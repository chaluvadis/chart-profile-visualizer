import { Buffer } from "node:buffer";
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import * as vscode from "vscode";
import type { ChartTreeItem } from "../core/chartProfilesProvider";
import { type RenderedResource, renderHelmTemplate } from "../k8s/helmRenderer";
import {
	type ArchitectureNode,
	buildArchitectureNodes,
	detectRelationships,
	type ResourceRelationship,
} from "../processing/relationshipDetector";
import { parseResources, type ResourceHierarchy } from "./resourceVisualizer";
import { mergeValues } from "../processing/valuesMerger";
import { generateEnhancedHtml } from "./webviewHtmlGenerator";
import { generateDependencyVisualizationData } from "./dependencyVisualizer";
import { getKubernetesConnector } from "../k8s/kubernetesConnector";
import { getRuntimeStateManager } from "../state/runtimeStateManager";
import type { ComparisonWebviewData } from "../diff/environmentDiff";
import { loadTemplate, getTemplatePath } from "../webview/templateLoader";

// Re-export for backward compatibility
export type { ComparisonWebviewData };

/**
 * Kubernetes Secret resource structure
 */
interface KubernetesSecret {
	apiVersion: string;
	kind: string;
	metadata?: {
		name?: string;
		namespace?: string;
		annotations?: Record<string, string>;
		labels?: Record<string, string>;
	};
	type?: string;
	data?: Record<string, string>;
	stringData?: Record<string, string>;
}

// Module-level state (singleton pattern for VSCode extension)
let currentPanel: vscode.WebviewPanel | undefined;
let currentContext: vscode.ExtensionContext | undefined;
let renderedResources: RenderedResource[] = [];

// Pending comparison data queue to handle rapid successive comparisons
interface PendingComparison {
	data: ComparisonWebviewData | null;
	timestamp: number;
}
let pendingComparisonData: PendingComparison | null = null;

// Store comparison parameters for potential refresh
let lastComparisonParams: {
	chartPath: string;
	chartName: string;
	leftEnv: string;
	rightEnv: string;
} | null = null;

// Store current chart item for refresh functionality
let currentChartItem: ChartTreeItem | null = null;

const defaultNamespace = "default";

/**
 * WeakMap to associate comparison data with webview panels
 * This allows multiple panels to each have their own comparison state
 */
const panelComparisonData = new WeakMap<vscode.WebviewPanel, ComparisonWebviewData | null>();

/**
 * Get comparison data for the current panel
 */
function getCurrentComparisonData(): ComparisonWebviewData | null {
	return currentPanel ? (panelComparisonData.get(currentPanel) ?? null) : null;
}

/**
 * Set comparison data for the current panel
 */
function setCurrentComparisonData(data: ComparisonWebviewData | null): void {
	if (currentPanel) {
		panelComparisonData.set(currentPanel, data);
	}
}

/**
 * Type definition for messages received from the webview
 */
type WebviewMessageType =
	| "exportYaml"
	| "exportJson"
	| "exportComparison"
	| "refreshComparison"
	| "runComparison"
	| "copyResource"
	| "revealSecret"
	| "showError";

