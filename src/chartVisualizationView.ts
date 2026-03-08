import { Buffer } from "node:buffer";
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import * as vscode from "vscode";
import type { ChartTreeItem } from "./chartProfilesProvider";
import { type RenderedResource, renderHelmTemplate } from "./helmRenderer";
import {
	type ArchitectureNode,
	buildArchitectureNodes,
	detectRelationships,
	type ResourceRelationship,
} from "./relationshipDetector";
import { parseResources, type ResourceHierarchy } from "./resourceVisualizer";
import { mergeValues } from "./valuesMerger";
import { generateEnhancedHtml } from "./webviewHtmlGenerator";
import { getKubernetesConnector } from "./kubernetesConnector";
import { getRuntimeStateManager } from "./runtimeStateManager";
import type { ComparisonWebviewData } from "./environmentDiff";
import { loadTemplate, getTemplatePath } from "./webview/templateLoader";

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
	| "copyResource"
	| "revealSecret";

interface WebviewMessage {
	type: WebviewMessageType;
	yaml?: string;
	secretName?: string;
	namespace?: string;
}

/**
 * Store comparison parameters for potential refresh
 */
export function storeComparisonParams(params: {
	chartPath: string;
	chartName: string;
	leftEnv: string;
	rightEnv: string;
}): void {
	lastComparisonParams = params;
}

/**
 * Get stored comparison parameters
 */
export function getComparisonParams(): typeof lastComparisonParams {
	return lastComparisonParams;
}

/**
 * Get the current chart item for refresh
 */
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
			async (message) => {
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
			panel.webview.html = await generateEnhancedHtml(panel.webview, chartData, extUri);
		} else {
			// Fallback - should never happen, but handle gracefully
			panel.webview.html = await getErrorHtml("Extension context not available");
		}
	} catch (error: any) {
		vscode.window.showErrorMessage(`Error loading chart visualization: ${error.message}`);
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
		case "refreshComparison":
			// Check if we have stored comparison parameters to re-run
			if (lastComparisonParams && currentContext) {
				try {
					// Re-run the comparison
					const { chartPath, chartName, leftEnv, rightEnv } = lastComparisonParams;

					// Import and run the comparison
					const { compareEnvironments, formatComparisonForWebview } = await import("./environmentDiff");
					const { renderHelmTemplate } = await import("./helmRenderer");

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
			vscode.window
				.showInformationMessage(
					"Comparison data cleared. Click 'Compare Environments' in the command palette to run a new comparison.",
					"Run Comparison"
				)
				.then((selection) => {
					if (selection === "Run Comparison") {
						vscode.commands.executeCommand("chartProfiles.compareEnvironments");
					}
				});
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
 * Export comparison results to a file
 */
async function exportComparisonResults() {
	const data = getCurrentComparisonData();
	if (!data) {
		vscode.window.showWarningMessage("No comparison data to export");
		return;
	}

	const uri = await vscode.window.showSaveDialog({
		filters: {
			JSON: ["json"],
			Markdown: ["md"],
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
	lines.push(`# Comparison: ${data.header.leftEnv} vs ${data.header.rightEnv}`);
	lines.push(`## Chart: ${data.header.chartName}`);
	lines.push("");
	lines.push("## Summary");
	lines.push(`- Added: ${data.summary.added}`);
	lines.push(`- Removed: ${data.summary.removed}`);
	lines.push(`- Modified: ${data.summary.modified}`);
	lines.push(`- Unchanged: ${data.summary.unchanged}`);
	lines.push("");

	for (const resource of data.resources) {
		lines.push(`### ${resource.kind}/${resource.name}`);
		lines.push(`Status: ${resource.diffType}`);
		if (resource.namespace) {
			lines.push(`Namespace: ${resource.namespace}`);
		}
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
