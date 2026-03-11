/**
 * Main webview script for Helm Chart Visualizer
 * Handles tab switching, toolbar actions, search, and resource explorer interactions
 */

// Global state
const currentZoom = 1;

// VS Code API instance - acquired once at initialization
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const vscode = acquireVsCodeApi();

// Webview data interfaces
interface WebviewData {
	architectureNodes: ArchitectureNode[];
	relationships: ResourceRelationship[];
	kindIcons: Record<string, string>;
	resourceCounts: Record<string, number>;
	totalValues: number;
	overriddenCount: number;
	comparisonData: ComparisonData | null;
	availableEnvs: string[];
}

interface ArchitectureNode {
	id: string;
	kind: string;
	name: string;
	namespace?: string;
	category: string;
	colorCode: string;
	icon: string;
	inDegree: number;
	outDegree: number;
	isCritical: boolean;
	healthStatus?: string;
	healthMessage?: string;
}

interface ResourceRelationship {
	source: string;
	target: string;
	type: string;
	label?: string;
	namespace?: string;
	crossNamespace?: boolean;
}

interface ComparisonData {
	header: {
		chartName: string;
		leftEnv: string;
		rightEnv: string;
	};
	summary: {
		added: number;
		removed: number;
		modified: number;
		unchanged: number;
		total: number;
		changePercentage: number;
	};
	resources: ComparisonResource[];
	kindGroups?: KindGroup[];
}

interface ComparisonResource {
	kind: string;
	name: string;
	namespace?: string;
	diffType: string;
	fields?: FieldDiff[];
}

interface FieldDiff {
	path: string;
	leftValue: unknown;
	rightValue: unknown;
}

interface KindGroup {
	kind: string;
	count: number;
}

// Will be initialized with data from the extension
// Attached to window so topology.ts can access it
declare global {
	interface Window {
		webviewData: WebviewData;
		initTopology: () => void;
		resourceChartInstance: unknown;
	}
}

window.webviewData = {
	architectureNodes: [],
	relationships: [],
	kindIcons: {},
	resourceCounts: {},
	totalValues: 0,
	overriddenCount: 0,
	comparisonData: null,
	availableEnvs: [],
};

/**
 * Initialize the webview with data from the extension
 * @param data - The chart visualization data
 */
function initializeWebview(data: WebviewData): void {
	window.webviewData = data;

	// Initialize all components
	initTabSwitching();
	initToolbarActions();
	initSearch();
	initResourceExplorer();
	initResultsTab();
	// Call initTopology from window (defined in topology.ts)
	if (typeof window.initTopology === "function") {
		window.initTopology();
	}
	initCharts();
	initRenderedYamlTab();
}

/**
 * Tab switching functionality
 */
function initTabSwitching(): void {
	document.querySelectorAll(".tab-btn").forEach((btn) => {
		btn.addEventListener("click", () => {
			const tabName = btn.getAttribute("data-tab");
			if (!tabName) return;

			document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
			document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
			btn.classList.add("active");
			const tabContent = document.getElementById(tabName);
			if (tabContent) {
				tabContent.classList.add("active");
			}
		});
	});
}

/**
 * Debounce function to prevent rapid button clicks
 */
function debounce<T extends (...args: unknown[]) => void>(fn: T, delay = 300): T {
	let timeoutId: ReturnType<typeof setTimeout> | null = null;
	return ((...args: unknown[]) => {
		if (timeoutId) {
			clearTimeout(timeoutId);
		}
		timeoutId = setTimeout(() => {
			fn(...args);
			timeoutId = null;
		}, delay);
	}) as T;
}

/**
 * Initialize Results tab with comparison data rendering
 */
function initResultsTab(): void {
	// Initialize comparison selector if available
	initComparisonSelector();

	// Auto-render comparison if data exists
	if (window.webviewData.comparisonData) {
		renderComparisonResults();
	}
}

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(text: unknown): string {
	if (text === null || text === undefined) {
		return "";
	}
	const div = document.createElement("div");
	div.textContent = String(text);
	return div.innerHTML;
}

/**
 * Apply YAML syntax highlighting to a YAML string
 */
