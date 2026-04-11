import * as path from "node:path";
import * as vscode from "vscode";
import type { ValidationIssue, ValidationResult } from "../processing/chartValidator";
import { escapeHtml, getTemplatePath, loadTemplate } from "../webview/templateLoader";

// Module-level state (singleton pattern for VSCode extension)
let validationPanel: vscode.WebviewPanel | undefined;
let validationContext: vscode.ExtensionContext | undefined;

// Store current validation params for refresh functionality
let currentValidationParams: { chartPath: string; environment: string } | undefined;

type ValidationWebviewCommand = "jumpToFile" | "refreshValidation" | "copyText";

interface ValidationWebviewMessage {
	command: ValidationWebviewCommand;
	file?: string;
	line?: number;
	text?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function parseValidationMessage(raw: unknown): ValidationWebviewMessage | null {
	if (!isRecord(raw) || typeof raw.command !== "string") {
		return null;
	}

	if (raw.command === "refreshValidation") {
		return { command: "refreshValidation" };
	}

	if (raw.command === "jumpToFile" && typeof raw.file === "string") {
		const line = typeof raw.line === "number" && Number.isFinite(raw.line) ? Math.floor(raw.line) : undefined;
		return {
			command: "jumpToFile",
			file: raw.file,
			line,
		};
	}

	if (raw.command === "copyText" && typeof raw.text === "string") {
		return {
			command: "copyText",
			text: raw.text,
		};
	}

	return null;
}

function isAllowedJumpPath(filePath: string): boolean {
	const normalized = path.resolve(filePath);
	const roots = vscode.workspace.workspaceFolders?.map((w) => path.resolve(w.uri.fsPath)) || [];

	if (roots.length === 0) {
		return false;
	}

	return roots.some((root) => {
		const relative = path.relative(root, normalized);
		return !relative.startsWith("..") && relative !== "";
	});
}

/**
 * Show validation results in a dedicated webview panel
 */
export async function showValidationResults(context: vscode.ExtensionContext, result: ValidationResult): Promise<void> {
	validationContext = context;

	const columnToShowIn = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

	// Build panel title
	const panelTitle = `Validation: ${result.chartPath.split("/").pop() || "Chart"}`;

	if (validationPanel) {
		validationPanel.reveal(columnToShowIn);
	} else {
		validationPanel = vscode.window.createWebviewPanel(
			"chartValidation",
			panelTitle,
			columnToShowIn || vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [context.extensionUri, vscode.Uri.file(context.extensionPath)],
			}
		);

		validationPanel.onDidDispose(
			() => {
				validationPanel = undefined;
			},
			null,
			context.subscriptions
		);
	}

	// Handle messages from the webview (always register, even for existing panel)
	validationPanel.webview.onDidReceiveMessage(
		async (rawMessage: unknown) => {
			const message = parseValidationMessage(rawMessage);
			if (!message) {
				vscode.window.showWarningMessage("Ignored invalid validation webview message");
				return;
			}
			await handleValidationMessage(message, context);
		},
		null,
		context.subscriptions
	);

	// Update the panel content
	await updateValidationPanel(result);
}

/**
 * Update the validation panel with new results
 */