interface WebviewMessage {
	type: WebviewMessageType;
	yaml?: string;
	secretName?: string;
	namespace?: string;
	env1?: string;
	env2?: string;
	message?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function getOptionalString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function parseWebviewMessage(raw: unknown): WebviewMessage | null {
	if (!isRecord(raw) || typeof raw.type !== "string") {
		return null;
	}

	const baseType = raw.type as WebviewMessageType;
	const msg: WebviewMessage = {
		type: baseType,
		yaml: getOptionalString(raw.yaml),
		secretName: getOptionalString(raw.secretName),
		namespace: getOptionalString(raw.namespace),
		env1: getOptionalString(raw.env1),
		env2: getOptionalString(raw.env2),
		message: getOptionalString(raw.message),
	};

	switch (msg.type) {
		case "exportYaml":
		case "exportJson":
		case "exportComparison":
		case "refreshComparison":
			return msg;
		case "runComparison":
			return msg.env1 && msg.env2 ? msg : null;
		case "copyResource":
			return msg.yaml !== undefined ? msg : null;
		case "revealSecret":
			return msg.secretName ? msg : null;
		case "showError":
			return msg.message ? msg : null;
		default:
			return null;
	}
}

function getCurrentChartItem(): ChartTreeItem | null {
	return currentChartItem;
}

/**
 * Get current comparison data
 */
function getComparisonData(): ComparisonWebviewData | null {
	return getCurrentComparisonData();
}

/**
 * Set comparison data and optionally store parameters for refresh
 */
function setComparisonData(
	data: ComparisonWebviewData | null,
	params?: {
		chartPath: string;
		chartName: string;
		leftEnv: string;
		rightEnv: string;
	}
): void {
	setCurrentComparisonData(data);
	if (params) {
		lastComparisonParams = params;
	}
}

/**
 * Clear comparison data
 */
export function clearComparisonData(): void {
	setCurrentComparisonData(null);
}

/**
 * Show chart comparison view (chart-level, no specific environment)
 */
export async function showCompare(context: vscode.ExtensionContext, item: ChartTreeItem) {
	if (!item || !item.chart) {
		vscode.window.showErrorMessage("Invalid chart selected for comparison");
		return;
	}

	// Clear any previous comparison data so the selector shows up
	pendingComparisonData = null;
	setCurrentComparisonData(null);

	// Store the chart item
	currentChartItem = item;
	lastComparisonParams = null;

	currentContext = context;

	const columnToShowIn = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

	// Build panel title for comparison
	const panelTitle = `Chart: ${item.chart.name} - Compare Environments`;

	if (currentPanel) {
		currentPanel.reveal(columnToShowIn);
	} else {
		currentPanel = vscode.window.createWebviewPanel(
			"chartVisualization",
			panelTitle,
			columnToShowIn || vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [
					context.extensionUri,
					vscode.Uri.file(path.join(context.extensionPath, "images")),
					vscode.Uri.file(path.join(context.extensionPath, "vendor")),
				],
			}
		);

		currentPanel.onDidDispose(
			() => {
				currentPanel = undefined;
			},
			null,
			context.subscriptions
		);

		// Handle messages from the webview
		currentPanel.webview.onDidReceiveMessage(
			async (rawMessage: unknown) => {
				const message = parseWebviewMessage(rawMessage);
				if (!message) {
					vscode.window.showWarningMessage("Ignored invalid webview message");
					return;
				}
				await handleMessage(message);
			},
			undefined,
			context.subscriptions
		);
	}

	// Update the webview content
	await updatePanelForCompare(item);
}

export async function show(
	context: vscode.ExtensionContext,
	item: ChartTreeItem,
	comparisonData?: ComparisonWebviewData | null
) {
	if (!item || !item.chart || !item.environment) {
		vscode.window.showErrorMessage("Invalid item selected for visualization");
		return;
	}

	// Store comparison data to be set after panel is created
	pendingComparisonData = comparisonData !== undefined ? { data: comparisonData, timestamp: Date.now() } : null;

	// Store the chart item and comparison parameters for potential refresh
	currentChartItem = item;
	if (comparisonData?.header) {
		lastComparisonParams = {
			chartPath: item.chart.path,
			chartName: item.chart.name,
			leftEnv: comparisonData.header.leftEnv,
			rightEnv: comparisonData.header.rightEnv,
		};
	}

	currentContext = context;

	const columnToShowIn = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

	// Build panel title - show both environments if comparison data exists
	let panelTitle: string;
	if (comparisonData?.header) {
		panelTitle = `Chart: ${item.chart.name} (${comparisonData.header.leftEnv} vs ${comparisonData.header.rightEnv})`;
	} else {
		panelTitle = `Chart: ${item.chart.name} (${item.environment})`;
	}

	if (currentPanel) {
		currentPanel.reveal(columnToShowIn);
	} else {
		currentPanel = vscode.window.createWebviewPanel(
			"chartVisualization",
			panelTitle,
			columnToShowIn || vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [
					context.extensionUri,
					vscode.Uri.file(path.join(context.extensionPath, "images")),
					vscode.Uri.file(path.join(context.extensionPath, "vendor")),
				],
			}
		);

		currentPanel.onDidDispose(
			() => {
				currentPanel = undefined;
				// Note: The WeakMap entry will be cleaned up when the panel object
				// is garbage collected (when there are no other references to it)
			},
			null,
			context.subscriptions
		);

		// Handle messages from the webview
		currentPanel.webview.onDidReceiveMessage(
			async (rawMessage: unknown) => {
				const message = parseWebviewMessage(rawMessage);
				if (!message) {
					vscode.window.showWarningMessage("Ignored invalid webview message");
					return;
				}
				await handleMessage(message);
			},
			undefined,
			context.subscriptions
		);
	}

	// Transfer any pending comparison data to the panel (for both new and existing panels)
	if (pendingComparisonData) {
		setCurrentComparisonData(pendingComparisonData.data);
		pendingComparisonData = null;
	}

	// Update the webview content
	await updatePanel(item);
}