function highlightYaml(yaml: string): string {
	// First escape HTML
	let escaped = escapeHtml(yaml);

	// Apply syntax highlighting using regex patterns
	// Keys (before colon)
	escaped = escaped.replace(
		/^(\s*)([^:#\n]+)(:)/gm,
		'$1<span class="yaml-key">$2</span><span class="yaml-colon">$3</span>'
	);

	// String values (quoted)
	escaped = escaped.replace(/'([^']*)'/g, "<span class=\"yaml-string\">'$1'</span>");
	escaped = escaped.replace(/"/g, '<span class="yaml-string">"$1"</span>');

	// Boolean values
	escaped = escaped.replace(/\b(true|false)\b/gi, '<span class="yaml-boolean">$1</span>');

	// Null values
	escaped = escaped.replace(/\bnull\b/gi, '<span class="yaml-null">null</span>');

	// Numbers
	escaped = escaped.replace(/(\b-?\d+(\.\d+)?\b)/g, '<span class="yaml-number">$1</span>');

	// Comments
	escaped = escaped.replace(/(#.*)$/gm, '<span class="yaml-comment">$1</span>');

	return escaped;
}

/**
 * Switch to the Compare Environments tab
 */
function switchToCompareTab(): void {
	// Deactivate all tab buttons
	document.querySelectorAll(".tab-btn").forEach((b) => {
		b.classList.remove("active");
	});
	// Deactivate all tab content
	document.querySelectorAll(".tab-content").forEach((c) => {
		c.classList.remove("active");
	});
	// Activate the Compare tab button
	const compareTabBtn = document.querySelector('.tab-btn[data-tab="compare"]');
	if (compareTabBtn) {
		compareTabBtn.classList.add("active");
	}
	// Activate the Compare tab content
	const compareContent = document.getElementById("compare");
	if (compareContent) {
		compareContent.classList.add("active");
	}
}

/**
 * Render comparison results in the Results tab
 */
function renderComparisonResults(): void {
	// Get the comparison results container (keep selector visible)
	const comparisonResults = document.getElementById("comparison-results") as HTMLElement | null;
	if (!comparisonResults) return;

	const data = window.webviewData.comparisonData;

	// Validate comparison data structure
	if (!data || typeof data !== "object") {
		comparisonResults.innerHTML = `
      <div class="comparison-placeholder">
        <div class="no-comparison-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 17H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m12 0h4M5 9V5a2 2 0 0 1 2-2h4m0 12v4a2 2 0 0 1-2 2h-4"/><path d="M9 17V9h6v8"/><circle cx="12" cy="12" r="2"/></svg></div>
        <div class="no-comparison-text">Select two environments to compare</div>
        <div class="no-comparison-hint">Choose a chart and two environments to see detailed comparison results</div>
      </div>`;
		comparisonResults.style.display = "block";
		return;
	}

	// Validate nested structure
	if (!data.header || !data.summary || !Array.isArray(data.resources)) {
		console.error("Invalid comparison data structure:", data);
		comparisonResults.innerHTML = `
      <div class="comparison-placeholder">
        <div class="no-comparison-icon">⚠️</div>
        <div class="no-comparison-text"> Invalid comparison data</div>
        <div class="no-comparison-hint">Please run the comparison again</div>
      </div>`;
		comparisonResults.style.display = "block";
		return;
	}

	// Validate header values
	if (!data.header.leftEnv || !data.header.rightEnv) {
		comparisonResults.innerHTML = `
      <div class="comparison-placeholder">
        <div class="no-comparison-icon">⚠️</div>
        <div class="no-comparison-text">No environment selected for comparison</div>
        <div class="no-comparison-hint">Select two environments to compare</div>
      </div>`;
		comparisonResults.style.display = "block";
		return;
	}

	// Switch to Compare tab automatically when comparison results are available
	switchToCompareTab();

	// Build the comparison HTML - only show resources with actual changes (not unchanged)
	const { header, summary, resources, kindGroups } = data;

	// Filter to only show resources with changes (added, removed, modified)
	// Exclude unchanged resources since they don't provide useful comparison info
	const changedResources = resources.filter((r) => r.diffType.toLowerCase() !== "unchanged");

	// Determine which stats have values to display (exclude unchanged from summary)
	const hasChanges = summary.added > 0 || summary.removed > 0 || summary.modified > 0;
	const activeCategories = [summary.added, summary.removed, summary.modified].filter((c) => c > 0).length;

	let html = `<div class="compare-container">
        <div class="compare-header-section">
            <div class="compare-info">
                <h2 class="compare-chart-name">${escapeHtml(header.chartName)}</h2>
                <div class="compare-envs">
                    <span class="env-tag env-base">${escapeHtml(header.leftEnv)}</span>
                    <span class="env-vs">vs</span>
                    <span class="env-tag env-compare">${escapeHtml(header.rightEnv)}</span>
                </div>
            </div>`;

	// Add summary stats only for non-zero values (exclude unchanged)
	if (hasChanges) {
		html += `<div class="compare-summary-stats">`;
		if (summary.added > 0)
			html += `<div class="summary-item stat-added"><span class="summary-count">${escapeHtml(String(summary.added))}</span><span class="summary-label">Added</span></div>`;
		if (summary.removed > 0)
			html += `<div class="summary-item stat-removed"><span class="summary-count">${escapeHtml(String(summary.removed))}</span><span class="summary-label">Removed</span></div>`;
		if (summary.modified > 0)
			html += `<div class="summary-item stat-modified"><span class="summary-count">${escapeHtml(String(summary.modified))}</span><span class="summary-label">Modified</span></div>`;
		html += `</div>`;
	} else {
		html += `<div class="compare-no-changes">No changes detected</div>`;
	}

	html += `</div>`;

	// Only show filter buttons if there are multiple categories with changes
	if (hasChanges && activeCategories > 1) {
		html += `<div class="compare-filters">`;
		html += `<button class="filter-btn active" data-filter="all">All</button>`;
		if (summary.added > 0)
			html += `<button class="filter-btn filter-added" data-filter="added">Added (${escapeHtml(String(summary.added))})</button>`;
		if (summary.removed > 0)
			html += `<button class="filter-btn filter-removed" data-filter="removed">Removed (${escapeHtml(String(summary.removed))})</button>`;
		if (summary.modified > 0)
			html += `<button class="filter-btn filter-modified" data-filter="modified">Modified (${escapeHtml(String(summary.modified))})</button>`;
		html += `</div>`;
	}

	html += `<div class="compare-resources">`;

	// Render resources - only changedResources (excludes unchanged)
	if (changedResources && changedResources.length > 0) {
		html += `<div class="resource-list">`;
		for (const resource of changedResources) {
			const diffClass = resource.diffType.toLowerCase();
			const hasFields = resource.fields && resource.fields.length > 0;
			const fieldCount = hasFields ? resource.fields.length : 0;

			// Only show field diffs expanded for modified resources
			const showFieldsExpanded = diffClass === "modified";

			html += `<div class="compare-resource-card ${escapeHtml(diffClass)}" data-diff-type="${escapeHtml(diffClass)}" ${hasFields ? `data-field-count="${fieldCount}"` : ""}>
        <div class="resource-summary">
          <span class="resource-kind">${escapeHtml(resource.kind)}</span>
          <span class="resource-name">${escapeHtml(resource.name)}</span>
          ${resource.namespace ? `<span class="resource-namespace">${escapeHtml(resource.namespace)}</span>` : ""}
          ${hasFields ? `<span class="field-count-badge">${fieldCount} field${fieldCount > 1 ? "s" : ""} changed</span>` : ""}
        </div>`;

			// Add field diffs - expanded for modified and unchanged
			if (hasFields) {
				html += `<div class="field-diffs field-diffs-visible" ${showFieldsExpanded ? 'style="display: block"' : ""}>`;
				for (const field of resource.fields) {
					// Format values properly - use JSON.stringify for complex objects
					const leftVal =
						typeof field.leftValue === "object"
							? JSON.stringify(field.leftValue, null, 2)
							: String(field.leftValue ?? "");
					const rightVal =
						typeof field.rightValue === "object"
							? JSON.stringify(field.rightValue, null, 2)
							: String(field.rightValue ?? "");
					html += `<div class="field-diff">`;
					html += `<div class="field-path-row">`;
					html += `<span class="field-path">${escapeHtml(field.path)}</span>`;
					html += `</div>`;
					html += `<div class="field-values-row">`;
					html += `<div class="field-left">`;
					html += `<pre class="field-value-content">${escapeHtml(leftVal)}</pre>`;
					html += `</div>`;
					html += `<span class="field-arrow">→</span>`;
					html += `<div class="field-right">`;
					html += `<pre class="field-value-content">${escapeHtml(rightVal)}</pre>`;
					html += `</div>`;
					html += `</div>`;
					html += `</div>`;
				}
				html += `</div>`;
			}

			html += `</div>`;
		}
		html += `</div>`;
	} else {
		html += `<div class="no-changes">No differences found between environments</div>`;
	}

	html += `</div></div>`;

	// Add filter button click handlers - only for changed resources (added, removed, modified)
	html += `<script>
		(function() {
			const filterBtns = document.querySelectorAll('.filter-btn');
			const resourceCards = document.querySelectorAll('.compare-resource-card');

			filterBtns.forEach(btn => {
				btn.addEventListener('click', () => {
					// Remove active class from all buttons
					filterBtns.forEach(b => b.classList.remove('active'));
					// Add active class to clicked button
					btn.classList.add('active');

					const filter = btn.getAttribute('data-filter');

					resourceCards.forEach(card => {
						if (filter === 'all') {
							card.style.display = '';
							// Expand field diffs for modified cards in 'all' view
							const diffType = card.getAttribute('data-diff-type');
							const fieldDiffs = card.querySelector('.field-diffs');
							if (diffType === 'modified' && fieldDiffs) {
								fieldDiffs.style.display = 'block';
							}
						} else if (filter === 'modified') {
							const diffType = card.getAttribute('data-diff-type');
							if (diffType === filter) {
								card.style.display = '';
								// Auto-expand field diffs when filtering by modified
								const fieldDiffs = card.querySelector('.field-diffs');
								if (fieldDiffs) {
									fieldDiffs.style.display = 'block';
								}
								// Highlight the modified field values
								const leftValues = card.querySelectorAll('.field-left');
								const rightValues = card.querySelectorAll('.field-right');
								leftValues.forEach(el => el.classList.add('highlighted'));
								rightValues.forEach(el => el.classList.add('highlighted'));
							} else {
								card.style.display = 'none';
							}
						} else {
							const diffType = card.getAttribute('data-diff-type');
							if (diffType === filter) {
								card.style.display = '';
								// Remove highlighting when showing other filters
								const leftValues = card.querySelectorAll('.field-left');
								const rightValues = card.querySelectorAll('.field-right');
								leftValues.forEach(el => el.classList.remove('highlighted'));
								rightValues.forEach(el => el.classList.remove('highlighted'));
							} else {
								card.style.display = 'none';
							}
						}
					});
				});
			});
		})();
	</script>`;

	// Render into comparison-results div and show it
	comparisonResults.innerHTML = html;
	comparisonResults.style.display = "block";
}

/**
 * Initialize the comparison environment selector
 */
function initComparisonSelector(): void {
	const env1Select = document.getElementById("env1-select") as HTMLSelectElement | null;
	const env2Select = document.getElementById("env2-select") as HTMLSelectElement | null;
	const runComparisonBtn = document.getElementById("run-comparison") as HTMLButtonElement | null;

	if (!env1Select || !env2Select || !runComparisonBtn) {
		return;
	}

	// Populate available environments
	const availableEnvs = window.webviewData.availableEnvs || [];
	if (availableEnvs.length < 2) {
		// Not enough environments to compare
		env1Select.disabled = true;
		env2Select.disabled = true;
		runComparisonBtn.disabled = true;
		return;
	}

	// Update options for env2 (exclude selected env1)
	function updateEnv2Options(): void {
		env2Select.innerHTML = '<option value="">Select environment...</option>';
		for (const env of availableEnvs) {
			if (env !== env1Select.value) {
				const option = document.createElement("option");
				option.value = env;
				option.textContent = env;
				env2Select.appendChild(option);
			}
		}
	}

	// Handle env1 selection change
	env1Select.addEventListener("change", () => {
		updateEnv2Options();
		// Check if both are selected
		runComparisonBtn.disabled = !env1Select.value || !env2Select.value;
	});

	// Handle env2 selection change
	env2Select.addEventListener("change", () => {
		// Check if both are selected
		runComparisonBtn.disabled = !env1Select.value || !env2Select.value;
	});

	// Handle run comparison button
	runComparisonBtn.addEventListener("click", () => {
		const env1 = env1Select.value;
		const env2 = env2Select.value;

		if (env1 && env2) {
			// Send message to extension to run comparison
			vscode.postMessage({
				type: "runComparison",
				env1,
				env2,
			});
		}
	});
}

/**
 * Toolbar actions (export, etc.)
 */
function initToolbarActions(): void {
	const exportYamlBtn = document.getElementById("exportYaml");
	const exportJsonBtn = document.getElementById("exportJson");

	if (exportYamlBtn) {
		exportYamlBtn.addEventListener("click", () => {
			vscode.postMessage({ type: "exportYaml" });
		});
	}

	if (exportJsonBtn) {
		exportJsonBtn.addEventListener("click", () => {
			vscode.postMessage({ type: "exportJson" });
		});
	}
}

/**
 * Search functionality for resource explorer
 */
function initSearch(): void {
	const searchBox = document.getElementById("searchBox");
	if (!searchBox) return;

	searchBox.addEventListener("input", (e) => {
		const target = e.target as HTMLInputElement;
		const search = target.value.toLowerCase();
		document.querySelectorAll(".resource-card").forEach((card) => {
			const text = card.textContent?.toLowerCase() || "";
			card.style.display = text.includes(search) ? "block" : "none";
		});
	});
}

/**
 * Resource explorer event delegation
 */
function initResourceExplorer(): void {
	document.addEventListener("click", (e) => {
		const target = e.target as HTMLElement;

		// Handle kind group toggle
		if (target.closest(".kind-header")) {
			const header = target.closest(".kind-header");
			const group = header?.parentElement;
			if (group) {
				group.classList.toggle("expanded");
				const resources = group.querySelector(".kind-resources");
				if (resources) {
					const isCollapsed = resources.getAttribute("data-collapsed") === "true";
					resources.setAttribute("data-collapsed", isCollapsed ? "false" : "true");
				}
			}
			return;
		}

		// Handle copy button
		if (target.closest(".copy-btn")) {
			e.stopPropagation();
			const card = target.closest(".resource-card");
			const yamlContent = card?.querySelector(".yaml-block");
			const yaml = yamlContent ? yamlContent.textContent : "";
			vscode.postMessage({ type: "copyResource", yaml });
			return;
		}

		// Handle resource header toggle (but not if clicking copy button)
		if (target.closest(".resource-header") && !target.closest(".copy-btn")) {
			const header = target.closest(".resource-header");
			const card = header?.parentElement;
			if (card) {
				card.classList.toggle("expanded");
				const details = card.querySelector(".resource-details");
				if (details) {
					const isCollapsed = details.getAttribute("data-collapsed") === "true";
					details.setAttribute("data-collapsed", isCollapsed ? "false" : "true");
				}
			}
			return;
		}
	});
}

/**
 * Initialize Chart.js visualizations
 */
function initCharts(): void {
	const chartColors = {
		primary: "#007acc",
		secondary: "#68217a",
		success: "#4caf50",
		warning: "#ff9800",
		danger: "#f44336",
		info: "#2196f3",
	};

	const colorPalette = [
		chartColors.primary,
		chartColors.secondary,
		chartColors.success,
		chartColors.warning,
		chartColors.info,
		chartColors.danger,
	];

	// Resource count chart
	if (Object.keys(window.webviewData.resourceCounts || {}).length > 0) {
		initResourceChart(colorPalette);
	}

	// Values pie chart
	if (window.webviewData.totalValues > 0) {
		initValuesChart(chartColors);
	}
}

/**
 * Initialize the resource count bar chart
 */
function initResourceChart(colorPalette: string[]): void {
	const canvas = document.getElementById("resourceChart") as HTMLCanvasElement | null;
	if (!canvas) return;

	const resourceData = window.webviewData.resourceCounts;
	let labels = Object.keys(resourceData);
	let values = Object.values(resourceData);

	// Aggregate long tail for readability & performance
	const MAX_BARS = 60;
	if (labels.length > MAX_BARS) {
		const pairs = labels.map((l, i) => ({ l, v: Number(values[i]) || 0 }));
		pairs.sort((a, b) => b.v - a.v);
		const top = pairs.slice(0, MAX_BARS);
		const othersTotal = pairs.slice(MAX_BARS).reduce((sum, p) => sum + p.v, 0);
		labels = top.map((p) => p.l).concat("Others");
		values = top.map((p) => p.v).concat(othersTotal);
	}

	// Decide orientation based on bar count
	const useHorizontal = labels.length > 20;
	const indexAxis = useHorizontal ? "y" : "x";

	// Dynamic canvas height proportional to bars
	const perBarPx = 24;
	const basePx = 120;
	const maxPx = Math.round(window.innerHeight * 0.6);
	const targetHeight = useHorizontal ? Math.min(maxPx, basePx + labels.length * perBarPx) : 300;
	canvas.style.height = `${targetHeight}px`;

	const foreground = getComputedStyle(document.body).getPropertyValue("--vscode-foreground");
	const gridColor = "rgba(128, 128, 128, 0.2)";

	function initChart(): void {
		// Destroy any previous instance to avoid leaks
		const existing = window.resourceChartInstance;
		if (existing) {
			try {
				(existing as { destroy: () => void }).destroy();
			} catch {
				// Ignore destroy errors
			}
		}

		// @ts-expect-error - Chart is loaded from external script
		const chart = new Chart(canvas, {
			type: "bar",
			data: {
				labels,
				datasets: [
					{
						label: "Resource Count",
						data: values,
						backgroundColor: colorPalette.slice(0, labels.length),
						borderColor: colorPalette.slice(0, labels.length),
						borderWidth: 1,
					},
				],
			},
			options: {
				indexAxis,
				responsive: true,
				maintainAspectRatio: false,
				animation: false,
				parsing: false,
				interaction: { mode: "nearest", intersect: false },
				plugins: {
					legend: {
						display: false,
						labels: { color: foreground },
					},
					title: { display: false },
					tooltip: {
						enabled: labels.length <= 200,
					},
				},
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
					},
				},
			},
		});
		window.resourceChartInstance = chart;

		// Resize handling for horizontal bars
		if (useHorizontal && "ResizeObserver" in window) {
			const ro = new ResizeObserver(() => {
				const maxPx = Math.round(window.innerHeight * 0.6);
				const newHeight = Math.min(maxPx, basePx + labels.length * perBarPx);
				canvas.style.height = `${newHeight}px`;
				const inst = window.resourceChartInstance;
				if (inst) {
					try {
						(inst as { resize: () => void }).resize();
					} catch {
						// Ignore resize errors
					}
				}
			});
			ro.observe(document.body);
		}
	}

	// Lazy init to avoid blocking UI
	if ("requestIdleCallback" in window) {
		window.requestIdleCallback(initChart, { timeout: 500 });
	} else {
		setTimeout(initChart, 0);
	}
}

/**
 * Initialize the values pie chart
 */
function initValuesChart(chartColors: Record<string, string>): void {
	const ctx = document.getElementById("valuesChart") as HTMLCanvasElement | null;
	if (!ctx) return;

	// @ts-expect-error - Chart is loaded from external script
	new Chart(ctx, {
		type: "pie",
		data: {
			labels: ["Overridden Values", "Base Values"],
			datasets: [
				{
					data: [
						window.webviewData.overriddenCount,
						window.webviewData.totalValues - window.webviewData.overriddenCount,
					],
					backgroundColor: [chartColors.warning, chartColors.info],
				},
			],
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
		},
	});
}

// Export for use in HTML
window.initializeWebview = initializeWebview;

/**
 * Initialize the Rendered YAML tab with environment selector
 */
function initRenderedYamlTab(): void {
	const envSelect = document.getElementById("rendered-env-select") as HTMLSelectElement | null;
	const renderBtn = document.getElementById("render-yaml-btn") as HTMLButtonElement | null;
	const exportBtn = document.getElementById("export-rendered-yaml-btn") as HTMLButtonElement | null;

	if (!envSelect || !renderBtn || !exportBtn) {
		return;
	}

	// Populate environment dropdown
	const availableEnvs = window.webviewData.availableEnvs || [];
	if (availableEnvs.length > 0) {
		envSelect.innerHTML = '<option value="">Select environment...</option>';
		for (const env of availableEnvs) {
			const option = document.createElement("option");
			option.value = env;
			option.textContent = env;
			envSelect.appendChild(option);
		}
	}

	// Handle render button click
	renderBtn.addEventListener("click", async () => {
		const selectedEnv = envSelect.value;
		if (!selectedEnv) {
			vscode.postMessage({ type: "showError", message: "Please select an environment" });
			return;
		}

		// Request rendered YAML from extension
		vscode.postMessage({
			type: "renderYaml",
			environment: selectedEnv,
		});
	});

	// Handle export button click
	exportBtn.addEventListener("click", () => {
		const selectedEnv = envSelect.value;
		if (selectedEnv) {
			vscode.postMessage({
				type: "exportRenderedYaml",
				environment: selectedEnv,
			});
		}
	});

	// Enable export button when environment is selected
	envSelect.addEventListener("change", () => {
		exportBtn.disabled = !envSelect.value;
	});
}

/**
 * Handle rendered YAML response from extension
 */
export function handleRenderedYamlResponse(data: {
	yaml: string;
	resources: Array<{ kind: string; name: string; namespace?: string }>;
	chartName: string;
	environment: string;
}): void {
	const contentDiv = document.getElementById("rendered-yaml-content") as HTMLElement | null;
	if (!contentDiv) return;

	if (!data.yaml) {
		contentDiv.innerHTML = `
			<div class="no-data">
				<div class="no-data-icon">⚠️</div>
				<div class="no-data-text">No rendered YAML available</div>
				<div class="no-data-hint">Try selecting a different environment</div>
			</div>`;
		return;
	}

	// Group resources by kind
	const resourceMap = new Map<string, Array<{ name: string; namespace?: string; yaml: string }>>();
	const lines = data.yaml.split("---");
	for (const section of lines) {
		const trimmed = section.trim();
		if (!trimmed) continue;

		// Extract kind, name, namespace from YAML
		const kindMatch = trimmed.match(/^kind:\s*(\S+)/m);
		const nameMatch = trimmed.match(/^metadata:\s*\n\s*name:\s*(\S+)/m);
		const nsMatch = trimmed.match(/^metadata:\s*\n\s*namespace:\s*(\S+)/m);

		if (kindMatch && nameMatch) {
			const kind = kindMatch[1];
			const name = nameMatch[1];
			const namespace = nsMatch ? nsMatch[1] : "default";

			if (!resourceMap.has(kind)) {
				resourceMap.set(kind, []);
			}
			resourceMap.get(kind)!.push({ name, namespace, yaml: trimmed });
		}
	}

	// Build HTML
	let html = '<div class="rendered-yaml">';
	for (const [kind, resources] of resourceMap) {
		html += `<div class="resource-group">`;
		html += `<div class="resource-header" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'none' ? 'block' : 'none'">`;
		html += `<span class="kind-badge">${kind}</span>`;
		html += `<span class="name-badge">${resources.map((r) => r.name).join(", ")}</span>`;
		html += `<span style="margin-left: auto; font-size: 10px;">▼</span>`;
		html += `</div>`;
		html += `<pre class="yaml-block">`;
		for (const r of resources) {
			html += `<div class="resource-item">`;
			html += `<div class="resource-item-header"># ${r.name} (${r.namespace})</div>`;
			html += highlightYaml(r.yaml);
			html += `</div>`;
		}
		html += `</pre>`;
		html += `</div>`;
	}
	html += `</div>`;

	contentDiv.innerHTML = html;
}

// Export functions for use in HTML
window.handleRenderedYamlResponse = handleRenderedYamlResponse;

window.initializeWebview = initializeWebview;

export {};
