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
