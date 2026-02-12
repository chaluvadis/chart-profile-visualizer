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
                <span class="help-tooltip" title="Shows the main components and their connections. Different shapes represent resource types: rounded rectangles (workloads), hexagons (networking), cylinders (storage), documents (configuration), shields (RBAC). Arrows indicate relationships and data flow. Larger nodes are more central to the system.">ⓘ</span>
            </h2>
            <div class="legend-container">
                <div class="legend-title">Legend:</div>
                <div class="legend-items">
                    <span class="legend-item"><svg width="30" height="20"><rect x="5" y="5" width="20" height="10" rx="3" fill="#007acc" stroke="#333" stroke-width="1"/></svg> Workload</span>
                    <span class="legend-item"><svg width="30" height="20"><polygon points="15,5 20,10 15,15 10,10" fill="#4caf50" stroke="#333" stroke-width="1"/></svg> Networking</span>
                    <span class="legend-item"><svg width="30" height="20"><ellipse cx="15" cy="7" rx="7" ry="3" fill="#9c27b0" stroke="#333" stroke-width="1"/><rect x="8" y="7" width="14" height="6" fill="#9c27b0" stroke="none"/><ellipse cx="15" cy="13" rx="7" ry="3" fill="#9c27b0" stroke="#333" stroke-width="1"/></svg> Storage</span>
                    <span class="legend-item"><svg width="30" height="20"><path d="M5,5 L18,5 L22,9 L22,15 L5,15 Z" fill="#ff9800" stroke="#333" stroke-width="1"/></svg> Config</span>
                    <span class="legend-item"><svg width="30" height="20"><path d="M15,5 L22,8 L22,12 Q22,14 15,14 Q8,14 8,12 L8,8 Z" fill="#f44336" stroke="#333" stroke-width="1"/></svg> RBAC</span>
                    <span class="legend-item"><svg width="30" height="20"><circle cx="15" cy="10" r="5" fill="#9e9e9e" stroke="#333" stroke-width="1"/></svg> Other</span>
                </div>
            </div>
            <div id="architectureDiagram" class="architecture-diagram"></div>
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
                    <span class="help-tooltip" title="Detailed system structure organized by tiers (swimlanes). Resources are grouped by category with visual highlighting of critical components. Click nodes to highlight relationships. Orange badges show high connectivity. Critical nodes have glowing indicators. Arrows show relationship direction and type.">ⓘ</span>
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
        /* Center the topology SVG within its container using flexbox */
        .topology-view {
            position: relative;
            height: 600px;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
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
        .legend-container {
            margin: 10px 0 20px 0;
            padding: 12px;
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 6px;
            border: 1px solid var(--vscode-panel-border);
        }
        .legend-title {
            font-size: 12px;
            font-weight: bold;
            margin-bottom: 8px;
            color: var(--vscode-descriptionForeground);
        }
        .legend-items {
            display: flex;
            flex-wrap: wrap;
            gap: 15px;
        }
        .legend-item {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            font-size: 11px;
        }
        .legend-item svg {
            vertical-align: middle;
        }
        .topo-node {
            cursor: pointer;
            transition: all 0.2s;
        }
        .topo-node:hover {
            filter: brightness(1.2);
        }
        .topo-node.selected {
            filter: brightness(1.4) drop-shadow(0 0 8px rgba(255, 152, 0, 0.8));
        }
        .topo-edge {
            fill: none;
            stroke: var(--vscode-foreground);
            stroke-width: 1.5;
            opacity: 0.3;
            marker-end: url(#arrowhead);
            transition: all 0.2s;
        }
        .topo-edge.highlighted {
            opacity: 0.9;
            stroke: #ff9800;
            stroke-width: 2.5;
        }
        .critical-glow {
            animation: pulse 2s ease-in-out infinite;
        }
        @keyframes pulse {
            0%, 100% { opacity: 0.2; }
            50% { opacity: 0.5; }
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
            
            // Control point offset for quadratic bezier curve - creates a gentle arc between nodes
            // Negative offset creates an upward curve, making edge direction clearer
            const CURVE_OFFSET = 30;
            
            edges.forEach(edge => {
                const source = nodePositions.get(edge.source);
                const target = nodePositions.get(edge.target);
                if (!source || !target) return;

                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                const d = \`M\${source.x},\${source.y} Q\${(source.x + target.x)/2},\${(source.y + target.y)/2 - CURVE_OFFSET} \${target.x},\${target.y}\`;
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

            // Draw nodes with different shapes based on category
            const nodesGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            nodePositions.forEach(({ x, y, node }) => {
                const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                g.setAttribute('class', node.isCritical ? 'arch-node critical' : 'arch-node');
                g.setAttribute('transform', \`translate(\${x}, \${y})\`);

                // Node size based on degree
                const size = 30 + Math.min(node.inDegree + node.outDegree, 10) * 3;
                const strokeWidth = node.isCritical ? '3' : '2';
                
                // Create different shapes based on category
                let shape;
                const category = node.category || 'Other';
                
                if (category === 'Workload') {
                    // Rounded rectangle for workloads
                    shape = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                    shape.setAttribute('x', -size/2);
                    shape.setAttribute('y', -size/2);
                    shape.setAttribute('width', size);
                    shape.setAttribute('height', size);
                    shape.setAttribute('rx', '8');
                } else if (category === 'Storage') {
                    // Cylinder shape for storage (approximated with ellipse stack)
                    const cylinderGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                    
                    const topEllipse = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
                    topEllipse.setAttribute('cx', '0');
                    topEllipse.setAttribute('cy', -size/3);
                    topEllipse.setAttribute('rx', size/2);
                    topEllipse.setAttribute('ry', size/6);
                    topEllipse.setAttribute('fill', node.colorCode || '#9c27b0');
                    topEllipse.setAttribute('stroke', 'var(--vscode-panel-border)');
                    topEllipse.setAttribute('stroke-width', strokeWidth);
                    
                    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                    rect.setAttribute('x', -size/2);
                    rect.setAttribute('y', -size/3);
                    rect.setAttribute('width', size);
                    rect.setAttribute('height', size * 2/3);
                    rect.setAttribute('fill', node.colorCode || '#9c27b0');
                    rect.setAttribute('stroke', 'none');
                    
                    const bottomEllipse = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
                    bottomEllipse.setAttribute('cx', '0');
                    bottomEllipse.setAttribute('cy', size/3);
                    bottomEllipse.setAttribute('rx', size/2);
                    bottomEllipse.setAttribute('ry', size/6);
                    bottomEllipse.setAttribute('fill', node.colorCode || '#9c27b0');
                    bottomEllipse.setAttribute('stroke', 'var(--vscode-panel-border)');
                    bottomEllipse.setAttribute('stroke-width', strokeWidth);
                    
                    cylinderGroup.appendChild(rect);
                    cylinderGroup.appendChild(topEllipse);
                    cylinderGroup.appendChild(bottomEllipse);
                    g.appendChild(cylinderGroup);
                    shape = null; // Already added to g
                } else if (category === 'Networking') {
                    // Hexagon for networking
                    shape = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                    const hexPoints = [
                        [size/2, 0],
                        [size/4, size/2],
                        [-size/4, size/2],
                        [-size/2, 0],
                        [-size/4, -size/2],
                        [size/4, -size/2]
                    ].map(p => p.join(',')).join(' ');
                    shape.setAttribute('points', hexPoints);
                } else if (category === 'Configuration') {
                    // Document shape for configuration (approximated with path)
                    shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                    const docPath = \`M\${-size/2},\${-size/2} L\${size/4},\${-size/2} L\${size/2},\${-size/4} L\${size/2},\${size/2} L\${-size/2},\${size/2} Z\`;
                    shape.setAttribute('d', docPath);
                } else if (category === 'RBAC') {
                    // Shield shape for RBAC
                    shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                    const shieldPath = \`M0,\${-size/2} L\${size/2},\${-size/4} L\${size/2},\${size/4} Q\${size/2},\${size/2} 0,\${size/2} Q\${-size/2},\${size/2} \${-size/2},\${size/4} L\${-size/2},\${-size/4} Z\`;
                    shape.setAttribute('d', shieldPath);
                } else {
                    // Circle for other types
                    shape = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                    shape.setAttribute('r', size/2);
                }
                
                if (shape) {
                    shape.setAttribute('fill', node.colorCode || '#007acc');
                    shape.setAttribute('stroke', 'var(--vscode-panel-border)');
                    shape.setAttribute('stroke-width', strokeWidth);
                    g.appendChild(shape);
                }

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
                title.textContent = \`\${node.kind}: \${node.name}\nCategory: \${category}\nIn: \${node.inDegree}, Out: \${node.outDegree}\${node.isCritical ? ' (Critical)' : ''}\`;
                g.appendChild(title);

                nodesGroup.appendChild(g);
            });
            svg.appendChild(nodesGroup);

            container.appendChild(svg);
        }

        // Initialize architecture diagram when overview tab is loaded
        // Use requestIdleCallback if available (modern browsers), otherwise fall back to setTimeout
        if (document.getElementById('architectureDiagram')) {
            if (typeof requestIdleCallback !== 'undefined') {
                requestIdleCallback(initArchitectureDiagram, { timeout: 500 });
            } else {
                setTimeout(initArchitectureDiagram, 0);
            }
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

            // Enhanced grouping by category (tiers/domains)
            const tiers = {
                'Workload': { nodes: [], color: '#007acc', label: 'Workloads' },
                'Networking': { nodes: [], color: '#4caf50', label: 'Networking' },
                'Storage': { nodes: [], color: '#9c27b0', label: 'Storage' },
                'Configuration': { nodes: [], color: '#ff9800', label: 'Configuration' },
                'RBAC': { nodes: [], color: '#f44336', label: 'RBAC' },
                'Scaling': { nodes: [], color: '#00bcd4', label: 'Scaling' },
                'Other': { nodes: [], color: '#9e9e9e', label: 'Other' }
            };
            
            nodes.forEach(node => {
                const category = node.category || 'Other';
                if (tiers[category]) {
                    tiers[category].nodes.push(node);
                } else {
                    // Route unknown categories to Other
                    tiers['Other'].nodes.push(node);
                }
            });
            
            const nodePositions = new Map();
            const tierOrder = ['Workload', 'Networking', 'Storage', 'Configuration', 'RBAC', 'Scaling', 'Other'];
            const activeTiers = tierOrder.filter(t => tiers[t].nodes.length > 0);
            
            /**
             * SWIMLANE LAYOUT ALGORITHM
             * 
             * The topology graph organizes resources into vertical swimlanes (columns) by category.
             * Each swimlane represents one of: Workloads, Networking, Storage, Configuration, RBAC, Scaling, or Other.
             * 
             * Layout calculations:
             * - margin: Outer padding (40px) to prevent nodes from being clipped at viewport edges
             * - columnWidth: (SVG width - 2*margin) divided by number of active tiers ensures equal spacing
             * - Node x-position: margin + (tierIndex + 0.5) * columnWidth centers nodes within their column
             * - Background rectangle: margin + tierIndex * columnWidth + padding aligns with column boundaries
             * - Node y-position: Nodes are stacked vertically with consistent spacing (70px)
             * 
             * This ensures:
             * 1. Consistent column widths across all tiers
             * 2. Nodes centered within their respective swimlanes
             * 3. Tier labels and backgrounds aligned with node positions
             * 4. No clipping at viewport edges even on narrow panels
             */
            const margin = 40;
            const columnWidth = activeTiers.length > 0 ? (width - 2 * margin) / activeTiers.length : width;
            const nodeSpacing = 70;
            const startY = 80;
            
            activeTiers.forEach((tierName, tierIndex) => {
                const tier = tiers[tierName];
                // Center nodes within each column for proper alignment, with margin offset
                const x = margin + (tierIndex + 0.5) * columnWidth;
                let y = startY;
                
                // Draw tier background rectangle aligned with column
                const tierGroup = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                tierGroup.setAttribute('class', 'topo-tier-bg');
                tierGroup.setAttribute('x', margin + tierIndex * columnWidth + 20);
                tierGroup.setAttribute('y', 20);
                tierGroup.setAttribute('width', columnWidth - 40);
                tierGroup.setAttribute('height', height - 40);
                tierGroup.setAttribute('fill', tier.color);
                tierGroup.setAttribute('opacity', '0.05');
                tierGroup.setAttribute('stroke', tier.color);
                tierGroup.setAttribute('stroke-width', '2');
                tierGroup.setAttribute('stroke-dasharray', '5,5');
                tierGroup.setAttribute('rx', '10');
                container.appendChild(tierGroup);
                
                // Tier label centered within column
                const tierLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                tierLabel.setAttribute('x', x);
                tierLabel.setAttribute('y', 50);
                tierLabel.setAttribute('text-anchor', 'middle');
                tierLabel.setAttribute('font-weight', 'bold');
                tierLabel.setAttribute('font-size', '14');
                tierLabel.setAttribute('fill', tier.color);
                tierLabel.textContent = tier.label;
                container.appendChild(tierLabel);
                
                // Position nodes vertically in this column
                tier.nodes.forEach((node, i) => {
                    nodePositions.set(node.id, { x, y, node });
                    y += nodeSpacing;
                });
            });

            // Draw edges with enhanced styling
            edges.forEach(edge => {
                const source = nodePositions.get(edge.source);
                const target = nodePositions.get(edge.target);
                if (!source || !target) return;

                // Use curved path for better visual clarity
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                const midX = (source.x + target.x) / 2;
                const midY = (source.y + target.y) / 2;
                const controlOffset = Math.abs(target.x - source.x) * 0.3;
                const d = \`M\${source.x},\${source.y} Q\${midX + controlOffset},\${midY} \${target.x},\${target.y}\`;
                path.setAttribute('d', d);
                path.setAttribute('class', 'topo-edge');
                path.setAttribute('stroke', edge.type === 'ownership' ? '#ff9800' : 'var(--vscode-foreground)');
                path.setAttribute('stroke-width', edge.type === 'ownership' ? '2' : '1.5');
                path.setAttribute('marker-end', 'url(#arrowhead)');
                
                const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
                title.textContent = \`\${edge.source} → \${edge.target}\nType: \${edge.type || 'unknown'}\${edge.label ? ' (' + edge.label + ')' : ''}\`;
                path.appendChild(title);
                
                container.appendChild(path);
            });

            // Draw nodes with enhanced interactivity
            let selectedNode = null;
            nodePositions.forEach(({ x, y, node }) => {
                const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                g.setAttribute('class', 'topo-node');
                g.setAttribute('data-node-id', node.id);
                g.setAttribute('transform', \`translate(\${x}, \${y})\`);

                // Highlight critical nodes with glow effect
                if (node.isCritical) {
                    const glow = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                    glow.setAttribute('r', '28');
                    glow.setAttribute('fill', '#ff9800');
                    glow.setAttribute('opacity', '0.3');
                    glow.setAttribute('class', 'critical-glow');
                    g.appendChild(glow);
                }
                
                // Node size based on connectivity
                const baseSize = 20;
                const connectivityBonus = Math.min(node.inDegree + node.outDegree, 8) * 2;
                const nodeSize = baseSize + connectivityBonus;

                const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                rect.setAttribute('x', -nodeSize);
                rect.setAttribute('y', -nodeSize/2);
                rect.setAttribute('width', nodeSize * 2);
                rect.setAttribute('height', nodeSize);
                rect.setAttribute('rx', '5');
                rect.setAttribute('fill', node.colorCode || '#007acc');
                rect.setAttribute('stroke', node.isCritical ? '#ff9800' : 'var(--vscode-panel-border)');
                rect.setAttribute('stroke-width', node.isCritical ? '3' : '2');
                g.appendChild(rect);

                // Add badge for high connectivity
                if (node.inDegree + node.outDegree > 5) {
                    const badge = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                    badge.setAttribute('cx', nodeSize - 5);
                    badge.setAttribute('cy', -nodeSize/2 + 5);
                    badge.setAttribute('r', '8');
                    badge.setAttribute('fill', '#ff9800');
                    badge.setAttribute('stroke', '#fff');
                    badge.setAttribute('stroke-width', '1.5');
                    g.appendChild(badge);
                    
                    const badgeText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                    badgeText.setAttribute('x', nodeSize - 5);
                    badgeText.setAttribute('y', -nodeSize/2 + 8);
                    badgeText.setAttribute('text-anchor', 'middle');
                    badgeText.setAttribute('font-size', '8');
                    badgeText.setAttribute('font-weight', 'bold');
                    badgeText.setAttribute('fill', '#fff');
                    badgeText.textContent = node.inDegree + node.outDegree;
                    g.appendChild(badgeText);
                }

                /**
                 * TEXT LABEL POSITIONING (INSIDE NODE BOXES)
                 * 
                 * Each node is a rectangle from y=-nodeSize/2 to y=nodeSize/2 (height = nodeSize)
                 * where nodeSize = baseSize (20) + connectivityBonus (0-16), typically 20-36px
                 * 
                 * For minimum size (20px): box bounds are y=-10 to y=10
                 * For maximum size (36px): box bounds are y=-18 to y=18
                 * 
                 * Labels are positioned to be INSIDE the box:
                 * - Kind label: y=-5 (upper portion, above center line at y=0)
                 * - Name label: y=7 (lower portion, below center line at y=0)
                 * 
                 * These positions work for all node sizes:
                 * - Minimum (20px): -5 and 7 are within [-10, 10] bounds
                 * - Typical/Maximum (36px): -5 and 7 are comfortably within [-18, 18] bounds
                 * 
                 * Both use text-anchor="middle" (set in CSS) to horizontally center at x=0
                 * Font sizes are kept small (9px, 8px) to fit within the node width
                 * Text is truncated to prevent overflow (kind: 10 chars, name: 12 chars)
                 * 
                 * Note: Labels are positioned close to edges on minimum-sized nodes but
                 * remain fully visible. Larger nodes have more comfortable spacing.
                 */
                const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                text.setAttribute('class', 'topo-label');
                text.setAttribute('y', '-5');  // Position above center, within box bounds for all node sizes
                text.setAttribute('font-size', '9');
                text.textContent = node.kind.substring(0, 10);
                g.appendChild(text);

                const nameText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                nameText.setAttribute('class', 'topo-label');
                nameText.setAttribute('y', '7');  // Position below center, within box bounds for all node sizes
                nameText.setAttribute('font-size', '8');
                nameText.setAttribute('opacity', '0.8');
                nameText.textContent = node.name.substring(0, 12);
                g.appendChild(nameText);

                // Enhanced tooltip
                const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
                const criticalStr = node.isCritical ? ' [CRITICAL]' : '';
                const connectionsStr = \`Connections: In=\${node.inDegree}, Out=\${node.outDegree}\`;
                title.textContent = \`\${node.kind}: \${node.name}\${criticalStr}\n\${node.namespace ? 'Namespace: ' + node.namespace : ''}\nCategory: \${node.category}\n\${connectionsStr}\`;
                g.appendChild(title);
                
                // Click to highlight related nodes
                g.style.cursor = 'pointer';
                g.addEventListener('click', (e) => {
                    e.stopPropagation();
                    
                    // Remove previous selection
                    document.querySelectorAll('.topo-node').forEach(n => n.classList.remove('selected'));
                    document.querySelectorAll('.topo-edge').forEach(e => e.classList.remove('highlighted'));
                    
                    if (selectedNode === node.id) {
                        selectedNode = null;
                        return;
                    }
                    
                    selectedNode = node.id;
                    g.classList.add('selected');
                    
                    // Highlight connected edges
                    const relatedEdges = edges.filter(e => e.source === node.id || e.target === node.id);
                    relatedEdges.forEach(edge => {
                        const edgePaths = container.querySelectorAll('path.topo-edge');
                        edgePaths.forEach(path => {
                            const titleText = path.querySelector('title')?.textContent || '';
                            if (titleText.includes(edge.source) && titleText.includes(edge.target)) {
                                path.classList.add('highlighted');
                            }
                        });
                    });
                });

                container.appendChild(g);
            });
            
            // Click on background to deselect
            svg.addEventListener('click', () => {
                document.querySelectorAll('.topo-node').forEach(n => n.classList.remove('selected'));
                document.querySelectorAll('.topo-edge').forEach(e => e.classList.remove('highlighted'));
                selectedNode = null;
            });

            /**
             * GRAPH CENTERING
             * 
             * After all nodes and edges are rendered, we center the entire graph
             * within the SVG viewport for better visual presentation.
             * 
             * Approach:
             * 1. Use getBBox() to get the actual bounding box of all rendered content
             * 2. Calculate the offset needed to center this content in the SVG viewport
             * 3. Apply this offset via topologyPanX and topologyPanY
             * 4. The transform is applied through updateTopologyZoom()
             * 5. Store these as default values for Reset View / Fit to Screen
             * 
             * Formula:
             * - centerX = (viewportWidth - contentWidth) / 2 - contentX
             * - centerY = (viewportHeight - contentHeight) / 2 - contentY
             * 
             * This works in conjunction with the .topology-view CSS flexbox centering
             * to ensure the graph is centered both at the container and content level.
             */
            const contentBounds = typeof container.getBBox === 'function' ? container.getBBox() : { x: 0, y: 0, width: width, height: height };
            const centerX = (width - contentBounds.width) / 2 - contentBounds.x;
            const centerY = (height - contentBounds.height) / 2 - contentBounds.y;
            // Store the initially computed centered pan so Reset / Fit can restore this view
            var defaultTopologyPanX = centerX;
            var defaultTopologyPanY = centerY;
            topologyPanX = centerX;
            topologyPanY = centerY;
            
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
                topologyPanX = defaultTopologyPanX;
                topologyPanY = defaultTopologyPanY;
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
                topologyPanX = defaultTopologyPanX;
                topologyPanY = defaultTopologyPanY;
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
