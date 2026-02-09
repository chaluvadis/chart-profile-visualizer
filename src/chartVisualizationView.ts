import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { ChartTreeItem } from './chartProfilesProvider';
import { mergeValues } from './valuesMerger';
import { renderHelmTemplate } from './helmRenderer';

/**
 * Manages the chart visualization webview panel
 */
export class ChartVisualizationView {
    private static currentPanel: vscode.WebviewPanel | undefined;

    public static async show(context: vscode.ExtensionContext, item: ChartTreeItem) {
        if (!item || !item.chart || !item.environment) {
            vscode.window.showErrorMessage('Invalid item selected for visualization');
            return;
        }

        const columnToShowIn = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (ChartVisualizationView.currentPanel) {
            ChartVisualizationView.currentPanel.reveal(columnToShowIn);
        } else {
            ChartVisualizationView.currentPanel = vscode.window.createWebviewPanel(
                'chartVisualization',
                `Chart: ${item.chart.name} (${item.environment})`,
                columnToShowIn || vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [context.extensionUri]
                }
            );

            ChartVisualizationView.currentPanel.onDidDispose(
                () => {
                    ChartVisualizationView.currentPanel = undefined;
                },
                null,
                context.subscriptions
            );
        }

        // Update the webview content
        await ChartVisualizationView.update(item);
    }

    private static async update(item: ChartTreeItem) {
        if (!ChartVisualizationView.currentPanel) {
            return;
        }

        const panel = ChartVisualizationView.currentPanel;
        panel.title = `Chart: ${item.chart!.name} (${item.environment})`;

        try {
            // Collect data for visualization
            const chartData = await ChartVisualizationView.collectChartData(item);

            // Generate and set HTML content
            panel.webview.html = ChartVisualizationView.getHtmlContent(panel.webview, chartData);
        } catch (error: any) {
            vscode.window.showErrorMessage(`Error loading chart visualization: ${error.message}`);
            panel.webview.html = ChartVisualizationView.getErrorHtml(error.message);
        }
    }

    private static async collectChartData(item: ChartTreeItem): Promise<ChartData> {
        const chartPath = item.chart!.path;
        const environment = item.environment!;
        const chartName = item.chart!.name;

        // Load base values separately for comparison
        const baseValuesPath = path.join(chartPath, 'values.yaml');
        const baseValues = loadYamlFile(baseValuesPath);

        // Merge values to get configuration
        const comparison = mergeValues(chartPath, environment);
        
        // Extract overridden values with their source information
        const overriddenValues: Array<{ key: string; baseValue: any; envValue: any }> = [];
        
        for (const [key, detail] of comparison.details.entries()) {
            if (detail.overridden) {
                // Get the base value by traversing the base values object
                const baseValue = getValueByPath(baseValues, key);
                overriddenValues.push({
                    key,
                    baseValue: baseValue !== undefined ? baseValue : '(not set)',
                    envValue: detail.value
                });
            }
        }

        const totalValues = comparison.details.size;
        const overriddenCount = overriddenValues.length;

        // Try to get rendered resources
        let resourceCounts: { [key: string]: number } = {};
        try {
            const releaseName = `${chartName}-${environment}`;
            const resources = await renderHelmTemplate(chartPath, environment, releaseName);
            
            resources.forEach(resource => {
                resourceCounts[resource.kind] = (resourceCounts[resource.kind] || 0) + 1;
            });
        } catch (error) {
            console.warn('Could not render templates for visualization:', error);
        }

        return {
            chartName,
            environment,
            totalValues,
            overriddenCount,
            overriddenValues: overriddenValues.slice(0, 10), // Top 10 for display
            resourceCounts
        };
    }

    private static getHtmlContent(webview: vscode.Webview, data: ChartData): string {
        const nonce = getNonce();
        const styleNonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${styleNonce}';">
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
        }
        .chart-canvas {
            max-width: 100%;
            height: 300px;
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

    ${Object.keys(data.resourceCounts).length > 0 ? `
    <div class="chart-container">
        <h2>Kubernetes Resources</h2>
        <canvas id="resourceChart" class="chart-canvas"></canvas>
    </div>
    ` : ''}

    ${data.overriddenValues.length > 0 ? `
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
                ${data.overriddenValues.map(v => `
                    <tr>
                        <td class="value-key">${escapeHtml(v.key)}</td>
                        <td class="value-old">${escapeHtml(String(v.baseValue))}</td>
                        <td class="value-new">${escapeHtml(String(v.envValue))}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    </div>
    ` : `
    <div class="no-data">
        <p>No value overrides found for this environment.</p>
    </div>
    `}

    <script nonce="${nonce}">
        ${Object.keys(data.resourceCounts).length > 0 ? `
        // Simple bar chart using Canvas API (no external dependencies)
        (function() {
            const canvas = document.getElementById('resourceChart');
            if (!canvas) return;
            
            const ctx = canvas.getContext('2d');
            const data = ${JSON.stringify(data.resourceCounts)};
            
            const labels = Object.keys(data);
            const values = Object.values(data);
            const maxValue = Math.max(...values);
            
            canvas.width = canvas.offsetWidth;
            canvas.height = 300;
            
            const barWidth = canvas.width / labels.length * 0.8;
            const barGap = canvas.width / labels.length * 0.2;
            const chartHeight = canvas.height - 50;
            
            // Colors from VS Code theme
            const barColor = '#007acc';
            const textColor = getComputedStyle(document.body).getPropertyValue('--vscode-foreground');
            
            ctx.fillStyle = textColor;
            ctx.font = '12px var(--vscode-font-family)';
            
            labels.forEach((label, i) => {
                const barHeight = (values[i] / maxValue) * chartHeight;
                const x = i * (barWidth + barGap) + barGap;
                const y = canvas.height - barHeight - 30;
                
                // Draw bar
                ctx.fillStyle = barColor;
                ctx.fillRect(x, y, barWidth, barHeight);
                
                // Draw value on top of bar
                ctx.fillStyle = textColor;
                ctx.textAlign = 'center';
                ctx.fillText(values[i], x + barWidth / 2, y - 5);
                
                // Draw label
                ctx.save();
                ctx.translate(x + barWidth / 2, canvas.height - 10);
                ctx.rotate(-Math.PI / 4);
                ctx.textAlign = 'right';
                ctx.fillText(label, 0, 0);
                ctx.restore();
            });
        })();
        ` : ''}
    </script>
</body>
</html>`;
    }

    private static getErrorHtml(errorMessage: string): string {
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
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Get a value from a nested object using a dot-notation path
 */
function getValueByPath(obj: any, path: string): any {
    const parts = path.split('.');
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
            const content = fs.readFileSync(filePath, 'utf8');
            return yaml.load(content) || {};
        }
    } catch (error) {
        console.error(`Error loading YAML file ${filePath}:`, error);
    }
    return {};
}
