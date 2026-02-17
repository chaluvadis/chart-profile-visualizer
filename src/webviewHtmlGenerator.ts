import * as crypto from "node:crypto";
import * as yaml from "js-yaml";
import * as vscode from "vscode";
import type { ResourceHierarchy } from "./resourceVisualizer";
import {
  getIconDataUri,
  getNormalizedIconName,
  getIconDataUriWithFallback,
} from "./iconManager";

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
    const redactField = (
      obj: Record<string, string>,
    ): Record<string, string> => {
      return Object.keys(obj).reduce(
        (acc, key) => {
          acc[key] = "***REDACTED***";
          return acc;
        },
        {} as Record<string, string>,
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
export function generateEnhancedHtml(
  webview: vscode.Webview,
  data: any,
  extensionUri: vscode.Uri,
): string {
  const nonce = getNonce();

  // Get local Chart.js and CSS URIs
  const chartJsUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "vendor", "chart.umd.js"),
  );
  const stylesUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "out", "styles.css"),
  );

  // Generate resource explorer HTML
  const resourceExplorerHtml = generateResourceExplorer(
    data.resourceHierarchy,
    webview,
    extensionUri,
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src ${webview.cspSource};">
    <title>Chart Visualization</title>
    <link rel="stylesheet" href="${stylesUri}" nonce="${nonce}">
</head>
<body>
    <div class="toolbar">
        <button id="exportYaml" class="toolbar-btn">📄 Export YAML</button>
        <button id="exportJson" class="toolbar-btn">📋 Export JSON</button>
        <input type="search" id="searchBox" placeholder="Search resources..." class="search-box">
    </div>

    <div class="tabs">
        <button class="tab-btn active" data-tab="overview">Overview</button>
        <button class="tab-btn" data-tab="resources">Resources</button>
    </div>

    <div id="overview" class="tab-content active">
        ${generateOverviewTab(data)}
    </div>

    <div id="resources" class="tab-content">
        ${resourceExplorerHtml}
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

        ${generateTopologyTab()}

        ${
          data.overriddenValues.length > 0
            ? `
        <div class="chart-container">
            <h2>Overridden Values</h2>
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
                            <td class="value-old">${escapeHtml(formatValue(v.baseValue))}</td>
                            <td class="value-new">${escapeHtml(formatValue(v.envValue))}</td>
                        </tr>
                    `,
                      )
                      .join("")}
                </tbody>
            </table>
        </div>
        `
            : `
        <div class="chart-container">
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
        </div>
        `
        }
    `;
}

