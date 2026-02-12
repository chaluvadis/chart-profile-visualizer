import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import * as vscode from "vscode";
import type { ChartTreeItem } from "./chartProfilesProvider";
import { type RenderedResource, renderHelmTemplate } from "./helmRenderer";
import { LiveUpdateManager } from "./liveUpdateManager";
import {
	type ArchitectureNode,
	buildArchitectureNodes,
	detectRelationships,
	type ResourceRelationship,
} from "./relationshipDetector";
import { parseResources, type ResourceHierarchy } from "./resourceVisualizer";
import { mergeValues } from "./valuesMerger";
import { generateEnhancedHtml } from "./webviewHtmlGenerator";

// Module-level state (singleton pattern for VSCode extension)
let currentPanel: vscode.WebviewPanel | undefined;
let currentContext: vscode.ExtensionContext | undefined;
let currentItem: ChartTreeItem | undefined;
const liveUpdateManager = new LiveUpdateManager();
let renderedResources: RenderedResource[] = [];

const defaultNamespace = "default";

export async function show(context: vscode.ExtensionContext, item: ChartTreeItem) {
	if (!item || !item.chart || !item.environment) {
		vscode.window.showErrorMessage("Invalid item selected for visualization");
		return;
	}

	currentContext = context;
	currentItem = item;

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
				liveUpdateManager.disable();
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
			vscode.window.showInformationMessage("Resource copied to clipboard");
			break;
		case "toggleLiveMode":
			toggleLiveMode(message.enabled);
			break;
		case "revealSecret":
			// Secret reveal would be handled here
			break;
	}
}

/**
 * Toggle live update mode
 */
function toggleLiveMode(enabled: boolean) {
	if (!currentItem) {
		return;
	}

	if (enabled) {
		const chartPath = currentItem.chart?.path;
		if (!chartPath) {
			vscode.window.showErrorMessage("Chart path not available for live updates");
			return;
		}
		liveUpdateManager.enable(chartPath, async () => {
			if (currentItem) {
				await updatePanel(currentItem);
			}
		});
		vscode.window.showInformationMessage("Live mode enabled");
	} else {
		liveUpdateManager.disable();
		vscode.window.showInformationMessage("Live mode disabled");
	}
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
		overriddenValues: overriddenValues.slice(0, 10), // Top 10 for display
		resourceCounts,
		namespaceCounts,
		templateSources,
		resources,
		resourceHierarchy,
		architectureNodes,
		relationships,
	};
}