async function updatePanel(item: ChartTreeItem) {
	if (!currentPanel) {
		return;
	}

	const panel = currentPanel;

	// Build panel title - show both environments if comparison data exists
	const comparisonData = getCurrentComparisonData();
	let panelTitle: string;
	if (comparisonData?.header) {
		panelTitle = `Chart: ${item.chart?.name} (${comparisonData.header.leftEnv} vs ${comparisonData.header.rightEnv})`;
	} else {
		panelTitle = `Chart: ${item.chart?.name} (${item.environment})`;
	}
	panel.title = panelTitle;

	try {
		// Collect data for visualization
		const chartData = await collectChartData(item);

		// Generate and set HTML content
		if (currentContext) {
			const extUri = currentContext.extensionUri;
			panel.webview.html = await generateEnhancedHtml(panel.webview, chartData, extUri, false);
		} else {
			// Fallback - should never happen, but handle gracefully
			panel.webview.html = await getErrorHtml("Extension context not available");
		}
	} catch (error: any) {
		vscode.window.showErrorMessage(`[FIXED] Error loading chart visualization: ${error.message}`);
		const extUri = currentContext?.extensionUri;
		panel.webview.html = await getErrorHtml(error.message, extUri);
	}
}

/**
 * Update panel for chart-level comparison (no specific environment)
 */
async function updatePanelForCompare(item: ChartTreeItem) {
	if (!currentPanel) {
		return;
	}

	const panel = currentPanel;

	// Build panel title for comparison
	const panelTitle = `Chart: ${item.chart?.name} - Compare Environments`;
	panel.title = panelTitle;

	try {
		// Collect data for comparison (need to provide a dummy environment for data collection)
		// We'll use the first available environment or a placeholder
		const chartData = await collectChartDataForCompare(item);

		// Generate and set HTML content
		if (currentContext) {
			const extUri = currentContext.extensionUri;
			panel.webview.html = await generateEnhancedHtml(panel.webview, chartData, extUri, true);
		} else {
			panel.webview.html = await getErrorHtml("Extension context not available");
		}
	} catch (error: any) {
		vscode.window.showErrorMessage(`[NEW CODE] Error loading chart comparison: ${error.message}`);
		const extUri = currentContext?.extensionUri;
		panel.webview.html = await getErrorHtml(error.message, extUri);
	}
}

/**
 * Handle messages from the webview
 */
async function handleMessage(message: WebviewMessage) {
	switch (message.type) {
		case "exportYaml":
			await exportResources("yaml");
			break;
		case "exportJson":
			await exportResources("json");
			break;
		case "exportComparison":
			await exportComparisonResults();
			break;
		case "runComparison":
			// Run comparison from the webview UI
			if (message.env1 && message.env2) {
				await runComparisonFromWebview(message.env1, message.env2);
			} else {
				vscode.window.showErrorMessage("Please select two environments to compare");
			}
			break;
		case "refreshComparison":
			// Check if we have stored comparison parameters to re-run
			if (lastComparisonParams && currentContext) {
				try {
					// Re-run the comparison
					const { chartPath, chartName, leftEnv, rightEnv } = lastComparisonParams;

					// Import and run the comparison
					const { compareEnvironments, formatComparisonForWebview } = await import("../diff/environmentDiff");
					const { renderHelmTemplate } = await import("../k8s/helmRenderer");

					vscode.window.showInformationMessage(`Re-running comparison: ${leftEnv} vs ${rightEnv}...`);

					const releaseName1 = `${chartName}-${leftEnv}`;
					const releaseName2 = `${chartName}-${rightEnv}`;

					const resources1 = await renderHelmTemplate(chartPath, leftEnv, releaseName1);
					const resources2 = await renderHelmTemplate(chartPath, rightEnv, releaseName2);

					const comparison = compareEnvironments(leftEnv, resources1, rightEnv, resources2, chartName);
					const comparisonData = formatComparisonForWebview(comparison);

					// Update stored data and refresh the webview
					setCurrentComparisonData(comparisonData);

					// Get the current item and refresh the panel
					const currentItem = getCurrentChartItem();
					if (currentItem) {
						await updatePanel(currentItem);
					}

					vscode.window.showInformationMessage(
						`Comparison refreshed: ${comparison.summary.added} added, ${comparison.summary.removed} removed, ${comparison.summary.modified} modified`
					);
					return;
				} catch (error) {
					console.error("Error refreshing comparison:", error);
					vscode.window.showErrorMessage(
						`Failed to refresh comparison: ${error instanceof Error ? error.message : String(error)}`
					);
					return;
				}
			}

			// Fallback: clear and inform user
			clearComparisonData();
			vscode.window.showInformationMessage(
				"Comparison data cleared. Use the dropdowns in Compare Environments tab to run a new comparison."
			);
			break;
		case "copyResource":
			if (message.yaml) {
				await vscode.env.clipboard.writeText(message.yaml);
				vscode.window.showInformationMessage("Resource YAML copied to clipboard");
			}
			break;
		case "revealSecret":
			if (message.secretName) {
				await revealSecret(message.secretName, message.namespace);
			}
			break;
		case "showError":
			if (message.message) {
				vscode.window.showErrorMessage(message.message.slice(0, 500));
			}
			break;
	}
}

