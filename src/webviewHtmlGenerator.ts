import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as yaml from 'js-yaml'; // Used for Secret sanitization to mask sensitive data
import { ResourceHierarchy } from './resourceVisualizer';

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
        const yamlObj = yaml.load(yamlContent.replace(/^#.*$/gm, '').trim());
        
        // Type guard to ensure we have a valid object
        if (!yamlObj || typeof yamlObj !== 'object') {
            return '# Secret data redacted for security';
        }
        
        const secretObj = yamlObj as SecretObject;
        
        // Redact sensitive fields by replacing values with placeholders
        const redactField = (obj: Record<string, string>): Record<string, string> => {
            return Object.keys(obj).reduce((acc, key) => {
                acc[key] = '***REDACTED***';
                return acc;
            }, {} as Record<string, string>);
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
        return '# Secret data redacted for security';
    }
}

/**
 * Generate enhanced webview HTML with resource explorer, topology view, and interactive features
 */
export function generateEnhancedHtml(
    webview: vscode.Webview,
    data: any,
    extensionUri: vscode.Uri
): string {
    const nonce = getNonce();
    const styleNonce = getNonce();

    // Get local Chart.js URI
    const chartJsUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'vendor', 'chart.umd.js')
    );

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

        ${Object.keys(data.resourceCounts).length > 0 ? `
        <div class="chart-container">
            <h2>Resource Type Distribution</h2>
            <canvas id="resourceChart" class="chart-canvas"></canvas>
        </div>
        ` : ''}

        ${data.totalValues > 0 ? `
        <div class="chart-container">
            <h2>Values: Overridden vs Base</h2>
            <canvas id="valuesChart" class="chart-canvas"></canvas>
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
                    ${data.overriddenValues.map((v: any) => `
                        <tr>
                            <td class="value-key">${escapeHtml(v.key)}</td>
                            <td class="value-old">${escapeHtml(String(v.baseValue))}</td>
                            <td class="value-new">${escapeHtml(String(v.envValue))}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
        ` : ''}
    `;
}

