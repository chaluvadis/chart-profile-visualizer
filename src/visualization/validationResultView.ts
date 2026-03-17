import * as path from "node:path";
import * as vscode from "vscode";
import type { ValidationResult, ValidationIssue } from "../processing/chartValidator";
import { loadTemplate, getTemplatePath } from "../webview/templateLoader";

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

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/\"/g, "&quot;")
		.replace(/'/g, "&#039;");
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
	return roots.some((root) => normalized === root || normalized.startsWith(`${root}${path.sep}`));
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

		// Handle messages from the webview
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
	}

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
			panel.webview.html = generateInlineValidationHtml(templateData);
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

	// Format timestamp
	const timestamp = new Date(result.timestamp).toLocaleString();
	const useCompactSummary = result.issues.length > 0 && result.issues.length <= 3;
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
		useCompactSummary,
		showFullSummary: !useCompactSummary,
		totalIssues: result.issues.length,
		summary: result.summary,
		hasErrors,
		hasWarnings,
		hasInfo,
		errors: formatIssues(errors),
		warnings: formatIssues(warnings),
		info: formatIssues(infos),
		errorCount: errors.length,
		warningCount: warnings.length,
		infoCount: infos.length,
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
		line: issue.line || null,
		lineNumber: issue.line && issue.line > 0 ? issue.line : 1,
		fileDisplay: issue.file ? `${issue.file}${issue.line && issue.line > 0 ? `:${issue.line}` : ""}` : null,
		remediation: issue.remediation || null,
		hasDetails: !!(issue.resource || issue.file || issue.remediation),
	}));
}

/**
 * Generate inline HTML for validation results (fallback)
 */