function getHtmlContent(webview: vscode.Webview, data: ChartData): string {
	const nonce = getNonce();
	const styleNonce = getNonce();

	return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' https://cdn.jsdelivr.net; style-src 'nonce-${styleNonce}';">
    <title>Chart Visualization</title>
    <style nonce="${styleNonce}">
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
            margin: 0;
        }
        h1, h2 {
            color: var(--vscode-foreground);
        }
        .header {
            border-bottom: 2px solid var(--vscode-panel-border);
            padding-bottom: 15px;
            margin-bottom: 20px;
        }
        .chart-title {
            font-size: 24px;
            font-weight: bold;
            margin: 0;
        }
        .environment-badge {
            display: inline-block;
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 14px;
            margin-left: 10px;
        }
        .stats-container {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin: 20px 0;
        }
        .stat-card {
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 15px;
        }
        .stat-label {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            text-transform: uppercase;
            margin-bottom: 5px;
        }
        .stat-value {
            font-size: 28px;
            font-weight: bold;
            color: var(--vscode-foreground);
        }
        .chart-container {
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
            max-height: 60vh;
            overflow: auto;
        }
        .chart-canvas {
            width: 100%;
            max-width: 100%;
            /* height will be set dynamically in JS based on bar count */
        }
        .values-table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
        }
        .values-table th,
        .values-table td {
            padding: 10px;
            text-align: left;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .values-table th {
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            font-weight: bold;
        }
        .value-key {
            font-family: var(--vscode-editor-font-family);
            color: var(--vscode-textLink-foreground);
        }
        .value-old {
            color: var(--vscode-descriptionForeground);
            text-decoration: line-through;
        }
        .value-new {
            color: var(--vscode-gitDecoration-modifiedResourceForeground);
            font-weight: bold;
        }
        .no-data {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }
        .template-list {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
            gap: 10px;
            margin-top: 10px;
        }
        .template-item {
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            padding: 8px 12px;
            border-radius: 4px;
            font-family: var(--vscode-editor-font-family);
            font-size: 12px;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1 class="chart-title">
            ${escapeHtml(data.chartName)}
            <span class="environment-badge">${escapeHtml(data.environment)}</span>
        </h1>
    </div>

    <div class="stats-container">
        <div class="stat-card">
            <div class="stat-label">Total Values</div>
            <div class="stat-value">${data.totalValues}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Overridden Values</div>
            <div class="stat-value">${data.overriddenCount}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Override Rate</div>
            <div class="stat-value">${data.totalValues > 0 ? Math.round((data.overriddenCount / data.totalValues) * 100) : 0}%</div>
        </div>
    </div>

    ${
		Object.keys(data.resourceCounts).length > 0
			? `
    <div class="chart-container">
        <h2>Resource Type Distribution</h2>
        <canvas id="resourceChart" class="chart-canvas"></canvas>
    </div>
    `
			: ""
	}

    ${
		data.totalValues > 0
			? `
    <div class="chart-container">
        <h2>Values: Overridden vs Base</h2>
        <canvas id="valuesChart" class="chart-canvas"></canvas>
    </div>
    `
			: ""
	}

    ${
		Object.keys(data.namespaceCounts).length > 1
			? `
    <div class="chart-container">
        <h2>Namespace Distribution</h2>
        <canvas id="namespaceChart" class="chart-canvas"></canvas>
    </div>
    `
			: ""
	}

    ${
		data.templateSources.length > 0
			? `
    <div class="chart-container">
        <h2>Template Sources</h2>
        <div class="template-list">
            ${data.templateSources.map((t) => `<div class="template-item">📄 ${escapeHtml(t)}</div>`).join("")}
        </div>
    </div>
    `
			: ""
	}

    ${
		data.overriddenValues.length > 0
			? `
    <div class="chart-container">
        <h2>Top Overridden Values</h2>
        <table class="values-table">
            <thead>
                <tr>
                    <th>Key</th>
                    <th>Base Value</th>
                    <th>Environment Value</th>
                </tr>
            </thead>
            <tbody>
                ${data.overriddenValues
					.map(
						(v) => `
                    <tr>
                        <td class="value-key">${escapeHtml(v.key)}</td>
                        <td class="value-old">${escapeHtml(String(v.baseValue))}</td>
                        <td class="value-new">${escapeHtml(String(v.envValue))}</td>
                    </tr>
                `
					)
					.join("")}
            </tbody>
        </table>
    </div>
    `
			: `
    <div class="no-data">
        <p>No value overrides found for this environment.</p>
    </div>
    `
	}

    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js" nonce="${nonce}"></script>
    <script nonce="${nonce}">
        const chartColors = {
            primary: '#007acc',
            secondary: '#68217a',
            success: '#4caf50',
            warning: '#ff9800',
            danger: '#f44336',
            info: '#2196f3',
            light: '#9e9e9e',
            dark: '#424242'
        };

        const colorPalette = [
            chartColors.primary,
            chartColors.secondary,
            chartColors.success,
            chartColors.warning,
            chartColors.info,
            chartColors.danger,
            chartColors.light
        ];

        const chartDefaults = {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: {
                        color: getComputedStyle(document.body).getPropertyValue('--vscode-foreground')
                    }
                }
            },
            scales: {
                x: {
                    ticks: {
                        color: getComputedStyle(document.body).getPropertyValue('--vscode-foreground')
                    },
                    grid: {
                        color: 'rgba(128, 128, 128, 0.2)'
                    }
                },
                y: {
                    ticks: {
                        color: getComputedStyle(document.body).getPropertyValue('--vscode-foreground')
                    },
                    grid: {
                        color: 'rgba(128, 128, 128, 0.2)'
                    }
                }
            }
        };

        ${
			Object.keys(data.resourceCounts).length > 0
				? `
        // Resource Type Distribution (Bar Chart)
        (function() {
            const canvas = document.getElementById('resourceChart');
            if (!canvas) return;

            const resourceData = ${JSON.stringify(data.resourceCounts)};
            let labels = Object.keys(resourceData);
            let values = Object.values(resourceData);

            // Aggregate long tail for readability & performance
            const MAX_BARS = 60;
            if (labels.length > MAX_BARS) {
                const pairs = labels.map((l, i) => ({ l, v: Number(values[i]) || 0 }));
                pairs.sort((a, b) => b.v - a.v);
                const top = pairs.slice(0, MAX_BARS);
                const othersTotal = pairs.slice(MAX_BARS).reduce((sum, p) => sum + p.v, 0);
                labels = top.map(p => p.l).concat('Others');
                values = top.map(p => p.v).concat(othersTotal);
            }

            // Decide orientation based on bar count
            const useHorizontal = labels.length > 20;
            const indexAxis = useHorizontal ? 'y' : 'x';

            // Dynamic canvas height proportional to bars (kept within viewport)
            const perBarPx = 24; // bar height when horizontal
            const basePx = 120;  // padding and legend space
            const maxPx = Math.round(window.innerHeight * 0.6);
            const targetHeight = useHorizontal
                ? Math.min(maxPx, basePx + (labels.length * perBarPx))
                : 300; // default for vertical
            canvas.style.height = \`\${targetHeight}px\`;

            const foreground = getComputedStyle(document.body).getPropertyValue('--vscode-foreground');
            const gridColor = 'rgba(128, 128, 128, 0.2)';

            function initChart() {
                // Destroy any previous instance to avoid leaks
                const existing = window.resourceChartInstance;
                if (existing) { try { existing.destroy(); } catch {} }

                const chart = new Chart(canvas, {
                    type: 'bar',
                    data: {
                        labels,
                        datasets: [{
                            label: 'Resource Count',
                            data: values,
                            backgroundColor: colorPalette.slice(0, labels.length),
                            borderColor: colorPalette.slice(0, labels.length),
                            borderWidth: 1,
                        }]
                    },
                    options: {
                        indexAxis,
                        responsive: true,
                        maintainAspectRatio: false,
                        animation: false,        // faster
                        parsing: false,          // bypass parsing overhead
                        interaction: { mode: 'nearest', intersect: false },
                        plugins: {
                            legend: {
                                display: false,
                                labels: { color: foreground }
                            },
                            title: { display: false },
                            tooltip: {
                                enabled: labels.length <= 200 // avoid heavy tooltips for huge sets
                            }
                        },
                        // Reduce event listeners for massive datasets
                        events: labels.length > 200 ? [] : undefined,
                        scales: {
                            x: {
                                ticks: {
                                    color: foreground,
                                    autoSkip: true,
                                    maxRotation: 45,
                                    sampleSize: 100,
                                },
                                grid: { color: gridColor },
                                beginAtZero: true,
                            },
                            y: {
                                ticks: {
                                    color: foreground,
                                    autoSkip: true,
                                    sampleSize: 100,
                                },
                                grid: { color: gridColor },
                                beginAtZero: true,
                            }
                        }
                    }
                });
                window.resourceChartInstance = chart;

                // Resize handling for horizontal bars
                if (useHorizontal && 'ResizeObserver' in window) {
                    const ro = new ResizeObserver(() => {
                        const maxPx = Math.round(window.innerHeight * 0.6);
                        const newHeight = Math.min(maxPx, basePx + (labels.length * perBarPx));
                        canvas.style.height = \`\${newHeight}px\`;
                        const inst = window.resourceChartInstance;
                        if (inst) { try { inst.resize(); } catch {} }
                    });
                    ro.observe(document.body);
                }
            }

            // Lazy init to avoid blocking UI
            if ('requestIdleCallback' in window) {
                window.requestIdleCallback(initChart, { timeout: 500 });
            } else {
                setTimeout(initChart, 0);
            }
        })();
        `
				: ""
		}

        ${
			data.totalValues > 0
				? `
        // Overridden vs Base Values (Pie Chart)
        (function() {
            const ctx = document.getElementById('valuesChart');
            if (!ctx) return;

            const overriddenCount = ${data.overriddenCount};
            const baseCount = ${data.totalValues - data.overriddenCount};

            new Chart(ctx, {
                type: 'pie',
                data: {
                    labels: ['Overridden Values', 'Base Values'],
                    datasets: [{
                        data: [overriddenCount, baseCount],
                        backgroundColor: [chartColors.warning, chartColors.info],
                        borderColor: [chartColors.warning, chartColors.info],
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            labels: {
                                color: getComputedStyle(document.body).getPropertyValue('--vscode-foreground')
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    const label = context.label || '';
                                    const value = context.parsed || 0;
                                    const percentage = ((value / ${data.totalValues}) * 100).toFixed(1);
                                    return label + ': ' + value + ' (' + percentage + '%)';
                                }
                            }
                        }
                    }
                }
            });
        })();
        `
				: ""
		}

        ${
			Object.keys(data.namespaceCounts).length > 1
				? `
        // Namespace Distribution (Doughnut Chart)
        (function() {
            const ctx = document.getElementById('namespaceChart');
            if (!ctx) return;

            const namespaceData = ${JSON.stringify(data.namespaceCounts)};
            const labels = Object.keys(namespaceData);
            const values = Object.values(namespaceData);

            new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: labels,
                    datasets: [{
                        data: values,
                        backgroundColor: colorPalette.slice(0, labels.length),
                        borderColor: colorPalette.slice(0, labels.length),
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            labels: {
                                color: getComputedStyle(document.body).getPropertyValue('--vscode-foreground')
                            }
                        }
                    }
                }
            });
        })();
        `
				: ""
		}
    </script>
</body>
</html>`;
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

function getNonce(): string {
	return crypto.randomBytes(16).toString("base64");
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
