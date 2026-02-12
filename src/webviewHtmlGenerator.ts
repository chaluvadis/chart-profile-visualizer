import * as crypto from "node:crypto";
import * as yaml from "js-yaml";
import * as vscode from "vscode";
import type { ResourceHierarchy } from "./resourceVisualizer";

/**
 * Interface for Kubernetes Secret object structure
 */
interface SecretObject {
	data?: Record<string, string>;
	stringData?: Record<string, string>;
	[key: string]: any;
}

/**
 * Sanitize a Secret's YAML content by redacting sensitive data fields
 */
function sanitizeSecretYaml(yamlContent: string): string {
	try {
		const yamlObj = yaml.load(yamlContent.replace(/^#.*$/gm, "").trim());

		// Type guard to ensure we have a valid object
		if (!yamlObj || typeof yamlObj !== "object") {
			return "# Secret data redacted for security";
		}

		const secretObj = yamlObj as SecretObject;

		// Redact sensitive fields by replacing values with placeholders
		const redactField = (obj: Record<string, string>): Record<string, string> => {
			return Object.keys(obj).reduce(
				(acc, key) => {
					acc[key] = "***REDACTED***";
					return acc;
				},
				{} as Record<string, string>
			);
		};

		if (secretObj.data) {
			secretObj.data = redactField(secretObj.data);
		}
		if (secretObj.stringData) {
			secretObj.stringData = redactField(secretObj.stringData);
		}

		return yaml.dump(secretObj);
	} catch (error) {
		// If parsing fails, just hide the whole yaml for secrets
		return "# Secret data redacted for security";
	}
}

/**
 * Generate enhanced webview HTML with resource explorer, topology view, and interactive features
 */
export function generateEnhancedHtml(webview: vscode.Webview, data: any, extensionUri: vscode.Uri): string {
	const nonce = getNonce();
	const styleNonce = getNonce();

	// Get local Chart.js URI
	const chartJsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "vendor", "chart.umd.js"));

	// Generate resource explorer HTML
	const resourceExplorerHtml = generateResourceExplorer(data.resourceHierarchy, webview, extensionUri);

	return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; script-src 'nonce-${nonce}'; style-src 'nonce-${styleNonce}' 'unsafe-inline';">
    <title>Chart Visualization</title>
    <style nonce="${styleNonce}">
        ${getEnhancedStyles()}
    </style>
</head>
<body>
    <div class="toolbar">
        <button id="exportYaml" class="toolbar-btn">📄 Export YAML</button>
        <button id="exportJson" class="toolbar-btn">📋 Export JSON</button>
        <button id="toggleLive" class="toolbar-btn">🔄 Live Mode</button>
        <button id="expandAll" class="toolbar-btn">➕ Expand All</button>
        <button id="collapseAll" class="toolbar-btn">➖ Collapse All</button>
        <input type="search" id="searchBox" placeholder="Search resources..." class="search-box">
    </div>

    <div class="tabs">
        <button class="tab-btn active" data-tab="overview">Overview</button>
        <button class="tab-btn" data-tab="resources">Resources</button>
        <button class="tab-btn" data-tab="topology">Topology</button>
    </div>

    <div id="overview" class="tab-content active">
        ${generateOverviewTab(data)}
    </div>

    <div id="resources" class="tab-content">
        ${resourceExplorerHtml}
    </div>

    <div id="topology" class="tab-content">
        ${generateTopologyTab()}
    </div>

    <script src="${chartJsUri}" nonce="${nonce}"></script>
    <script nonce="${nonce}">
        ${generateJavaScript(data)}
    </script>
</body>
</html>`;
}

function generateOverviewTab(data: any): string {
	return `
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
                <div class="stat-label">Resources</div>
                <div class="stat-value">${data.resources.length}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Override Rate</div>
                <div class="stat-value">${data.totalValues > 0 ? Math.round((data.overriddenCount / data.totalValues) * 100) : 0}%</div>
            </div>
        </div>

        ${
			data.architectureNodes && data.architectureNodes.length > 0
				? `
        <div class="chart-container">
            <h2>High-Level Architecture
                <span class="help-tooltip" title="Shows the main components and their connections. Arrows indicate relationships and data flow. Larger nodes are more central to the system.">ⓘ</span>
            </h2>
            <div id="architectureDiagram" class="architecture-diagram"></div>
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
							(v: any) => `
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
				: ""
		}
    `;
}

function generateResourceExplorer(
	hierarchy: ResourceHierarchy,
	webview: vscode.Webview,
	extensionUri: vscode.Uri
): string {
	if (!hierarchy || hierarchy.totalCount === 0) {
		return '<div class="no-data"><p>No resources found</p></div>';
	}

	let html = '<div class="resource-explorer">';

	for (const [kind, group] of hierarchy.kindGroups) {
		html += `
        <div class="kind-group" data-kind="${escapeHtml(kind)}">
            <div class="kind-header">
                <span class="expand-icon">▶</span>
                <span class="kind-name" style="color: ${group.colorCode}">${escapeHtml(kind)} (${group.count})</span>
            </div>
            <div class="kind-resources" style="display: none;">
        `;

		for (const resource of group.resources) {
			// For secrets, sanitize the YAML to mask sensitive data
			const displayYaml = resource.kind === "Secret" ? sanitizeSecretYaml(resource.yaml) : resource.yaml;

			html += `
            <div class="resource-card" style="border-left-color: ${group.colorCode}" data-resource-name="${escapeAttr(resource.name)}">
                <div class="resource-header">
                    <span class="expand-icon">▶</span>
                    <strong>${escapeHtml(resource.name)}</strong>
                    ${resource.namespace ? `<span class="namespace-tag">${escapeHtml(resource.namespace)}</span>` : ""}
                    <button class="copy-btn">📋</button>
                </div>
                <div class="resource-details" style="display: none;">
                    <div class="detail-section">
                        <h4>Metadata</h4>
                        <pre>${escapeHtml(JSON.stringify(resource.metadata, null, 2))}</pre>
                    </div>
                    ${
						Object.keys(resource.spec || {}).length > 0
							? `
                    <div class="detail-section">
                        <h4>Spec</h4>
                        <pre>${escapeHtml(JSON.stringify(resource.spec, null, 2))}</pre>
                    </div>
                    `
							: ""
					}
                    ${
						resource.kind === "Secret" && resource.data
							? `
                    <div class="detail-section">
                        <h4>Data (masked)</h4>
                        <pre>${escapeHtml(JSON.stringify(resource.data, null, 2))}</pre>
                    </div>
                    `
							: ""
					}
                    <div class="detail-section">
                        <h4>Full YAML</h4>
                        <pre class="yaml-content">${escapeHtml(displayYaml)}</pre>
                    </div>
                </div>
            </div>
            `;
		}

		html += `
            </div>
        </div>
        `;
	}

	html += "</div>";
	return html;
}

function generateTopologyTab(): string {
	return `
        <div class="topology-view">
            <div class="topology-header">
                <h2>System Topology
                    <span class="help-tooltip" title="Interactive view of resources with relationships. Resources are grouped by type and namespace. Click nodes to see details, zoom/pan to navigate.">ⓘ</span>
                </h2>
            </div>
            <div class="topology-controls">
                <button id="zoomInBtn" class="topology-btn" title="Zoom In">🔍+</button>
                <button id="zoomOutBtn" class="topology-btn" title="Zoom Out">🔍-</button>
                <button id="resetZoomBtn" class="topology-btn" title="Reset View">⟲</button>
                <button id="fitToScreen" class="topology-btn" title="Fit to Screen">⛶</button>
            </div>
            <svg id="topologySvg" class="topology-svg">
                <defs>
                    <!-- Arrow markers for different relationship types -->
                    <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                        <polygon points="0 0, 10 3, 0 6" fill="var(--vscode-foreground)" opacity="0.6" />
                    </marker>
                    <marker id="arrowhead-critical" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                        <polygon points="0 0, 10 3, 0 6" fill="#ff9800" opacity="0.8" />
                    </marker>
                </defs>
                <g id="topologyContent"></g>
            </svg>
        </div>
    `;
}

function getEnhancedStyles(): string {
	return `
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 0;
            margin: 0;
        }
        .toolbar {
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            padding: 10px;
            display: flex;
            gap: 10px;
            align-items: center;
            border-bottom: 1px solid var(--vscode-panel-border);
            position: sticky;
            top: 0;
            z-index: 100;
        }
        .toolbar-btn {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
        }
        .toolbar-btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        .search-box {
            flex: 1;
            max-width: 300px;
            padding: 6px 12px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
        }
        .tabs {
            display: flex;
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .tab-btn {
            background: none;
            border: none;
            color: var(--vscode-foreground);
            padding: 12px 20px;
            cursor: pointer;
            border-bottom: 2px solid transparent;
        }
        .tab-btn.active {
            border-bottom-color: var(--vscode-focusBorder);
            font-weight: bold;
        }
        .tab-content {
            display: none;
            padding: 20px;
        }
        .tab-content.active {
            display: block;
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
        .resource-explorer {
            padding: 10px 0;
        }
        .kind-group {
            margin-bottom: 15px;
        }
        .kind-header {
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            padding: 12px;
            border-radius: 6px;
            cursor: pointer;
            font-weight: bold;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .kind-header:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        .expand-icon {
            transition: transform 0.2s;
        }
        .expanded .expand-icon {
            transform: rotate(90deg);
        }
        .kind-resources {
            margin-left: 20px;
            margin-top: 10px;
        }
        .resource-card {
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-left: 4px solid;
            border-radius: 4px;
            margin-bottom: 10px;
            padding: 12px;
        }
        .resource-header {
            display: flex;
            align-items: center;
            gap: 8px;
            cursor: pointer;
        }
        .namespace-tag {
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 11px;
        }
        .copy-btn {
            margin-left: auto;
            background: none;
            border: none;
            cursor: pointer;
            font-size: 16px;
            opacity: 0.6;
        }
        .copy-btn:hover {
            opacity: 1;
        }
        .resource-details {
            margin-top: 12px;
            padding-top: 12px;
            border-top: 1px solid var(--vscode-panel-border);
        }
        .detail-section {
            margin-bottom: 15px;
        }
        .detail-section h4 {
            margin: 0 0 8px 0;
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
            text-transform: uppercase;
        }
        .detail-section pre {
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            padding: 10px;
            border-radius: 4px;
            overflow-x: auto;
            font-size: 12px;
            margin: 0;
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
        .topology-view {
            position: relative;
            height: 600px;
        }
        .topology-controls {
            position: absolute;
            top: 10px;
            right: 10px;
            z-index: 10;
            display: flex;
            gap: 5px;
        }
        .topology-controls button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 12px;
            border-radius: 4px;
            cursor: pointer;
        }
        .topology-svg {
            width: 100%;
            height: 100%;
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
        }
        .topology-header {
            padding: 10px 0;
        }
        .topology-header h2 {
            margin: 0;
        }
        .topology-btn {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 6px 10px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
        }
        .topology-btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        .architecture-diagram {
            position: relative;
            min-height: 500px;
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            overflow: hidden;
        }
        .arch-svg {
            width: 100%;
            height: 100%;
        }
        .arch-node {
            cursor: pointer;
            transition: opacity 0.2s;
        }
        .arch-node:hover {
            opacity: 0.8;
        }
        .arch-node.critical {
            filter: drop-shadow(0 0 4px rgba(255, 152, 0, 0.6));
        }
        .arch-edge {
            fill: none;
            stroke: var(--vscode-foreground);
            stroke-width: 1.5;
            opacity: 0.4;
            marker-end: url(#arrowhead);
        }
        .arch-edge.critical-path {
            stroke: #ff9800;
            stroke-width: 2;
            opacity: 0.7;
            marker-end: url(#arrowhead-critical);
        }
        .arch-label {
            font-size: 11px;
            fill: var(--vscode-foreground);
            text-anchor: middle;
            pointer-events: none;
        }
        .arch-group-label {
            font-size: 13px;
            fill: var(--vscode-descriptionForeground);
            font-weight: bold;
        }
        .help-tooltip {
            cursor: help;
            opacity: 0.6;
            font-size: 14px;
            margin-left: 5px;
        }
        .help-tooltip:hover {
            opacity: 1;
        }
        .topo-node {
            cursor: pointer;
            transition: all 0.2s;
        }
        .topo-node:hover {
            filter: brightness(1.2);
        }
        .topo-node.selected {
            filter: brightness(1.3);
            stroke-width: 3;
        }
        .topo-edge {
            fill: none;
            stroke: var(--vscode-foreground);
            stroke-width: 1.5;
            opacity: 0.3;
            marker-end: url(#arrowhead);
        }
        .topo-label {
            font-size: 10px;
            fill: var(--vscode-foreground);
            text-anchor: middle;
            pointer-events: none;
        }
        .topo-group {
            fill: var(--vscode-editor-inactiveSelectionBackground);
            stroke: var(--vscode-panel-border);
            stroke-width: 2;
            rx: 8;
            opacity: 0.3;
        }
        .no-data {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }
    `;
}

function generateJavaScript(data: any): string {
	// Create a minimal, sanitized dataset for topology - only include kind, name, namespace
	const topologyResources = data.resources.map((r: any) => ({
		kind: r.kind || "Unknown",
		name: r.name || "unnamed",
		namespace: r.namespace || "default",
	}));

	// Escape the JSON to prevent XSS by replacing < with \u003c
	const safeTopologyData = JSON.stringify(topologyResources).replace(/</g, "\\u003c");

	// Pass architecture data safely
	const architectureNodes = data.architectureNodes || [];
	const relationships = data.relationships || [];
	const safeArchNodes = JSON.stringify(architectureNodes).replace(/</g, "\\u003c");
	const safeRelationships = JSON.stringify(relationships).replace(/</g, "\\u003c");

	return `
        const vscode = acquireVsCodeApi();
        let liveMode = false;
        let currentZoom = 1;
        let topologyZoom = 1;
        let topologyPanX = 0;
        let topologyPanY = 0;

        // Tab switching
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tabName = btn.getAttribute('data-tab');
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById(tabName).classList.add('active');

                if (tabName === 'topology') {
                    initTopology();
                }
            });
        });

        // Toolbar actions
        document.getElementById('exportYaml').addEventListener('click', () => {
            vscode.postMessage({ type: 'exportYaml' });
        });

        document.getElementById('exportJson').addEventListener('click', () => {
            vscode.postMessage({ type: 'exportJson' });
        });

        document.getElementById('toggleLive').addEventListener('click', (e) => {
            liveMode = !liveMode;
            e.target.textContent = liveMode ? '🔄 Live (On)' : '🔄 Live Mode';
            e.target.style.fontWeight = liveMode ? 'bold' : 'normal';
            vscode.postMessage({ type: 'toggleLiveMode', enabled: liveMode });
        });

        document.getElementById('expandAll').addEventListener('click', () => {
            document.querySelectorAll('.kind-group').forEach(group => {
                group.classList.add('expanded');
                const resources = group.querySelector('.kind-resources');
                if (resources) resources.style.display = 'block';
            });
        });

        document.getElementById('collapseAll').addEventListener('click', () => {
            document.querySelectorAll('.kind-group').forEach(group => {
                group.classList.remove('expanded');
                const resources = group.querySelector('.kind-resources');
                if (resources) resources.style.display = 'none';
            });
            document.querySelectorAll('.resource-card').forEach(card => {
                card.classList.remove('expanded');
                const details = card.querySelector('.resource-details');
                if (details) details.style.display = 'none';
            });
        });

        // Search functionality
        document.getElementById('searchBox').addEventListener('input', (e) => {
            const search = e.target.value.toLowerCase();
            document.querySelectorAll('.resource-card').forEach(card => {
                const text = card.textContent.toLowerCase();
                card.style.display = text.includes(search) ? 'block' : 'none';
            });
        });

        // Resource explorer event delegation - attach listeners to parent elements
        document.addEventListener('click', (e) => {
            const target = e.target;

            // Handle kind group toggle
            if (target.closest('.kind-header')) {
                const header = target.closest('.kind-header');
                const group = header.parentElement;
                group.classList.toggle('expanded');
                const resources = group.querySelector('.kind-resources');
                if (resources) {
                    resources.style.display = resources.style.display === 'none' ? 'block' : 'none';
                }
                return;
            }

            // Handle copy button
            if (target.closest('.copy-btn')) {
                e.stopPropagation();
                const card = target.closest('.resource-card');
                const yaml = card.querySelector('.yaml-content').textContent;
                vscode.postMessage({ type: 'copyResource', yaml });
                return;
            }

            // Handle resource header toggle (but not if clicking copy button)
            if (target.closest('.resource-header') && !target.closest('.copy-btn')) {
                const header = target.closest('.resource-header');
                const card = header.parentElement;
                card.classList.toggle('expanded');
                const details = card.querySelector('.resource-details');
                if (details) {
                    details.style.display = details.style.display === 'none' ? 'block' : 'none';
                }
                return;
            }
        });

        // Architecture diagram rendering
        function initArchitectureDiagram() {
            const container = document.getElementById('architectureDiagram');
            if (!container) return;
            if (container.hasAttribute('data-initialized')) return;
            container.setAttribute('data-initialized', 'true');

            const nodes = ${safeArchNodes};
            const edges = ${safeRelationships};
            
            if (nodes.length === 0) {
                container.innerHTML = '<div class="no-data">No resources to display</div>';
                return;
            }

            // Create SVG
            const width = container.clientWidth;
            const height = 500;
            
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('class', 'arch-svg');
            svg.setAttribute('width', width);
            svg.setAttribute('height', height);
            svg.setAttribute('viewBox', \`0 0 \${width} \${height}\`);

            // Add arrow markers
            const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
            marker.setAttribute('id', 'arrowhead');
            marker.setAttribute('markerWidth', '10');
            marker.setAttribute('markerHeight', '10');
            marker.setAttribute('refX', '9');
            marker.setAttribute('refY', '3');
            marker.setAttribute('orient', 'auto');
            const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            polygon.setAttribute('points', '0 0, 10 3, 0 6');
            polygon.setAttribute('fill', 'var(--vscode-foreground)');
            polygon.setAttribute('opacity', '0.6');
            marker.appendChild(polygon);
            defs.appendChild(marker);
            
            const markerCritical = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
            markerCritical.setAttribute('id', 'arrowhead-critical');
            markerCritical.setAttribute('markerWidth', '10');
            markerCritical.setAttribute('markerHeight', '10');
            markerCritical.setAttribute('refX', '9');
            markerCritical.setAttribute('refY', '3');
            markerCritical.setAttribute('orient', 'auto');
            const polygonCritical = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            polygonCritical.setAttribute('points', '0 0, 10 3, 0 6');
            polygonCritical.setAttribute('fill', '#ff9800');
            polygonCritical.setAttribute('opacity', '0.8');
            markerCritical.appendChild(polygonCritical);
            defs.appendChild(markerCritical);
            svg.appendChild(defs);

            // Simple hierarchical layout: group by category, arrange in layers
            const categories = {};
            nodes.forEach(node => {
                if (!categories[node.category]) {
                    categories[node.category] = [];
                }
                categories[node.category].push(node);
            });

            const categoryKeys = Object.keys(categories);
            const layerHeight = height / (categoryKeys.length + 1);
            const nodePositions = new Map();

            // Position nodes
            categoryKeys.forEach((category, layerIndex) => {
                const layerNodes = categories[category];
                const layerY = (layerIndex + 1) * layerHeight;
                const nodeWidth = Math.min(width / (layerNodes.length + 1), 150);

                layerNodes.forEach((node, i) => {
                    const x = ((i + 1) * width) / (layerNodes.length + 1);
                    const y = layerY;
                    nodePositions.set(node.id, { x, y, node });
                });
            });

            // Draw edges first (so they appear behind nodes)
            const edgesGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            edges.forEach(edge => {
                const source = nodePositions.get(edge.source);
                const target = nodePositions.get(edge.target);
                if (!source || !target) return;

                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                const d = \`M\${source.x},\${source.y} Q\${(source.x + target.x)/2},\${(source.y + target.y)/2 - 30} \${target.x},\${target.y}\`;
                path.setAttribute('d', d);
                path.setAttribute('class', 'arch-edge');
                path.setAttribute('marker-end', 'url(#arrowhead)');
                
                // Title for tooltip
                const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
                title.textContent = \`\${edge.source} → \${edge.target} (\${edge.label || edge.type})\`;
                path.appendChild(title);
                
                edgesGroup.appendChild(path);
            });
            svg.appendChild(edgesGroup);

            // Draw nodes
            const nodesGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            nodePositions.forEach(({ x, y, node }) => {
                const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                g.setAttribute('class', node.isCritical ? 'arch-node critical' : 'arch-node');
                g.setAttribute('transform', \`translate(\${x}, \${y})\`);

                // Node size based on degree
                const size = 30 + Math.min(node.inDegree + node.outDegree, 10) * 3;

                const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('r', size/2);
                circle.setAttribute('fill', node.colorCode || '#007acc');
                circle.setAttribute('stroke', 'var(--vscode-panel-border)');
                circle.setAttribute('stroke-width', '2');
                g.appendChild(circle);

                const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                text.setAttribute('class', 'arch-label');
                text.setAttribute('y', size/2 + 15);
                text.textContent = node.name.substring(0, 12);
                g.appendChild(text);

                const kindText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                kindText.setAttribute('class', 'arch-label');
                kindText.setAttribute('y', size/2 + 28);
                kindText.setAttribute('font-size', '9');
                kindText.setAttribute('opacity', '0.7');
                kindText.textContent = node.kind;
                g.appendChild(kindText);

                // Tooltip
                const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
                title.textContent = \`\${node.kind}: \${node.name}\nIn: \${node.inDegree}, Out: \${node.outDegree}\${node.isCritical ? ' (Critical)' : ''}\`;
                g.appendChild(title);

                nodesGroup.appendChild(g);
            });
            svg.appendChild(nodesGroup);

            container.appendChild(svg);
        }

        // Initialize architecture diagram when overview tab is loaded
        if (document.getElementById('architectureDiagram')) {
            requestIdleCallback ? requestIdleCallback(initArchitectureDiagram) : setTimeout(initArchitectureDiagram, 0);
        }

        // Enhanced Topology view with relationships
        function initTopology() {
            const svg = document.getElementById('topologySvg');
            if (!svg) return;
            if (svg.hasAttribute('data-initialized')) return;
            svg.setAttribute('data-initialized', 'true');

            const container = document.getElementById('topologyContent');
            if (!container) return;

            const nodes = ${safeArchNodes};
            const edges = ${safeRelationships};
            
            if (nodes.length === 0) {
                container.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="var(--vscode-foreground)">No resources to display</text>';
                return;
            }

            const width = svg.clientWidth || 800;
            const height = svg.clientHeight || 600;

            // Group nodes by namespace and category
            const groups = {};
            nodes.forEach(node => {
                const key = \`\${node.namespace || 'default'}-\${node.category}\`;
                if (!groups[key]) {
                    groups[key] = {
                        namespace: node.namespace || 'default',
                        category: node.category,
                        nodes: []
                    };
                }
                groups[key].nodes.push(node);
            });

            const groupKeys = Object.keys(groups);
            const nodePositions = new Map();

            // Simple grid layout with grouping
            let currentX = 100;
            let currentY = 100;
            const groupSpacing = 50;
            const nodeSpacing = 80;
            const nodesPerRow = 4;

            groupKeys.forEach(groupKey => {
                const group = groups[groupKey];
                let x = currentX;
                let y = currentY;

                group.nodes.forEach((node, i) => {
                    nodePositions.set(node.id, { x, y, node });
                    
                    x += nodeSpacing;
                    if ((i + 1) % nodesPerRow === 0) {
                        x = currentX;
                        y += nodeSpacing;
                    }
                });

                currentY = y + nodeSpacing + groupSpacing;
                if (currentY > height - 100) {
                    currentY = 100;
                    currentX += (nodesPerRow * nodeSpacing) + groupSpacing;
                }
            });

            // Draw edges
            edges.forEach(edge => {
                const source = nodePositions.get(edge.source);
                const target = nodePositions.get(edge.target);
                if (!source || !target) return;

                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', source.x);
                line.setAttribute('y1', source.y);
                line.setAttribute('x2', target.x);
                line.setAttribute('y2', target.y);
                line.setAttribute('class', 'topo-edge');
                line.setAttribute('marker-end', 'url(#arrowhead)');
                
                const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
                title.textContent = \`\${edge.source} → \${edge.target}\`;
                line.appendChild(title);
                
                container.appendChild(line);
            });

            // Draw nodes
            nodePositions.forEach(({ x, y, node }) => {
                const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                g.setAttribute('class', 'topo-node');
                g.setAttribute('transform', \`translate(\${x}, \${y})\`);

                const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                rect.setAttribute('x', '-30');
                rect.setAttribute('y', '-20');
                rect.setAttribute('width', '60');
                rect.setAttribute('height', '40');
                rect.setAttribute('rx', '5');
                rect.setAttribute('fill', node.colorCode || '#007acc');
                rect.setAttribute('stroke', 'var(--vscode-panel-border)');
                rect.setAttribute('stroke-width', node.isCritical ? '3' : '1');
                g.appendChild(rect);

                const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                text.setAttribute('class', 'topo-label');
                text.setAttribute('y', '-5');
                text.textContent = node.kind.substring(0, 8);
                g.appendChild(text);

                const nameText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                nameText.setAttribute('class', 'topo-label');
                nameText.setAttribute('y', '8');
                nameText.setAttribute('font-size', '9');
                nameText.textContent = node.name.substring(0, 10);
                g.appendChild(nameText);

                const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
                title.textContent = \`\${node.kind}: \${node.name}\n\${node.namespace ? 'Namespace: ' + node.namespace : ''}\`;
                g.appendChild(title);

                container.appendChild(g);
            });

            updateTopologyZoom();
        }

        // Topology zoom controls
        const zoomInBtn = document.getElementById('zoomInBtn');
        const zoomOutBtn = document.getElementById('zoomOutBtn');
        const resetZoomBtn = document.getElementById('resetZoomBtn');
        const fitToScreenBtn = document.getElementById('fitToScreen');

        if (zoomInBtn) {
            zoomInBtn.addEventListener('click', () => {
                topologyZoom = Math.min(topologyZoom + 0.2, 3);
                updateTopologyZoom();
            });
        }

        if (zoomOutBtn) {
            zoomOutBtn.addEventListener('click', () => {
                topologyZoom = Math.max(topologyZoom - 0.2, 0.3);
                updateTopologyZoom();
            });
        }

        if (resetZoomBtn) {
            resetZoomBtn.addEventListener('click', () => {
                topologyZoom = 1;
                topologyPanX = 0;
                topologyPanY = 0;
                updateTopologyZoom();
            });
        }

        if (fitToScreenBtn) {
            fitToScreenBtn.addEventListener('click', () => {
                const svg = document.getElementById('topologySvg');
                const container = document.getElementById('topologyContent');
                if (!svg || !container) return;
                
                // Reset to default view
                topologyZoom = 0.8;
                topologyPanX = 0;
                topologyPanY = 0;
                updateTopologyZoom();
            });
        }

        function updateTopologyZoom() {
            const container = document.getElementById('topologyContent');
            if (container) {
                container.setAttribute('transform', \`translate(\${topologyPanX}, \${topologyPanY}) scale(\${topologyZoom})\`);
            }
        }

        // Chart.js initialization for overview tab
        ${generateChartJsInit(data)}
    `;
}

function generateChartJsInit(data: any): string {
	return `
        const chartColors = {
            primary: '#007acc',
            secondary: '#68217a',
            success: '#4caf50',
            warning: '#ff9800',
            danger: '#f44336',
            info: '#2196f3'
        };

        const colorPalette = [
            chartColors.primary,
            chartColors.secondary,
            chartColors.success,
            chartColors.warning,
            chartColors.info,
            chartColors.danger
        ];

        ${
			Object.keys(data.resourceCounts || {}).length > 0
				? `
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
        (function() {
            const ctx = document.getElementById('valuesChart');
            if (!ctx) return;

            new Chart(ctx, {
                type: 'pie',
                data: {
                    labels: ['Overridden Values', 'Base Values'],
                    datasets: [{
                        data: [${data.overriddenCount}, ${data.totalValues - data.overriddenCount}],
                        backgroundColor: [chartColors.warning, chartColors.info]
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false
                }
            });
        })();
        `
				: ""
		}
    `;
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

function escapeAttr(text: string): string {
	return text.replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