function generateInlineValidationHtml(data: Record<string, unknown>): string {
	const { valid, summary, errors, warnings, info, chartName, environment, timestamp } = data as {
		valid: boolean;
		summary: { errors: number; warnings: number; info: number };
		errors: Record<string, unknown>[];
		warnings: Record<string, unknown>[];
		info: Record<string, unknown>[];
		chartName: string;
		environment: string;
		timestamp: string;
	};

	const statusClass = valid ? "status-valid" : "status-invalid";
	const statusText = valid ? "✓ Chart Valid" : "✗ Chart Invalid";

	return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline';">
    <title>Validation Results</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 16px;
            margin: 0;
            line-height: 1.5;
        }
        .header {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 20px;
            padding-bottom: 16px;
            border-bottom: 1px solid var(--vscode-editor-lineHighlightBackground);
        }
        .status-badge {
            padding: 6px 12px;
            border-radius: 4px;
            font-weight: 600;
            font-size: 14px;
        }
        .status-valid {
            background-color: rgba(46, 160, 67, 0.2);
            color: #3fb950;
            border: 1px solid #3fb950;
        }
        .status-invalid {
            background-color: rgba(248, 81, 73, 0.2);
            color: #f85149;
            border: 1px solid #f85149;
        }
        .summary {
            display: flex;
            gap: 16px;
            margin-bottom: 24px;
        }
        .summary-item {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 8px 12px;
            background-color: var(--vscode-editor-lineHighlightBackground);
            border-radius: 4px;
        }
        .count {
            font-weight: 600;
            font-size: 16px;
        }
        .count-error { color: #f85149; }
        .count-warning { color: #d29922; }
        .count-info { color: #58a6ff; }
        .section {
            margin-bottom: 20px;
        }
        .section-header {
            display: flex;
            align-items: center;
            gap: 8px;
            cursor: pointer;
            padding: 8px 12px;
            background-color: var(--vscode-editor-lineHighlightBackground);
            border-radius: 4px;
            margin-bottom: 8px;
        }
        .section-header:hover {
            background-color: var(--vscode-editor-selectionBackground);
        }
        .section-title {
            font-weight: 600;
            font-size: 14px;
        }
        .section-count {
            background-color: var(--vscode-editor-selectionBackground);
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 12px;
        }
        .issue-card {
            padding: 12px;
            margin-bottom: 8px;
            border-radius: 4px;
            border-left: 3px solid;
        }
        .issue-error {
            border-left-color: #f85149;
            background-color: rgba(248, 81, 73, 0.1);
        }
        .issue-warning {
            border-left-color: #d29922;
            background-color: rgba(210, 153, 34, 0.1);
        }
        .issue-info {
            border-left-color: #58a6ff;
            background-color: rgba(88, 166, 255, 0.1);
        }
        .issue-header {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 6px;
        }
        .issue-code {
            font-family: var(--vscode-editor-font-family);
            font-size: 12px;
            padding: 2px 6px;
            border-radius: 3px;
            background-color: var(--vscode-editor-selectionBackground);
        }
        .issue-message {
            font-size: 13px;
        }
        .issue-details {
            margin-top: 8px;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
        .issue-details div {
            margin-top: 4px;
        }
        .issue-resource {
            color: #7ee787;
        }
        .issue-remediation {
            color: #ffa657;
        }
        .chart-info {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-top: 16px;
            padding-top: 12px;
            border-top: 1px solid var(--vscode-editor-lineHighlightBackground);
        }
        .collapsible-content {
            max-height: 1000px;
            overflow: hidden;
            transition: max-height 0.3s ease-out;
        }
        .collapsible-content.collapsed {
            max-height: 0;
        }
    </style>
</head>
<body>
    <div class="header">
        <span class="status-badge ${statusClass}">${statusText}</span>
        <span>Validation Results</span>
    </div>

    <div class="summary">
        <div class="summary-item">
            <span class="count count-error">${summary.errors}</span>
            <span>Errors</span>
        </div>
        <div class="summary-item">
            <span class="count count-warning">${summary.warnings}</span>
            <span>Warnings</span>
        </div>
        <div class="summary-item">
            <span class="count count-info">${summary.info}</span>
            <span>Info</span>
        </div>
    </div>

    ${generateSectionHtml("Errors", errors, "error", errors.length > 0)}
    ${generateSectionHtml("Warnings", warnings, "warning", warnings.length > 0)}
    ${generateSectionHtml("Info", info, "info", info.length > 0)}

    <div class="chart-info">
        <strong>Chart:</strong> ${chartName}<br>
        <strong>Environment:</strong> ${environment}<br>
        <strong>Timestamp:</strong> ${timestamp}
    </div>
</body>
</html>`;
}

/**
 * Generate HTML for a collapsible section
 */
function generateSectionHtml(
	title: string,
	issues: Record<string, unknown>[],
	severity: string,
	hasIssues: boolean
): string {
	if (!hasIssues) {
		return "";
	}

	const icon = severity === "error" ? "✗" : severity === "warning" ? "⚠" : "ℹ";
	const count = issues.length;

	const itemsHtml = issues
		.map((issue) => {
			const hasDetails = issue.hasDetails as boolean;
			const detailsHtml = hasDetails
				? `
            <div class="issue-details">
                ${issue.resource ? `<div class="issue-resource">📦 Resource: ${issue.resource}</div>` : ""}
                ${issue.file ? `<div>📄 File: ${issue.file}${issue.line ? `:${issue.line}` : ""}</div>` : ""}
                ${issue.remediation ? `<div class="issue-remediation">💡 Fix: ${issue.remediation}</div>` : ""}
            </div>
        `
				: "";

			return `
        <div class="issue-card issue-${severity}">
            <div class="issue-header">
                <span class="issue-code">${issue.code}</span>
            </div>
            <div class="issue-message">${issue.message}</div>
            ${detailsHtml}
        </div>
    `;
		})
		.join("");

	return `
    <div class="section">
        <div class="section-header" onclick="this.nextElementSibling.classList.toggle('collapsed')">
            <span>${icon}</span>
            <span class="section-title">${title}</span>
            <span class="section-count">${count}</span>
            <span style="margin-left: auto;">▼</span>
        </div>
        <div class="collapsible-content">
            ${itemsHtml}
        </div>
    </div>
`;
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
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline';">
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
				if (!isAllowedJumpPath(message.file)) {
					vscode.window.showErrorMessage("Refused to open file outside workspace");
					return;
				}
				try {
					const document = await vscode.workspace.openTextDocument(message.file);
					const editor = await vscode.window.showTextDocument(document, {
						viewColumn: vscode.ViewColumn.One,
						preserveFocus: false,
					});
					// Go to line if specified
					if (message.line && message.line > 0) {
						const position = new vscode.Position(message.line - 1, 0);
						editor.selection = new vscode.Selection(position, position);
						editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
					}
				} catch (error) {
					vscode.window.showErrorMessage(`Failed to open file: ${message.file}`);
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