function generateResourceExplorer(hierarchy: ResourceHierarchy, webview: vscode.Webview, extensionUri: vscode.Uri): string {
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
            const displayYaml = resource.kind === 'Secret' 
                ? sanitizeSecretYaml(resource.yaml)
                : resource.yaml;
            
            html += `
            <div class="resource-card" style="border-left-color: ${group.colorCode}" data-resource-name="${escapeAttr(resource.name)}">
                <div class="resource-header">
                    <span class="expand-icon">▶</span>
                    <strong>${escapeHtml(resource.name)}</strong>
                    ${resource.namespace ? `<span class="namespace-tag">${escapeHtml(resource.namespace)}</span>` : ''}
                    <button class="copy-btn">📋</button>
                </div>
                <div class="resource-details" style="display: none;">
                    <div class="detail-section">
                        <h4>Metadata</h4>
                        <pre>${escapeHtml(JSON.stringify(resource.metadata, null, 2))}</pre>
                    </div>
                    ${Object.keys(resource.spec || {}).length > 0 ? `
                    <div class="detail-section">
                        <h4>Spec</h4>
                        <pre>${escapeHtml(JSON.stringify(resource.spec, null, 2))}</pre>
                    </div>
                    ` : ''}
                    ${resource.kind === 'Secret' && resource.data ? `
                    <div class="detail-section">
                        <h4>Data (masked)</h4>
                        <pre>${escapeHtml(JSON.stringify(resource.data, null, 2))}</pre>
                    </div>
                    ` : ''}
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
    
    html += '</div>';
    return html;
}

function generateTopologyTab(): string {
    return `
        <div class="topology-view">
            <div class="topology-controls">
                <button id="zoomInBtn">🔍+</button>
                <button id="zoomOutBtn">🔍-</button>
                <button id="resetZoomBtn">⟲</button>
            </div>
            <svg id="topologySvg" class="topology-svg">
                <text x="50%" y="50%" text-anchor="middle" fill="var(--vscode-foreground)">
                    Topology view: Drag to connect resources
                </text>
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
        }
        .chart-canvas {
            max-width: 100%;
            height: 300px;
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
        kind: r.kind || 'Unknown',
        name: r.name || 'unnamed',
        namespace: r.namespace || 'default'
    }));
    
    // Escape the JSON to prevent XSS by replacing < with \u003c
    const safeTopologyData = JSON.stringify(topologyResources).replace(/</g, '\\u003c');
    
    return `
        const vscode = acquireVsCodeApi();
        let liveMode = false;
        let currentZoom = 1;

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

        // Topology view functions
        function initTopology() {
            const svg = document.getElementById('topologySvg');
            if (svg.hasAttribute('data-initialized')) return;
            svg.setAttribute('data-initialized', 'true');
            
            // Simple topology: just show resources as nodes (minimal data)
            const resources = ${safeTopologyData};
            const width = svg.clientWidth;
            const height = svg.clientHeight;
            
            resources.forEach((resource, i) => {
                const x = 50 + (i % 5) * 150;
                const y = 50 + Math.floor(i / 5) * 100;
                
                const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                g.setAttribute('transform', \`translate(\${x}, \${y})\`);
                
                const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                rect.setAttribute('width', '120');
                rect.setAttribute('height', '60');
                rect.setAttribute('rx', '5');
                rect.setAttribute('fill', 'var(--vscode-editor-inactiveSelectionBackground)');
                rect.setAttribute('stroke', 'var(--vscode-panel-border)');
                g.appendChild(rect);
                
                const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                text.setAttribute('x', '60');
                text.setAttribute('y', '25');
                text.setAttribute('text-anchor', 'middle');
                text.setAttribute('fill', 'var(--vscode-foreground)');
                text.setAttribute('font-size', '12');
                text.textContent = resource.kind;
                g.appendChild(text);
                
                const name = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                name.setAttribute('x', '60');
                name.setAttribute('y', '45');
                name.setAttribute('text-anchor', 'middle');
                name.setAttribute('fill', 'var(--vscode-descriptionForeground)');
                name.setAttribute('font-size', '10');
                name.textContent = resource.name.substring(0, 15);
                g.appendChild(name);
                
                svg.appendChild(g);
            });
        }

        // Topology zoom controls - bind event listeners
        const zoomInBtn = document.getElementById('zoomInBtn');
        const zoomOutBtn = document.getElementById('zoomOutBtn');
        const resetZoomBtn = document.getElementById('resetZoomBtn');
        
        if (zoomInBtn) {
            zoomInBtn.addEventListener('click', () => {
                currentZoom = Math.min(currentZoom + 0.1, 3);
                updateZoom();
            });
        }
        
        if (zoomOutBtn) {
            zoomOutBtn.addEventListener('click', () => {
                currentZoom = Math.max(currentZoom - 0.1, 0.5);
                updateZoom();
            });
        }
        
        if (resetZoomBtn) {
            resetZoomBtn.addEventListener('click', () => {
                currentZoom = 1;
                updateZoom();
            });
        }

        function updateZoom() {
            const svg = document.getElementById('topologySvg');
            if (svg) {
                svg.style.transform = \`scale(\${currentZoom})\`;
                svg.style.transformOrigin = 'center center';
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

        ${Object.keys(data.resourceCounts || {}).length > 0 ? `
        (function() {
            const ctx = document.getElementById('resourceChart');
            if (!ctx) return;
            
            const resourceData = ${JSON.stringify(data.resourceCounts)};
            const labels = Object.keys(resourceData);
            const values = Object.values(resourceData);
            
            new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Resource Count',
                        data: values,
                        backgroundColor: colorPalette.slice(0, labels.length),
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false }
                    }
                }
            });
        })();
        ` : ''}

        ${data.totalValues > 0 ? `
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
        ` : ''}
    `;
}

function getNonce(): string {
    return crypto.randomBytes(16).toString('base64');
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function escapeAttr(text: string): string {
    return text.replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