async function updateValidationPanel(result: ValidationResult): Promise<void> {
	if (!validationPanel) {
		return;
	}

	const panel = validationPanel;
	const chartName = result.chartPath.split("/").pop() || "Chart";

	// Update title
	panel.title = `Validation: ${chartName} (${result.environment})`;

	// Store current validation params for refresh
	currentValidationParams = {
		chartPath: result.chartPath,
		environment: result.environment,
	};

	try {
		// Prepare data for the template
		const templateData = prepareValidationData(result, chartName);

		// Generate HTML content
		if (validationContext) {
			const extUri = validationContext.extensionUri;
			panel.webview.html = await loadTemplate(getTemplatePath("validation", extUri), templateData);
		} else {
			throw new Error("Extension context not available");
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		const extUri = validationContext?.extensionUri;
		panel.webview.html = await generateErrorHtml(errorMessage, extUri);
	}
}

/**
 * Prepare validation data for the template
 */
function prepareValidationData(result: ValidationResult, chartName: string): Record<string, unknown> {
	// Group issues by severity
	const errors = result.issues.filter((i) => i.severity === "error");
	const warnings = result.issues.filter((i) => i.severity === "warning");
	const infos = result.issues.filter((i) => i.severity === "info");

	// Group issues by category
	const categories = {
		lint: result.issues.filter((i) => i.category === "lint"),
		schema: result.issues.filter((i) => i.category === "schema"),
		template: result.issues.filter((i) => i.category === "template"),
		security: result.issues.filter((i) => i.category === "security"),
		unused: result.issues.filter((i) => i.category === "unused"),
		breaking: result.issues.filter((i) => i.category === "breaking"),
		general: result.issues.filter((i) => !i.category || i.category === "general"),
	};

	// Format timestamp
	const timestamp = new Date(result.timestamp).toLocaleString();
	const hasErrors = errors.length > 0;
	const hasWarnings = warnings.length > 0;
	const hasInfo = infos.length > 0;

	const statusClass = hasErrors ? "invalid" : hasWarnings || hasInfo ? "attention" : "valid";
	const statusIcon = hasErrors ? "✗" : hasWarnings ? "!" : hasInfo ? "i" : "✓";

	let statusTitle = "Validation Passed";
	let statusSubtitle = "All checks passed for this chart/environment";

	if (hasErrors) {
		statusTitle = "Validation Failed";
		statusSubtitle = `${result.issues.length} issue(s) found`;
	} else if (hasWarnings) {
		statusTitle = "Validation Passed with Warnings";
		statusSubtitle = `${warnings.length} warning(s) and ${infos.length} info item(s)`;
	} else if (hasInfo) {
		statusTitle = "Validation Passed with Notes";
		statusSubtitle = `${infos.length} informational check(s) found`;
	}

	// Create init data for webview
	const initData = {
		categories: {
			lint: formatIssues(categories.lint),
			schema: formatIssues(categories.schema),
			template: formatIssues(categories.template),
			security: formatIssues(categories.security),
			unused: formatIssues(categories.unused),
			breaking: formatIssues(categories.breaking),
			general: formatIssues(categories.general),
		},
		totalIssues: result.issues.length,
	};

	// Calculate metrics for status bar
	const uniqueCharts =
		result.issues.length > 0 ? new Set(result.issues.map((i) => i.chartPath || "[chart]")).size : 0;
	const uniqueFiles = result.issues.length > 0 ? new Set(result.issues.map((i) => i.file || "[no file]")).size : 0;

	const validationStatus = hasErrors ? "Failed" : hasWarnings ? "Partial" : "Passed";

	return {
		chartName,
		chartPath: result.chartPath,
		environment: result.environment,
		timestamp,
		valid: result.valid,
		statusIcon,
		statusClass,
		statusTitle,
		statusSubtitle,
		totalIssues: result.issues.length,
		summary: result.summary,
		hasErrors,
		hasWarnings,
		hasInfo,
		errorCount: errors.length,
		warningCount: warnings.length,
		infoCount: infos.length,
		initData: JSON.stringify(initData).replace(/</g, "\\u003c"),
		// Status bar metrics
		statusBar: JSON.stringify({
			totalCharts: uniqueCharts || 1,
			totalFiles: uniqueFiles || 0,
			totalLogs: result.issues.length,
			errorCount: errors.length,
			warningCount: warnings.length,
			status: validationStatus,
		}).replace(/</g, "\\u003c"),
	};
}

/**
 * Format issues for template display
 */
function formatIssues(issues: ValidationIssue[]): Record<string, unknown>[] {
	return issues.map((issue) => ({
		code: issue.code,
		message: issue.message,
		resource: issue.resource || null,
		file: issue.file || null,
		chartPath: issue.chartPath || null,
		line: issue.line || null,
		lineNumber: issue.line && issue.line > 0 ? issue.line : 1,
		fileDisplay: issue.file ? `${issue.file}${issue.line && issue.line > 0 ? `:${issue.line}` : ""}` : null,
		remediation: issue.remediation || null,
		hasDetails: !!(issue.resource || issue.file || issue.remediation),
		category: issue.category || "general",
		severity: issue.severity,
	}));
}

/**
 * Generate error HTML
 */
async function generateErrorHtml(errorMessage: string, extensionUri?: vscode.Uri): Promise<string> {
	if (extensionUri) {
		return await loadTemplate(getTemplatePath("error", extensionUri), {
			errorMessage: `Failed to load validation results: ${errorMessage}`,
		});
	}

	const escapedMessage = escapeHtml(errorMessage);

	return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'unsafe-inline'">
    <title>Error</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
        }
        .error-container {
            text-align: center;
            max-width: 500px;
        }
        .error-icon {
            font-size: 48px;
            color: var(--vscode-errorForeground);
        }
        .error-message {
            margin-top: 20px;
            color: var(--vscode-errorForeground);
        }
    </style>
</head>
<body>
    <div class="error-container">
        <div class="error-icon">⚠️</div>
        <h1>Error Loading Validation Results</h1>
        <p class="error-message">${escapedMessage}</p>
    </div>
</body>
</html>`;
}

/**
 * Close the validation panel if open
 */
export function closeValidationPanel(): void {
	if (validationPanel) {
		validationPanel.dispose();
		validationPanel = undefined;
	}
}

/**
 * Handle messages from the validation webview
 */
async function handleValidationMessage(
	message: ValidationWebviewMessage,
	context: vscode.ExtensionContext
): Promise<void> {
	switch (message.command) {
		case "copyText":
			if (typeof message.text === "string") {
				await vscode.env.clipboard.writeText(message.text);
			}
			break;
		case "jumpToFile":
			if (message.file) {
				let resolvedPath = message.file;
				if (!path.isAbsolute(message.file) && currentValidationParams) {
					resolvedPath = path.resolve(currentValidationParams.chartPath, message.file);
				}

				if (!isAllowedJumpPath(resolvedPath)) {
					vscode.window.showErrorMessage("Refused to open file outside workspace");
					return;
				}
				try {
					const fileUri = vscode.Uri.file(resolvedPath);
					const document = await vscode.workspace.openTextDocument(fileUri);
					const editor = await vscode.window.showTextDocument(document, {
						viewColumn: vscode.ViewColumn.One,
						preserveFocus: false,
					});
					if (message.line && message.line > 0) {
						const position = new vscode.Position(message.line - 1, 0);
						editor.selection = new vscode.Selection(position, position);
						editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
					}
				} catch (error) {
					vscode.window.showErrorMessage(`Failed to open file: ${resolvedPath}`);
				}
			}
			break;
		case "refreshValidation":
			// Re-run validation
			if (!currentValidationParams) {
				vscode.window.showWarningMessage("No validation to refresh");
				return;
			}
			vscode.window.showInformationMessage("Re-running validation...");
			try {
				// Import the validator and re-run
				const { createChartValidator } = await import("../processing/chartValidator");
				const validator = createChartValidator(currentValidationParams.chartPath);
				const newResult = await validator.validateAll(currentValidationParams.environment);
				// Update the panel with new results
				await updateValidationPanel(newResult);
				// Update stored params
				currentValidationParams = {
					chartPath: newResult.chartPath,
					environment: newResult.environment,
				};
				vscode.window.showInformationMessage(`Validation complete: ${newResult.issues.length} issue(s) found`);
			} catch (error) {
				vscode.window.showErrorMessage(
					`Failed to re-run validation: ${error instanceof Error ? error.message : String(error)}`
				);
			}
			break;
	}
}