/**
 * Run comparison from the webview UI
 */
async function runComparisonFromWebview(env1: string, env2: string): Promise<void> {
	const currentItem = getCurrentChartItem();
	if (!currentItem) {
		vscode.window.showErrorMessage("No chart selected. Please select a chart first.");
		return;
	}

	const chartPath = currentItem.chart?.path;
	const chartName = currentItem.chart?.name;

	if (!chartPath || !chartName) {
		vscode.window.showErrorMessage("Invalid chart information.");
		return;
	}

	try {
		vscode.window.showInformationMessage(`Comparing ${env1} vs ${env2}...`);

		const { compareEnvironments, formatComparisonForWebview } = await import("../diff/environmentDiff");
		const { renderHelmTemplate } = await import("../k8s/helmRenderer");

		const releaseName1 = `${chartName}-${env1}`;
		const releaseName2 = `${chartName}-${env2}`;

		const resources1 = await renderHelmTemplate(chartPath, env1, releaseName1);
		const resources2 = await renderHelmTemplate(chartPath, env2, releaseName2);

		const comparison = compareEnvironments(env1, resources1, env2, resources2, chartName);
		const comparisonData = formatComparisonForWebview(comparison);

		// Update stored data and refresh the webview
		setCurrentComparisonData(comparisonData);

		// Update lastComparisonParams for refresh
		lastComparisonParams = {
			chartPath,
			chartName,
			leftEnv: env1,
			rightEnv: env2,
		};

		// Refresh the panel
		if (currentItem) {
			// Use the comparison mode function, not the regular visualization function
			await updatePanelForCompare(currentItem);
		}

		vscode.window.showInformationMessage(
			`Comparison complete: ${comparison.summary.added} added, ${comparison.summary.removed} removed, ${comparison.summary.modified} modified`
		);
	} catch (error) {
		console.error("Error running comparison from webview:", error);
		vscode.window.showErrorMessage(
			`Failed to run comparison: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

/**
 * Reveal secret data from the Kubernetes cluster
 * Fetches the actual secret values and displays them in a new document
 */
async function revealSecret(secretName: string, namespace?: string): Promise<void> {
	const connector = getKubernetesConnector();
	const runtimeStateManager = getRuntimeStateManager();

	// Check if connected to cluster
	const clusterInfo = await connector.getClusterInfo();
	if (!clusterInfo.connected) {
		vscode.window.showErrorMessage("Not connected to Kubernetes cluster. Cannot reveal secret data.");
		return;
	}

	// Check if kubectl is available
	const kubectlAvailable = await connector.isKubectlAvailable();
	if (!kubectlAvailable) {
		vscode.window.showErrorMessage("kubectl is not available. Install kubectl to reveal secret data.");
		return;
	}

	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: `Fetching secret "${secretName}"...`,
			cancellable: false,
		},
		async () => {
			try {
				const ns = namespace || clusterInfo.namespace || "default";

				// Get the secret YAML from cluster using runtime state manager
				const secretYaml = await runtimeStateManager.getResourceYaml("secret", secretName, ns);

				// Parse the secret with proper typing
				const secretObj = yaml.load(secretYaml) as KubernetesSecret;

				if (!secretObj || !secretObj.data) {
					vscode.window.showWarningMessage(
						`Secret "${secretName}" has no data field or could not be parsed.`
					);
					return;
				}

				// Decode base64 values
				const decodedData: Record<string, string> = {};
				const data = secretObj.data;

				for (const [key, base64Value] of Object.entries(data)) {
					try {
						// Decode base64 to string
						const decoded = Buffer.from(base64Value, "base64").toString("utf8");
						decodedData[key] = decoded;
					} catch {
						// If decoding fails, show the raw base64
						decodedData[key] = `[base64 decode failed] ${base64Value}`;
					}
				}

				// Build the revealed secret document
				const lines: string[] = [];
				lines.push("# ═══════════════════════════════════════════════════════════════");
				lines.push("# ⚠️  REVEALED SECRET DATA - HANDLE WITH CARE");
				lines.push("# ═══════════════════════════════════════════════════════════════");
				lines.push(`# Secret: ${secretName}`);
				lines.push(`# Namespace: ${ns}`);
				lines.push(`# Revealed at: ${new Date().toISOString()}`);
				lines.push("# ═══════════════════════════════════════════════════════════════");
				lines.push("");
				lines.push("## Original Secret (with base64 encoded data)");
				lines.push("```yaml");
				lines.push(
					yaml.dump(
						{
							apiVersion: secretObj.apiVersion,
							kind: secretObj.kind,
							metadata: {
								name: secretObj.metadata?.name,
								namespace: secretObj.metadata?.namespace,
							},
							type: secretObj.type,
							data: secretObj.data,
						},
						{ indent: 2 }
					)
				);
				lines.push("```");
				lines.push("");
				lines.push("## Decoded Secret Data");
				lines.push("```yaml");
				lines.push(yaml.dump(decodedData, { indent: 2 }));
				lines.push("```");
				lines.push("");
				lines.push("# ═══════════════════════════════════════════════════════════════");
				lines.push("# ⚠️  SECURITY WARNING");
				lines.push("# ═══════════════════════════════════════════════════════════════");
				lines.push("# - This document contains sensitive data");
				lines.push("# - Do not commit this file to version control");
				lines.push("# - Close this document after reviewing");
				lines.push("# - Consider using Kubernetes secrets management best practices");
				lines.push("# ═══════════════════════════════════════════════════════════════");

				// Open in a new document
				const doc = await vscode.workspace.openTextDocument({
					content: lines.join("\n"),
					language: "markdown",
				});

				await vscode.window.showTextDocument(doc, {
					preview: true,
					viewColumn: vscode.ViewColumn.Beside,
				});

				// Show warning message
				vscode.window.showWarningMessage(
					`Secret "${secretName}" revealed. This document contains sensitive data.`
				);
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : String(error);

				if (errorMessage.includes("NotFound") || errorMessage.includes("not found")) {
					vscode.window.showErrorMessage(
						`Secret "${secretName}" not found in namespace "${namespace || "default"}". The secret may not be deployed yet.`
					);
				} else {
					vscode.window.showErrorMessage(`Failed to reveal secret: ${errorMessage}`);
				}
			}
		}
	);
}

