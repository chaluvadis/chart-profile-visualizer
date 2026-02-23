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

const defaultNamespace = "default";

export async function show(context: vscode.ExtensionContext, item: ChartTreeItem) {
	if (!item || !item.chart || !item.environment) {
		vscode.window.showErrorMessage("Invalid item selected for visualization");
		return;
	}

	currentContext = context;

	const columnToShowIn = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

	if (currentPanel) {
		currentPanel.reveal(columnToShowIn);
	} else {
		currentPanel = vscode.window.createWebviewPanel(
			"chartVisualization",
			`Chart: ${item.chart.name} (${item.environment})`,
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
			async (message) => {
				await handleMessage(message);
			},
			undefined,
			context.subscriptions
		);
	}

	// Update the webview content
	await updatePanel(item);
}

async function updatePanel(item: ChartTreeItem) {
	if (!currentPanel) {
		return;
	}

	const panel = currentPanel;
	panel.title = `Chart: ${item.chart?.name} (${item.environment})`;

	try {
		// Collect data for visualization
		const chartData = await collectChartData(item);

		// Generate and set HTML content
		if (currentContext) {
			panel.webview.html = generateEnhancedHtml(panel.webview, chartData, currentContext.extensionUri);
		} else {
			// Fallback - should never happen, but handle gracefully
			panel.webview.html = getErrorHtml("Extension context not available");
		}
	} catch (error: any) {
		vscode.window.showErrorMessage(`Error loading chart visualization: ${error.message}`);
		panel.webview.html = getErrorHtml(error.message);
	}
}

/**
 * Handle messages from the webview
 */
async function handleMessage(message: any) {
	switch (message.type) {
		case "exportYaml":
			await exportResources("yaml");
			break;
		case "exportJson":
			await exportResources("json");
			break;
		case "copyResource":
			await vscode.env.clipboard.writeText(message.yaml);
			vscode.window.showInformationMessage("Resource YAML copied to clipboard");
			break;
		case "revealSecret":
			await revealSecret(message.secretName, message.namespace);
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
	};
}

function getErrorHtml(errorMessage: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
