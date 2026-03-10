import * as crypto from "node:crypto";
import * as yaml from "js-yaml";
import * as vscode from "vscode";
import type { ResourceHierarchy } from "./resourceVisualizer";
import { getIconDataUriWithFallback } from "../k8s/iconManager";
import { loadTemplate, getTemplatePath } from "../webview/templateLoader";

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
export async function generateEnhancedHtml(
	webview: vscode.Webview,
	data: any,
	extensionUri: vscode.Uri
): Promise<string> {
	const nonce = getNonce();

	// Debug: Show message to confirm code is running
	vscode.window.showInformationMessage("Generating webview HTML...");

	try {
		// Get local Chart.js, CSS, and webview JS URIs
		const chartJsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "vendor", "chart.umd.js"));
		const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "out", "webview", "styles.css"));
		const mainJsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "out", "webview", "main.js"));
		const topologyJsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "out", "webview", "topology.js"));

		// Debug: Show URI info
		vscode.window.showInformationMessage(`Chart.js: ${chartJsUri}`);

		// Generate dynamic content
		const overviewContent = generateOverviewTab(data);
		const resourceExplorerHtml = generateResourceExplorer(data.resourceHierarchy, webview, extensionUri);
		const resultsContent = await loadTemplate(getTemplatePath("results", extensionUri), {
			availableEnvs: data.availableEnvs || [],
		});
		const initData = generateInitializationData(data);

		// Load main template and replace placeholders
		const mainTemplate = await loadTemplate(getTemplatePath("main", extensionUri), {
			nonce,
			cspSource: webview.cspSource,
			stylesUri,
			chartJsUri,
			topologyJsUri,
			mainJsUri,
			initData,
			overviewContent,
			resourcesContent: resourceExplorerHtml,
			resultsContent,
			availableEnvs: data.availableEnvs || [],
		});

		return mainTemplate;
	} catch (error) {
		vscode.window.showErrorMessage(`Error generating webview: ${error}`);
		// Return fallback HTML
		const fallbackHtml = `
		<!DOCTYPE html>
		<html>
		<head>
			<meta charset="UTF-8">
				<meta http-equiv="Content-Security-Policy" content="${webview.cspSource} script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';">
				<title>Chart Profile Visualizer</title>
		</head>
		<body>
			<div class="error-container">
				<h1>Error Loading Chart Profile</h1>
				<p>${error}</p>
			</div>
		</body>
		</html>
		`;
		return fallbackHtml;
	}
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

        ${
			Object.keys(data.resourceCounts || {}).length > 0
				? `
        <div class="chart-container">
            <h2>Resource Distribution</h2>
            <div class="chart-wrapper">
                <canvas id="resourceChart"></canvas>
            </div>
        </div>
        `
				: `
        <div class="chart-container" style="display:none">
            <h2>Resource Distribution</h2>
            <div class="chart-wrapper">
                <canvas id="resourceChart"></canvas>
            </div>
        </div>
        `
		}

        ${
			data.totalValues > 0
				? `
        <div class="chart-container">
            <h2>Values Overview</h2>
            <div class="chart-wrapper">
                <canvas id="valuesChart"></canvas>
            </div>
        </div>
        `
				: `
        <div class="chart-container" style="display:none">
            <h2>Values Overview</h2>
            <div class="chart-wrapper">
                <canvas id="valuesChart"></canvas>
            </div>
        </div>
        `
		}

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
                    `
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

/**
 * Apply syntax highlighting to YAML content
 */
function highlightYaml(yamlContent: string): string {
	const lines = yamlContent.split("\n");
	const highlighted: string[] = [];

	for (const line of lines) {
		// Check for comments first
		const commentIndex = line.indexOf("#");
		if (commentIndex !== -1) {
			const beforeComment = line.substring(0, commentIndex);
			const comment = line.substring(commentIndex);
			const highlightedBefore = highlightYamlLine(beforeComment);
			const highlightedComment = `<span class="yaml-comment">${escapeHtml(comment)}</span>`;
			highlighted.push(highlightedBefore + highlightedComment);
			continue;
		}

		highlighted.push(highlightYamlLine(line));
	}

	return highlighted.join("\n");
}

/**
 * Highlight a single YAML line (without comments)
 */
function highlightYamlLine(line: string): string {
	// Match list items first (handles both "- value" and "- key: value")
	const listMatch = line.match(/^(\s*)(- )(.*)$/);
	if (listMatch) {
		const [, indent, dash, content] = listMatch;
		const highlightedDash = `<span class="yaml-indicator">${dash}</span>`;
		// The content after "- " may itself be a "key: value" pair.
		// Require a space after colon (or colon at end) to avoid matching URLs (e.g. https://...).
		const keyInListMatch = content.match(/^([^:]+)(: )(.*)$/) || content.match(/^([^:]+)(:)$/);
		if (keyInListMatch) {
			const [, key, colon, value = ""] = keyInListMatch;
			const highlightedKey = `<span class="yaml-key">${escapeHtml(key)}</span>`;
			const highlightedColon = `<span class="yaml-colon">${colon}</span>`;
			const highlightedValue = highlightYamlValue(value);
			return `${indent}${highlightedDash}${highlightedKey}${highlightedColon}${highlightedValue}`;
		}
		const highlightedContent = highlightYamlValue(content);
		return `${indent}${highlightedDash}${highlightedContent}`;
	}

	// Match key: value pattern. Require a space after colon (or colon at end) to avoid matching URLs.
	const keyMatch = line.match(/^(\s*)([^:]+)(: )(.*)$/) || line.match(/^(\s*)([^:]+)(:)\s*$/);
	if (keyMatch) {
		const [, indent, key, colon, value = ""] = keyMatch;
		const highlightedKey = `<span class="yaml-key">${escapeHtml(key)}</span>`;
		const highlightedColon = `<span class="yaml-colon">${colon}</span>`;
		const highlightedValue = highlightYamlValue(value);
		return `${indent}${highlightedKey}${highlightedColon}${highlightedValue}`;
	}

	return escapeHtml(line);
}

/**
 * Highlight a YAML value
 */
function highlightYamlValue(value: string): string {
	const trimmed = value.trim();

	if (!trimmed) {
		return escapeHtml(value);
	}

	// Check for quoted strings
	if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
		return `<span class="yaml-value">${escapeHtml(value)}</span>`;
	}

	// Check for numbers
	if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
		return value.replace(trimmed, `<span class="yaml-number">${trimmed}</span>`);
	}

	// Check for booleans
	if (trimmed === "true" || trimmed === "false") {
		return value.replace(trimmed, `<span class="yaml-boolean">${trimmed}</span>`);
	}

	// Check for null
	if (trimmed === "null" || trimmed === "~") {
		return value.replace(trimmed, `<span class="yaml-null">${trimmed}</span>`);
	}

	// Check for anchors
	if (trimmed.startsWith("&") || trimmed.startsWith("*")) {
		return `<span class="yaml-anchor">${escapeHtml(value)}</span>`;
	}

	// Plain string
	if (trimmed) {
		return `<span class="yaml-value">${escapeHtml(value)}</span>`;
	}

	return escapeHtml(value);
}

function generateResourceExplorer(
	hierarchy: ResourceHierarchy,
	webview: vscode.Webview,
	extensionUri: vscode.Uri
): string {
	if (!hierarchy || hierarchy.totalCount === 0) {
		return `
			<div class="no-data">
				<div class="no-data-icon">📦</div>
				<div class="no-data-text">No resources found</div>
				<div class="no-data-hint">Render your Helm chart to see resources here</div>
			</div>
		`;
	}

	let html = '<div class="resource-explorer">';

	for (const [kind, group] of hierarchy.kindGroups) {
		// Get icon for this resource kind with fallback
		const iconDataUri = getIconDataUriWithFallback(kind, group.category, "dark");

		html += `
        <div class="kind-group" data-kind="${escapeHtml(kind)}">
            <div class="kind-header">
                <span class="expand-icon">▶</span>
                <img src="${iconDataUri}" class="kind-icon" alt="${escapeHtml(kind)}" />
                <span class="kind-name" data-color="${group.colorCode}">${escapeHtml(kind)}</span>
                <span class="kind-count">${group.count}</span>
            </div>
            <div class="kind-resources" data-collapsed="true">
        `;

		for (const resource of group.resources) {
			// For secrets, sanitize the YAML to mask sensitive data
			const displayYaml = resource.kind === "Secret" ? sanitizeSecretYaml(resource.yaml) : resource.yaml;

			// Apply syntax highlighting
			const highlightedYaml = highlightYaml(displayYaml);

			// Get icon for this resource
			const resourceIconUri = getIconDataUriWithFallback(resource.kind, resource.category, "dark");

			html += `
            <div class="resource-card" data-color="${group.colorCode}" data-resource-name="${escapeAttr(resource.name)}">
                <div class="resource-header">
                    <span class="expand-icon">▶</span>
                    <img src="${resourceIconUri}" class="resource-icon" alt="${escapeHtml(resource.kind)}" />
                    <span class="resource-name">${escapeHtml(resource.name)}</span>
                    ${resource.namespace ? `<span class="namespace-tag">${escapeHtml(resource.namespace)}</span>` : ""}
                    <button class="copy-btn" title="Copy YAML">📋</button>
                </div>
                <div class="resource-details" data-collapsed="true">
                    <pre class="code-block yaml-block">${highlightedYaml}</pre>
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