function generateResourceExplorer(
  hierarchy: ResourceHierarchy,
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
): string {
  if (!hierarchy || hierarchy.totalCount === 0) {
    return '<div class="no-data"><p>No resources found</p></div>';
  }

  let html = '<div class="resource-explorer">';

  for (const [kind, group] of hierarchy.kindGroups) {
    // Get icon for this resource kind
    const iconName = getNormalizedIconName(kind);
    const iconDataUri = getIconDataUri(kind, "dark");

    html += `
        <div class="kind-group" data-kind="${escapeHtml(kind)}">
            <div class="kind-header">
                <span class="expand-icon">▶</span>
                <img src="${iconDataUri}" class="kind-icon" alt="${escapeHtml(kind)}" />
                <span class="kind-name" data-color="${group.colorCode}">${escapeHtml(kind)} (${group.count})</span>
            </div>
            <div class="kind-resources" data-collapsed="true">
        `;

    for (const resource of group.resources) {
      // For secrets, sanitize the YAML to mask sensitive data
      const displayYaml =
        resource.kind === "Secret"
          ? sanitizeSecretYaml(resource.yaml)
          : resource.yaml;

      // Get icon for this resource
      const resourceIconUri = getIconDataUri(resource.kind, "dark");

      html += `
            <div class="resource-card" data-color="${group.colorCode}" data-resource-name="${escapeAttr(resource.name)}">
                <div class="resource-header">
                    <span class="expand-icon">▶</span>
                    <img src="${resourceIconUri}" class="resource-icon" alt="${escapeHtml(resource.kind)}" />
                    <strong>${escapeHtml(resource.name)}</strong>
                    ${resource.namespace ? `<span class="namespace-tag">${escapeHtml(resource.namespace)}</span>` : ""}
                    <button class="copy-btn">📋</button>
                </div>
                <div class="resource-details" data-collapsed="true">
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
                <div class="topology-title-section">
                    <h2>Resource Architecture
                        <span class="help-tooltip" title="Interactive system architecture view organized by resource tiers. Click nodes to highlight relationships. Use controls to zoom, pan, and filter. Critical nodes are marked with badges. Connection counts show integration complexity.">ⓘ</span>
                    </h2>
                    <div class="topology-info">
                        <span id="nodeCount" class="topology-stat">0 resources</span>
                        <span class="topology-separator">•</span>
                        <span id="edgeCount" class="topology-stat">0 connections</span>
                    </div>
                </div>
                <div class="topology-controls">
                    <div class="control-group">
                        <button id="zoomInBtn" class="topology-btn" title="Zoom In">
                            <span class="btn-icon">➕</span>
                        </button>
                        <button id="zoomOutBtn" class="topology-btn" title="Zoom Out">
                            <span class="btn-icon">➖</span>
                        </button>
                        <button id="resetZoomBtn" class="topology-btn" title="Reset View">
                            <span class="btn-icon">⟲</span>
                        </button>
                        <button id="fitToScreen" class="topology-btn" title="Fit to Screen">
                            <span class="btn-icon">⛶</span>
                        </button>
                    </div>
                    <div class="control-group">
                        <select id="tierFilter" class="topology-select" title="Filter by tier">
                            <option value="all">All Tiers</option>
                            <option value="Workload">Workloads</option>
                            <option value="Networking">Networking</option>
                            <option value="Storage">Storage</option>
                            <option value="Configuration">Configuration</option>
                            <option value="RBAC">RBAC</option>
                            <option value="Scaling">Scaling</option>
                            <option value="Other">Other</option>
                        </select>
                    </div>
                </div>
            </div>
            <div class="topology-legend">
                <div class="legend-section">
                    <span class="legend-label">Resource Tiers:</span>
                    <div class="legend-items">
                        <div class="legend-item">
                            <div class="legend-color" data-color="#0078d4"></div>
                            <span>Workload</span>
                        </div>
                        <div class="legend-item">
                            <div class="legend-color" data-color="#107c10"></div>
                            <span>Networking</span>
                        </div>
                        <div class="legend-item">
                            <div class="legend-color" data-color="#8661c5"></div>
                            <span>Storage</span>
                        </div>
                        <div class="legend-item">
                            <div class="legend-color" data-color="#d83b01"></div>
                            <span>Configuration</span>
                        </div>
                        <div class="legend-item">
                            <div class="legend-color" data-color="#e81123"></div>
                            <span>RBAC</span>
                        </div>
                        <div class="legend-item">
                            <div class="legend-color" data-color="#008272"></div>
                            <span>Scaling</span>
                        </div>
                    </div>
                </div>
                <div class="legend-section">
                    <span class="legend-label">Indicators:</span>
                    <div class="legend-items">
                        <div class="legend-item">
                            <div class="legend-badge critical">⚠</div>
                            <span>Critical Resource</span>
                        </div>
                        <div class="legend-item">
                            <div class="legend-badge connectivity">5+</div>
                            <span>High Connectivity</span>
                        </div>
                    </div>
                </div>
            </div>
            <svg id="topologySvg" class="topology-svg">
                <defs>
                    <!-- Gradient definitions for modern look -->
                    <linearGradient id="nodeGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="rgba(255,255,255,0.1)" stop-opacity="1" />
                        <stop offset="100%" stop-color="rgba(0,0,0,0.1)" stop-opacity="1" />
                    </linearGradient>
                    <!-- Arrow markers for different relationship types - Tip at path endpoint -->
                    <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="10" refY="5" orient="auto">
                        <polygon points="0 0, 10 5, 0 10" fill="var(--vscode-foreground)" opacity="0.8" />
                    </marker>
                    <marker id="arrowhead-critical" markerWidth="10" markerHeight="10" refX="10" refY="5" orient="auto">
                        <polygon points="0 0, 10 5, 0 10" fill="#ffa500" opacity="1" />
                    </marker>
                    <marker id="arrowhead-selected" markerWidth="10" markerHeight="10" refX="10" refY="5" orient="auto">
                        <polygon points="0 0, 10 5, 0 10" fill="#0078d4" opacity="1" />
                    </marker>
                    <!-- Filter for drop shadow -->
                    <filter id="dropShadow" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur in="SourceAlpha" stdDeviation="2"/>
                        <feOffset dx="0" dy="2" result="offsetblur"/>
                        <feComponentTransfer>
                            <feFuncA type="linear" slope="0.3"/>
                        </feComponentTransfer>
                        <feMerge>
                            <feMergeNode/>
                            <feMergeNode in="SourceGraphic"/>
                        </feMerge>
                    </filter>
                    <!-- Glow effect for critical nodes -->
                    <filter id="criticalGlow" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
                        <feMerge>
                            <feMergeNode in="coloredBlur"/>
                            <feMergeNode in="SourceGraphic"/>
                        </feMerge>
                    </filter>
                </defs>
                <g id="topologyContent"></g>
            </svg>
        </div>
    `;
}

function generateJavaScript(data: any): string {
  // Pass architecture data safely
  const architectureNodes = data.architectureNodes || [];
  const relationships = data.relationships || [];
  const safeArchNodes = JSON.stringify(architectureNodes).replace(
    /</g,
    "\\u003c",
  );
  const safeRelationships = JSON.stringify(relationships).replace(
    /</g,
    "\\u003c",
  );

  // Generate icon data URIs for all unique kinds in the nodes
  // Default to dark theme, webview will switch based on VS Code theme
  // Uses category-based fallback when specific icon doesn't exist
  const kindIconMap: Record<string, string> = {};
  for (const node of architectureNodes) {
    if (node.kind && !kindIconMap[node.kind]) {
      try {
        // Use fallback function that tries specific icon, then category-based icon
        kindIconMap[node.kind] = getIconDataUriWithFallback(
          node.kind,
          node.category || "Other",
          "dark",
        );
      } catch (error) {
        // If the icon manager is not initialized or an error occurs,
        // skip assigning an icon for this kind rather than failing.
        console.warn(`Failed to get icon for kind ${node.kind}:`, error);
      }
    }
  }
  const safeIconMap = JSON.stringify(kindIconMap).replace(/</g, "\\u003c");

  return `
        const vscode = acquireVsCodeApi();
        let currentZoom = 1;
        let topologyZoom = 1;
        let topologyPanX = 0;
        let topologyPanY = 0;

        // Icon data URIs for each resource kind
        const kindIcons = ${safeIconMap};

        // Topology layout constants
        const MAX_AUTO_FIT_ZOOM = 1.5; // Maximum zoom level when auto-fitting content to screen

        // Tab switching
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tabName = btn.getAttribute('data-tab');
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById(tabName).classList.add('active');
            });
        });

        // Initialize topology on page load since it's now in the Overview tab
        initTopology();

        // Toolbar actions
        document.getElementById('exportYaml').addEventListener('click', () => {
            vscode.postMessage({ type: 'exportYaml' });
        });

        document.getElementById('exportJson').addEventListener('click', () => {
            vscode.postMessage({ type: 'exportJson' });
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
                    const isCollapsed = resources.getAttribute('data-collapsed') === 'true';
                    resources.setAttribute('data-collapsed', isCollapsed ? 'false' : 'true');
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
                    const isCollapsed = details.getAttribute('data-collapsed') === 'true';
                    details.setAttribute('data-collapsed', isCollapsed ? 'false' : 'true');
                }
                return;
            }
        });

        // Enhanced Topology view with relationships
        /**
         * Modern Topology Rendering with Horizontal Layout
         *
         * Key improvements:
         * - Horizontal tier arrangement (resources grouped by type across the width)
         * - Better spacing and visual hierarchy
         * - Modern card-based node design with shadows
         * - Enhanced interactivity and animations
         * - Cleaner edge routing
         */
        function initTopology() {
            const svg = document.getElementById('topologySvg');
            if (!svg) return;
            if (svg.hasAttribute('data-initialized')) return;
            svg.setAttribute('data-initialized', 'true');

            const container = document.getElementById('topologyContent');
            if (!container) return;

            const nodes = ${safeArchNodes};
            const edges = ${safeRelationships};

            // Update stats in header
            const nodeCount = document.getElementById('nodeCount');
            const edgeCount = document.getElementById('edgeCount');
            if (nodeCount) nodeCount.textContent = \`\${nodes.length} resource\${nodes.length !== 1 ? 's' : ''}\`;
            if (edgeCount) edgeCount.textContent = \`\${edges.length} connection\${edges.length !== 1 ? 's' : ''}\`;

            if (nodes.length === 0) {
                container.innerHTML = '<text x="50%" y="50%" text-anchor="middle" font-size="14" fill="var(--vscode-descriptionForeground)">No resources to display</text>';
                return;
            }

            const width = svg.clientWidth || 1000;
            const height = svg.clientHeight || 650;

            // Enhanced tier configuration with modern colors
            const tiers = {
                'Workload': { nodes: [], color: '#0078d4', label: 'Workloads', icon: '⚙' },
                'Networking': { nodes: [], color: '#107c10', label: 'Networking', icon: '🌐' },
                'Storage': { nodes: [], color: '#8661c5', label: 'Storage', icon: '💾' },
                'Configuration': { nodes: [], color: '#d83b01', label: 'Configuration', icon: '📝' },
                'RBAC': { nodes: [], color: '#e81123', label: 'RBAC', icon: '🔒' },
                'Scaling': { nodes: [], color: '#008272', label: 'Scaling', icon: '📊' },
                'Other': { nodes: [], color: '#737373', label: 'Other', icon: '📦' }
            };

            // Group nodes by category
            nodes.forEach(node => {
                const category = node.category || 'Other';
                if (tiers[category]) {
                    tiers[category].nodes.push(node);
                } else {
                    tiers['Other'].nodes.push(node);
                }
            });

            const nodePositions = new Map();
            const tierOrder = ['Workload', 'Networking', 'Storage', 'Configuration', 'RBAC', 'Scaling', 'Other'];
            const activeTiers = tierOrder.filter(t => tiers[t].nodes.length > 0);

            // Calculate node width based on longest name
            // Account for: left accent bar (4px) + icon area (30px) + text + right indicator space (30px)
            const NODE_HEIGHT = 64;
            const MIN_NODE_WIDTH = 180;
            const MAX_NODE_WIDTH = 400;
            const CHAR_WIDTH_APPROX = 8; // Approximate width per character at 13px font
            const LEFT_RESERVED = 60; // Accent bar + icon + padding
            const RIGHT_RESERVED = 40; // Indicator space on right
            const maxNameLength = Math.max(...nodes.map(n => n.name.length));
            const calculatedNodeWidth = Math.max(MIN_NODE_WIDTH, Math.min(MAX_NODE_WIDTH, LEFT_RESERVED + maxNameLength * CHAR_WIDTH_APPROX + RIGHT_RESERVED));
            const NODE_WIDTH = calculatedNodeWidth;

            /**
             * HORIZONTAL TIER LAYOUT ALGORITHM
             *
             * Improved layout that arranges tiers horizontally across the canvas
             * with better spacing and visual organization.
             *
             * Layout structure:
             * - Tiers are arranged as horizontal rows (not vertical columns)
             * - Each tier gets a horizontal band across the canvas
             * - Nodes within a tier are distributed horizontally
             * - Better utilization of widescreen displays
             */
            const margin = 60;
            // Ensure minimum tier height for readability
            const minTierHeight = 140; // Increased for 64px tall cards
            const calculatedTierHeight = activeTiers.length > 0 ? (height - 2 * margin - 60) / activeTiers.length : minTierHeight;
            const tierHeight = Math.max(minTierHeight, calculatedTierHeight);
            const nodeSpacing = NODE_WIDTH + 40; // Dynamic spacing based on node width
            const startY = margin + 60;
            const tierLabelHeight = 35; // Height reserved for tier label at top of each tier band

            // Track filter state
            let filterTier = 'all';
            const tierFilterEl = document.getElementById('tierFilter');
            if (tierFilterEl) {
                tierFilterEl.addEventListener('change', (e) => {
                    filterTier = e.target.value;
                    applyTierFilter();
                });
            }

            function applyTierFilter() {
                const allNodes = container.querySelectorAll('.topo-node');
                const allEdges = container.querySelectorAll('.topo-edge');
                const allTierBgs = container.querySelectorAll('.topo-tier-bg');
                const allTierLabels = container.querySelectorAll('.topo-tier-label');

                if (filterTier === 'all') {
                    allNodes.forEach(n => n.removeAttribute('data-filtered'));
                    allEdges.forEach(e => e.removeAttribute('data-filtered'));
                    allTierBgs.forEach(b => b.removeAttribute('data-filtered'));
                    allTierLabels.forEach(l => l.removeAttribute('data-filtered'));
                } else {
                    // Hide all first
                    allNodes.forEach(n => n.setAttribute('data-filtered', 'hidden'));
                    allEdges.forEach(e => e.setAttribute('data-filtered', 'hidden'));
                    allTierBgs.forEach(b => b.setAttribute('data-filtered', 'hidden'));
                    allTierLabels.forEach(l => l.setAttribute('data-filtered', 'hidden'));

                    // Show selected tier
                    allNodes.forEach(n => {
                        if (n.getAttribute('data-tier') === filterTier) {
                            n.removeAttribute('data-filtered');
                        }
                    });
                    allTierBgs.forEach(b => {
                        if (b.getAttribute('data-tier') === filterTier) {
                            b.removeAttribute('data-filtered');
                        }
                    });
                    allTierLabels.forEach(l => {
                        if (l.getAttribute('data-tier') === filterTier) {
                            l.removeAttribute('data-filtered');
                        }
                    });

                    // Show edges that connect to visible nodes
                    allEdges.forEach(edge => {
                        const sourceId = edge.getAttribute('data-source');
                        const targetId = edge.getAttribute('data-target');
                        const sourceNode = container.querySelector(\`.topo-node[data-node-id="\${sourceId}"]\`);
                        const targetNode = container.querySelector(\`.topo-node[data-node-id="\${targetId}"]\`);

                        if (sourceNode?.getAttribute('data-filtered') !== 'hidden' && targetNode?.getAttribute('data-filtered') !== 'hidden') {
                            edge.removeAttribute('data-filtered');
                        }
                    });
                }
            }

            // Render tiers and position nodes
            activeTiers.forEach((tierName, tierIndex) => {
                const tier = tiers[tierName];
                const tierY = startY + tierIndex * tierHeight;

                // Draw tier background with consistent padding
                const tierBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                tierBg.setAttribute('class', 'topo-tier-bg');
                tierBg.setAttribute('data-tier', tierName);
                tierBg.setAttribute('x', margin - 10);
                tierBg.setAttribute('y', tierY + 5);
                tierBg.setAttribute('width', width - 2 * margin + 20);
                tierBg.setAttribute('height', tierHeight - 25);
                tierBg.setAttribute('fill', tier.color);
                container.appendChild(tierBg);

                // Tier label on the left with better positioning
                const tierLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                tierLabel.setAttribute('class', 'topo-tier-label');
                tierLabel.setAttribute('data-tier', tierName);
                tierLabel.setAttribute('x', margin + 5);
                tierLabel.setAttribute('y', tierY + 22);
                tierLabel.setAttribute('text-anchor', 'start');
                tierLabel.setAttribute('dominant-baseline', 'middle');
                tierLabel.setAttribute('fill', tier.color);
                tierLabel.textContent = \`\${tier.icon} \${tier.label}\`;
                container.appendChild(tierLabel);

                // Position nodes horizontally within this tier with improved spacing
                const tierNodeCount = tier.nodes.length;
                // Skip empty tiers to prevent division by zero in spacing calculation
                if (tierNodeCount === 0) return;

                const availableWidth = width - 2 * margin - 100; // More conservative margin
                const minNodeSpacing = NODE_WIDTH + 40; // Dynamic based on calculated node width

                // For multi-node tiers, distribute evenly across full width
                // For single-node tiers, center the node
                let startX, spacing;
                if (tierNodeCount === 1) {
                    // Center single node horizontally
                    startX = width / 2;
                    spacing = 0;
                } else {
                    // Calculate optimal spacing - either evenly distributed or min spacing
                    const evenSpacing = availableWidth / (tierNodeCount - 1);
                    spacing = Math.max(evenSpacing, minNodeSpacing);

                    // Center the group of nodes
                    const totalWidth = (tierNodeCount - 1) * spacing;
                    startX = (width - totalWidth) / 2;
                }

                // Account for tier label height when calculating vertical position
                // Tier background spans from (tierY + 5) to (tierY + tierHeight - 20)
                // Label is centered at (tierY + 22), needs space of tierLabelHeight
                // The +5 offset accounts for the visual spacing after the label area
                const labelBottomY = tierY + 22 + 5; // Label vertical center + small spacing below
                const tierBottomY = tierY + tierHeight - 20; // Bottom of tier background
                const availableHeight = tierBottomY - labelBottomY;
                const y = labelBottomY + availableHeight / 2; // Center nodes in available space

                tier.nodes.forEach((node, i) => {
                    const x = startX + i * spacing;
                    nodePositions.set(node.id, { x, y, node, tier: tierName });
                });
            });

            // Draw edges first (so they appear behind nodes)
            edges.forEach(edge => {
                const source = nodePositions.get(edge.source);
                const target = nodePositions.get(edge.target);
                if (!source || !target) return;

                // Calculate direction and distance
                const dx = target.x - source.x;
                const dy = target.y - source.y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                // Skip if nodes are too close
                if (distance < NODE_WIDTH) return;

                // Calculate edge start and end points at node boundaries
                // For horizontal cards, we want edges to connect from sides
                const angle = Math.atan2(dy, dx);

                // Determine best connection points based on relative positions
                let sourceX, sourceY, targetX, targetY;

                if (Math.abs(dx) > Math.abs(dy)) {
                    // Primarily horizontal connection - connect from left/right sides
                    if (dx > 0) {
                        // Target is to the right
                        sourceX = source.x + NODE_WIDTH / 2;
                        targetX = target.x - NODE_WIDTH / 2 - 10;
                    } else {
                        // Target is to the left
                        sourceX = source.x - NODE_WIDTH / 2;
                        targetX = target.x + NODE_WIDTH / 2 + 10;
                    }
                    sourceY = source.y;
                    targetY = target.y;
                } else {
                    // Primarily vertical connection - connect from top/bottom
                    if (dy > 0) {
                        // Target is below
                        sourceY = source.y + NODE_HEIGHT / 2;
                        targetY = target.y - NODE_HEIGHT / 2 - 10;
                    } else {
                        // Target is above
                        sourceY = source.y - NODE_HEIGHT / 2;
                        targetY = target.y + NODE_HEIGHT / 2 + 10;
                    }
                    sourceX = source.x;
                    targetX = target.x;
                }

                // Create the path with smooth curves
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');

                // Calculate control points for bezier curve
                const midX = (sourceX + targetX) / 2;
                const midY = (sourceY + targetY) / 2;

                // Use straight lines with slight curves for cleaner look
                let d;
                if (Math.abs(dx) > Math.abs(dy)) {
                    // Horizontal curve
                    d = \`M\${sourceX},\${sourceY} C\${midX},\${sourceY} \${midX},\${targetY} \${targetX},\${targetY}\`;
                } else {
                    // Vertical curve
                    d = \`M\${sourceX},\${sourceY} C\${sourceX},\${midY} \${targetX},\${midY} \${targetX},\${targetY}\`;
                }

                path.setAttribute('d', d);
                path.setAttribute('class', \`topo-edge\${edge.type === 'ownership' ? ' critical-path' : ''}\`);
                path.setAttribute('data-source', edge.source);
                path.setAttribute('data-target', edge.target);
                path.setAttribute('stroke', edge.type === 'ownership' ? '#ffa500' : 'var(--vscode-foreground)');
                path.setAttribute('stroke-width', '2');
                path.setAttribute('fill', 'none');
                path.setAttribute('marker-end', edge.type === 'ownership' ? 'url(#arrowhead-critical)' : 'url(#arrowhead)');

                const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
                title.textContent = \`\${edge.source} → \${edge.target}\\nType: \${edge.type || 'connection'}\${edge.label ? \`\\n\${edge.label}\` : ''}\`;
                path.appendChild(title);

                container.appendChild(path);
            });

            // Helper function to truncate text to fit within available width
            // Uses SVG's getComputedTextLength() for accurate measurement
            // Note: Uses linear truncation (O(n)) which is sufficient for typical K8s
            // resource names (10-30 chars). Binary search could optimize to O(log n)
            // but adds complexity with minimal benefit for this use case.
            const truncateText = (text, maxWidth, element) => {
                const ELLIPSIS = '...';
                element.textContent = text;
                let textWidth = element.getComputedTextLength();

                // If text fits, no truncation needed
                if (textWidth <= maxWidth) {
                    return text;
                }

                // Truncate text to fit with ellipsis
                let truncated = text;
                while (textWidth > maxWidth && truncated.length > 0) {
                    truncated = truncated.slice(0, -1);
                    element.textContent = truncated + ELLIPSIS;
                    textWidth = element.getComputedTextLength();
                }

                // If we had to truncate, return with ellipsis
                return truncated.length > 0 ? truncated + ELLIPSIS : ELLIPSIS;
            };

            // Draw nodes with practical DevOps-focused design
            let selectedNode = null;
            nodePositions.forEach(({ x, y, node, tier }) => {
                const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                g.setAttribute('class', \`topo-node\${node.isCritical ? ' critical' : ''}\`);
                g.setAttribute('data-node-id', node.id);
                g.setAttribute('data-tier', tier);
                g.setAttribute('transform', \`translate(\${x}, \${y})\`);

                // Node dimensions - dynamically calculated based on name length
                const nodeWidth = NODE_WIDTH;
                const nodeHeight = NODE_HEIGHT;
                const tierColor = tiers[tier]?.color || '#0078d4';

                // Card background with subtle shadow
                const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                rect.setAttribute('class', 'topo-node-rect');
                rect.setAttribute('x', -nodeWidth / 2);
                rect.setAttribute('y', -nodeHeight / 2);
                rect.setAttribute('width', nodeWidth);
                rect.setAttribute('height', nodeHeight);
                rect.setAttribute('rx', '4');
                rect.setAttribute('fill', 'var(--vscode-editor-background)');
                rect.setAttribute('stroke', node.isCritical ? '#f44336' : 'var(--vscode-panel-border)');
                rect.setAttribute('stroke-width', node.isCritical ? '1.5' : '1');
                g.appendChild(rect);

                // Left accent bar - category indicator
                const accentBar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                accentBar.setAttribute('x', -nodeWidth / 2);
                accentBar.setAttribute('y', -nodeHeight / 2);
                accentBar.setAttribute('width', '4');
                accentBar.setAttribute('height', nodeHeight);
                accentBar.setAttribute('rx', '0');
                accentBar.setAttribute('fill', tierColor);
                g.appendChild(accentBar);

                // Icon on left side
                const iconDataUri = kindIcons[node.kind];
                const iconX = -nodeWidth / 2 + 12;

                if (iconDataUri) {
                    const iconImg = document.createElementNS('http://www.w3.org/2000/svg', 'image');
                    iconImg.setAttribute('href', iconDataUri);
                    iconImg.setAttribute('x', iconX);
                    iconImg.setAttribute('y', -10);
                    iconImg.setAttribute('width', 18);
                    iconImg.setAttribute('height', 18);
                    g.appendChild(iconImg);
                }

                // Text content - practical layout
                const textStartX = iconDataUri ? iconX + 24 : iconX + 8;

                // Kind label - resource type
                const kindText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                kindText.setAttribute('x', textStartX);
                kindText.setAttribute('y', -8);
                kindText.setAttribute('text-anchor', 'start');
                kindText.setAttribute('dominant-baseline', 'middle');
                kindText.setAttribute('font-size', '10');
                kindText.setAttribute('fill', 'var(--vscode-descriptionForeground)');
                kindText.setAttribute('font-family', 'var(--vscode-font-family)');
                kindText.textContent = node.kind;
                g.appendChild(kindText);

                // Name label - resource name (most important)
                const nameText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                nameText.setAttribute('x', textStartX);
                nameText.setAttribute('y', 6);
                nameText.setAttribute('text-anchor', 'start');
                nameText.setAttribute('dominant-baseline', 'middle');
                nameText.setAttribute('font-size', '13');
                nameText.setAttribute('font-weight', '600');
                nameText.setAttribute('fill', 'var(--vscode-foreground)');
                nameText.setAttribute('font-family', 'var(--vscode-font-family)');
                nameText.textContent = node.name;
                g.appendChild(nameText);

                // Namespace tag (if present)
                if (node.namespace) {
                    const nsText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                    nsText.setAttribute('x', textStartX);
                    nsText.setAttribute('y', 20);
                    nsText.setAttribute('text-anchor', 'start');
                    nsText.setAttribute('dominant-baseline', 'middle');
                    nsText.setAttribute('font-size', '9');
                    nsText.setAttribute('fill', 'var(--vscode-descriptionForeground)');
                    nsText.setAttribute('font-family', 'var(--vscode-font-family)');
                    nsText.textContent = \`ns: \${node.namespace}\`;
                    g.appendChild(nsText);
                }

                // Status indicators on right side
                const indicatorX = nodeWidth / 2 - 14;

                // Critical indicator
                if (node.isCritical) {
                    const criticalBadge = document.createElementNS('http://www.w3.org/2000/svg', 'g');

                    const criticalBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                    criticalBg.setAttribute('x', indicatorX - 12);
                    criticalBg.setAttribute('y', -10);
                    criticalBg.setAttribute('width', 24);
                    criticalBg.setAttribute('height', 20);
                    criticalBg.setAttribute('rx', '3');
                    criticalBg.setAttribute('fill', '#f44336');
                    criticalBadge.appendChild(criticalBg);

                    const criticalText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                    criticalText.setAttribute('x', indicatorX);
                    criticalText.setAttribute('y', 2);
                    criticalText.setAttribute('text-anchor', 'middle');
                    criticalText.setAttribute('font-size', '10');
                    criticalText.setAttribute('font-weight', '600');
                    criticalText.setAttribute('fill', '#fff');
                    criticalText.textContent = '!';
                    criticalBadge.appendChild(criticalText);

                    g.appendChild(criticalBadge);
                }

                // Connectivity indicator
                const totalConnections = node.inDegree + node.outDegree;
                if (totalConnections >= 3) {
                    const connY = node.isCritical ? 14 : 0;
                    const connBadge = document.createElementNS('http://www.w3.org/2000/svg', 'g');

                    const connBg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                    connBg.setAttribute('cx', indicatorX);
                    connBg.setAttribute('cy', connY);
                    connBg.setAttribute('r', '10');
                    connBg.setAttribute('fill', 'var(--vscode-button-secondaryBackground)');
                    connBadge.appendChild(connBg);

                    const connText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                    connText.setAttribute('x', indicatorX);
                    connText.setAttribute('y', connY + 3);
                    connText.setAttribute('text-anchor', 'middle');
                    connText.setAttribute('font-size', '9');
                    connText.setAttribute('font-weight', '600');
                    connText.setAttribute('fill', 'var(--vscode-button-secondaryForeground)');
                    connText.textContent = totalConnections;
                    connBadge.appendChild(connText);

                    g.appendChild(connBadge);
                }

                // Enhanced tooltip
                const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
                const criticalStr = node.isCritical ? ' [CRITICAL]' : '';
                const connectionsStr = \`Connections: \${totalConnections} (In: \${node.inDegree}, Out: \${node.outDegree})\`;
                title.textContent = \`\${node.kind}: \${node.name}\${criticalStr}\${node.namespace ? \`\\nNamespace: \${node.namespace}\` : ''}\\nCategory: \${node.category}\\n\${connectionsStr}\`;
                g.appendChild(title);

                // Interactive click handler
                g.style.cursor = 'pointer';
                g.addEventListener('click', (e) => {
                    e.stopPropagation();

                    // Clear previous selection
                    container.querySelectorAll('.topo-node').forEach(n => n.classList.remove('selected'));
                    container.querySelectorAll('.topo-edge').forEach(e => e.classList.remove('highlighted'));

                    if (selectedNode === node.id) {
                        selectedNode = null;
                        return;
                    }

                    selectedNode = node.id;
                    g.classList.add('selected');

                    // Highlight connected edges
                    edges.filter(e => e.source === node.id || e.target === node.id).forEach(edge => {
                        const edgePath = container.querySelector(\`path[data-source="\${edge.source}"][data-target="\${edge.target}"]\`);
                        if (edgePath) {
                            edgePath.classList.add('highlighted');
                        }
                    });
                });

                container.appendChild(g);
            });

            // Click on background to deselect
            svg.addEventListener('click', (e) => {
                if (e.target === svg || e.target === container) {
                    container.querySelectorAll('.topo-node').forEach(n => n.classList.remove('selected'));
                    container.querySelectorAll('.topo-edge').forEach(e => e.classList.remove('highlighted'));
                    selectedNode = null;
                }
            });

            // Pan and zoom support
            let isPanning = false;
            let panStart = { x: 0, y: 0 };

            svg.addEventListener('mousedown', (e) => {
                if (e.target === svg || e.target === container || e.target.tagName === 'rect' && e.target.classList.contains('topo-tier-bg')) {
                    isPanning = true;
                    panStart = { x: e.clientX - topologyPanX, y: e.clientY - topologyPanY };
                }
            });

            svg.addEventListener('mousemove', (e) => {
                if (isPanning) {
                    topologyPanX = e.clientX - panStart.x;
                    topologyPanY = e.clientY - panStart.y;
                    updateTopologyZoom();
                }
            });

            svg.addEventListener('mouseup', () => {
                isPanning = false;
            });

            svg.addEventListener('mouseleave', () => {
                isPanning = false;
            });

            // Mouse wheel zoom
            svg.addEventListener('wheel', (e) => {
                e.preventDefault();
                const delta = e.deltaY > 0 ? -0.1 : 0.1;
                topologyZoom = Math.max(0.3, Math.min(3, topologyZoom + delta));
                updateTopologyZoom();
            });

            // Auto-fit to screen on initial render
            fitTopologyToScreen();
        }

        // Helper function to fit topology to screen
        function fitTopologyToScreen() {
            const svg = document.getElementById('topologySvg');
            const container = document.getElementById('topologyContent');
            if (!svg || !container) return;

            // Calculate optimal zoom to fit content
            try {
                const bbox = container.getBBox();
                const svgWidth = svg.clientWidth || 1000;
                const svgHeight = svg.clientHeight || 650;

                const scaleX = svgWidth / (bbox.width + 100);
                const scaleY = svgHeight / (bbox.height + 100);
                topologyZoom = Math.min(scaleX, scaleY, MAX_AUTO_FIT_ZOOM);

                // Center the content
                const scaledWidth = bbox.width * topologyZoom;
                const scaledHeight = bbox.height * topologyZoom;
                topologyPanX = (svgWidth - scaledWidth) / 2 - bbox.x * topologyZoom;
                topologyPanY = (svgHeight - scaledHeight) / 2 - bbox.y * topologyZoom;
            } catch (e) {
                topologyZoom = 0.8;
                topologyPanX = 0;
                topologyPanY = 0;
            }
            updateTopologyZoom();
        }

        function updateTopologyZoom() {
            const container = document.getElementById('topologyContent');
            if (container) {
                container.setAttribute('transform', \`translate(\${topologyPanX}, \${topologyPanY}) scale(\${topologyZoom})\`);
            }
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
            fitToScreenBtn.addEventListener('click', fitTopologyToScreen);
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

/**
 * Format a value for display, handling objects and arrays properly
 */
function formatValue(value: any): string {
  if (value === null || value === undefined) {
    return "(not set)";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
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