/**
 * Export resources to a file
 */
async function exportResources(format: "yaml" | "json") {
	if (renderedResources.length === 0) {
		vscode.window.showWarningMessage("No resources to export");
		return;
	}

	const defaultExt = format === "yaml" ? "yaml" : "json";
	const defaultFileName = `rendered-resources.${defaultExt}`;

	// Get a sensible default directory
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
	const defaultUri = workspaceFolder ? vscode.Uri.joinPath(workspaceFolder, defaultFileName) : undefined;

	const uri = await vscode.window.showSaveDialog({
		defaultUri,
		filters: {
			[format.toUpperCase()]: [defaultExt],
		},
	});

	if (!uri) {
		return;
	}

	try {
		let content: string;
		if (format === "yaml") {
			// Export as YAML documents
			content = renderedResources.map((r) => r.yaml).join("\n---\n");
		} else {
			// Export as JSON
			const jsonData = renderedResources.map((r) => {
				try {
					const yamlContent = r.yaml.replace(/^#.*$/gm, "").trim();
					return yaml.load(yamlContent);
				} catch {
					return { raw: r.yaml };
				}
			});
			content = JSON.stringify(jsonData, null, 2);
		}

		await fs.promises.writeFile(uri.fsPath, content, "utf8");
		vscode.window.showInformationMessage(`Resources exported to ${uri.fsPath}`);
	} catch (error: any) {
		vscode.window.showErrorMessage(`Export failed: ${error.message}`);
	}
}

/**
 * Export comparison results to a file (callable from extension commands)
 */
export async function exportComparisonReport(): Promise<void> {
	return exportComparisonResults();
}

/**
 * Export comparison results to a file
 */
async function exportComparisonResults() {
	const data = getCurrentComparisonData();
	if (!data) {
		vscode.window.showWarningMessage("No comparison data to export");
		return;
	}

	const defaultFileName = `comparison-${data.header.leftEnv}-vs-${data.header.rightEnv}.md`;
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
	const defaultUri = workspaceFolder ? vscode.Uri.joinPath(workspaceFolder, defaultFileName) : undefined;

	const uri = await vscode.window.showSaveDialog({
		defaultUri,
		filters: {
			Markdown: ["md"],
			JSON: ["json"],
		},
	});

	if (!uri) {
		return;
	}

	try {
		let content: string;
		const ext = uri.fsPath.split(".").pop()?.toLowerCase();

		// Default to markdown if extension is not explicitly json
		if (ext === "json") {
			content = JSON.stringify(data, null, 2);
		} else {
			// Generate markdown for .md extension or any other case
			content = generateComparisonMarkdown(data);
		}

		await fs.promises.writeFile(uri.fsPath, content, "utf8");
		vscode.window.showInformationMessage(`Comparison exported to ${uri.fsPath}`);
	} catch (error: any) {
		vscode.window.showErrorMessage(`Export failed: ${error.message}`);
	}
}

/**
 * Generate markdown representation of comparison results
 */
function generateComparisonMarkdown(data: ComparisonWebviewData): string {
	const lines: string[] = [];
	const timestamp = new Date().toISOString();

	lines.push(`# Comparison Report: ${data.header.leftEnv} vs ${data.header.rightEnv}`);
	lines.push(`**Chart:** ${data.header.chartName}`);
	lines.push(`**Generated:** ${timestamp}`);
	lines.push("");

	// Summary section
	lines.push("## Summary");
	lines.push("");
	lines.push("### Change Counts");
	lines.push(`| Category | Count |`);
	lines.push(`|----------|-------|`);
	lines.push(`| Added    | ${data.summary.added} |`);
	lines.push(`| Removed  | ${data.summary.removed} |`);
	lines.push(`| Modified | ${data.summary.modified} |`);
	lines.push(`| Unchanged | ${data.summary.unchanged} |`);
	lines.push(`| **Total** | **${data.summary.total}** |`);
	if (data.summary.changePercentage !== undefined) {
		lines.push(`| Change % | ${data.summary.changePercentage.toFixed(1)}% |`);
	}
	lines.push("");

	// Severity counts
	const hasSeverity = data.summary.critical > 0 || data.summary.warning > 0 || data.summary.info > 0;
	if (hasSeverity) {
		lines.push("### Severity Counts");
		lines.push("");
		lines.push(`| Severity | Count |`);
		lines.push(`|----------|-------|`);
		if (data.summary.critical > 0) lines.push(`| 🔴 Critical | ${data.summary.critical} |`);
		if (data.summary.warning > 0) lines.push(`| 🟡 Warning  | ${data.summary.warning} |`);
		if (data.summary.info > 0) lines.push(`| 🔵 Info     | ${data.summary.info} |`);
		lines.push("");
	}

	// Drift list
	const changedResources = data.resources.filter((r) => r.diffType.toLowerCase() !== "unchanged");
	if (changedResources.length > 0) {
		lines.push("## Drift List");
		lines.push("");

		for (const resource of changedResources) {
			const ns = resource.namespace ? ` (${resource.namespace})` : "";
			const severity = resource.maxSeverity ? ` — **${resource.maxSeverity}**` : "";
			lines.push(`### ${resource.kind}/${resource.name}${ns}`);
			lines.push(`**Status:** ${resource.diffType}${severity}`);

			if (resource.fields && resource.fields.length > 0) {
				lines.push("");
				lines.push(`| Field | ${data.header.leftEnv} | ${data.header.rightEnv} | Severity |`);
				lines.push(`|-------|${"-".repeat(data.header.leftEnv.length + 2)}|${"-".repeat(data.header.rightEnv.length + 2)}|----------|`);
				for (const field of resource.fields) {
					const leftVal = field.leftValue === undefined ? "*(absent)*" : `\`${JSON.stringify(field.leftValue)}\``;
					const rightVal = field.rightValue === undefined ? "*(absent)*" : `\`${JSON.stringify(field.rightValue)}\``;
					const fieldSev = field.severity ?? "info";
					lines.push(`| \`${field.path}\` | ${leftVal} | ${rightVal} | ${fieldSev} |`);
				}
			}
			lines.push("");
		}
	} else {
		lines.push("## Drift List");
		lines.push("");
		lines.push("No differences found between environments.");
		lines.push("");
	}

	return lines.join("\n");
}

async function collectChartData(item: ChartTreeItem): Promise<ChartData> {
	const chart = item.chart;
	const environment = item.environment;

	// Validate required fields
	if (!chart?.path || !environment || !chart?.name) {
		throw new Error("Invalid chart item: missing required fields");
	}

	const chartPath = chart.path;
	const chartName = chart.name;

	// Load base values separately for comparison
	const baseValuesPath = path.join(chartPath, "values.yaml");
	const baseValues = loadYamlFile(baseValuesPath);

	// Merge values to get configuration
	const comparison = mergeValues(chartPath, environment);

	// Extract overridden values with their source information
	const overriddenValues: Array<{
		key: string;
		baseValue: any;
		envValue: any;
	}> = [];

	for (const [key, detail] of comparison.details.entries()) {
		if (detail.overridden) {
			// Get the base value by traversing the base values object
			const baseValue = getValueByPath(baseValues, key);
			overriddenValues.push({
				key,
				baseValue: baseValue !== undefined ? baseValue : "(not set)",
				envValue: detail.value,
			});
		}
	}

	const totalValues = comparison.details.size;
	const overriddenCount = overriddenValues.length;

	// Try to get rendered resources
	const resourceCounts: { [key: string]: number } = {};
	const namespaceCounts: { [namespace: string]: number } = {};
	let templateSources: string[] = [];
	let resources: RenderedResource[] = [];

	try {
		const releaseName = `${chartName}-${environment}`;
		resources = await renderHelmTemplate(chartPath, environment, releaseName);

		// Store resources for export
		renderedResources = resources;

		resources.forEach((resource) => {
			// Count by resource kind
			resourceCounts[resource.kind] = (resourceCounts[resource.kind] || 0) + 1;

			// Count by namespace (if present)
			const namespace = resource.namespace || defaultNamespace;
			namespaceCounts[namespace] = (namespaceCounts[namespace] || 0) + 1;
		});

		// Get list of template files
		const templatesDir = path.join(chartPath, "templates");
		if (fs.existsSync(templatesDir)) {
			const files = fs.readdirSync(templatesDir);
			templateSources = files.filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
		}
	} catch (error) {
		console.warn("Could not render templates for visualization:", error);
	}

	// Parse resources into hierarchy
	const resourceHierarchy = parseResources(resources);

	// Detect relationships and build architecture
	const structuredResources = Array.from(resourceHierarchy.kindGroups.values()).flatMap((group) => group.resources);
	const relationships = detectRelationships(structuredResources);
	const architectureNodes = buildArchitectureNodes(structuredResources, relationships);

	// Get available environments from the chart directory
	let availableEnvs: string[] = [];
	try {
		const envFiles = fs.readdirSync(chartPath).filter((f: string) => f.match(/^values-(.+)\.ya?ml$/));
		availableEnvs = envFiles.map((f: string) => f.match(/^values-(.+)\.ya?ml$/)![1]);
	} catch (error) {
		console.warn("Could not read environment files:", error);
	}

	// Get dependency visualization data
	let dependencyData: {
		nodes: Array<{
			id: string;
			label: string;
			type: "root" | "dependency";
			version: string;
			enabled: boolean;
			repository: string;
		}>;
		edges: Array<{ source: string; target: string; type: string }>;
		summary: { total: number; enabled: number; disabled: number; conflicts: number };
	};
	try {
		dependencyData = generateDependencyVisualizationData(chartPath);
	} catch (error) {
		console.warn("Failed to generate dependency data:", error);
		dependencyData = { nodes: [], edges: [], summary: { total: 0, enabled: 0, disabled: 0, conflicts: 0 } };
	}
	return {
		chartName,
		environment,
		totalValues,
		overriddenCount,
		overriddenValues, // All overridden values
		resourceCounts,
		namespaceCounts,
		templateSources,
		resources,
		resourceHierarchy,
		architectureNodes,
		relationships,
		comparisonData: getCurrentComparisonData(),
		availableEnvs,
		dependencyData,
	};
}

/**
 * Collect chart data for comparison view (chart-level, no specific environment)
 */
async function collectChartDataForCompare(item: ChartTreeItem): Promise<ChartData> {
	const chart = item.chart;

	// Validate required fields
	if (!chart?.path || !chart?.name) {
		const errorDetails = `chart=${JSON.stringify(chart)}, chartPath=${chart?.path}, chartName=${chart?.name}`;
		throw new Error(`Invalid chart item: missing required fields. Details: ${errorDetails}`);
	}

	const chartPath = chart.path;
	const chartName = chart.name;

	// Get available environments from the chart directory
	let availableEnvs: string[] = [];
	try {
		const envFiles = fs.readdirSync(chartPath).filter((f: string) => f.match(/^values-(.+)\.ya?ml$/));
		availableEnvs = envFiles.map((f: string) => f.match(/^values-(.+)\.ya?ml$/)![1]);
	} catch (error) {
		console.warn("Could not read environment files:", error);
	}

	// Use the first available environment for data collection
	// (or "default" if no environments found)
	const environment = availableEnvs.length > 0 ? availableEnvs[0] : "default";

	// Load base values separately for comparison
	const baseValuesPath = path.join(chartPath, "values.yaml");
	const baseValues = loadYamlFile(baseValuesPath);

	// Merge values to get configuration
	const comparison = mergeValues(chartPath, environment);

	// Extract overridden values with their source information
	const overriddenValues: Array<{
		key: string;
		baseValue: any;
		envValue: any;
	}> = [];

	for (const [key, detail] of comparison.details.entries()) {
		if (detail.overridden) {
			const baseValue = getValueByPath(baseValues, key);
			overriddenValues.push({
				key,
				baseValue: baseValue !== undefined ? baseValue : "(not set)",
				envValue: detail.value,
			});
		}
	}

	const totalValues = comparison.details.size;
	const overriddenCount = overriddenValues.length;

	// Try to get rendered resources
	const resourceCounts: { [key: string]: number } = {};
	const namespaceCounts: { [namespace: string]: number } = {};
	let templateSources: string[] = [];
	let resources: RenderedResource[] = [];

	try {
		const releaseName = `${chartName}-${environment}`;
		resources = await renderHelmTemplate(chartPath, environment, releaseName);

		// Store resources for export
		renderedResources = resources;

		resources.forEach((resource) => {
			resourceCounts[resource.kind] = (resourceCounts[resource.kind] || 0) + 1;
			const namespace = resource.namespace || defaultNamespace;
			namespaceCounts[namespace] = (namespaceCounts[namespace] || 0) + 1;
		});

		const templatesDir = path.join(chartPath, "templates");
		if (fs.existsSync(templatesDir)) {
			const files = fs.readdirSync(templatesDir);
			templateSources = files.filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
		}
	} catch (error) {
		console.warn("Could not render templates for visualization:", error);
	}

	// Parse resources into hierarchy
	const resourceHierarchy = parseResources(resources);

	// Detect relationships and build architecture
	const structuredResources = Array.from(resourceHierarchy.kindGroups.values()).flatMap((group) => group.resources);
	const relationships = detectRelationships(structuredResources);
	const architectureNodes = buildArchitectureNodes(structuredResources, relationships);

	return {
		chartName,
		environment,
		totalValues,
		overriddenCount,
		overriddenValues,
		resourceCounts,
		namespaceCounts,
		templateSources,
		resources,
		resourceHierarchy,
		architectureNodes,
		relationships,
		comparisonData: getCurrentComparisonData(), // Use stored comparison data if available
		availableEnvs,
	};
}

async function getErrorHtml(errorMessage: string, extensionUri?: vscode.Uri): Promise<string> {
	// If we have an extension URI, use the template; otherwise fall back to inline HTML
	if (extensionUri) {
		return loadTemplate(getTemplatePath("error", extensionUri), { errorMessage });
	}

	// Fallback inline error HTML (should not happen in normal operation)
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
        <h1>Error Loading Visualization</h1>
        <p class="error-message">${escapeHtml(errorMessage)}</p>
    </div>
</body>
</html>`;
}

interface ChartData {
	chartName: string;
	environment: string;
	totalValues: number;
	overriddenCount: number;
	overriddenValues: Array<{
		key: string;
		baseValue: any;
		envValue: any;
	}>;
	resourceCounts: { [key: string]: number };
	namespaceCounts: { [namespace: string]: number };
	templateSources: string[];
	resources: RenderedResource[];
	resourceHierarchy: ResourceHierarchy;
	architectureNodes: ArchitectureNode[];
	relationships: ResourceRelationship[];
	comparisonData?: ComparisonWebviewData | null;
	availableEnvs?: string[];
	dependencyData?: {
		nodes: Array<{
			id: string;
			label: string;
			type: "root" | "dependency";
			version: string;
			enabled: boolean;
			repository: string;
		}>;
		edges: Array<{
			source: string;
			target: string;
			type: string;
		}>;
		summary: {
			total: number;
			enabled: number;
			disabled: number;
			conflicts: number;
		};
	};
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

/**
 * Get a value from a nested object using a dot-notation path
 */
function getValueByPath(obj: any, path: string): any {
	const parts = path.split(".");
	let current = obj;

	for (const part of parts) {
		if (current === undefined || current === null) {
			return undefined;
		}
		current = current[part];
	}

	return current;
}

/**
 * Load a YAML file and return its parsed content
 */
function loadYamlFile(filePath: string): any {
	try {
		if (fs.existsSync(filePath)) {
			const content = fs.readFileSync(filePath, "utf8");
			return yaml.load(content) || {};
		}
	} catch (error) {
		console.error(`Error loading YAML file ${filePath}:`, error);
	}
	return {};
}