/**
 * Generate initialization data for the webview JavaScript
 * This replaces the large inline generateJavaScript function
 */
function generateInitializationData(data: any): string {
	// Pass architecture data safely
	const architectureNodes = data.architectureNodes || [];
	const relationships = data.relationships || [];

	// Generate icon data URIs for all unique kinds in the nodes
	const kindIconMap: Record<string, string> = {};
	for (const node of architectureNodes) {
		if (node.kind && !kindIconMap[node.kind]) {
			try {
				kindIconMap[node.kind] = getIconDataUriWithFallback(node.kind, node.category, "dark");
			} catch (error) {
				// If the icon manager is not initialized or an error occurs,
				// skip assigning an icon for this kind rather than failing.
				console.warn(`Failed to get icon for kind ${node.kind}:`, error);
			}
		}
	}

	// Create the initialization data object
	const initData = {
		architectureNodes,
		relationships,
		kindIcons: kindIconMap,
		resourceCounts: data.resourceCounts || {},
		overriddenCount: data.overriddenCount || 0,
		totalValues: data.totalValues || 0,
		comparisonData: data.comparisonData || null,
		availableEnvs: data.availableEnvs || [],
	};

	// Safely serialize to JSON, escaping < characters for security
	// Also escape quotes for safe use in HTML attributes
	return JSON.stringify(initData).replace(/</g, "\\u003c").replace(/"/g, "&quot;");
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
