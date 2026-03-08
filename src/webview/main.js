// @ts-nocheck
"use strict";

/**
 * Main webview script for Helm Chart Visualizer
 * Handles tab switching, toolbar actions, search, and resource explorer interactions
 */

// Global state
let currentZoom = 1;

// VS Code API instance - acquired once at initialization
const vscode = acquireVsCodeApi();

// Will be initialized with data from the extension
// Attached to window so topology.js can access it
window.webviewData = {
  architectureNodes: [],
  relationships: [],
  kindIcons: {},
  resourceCounts: {},
  totalValues: 0,
  overriddenCount: 0,
  comparisonData: null,
};

/**
 * Initialize the webview with data from the extension
 * @param {Object} data - The chart visualization data
 */
function initializeWebview(data) {
  window.webviewData = data;

  // Initialize all components
  initTabSwitching();
  initToolbarActions();
  initSearch();
  initResourceExplorer();
  initResultsTab();
  // Call initTopology from window (defined in topology.js)
  if (typeof window.initTopology === "function") {
    window.initTopology();
  }
  initCharts();
}

/**
 * Tab switching functionality
 */
function initTabSwitching() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tabName = btn.getAttribute("data-tab");
      document
        .querySelectorAll(".tab-btn")
        .forEach((b) => b.classList.remove("active"));
      document
        .querySelectorAll(".tab-content")
        .forEach((c) => c.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(tabName).classList.add("active");
    });
  });
}

/**
 * Debounce function to prevent rapid button clicks
 */
function debounce(fn, delay = 300) {
  let timeoutId = null;
  return function(...args) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn.apply(this, args);
      timeoutId = null;
    }, delay);
  };
}

/**
 * Initialize Results tab with comparison data rendering
 */
function initResultsTab() {
  // Debounced export handler to prevent multiple file dialogs
  const debouncedExport = debounce(() => {
    vscode.postMessage({ type: "exportComparison" });
  }, 500);

  // Debounced refresh handler
  const debouncedRefresh = debounce(() => {
    vscode.postMessage({ type: "refreshComparison" });
  }, 500);

  // Initialize results sub-tab switching
  document.querySelectorAll(".results-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tabName = btn.getAttribute("data-tab");
      document
        .querySelectorAll(".results-tab-btn")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      // Handle tab content visibility
      const resultsContent = document.getElementById("results-content");
      if (resultsContent) {
        // For now, only compare tab has content
        if (tabName === "compare") {
          renderComparisonResults();
        } else {
          resultsContent.innerHTML = `<div class="placeholder">${tabName.charAt(0).toUpperCase() + tabName.slice(1)} view coming soon</div>`;
        }
      }
    });
  });

  // Initialize export and refresh buttons with debounce
  const exportBtn = document.getElementById("exportResults");
  if (exportBtn) {
    exportBtn.addEventListener("click", () => {
      // Show visual feedback that click was registered
      exportBtn.disabled = true;
      debouncedExport();
      setTimeout(() => { exportBtn.disabled = false; }, 500);
    });
  }

  const refreshBtn = document.getElementById("refreshResults");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      refreshBtn.disabled = true;
      debouncedRefresh();
      setTimeout(() => { refreshBtn.disabled = false; }, 500);
    });
  }

  // Auto-render comparison if data exists
  if (window.webviewData.comparisonData) {
    renderComparisonResults();
  }
}

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(text) {
  if (text === null || text === undefined) {
    return "";
  }
  const div = document.createElement("div");
  div.textContent = String(text);
  return div.innerHTML;
}

/**
 * Render comparison results in the Results tab
 */
function renderComparisonResults() {
  const resultsContent = document.getElementById("results-content");
  if (!resultsContent) return;

  const data = window.webviewData.comparisonData;

  // Validate comparison data structure
  if (!data || typeof data !== 'object') {
    resultsContent.innerHTML = `
      <div class="comparison-placeholder">
        <div class="no-comparison-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 17H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m12 0h4M5 9V5a2 2 0 0 1 2-2h4m0 12v4a2 2 0 0 1-2 2h-4"/><path d="M9 17V9h6v8"/><circle cx="12" cy="12" r="2"/></svg></div>
        <div class="no-comparison-text">Select two environments to compare</div>
        <div class="no-comparison-hint">Choose a chart and two environments to see detailed comparison results</div>
      </div>`;
    return;
  }

  // Validate nested structure
  if (!data.header || !data.summary || !Array.isArray(data.resources)) {
    console.error('Invalid comparison data structure:', data);
    resultsContent.innerHTML = `
      <div class="comparison-placeholder">
        <div class="no-comparison-icon">⚠️</div>
        <div class="no-comparison-text">Invalid comparison data</div>
        <div class="no-comparison-hint">Please run the comparison again</div>
      </div>`;
    return;
  }

  // Build the comparison HTML
  const { header, summary, resources, kindGroups } = data;

  let html = `<div class="compare-summary">
    <div class="compare-header">
      <h3>${escapeHtml(header.chartName)}</h3>
      <span class="env-badge">${escapeHtml(header.leftEnv)}</span>
      <span class="env-separator">vs</span>
      <span class="env-badge">${escapeHtml(header.rightEnv)}</span>
    </div>
    <div class="summary-stats">
      <div class="stat stat-added">
        <span class="stat-value">${escapeHtml(String(summary.added))}</span>
        <span class="stat-label">Added</span>
      </div>
      <div class="stat stat-removed">
        <span class="stat-value">${escapeHtml(String(summary.removed))}</span>
        <span class="stat-label">Removed</span>
      </div>
      <div class="stat stat-modified">
        <span class="stat-value">${escapeHtml(String(summary.modified))}</span>
        <span class="stat-label">Modified</span>
      </div>
      <div class="stat stat-unchanged">
        <span class="stat-value">${escapeHtml(String(summary.unchanged))}</span>
        <span class="stat-label">Unchanged</span>
      </div>
    </div>
  </div>`;

  // Group resources by type
  if (resources && resources.length > 0) {
    html += `<div class="compare-resources">`;

    // Add kind groups summary
    if (kindGroups && kindGroups.length > 0) {
      html += `<div class="kind-summary">`;
      for (const group of kindGroups) {
        html += `<span class="kind-badge">${escapeHtml(group.kind)}: ${escapeHtml(String(group.count))}</span>`;
      }
      html += `</div>`;
    }

    // Add resource list
    html += `<div class="resource-list">`;
    for (const resource of resources) {
      const diffClass = resource.diffType.toLowerCase();
      html += `<div class="compare-resource-card ${escapeHtml(diffClass)}">
        <div class="resource-summary">
          <span class="diff-indicator diff-${escapeHtml(diffClass)}">${escapeHtml(resource.diffType)}</span>
          <span class="resource-kind">${escapeHtml(resource.kind)}</span>
          <span class="resource-name">${escapeHtml(resource.name)}</span>
          ${resource.namespace ? `<span class="resource-namespace">${escapeHtml(resource.namespace)}</span>` : ""}
        </div>`;

      // Add field diffs if any
      if (resource.fields && resource.fields.length > 0) {
        html += `<div class="field-diffs">`;
        for (const field of resource.fields) {
          html += `<div class="field-diff">
            <span class="field-path">${escapeHtml(field.path)}</span>
            <span class="field-values">
              <span class="field-left">${escapeHtml(JSON.stringify(field.leftValue))}</span>
              <span class="field-arrow">→</span>
              <span class="field-right">${escapeHtml(JSON.stringify(field.rightValue))}</span>
            </span>
          </div>`;
        }
        html += `</div>`;
      }

      html += `</div>`;
    }
    html += `</div>`;
  } else {
    html += `<div class="no-changes">No differences found between environments</div>`;
  }

  html += `</div>`;

  resultsContent.innerHTML = html;
}

/**
 * Toolbar actions (export, etc.)
 */
function initToolbarActions() {
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
function initSearch() {
  const searchBox = document.getElementById("searchBox");
  if (!searchBox) return;

  searchBox.addEventListener("input", (e) => {
    const search = e.target.value.toLowerCase();
    document.querySelectorAll(".resource-card").forEach((card) => {
      const text = card.textContent.toLowerCase();
      card.style.display = text.includes(search) ? "block" : "none";
    });
  });
}

/**
 * Resource explorer event delegation
 */
function initResourceExplorer() {
  document.addEventListener("click", (e) => {
    const target = e.target;

    // Handle kind group toggle
    if (target.closest(".kind-header")) {
      const header = target.closest(".kind-header");
      const group = header.parentElement;
      group.classList.toggle("expanded");
      const resources = group.querySelector(".kind-resources");
      if (resources) {
        const isCollapsed = resources.getAttribute("data-collapsed") === "true";
        resources.setAttribute(
          "data-collapsed",
          isCollapsed ? "false" : "true",
        );
      }
      return;
    }

    // Handle copy button
    if (target.closest(".copy-btn")) {
      e.stopPropagation();
      const card = target.closest(".resource-card");
      const yamlContent = card.querySelector(".yaml-block");
      const yaml = yamlContent ? yamlContent.textContent : "";
      vscode.postMessage({ type: "copyResource", yaml });
      return;
    }

    // Handle resource header toggle (but not if clicking copy button)
    if (target.closest(".resource-header") && !target.closest(".copy-btn")) {
      const header = target.closest(".resource-header");
      const card = header.parentElement;
      card.classList.toggle("expanded");
      const details = card.querySelector(".resource-details");
      if (details) {
        const isCollapsed = details.getAttribute("data-collapsed") === "true";
        details.setAttribute("data-collapsed", isCollapsed ? "false" : "true");
      }
      return;
    }
  });
}

/**
 * Initialize Chart.js visualizations
 */
function initCharts() {
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
function initResourceChart(colorPalette) {
  const canvas = document.getElementById("resourceChart");
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
  const targetHeight = useHorizontal
    ? Math.min(maxPx, basePx + labels.length * perBarPx)
    : 300;
  canvas.style.height = `${targetHeight}px`;

  const foreground = getComputedStyle(document.body).getPropertyValue(
    "--vscode-foreground",
  );
  const gridColor = "rgba(128, 128, 128, 0.2)";

  function initChart() {
    // Destroy any previous instance to avoid leaks
    const existing = window.resourceChartInstance;
    if (existing) {
      try {
        existing.destroy();
      } catch {}
    }

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
            inst.resize();
          } catch {}
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
function initValuesChart(chartColors) {
  const ctx = document.getElementById("valuesChart");
  if (!ctx) return;

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
