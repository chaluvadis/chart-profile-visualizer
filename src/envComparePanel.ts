import * as crypto from "node:crypto";
import * as vscode from "vscode";
import { parseWorkspaceEnvProfiles } from "./parsers/markdownEnvParser";
import type { ComparePayload, EnvProfile } from "./types/envProfile";
import { generateCompareTableHtml, generateSummaryCardsHtml } from "./ui/components/CompareTable";
import { generateTrendChartScript } from "./ui/components/TrendChart";

/** Singleton webview panel for the env-profile comparison view */
let panel: vscode.WebviewPanel | undefined;

/**
 * Open (or reveal) the "Compare Environments" webview panel.
 * Reads markdown files in the workspace, parses env profiles, and renders the
 * interactive comparison UI.
 */
export async function showEnvComparePanel(context: vscode.ExtensionContext, workspaceRoots: string[]): Promise<void> {
	const columnToShowIn = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

	if (panel) {
		panel.reveal(columnToShowIn);
		return;
	}

	panel = vscode.window.createWebviewPanel(
		"envCompare",
		"Compare Environments",
		columnToShowIn || vscode.ViewColumn.One,
		{
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [context.extensionUri],
		}
	);

	panel.onDidDispose(
		() => {
			panel = undefined;
		},
		null,
		context.subscriptions
	);

	// Show a loading state immediately
	panel.webview.html = buildLoadingHtml();

	try {
		const payload = parseWorkspaceEnvProfiles(workspaceRoots);
		panel.webview.html = buildPanelHtml(context, panel.webview, payload);
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		panel.webview.html = buildErrorHtml(msg);
		return;
	}

	// Handle messages sent from the webview (filter/export actions)
	panel.webview.onDidReceiveMessage(
		async (message: WebviewMessage) => {
			if (!panel) return;
			switch (message.command) {
				case "refresh": {
					panel.webview.html = buildLoadingHtml();
					try {
						const payload = parseWorkspaceEnvProfiles(workspaceRoots);
						panel.webview.html = buildPanelHtml(context, panel.webview, payload);
					} catch (err: unknown) {
						const msg = err instanceof Error ? err.message : String(err);
						panel.webview.html = buildErrorHtml(msg);
					}
					break;
				}
				case "exportCsv": {
					await handleExportCsv(message.profiles ?? []);
					break;
				}
				case "updateView": {
					// Re-render just the dynamic sections without rebuilding the whole page
					const payload = parseWorkspaceEnvProfiles(workspaceRoots);
					const tableHtml = generateCompareTableHtml(
						payload.profiles,
						message.selectedEnvs ?? [],
						message.selectedMetric ?? ""
					);
					const summaryHtml = generateSummaryCardsHtml(
						payload.profiles,
						message.selectedEnvs ?? [],
						message.selectedMetric ?? ""
					);
					panel.webview.postMessage({
						command: "renderPartial",
						tableHtml,
						summaryHtml,
					});
					break;
				}
				default:
					break;
			}
		},
		undefined,
		context.subscriptions
	);
}

// ── HTML builders ─────────────────────────────────────────────────────────────

function buildLoadingHtml(): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Compare Environments</title>
	<style>
		body { display:flex; align-items:center; justify-content:center; height:100vh; margin:0;
			   font-family: var(--vscode-font-family); color: var(--vscode-foreground);
			   background: var(--vscode-editor-background); }
		.spinner { font-size: 1.2em; opacity: 0.7; }
	</style>
</head>
<body>
	<div class="spinner">⏳ Scanning workspace for environment profiles…</div>
</body>
</html>`;
}

function buildErrorHtml(message: string): string {
	const safe = escapeHtml(message);
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Compare Environments</title>
	<style>
		body { font-family: var(--vscode-font-family); color: var(--vscode-foreground);
			   background: var(--vscode-editor-background); padding: 2rem; }
		.error { color: var(--vscode-errorForeground); border: 1px solid currentColor;
				 padding: 1rem; border-radius: 4px; }
	</style>
</head>
<body>
	<h2>Compare Environments</h2>
	<div class="error">
		<strong>Error loading profiles:</strong><br>${safe}
	</div>
</body>
</html>`;
}

function buildPanelHtml(context: vscode.ExtensionContext, webview: vscode.Webview, payload: ComparePayload): string {
	const nonce = getNonce();
	const chartJsUri = webview
		.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "vendor", "chart.umd.js"))
		.toString();

	const defaultEnvs = payload.environments.slice(0, 3);
	const defaultMetric = payload.availableMetrics[0] ?? "latency";

	const tableHtml = generateCompareTableHtml(payload.profiles, defaultEnvs, defaultMetric);
	const summaryHtml = generateSummaryCardsHtml(payload.profiles, defaultEnvs, defaultMetric);
	const trendScript = generateTrendChartScript(payload.profiles, defaultEnvs, defaultMetric, nonce, chartJsUri);

	const envOptions = payload.environments
		.map(
			(e) =>
				`<option value="${escapeHtml(e)}" ${defaultEnvs.includes(e) ? "selected" : ""}>${escapeHtml(e)}</option>`
		)
		.join("\n");

	const metricOptions = payload.availableMetrics
		.map(
			(m) => `<option value="${escapeHtml(m)}" ${m === defaultMetric ? "selected" : ""}>${escapeHtml(m)}</option>`
		)
		.join("\n");

	const savedPayloadJson = JSON.stringify({
		profiles: payload.profiles,
		environments: payload.environments,
		availableMetrics: payload.availableMetrics,
	});

	const hasNoData = payload.profiles.length === 0;
	const noDataBanner = hasNoData
		? `<div class="no-data-banner">
		<strong>No environment profiles found.</strong>
		Add markdown files with <code>env-profile</code> frontmatter or code blocks to your workspace.
		See the <a href="https://github.com/chaluvadis/chart-profile-visualizer#environment-profiles">documentation</a> for the supported schema.
		</div>`
		: "";

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy"
		content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src ${webview.cspSource};">
	<title>Compare Environments</title>
	<style nonce="${nonce}">
		/* ── Reset / base ──────────────────────────────────────────── */
		*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
		body {
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
			color: var(--vscode-foreground);
			background: var(--vscode-editor-background);
			padding: 1rem 1.5rem;
		}
		a { color: var(--vscode-textLink-foreground); }

		/* ── Header ────────────────────────────────────────────────── */
		.panel-header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			margin-bottom: 1.2rem;
			gap: 1rem;
			flex-wrap: wrap;
		}
		.panel-title { font-size: 1.3em; font-weight: 600; }

		/* ── Controls bar ───────────────────────────────────────────── */
		.controls {
			display: flex;
			gap: 0.75rem;
			flex-wrap: wrap;
			align-items: flex-end;
			background: var(--vscode-editor-inactiveSelectionBackground);
			border: 1px solid var(--vscode-editorWidget-border);
			border-radius: 6px;
			padding: 0.75rem 1rem;
			margin-bottom: 1.2rem;
		}
		.control-group { display: flex; flex-direction: column; gap: 0.25rem; }
		.control-group label { font-size: 0.78em; opacity: 0.75; }
		select, button {
			background: var(--vscode-dropdown-background);
			color: var(--vscode-dropdown-foreground);
			border: 1px solid var(--vscode-dropdown-border);
			border-radius: 4px;
			padding: 0.3rem 0.5rem;
			font-size: 0.9em;
			cursor: pointer;
		}
		button {
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			border-color: transparent;
			padding: 0.35rem 0.8rem;
			align-self: flex-end;
		}
		button:hover { background: var(--vscode-button-hoverBackground); }
		select[multiple] { min-width: 160px; height: 80px; }

		/* ── No-data banner ─────────────────────────────────────────── */
		.no-data-banner {
			border: 1px solid var(--vscode-editorWarning-foreground);
			background: var(--vscode-inputValidation-warningBackground);
			color: var(--vscode-foreground);
			border-radius: 6px;
			padding: 0.75rem 1rem;
			margin-bottom: 1rem;
			line-height: 1.6;
		}

		/* ── Summary cards ─────────────────────────────────────────── */
		.summary-cards {
			display: flex;
			gap: 0.75rem;
			flex-wrap: wrap;
			margin-bottom: 1.2rem;
		}
		.summary-card {
			background: var(--vscode-editor-inactiveSelectionBackground);
			border: 1px solid var(--vscode-editorWidget-border);
			border-radius: 8px;
			padding: 0.75rem 1rem;
			min-width: 140px;
			flex: 1 1 140px;
		}
		.summary-card.empty { opacity: 0.5; }
		.card-env { font-size: 0.78em; opacity: 0.75; margin-bottom: 0.15rem; }
		.card-metric-name { font-size: 0.78em; opacity: 0.6; }
		.card-value { font-size: 1.5em; font-weight: 700; margin: 0.2rem 0; }
		.card-trend { font-size: 1em; }
		.card-trend.trend-up { color: #e05252; }
		.card-trend.trend-down { color: #4db86d; }
		.card-ts { font-size: 0.7em; opacity: 0.55; margin-top: 0.25rem; }

		/* ── Comparison table ──────────────────────────────────────── */
		.compare-table-wrapper { overflow-x: auto; margin-bottom: 1.5rem; }
		.compare-table {
			border-collapse: collapse;
			width: 100%;
			font-size: 0.9em;
		}
		.compare-table th, .compare-table td {
			border: 1px solid var(--vscode-editorWidget-border);
			padding: 0.45rem 0.7rem;
			text-align: center;
		}
		.compare-table th {
			background: var(--vscode-editor-inactiveSelectionBackground);
			font-weight: 600;
		}
		.compare-table .row-label {
			text-align: left;
			font-weight: 600;
			background: var(--vscode-editor-inactiveSelectionBackground);
			white-space: nowrap;
		}
		.compare-table .delta-row { font-style: italic; }
		.delta-up { color: #e05252; }
		.delta-down { color: #4db86d; }
		.delta.baseline { opacity: 0.5; }
		.tag {
			display: inline-block;
			background: var(--vscode-badge-background);
			color: var(--vscode-badge-foreground);
			border-radius: 10px;
			padding: 0 0.45rem;
			font-size: 0.75em;
			margin: 1px;
		}
		.timestamp { font-size: 0.8em; opacity: 0.75; }

		/* ── Trend chart ───────────────────────────────────────────── */
		.chart-wrapper {
			background: var(--vscode-editor-inactiveSelectionBackground);
			border: 1px solid var(--vscode-editorWidget-border);
			border-radius: 8px;
			padding: 1rem;
			margin-bottom: 1.5rem;
			height: 320px;
			position: relative;
		}
		canvas { width: 100% !important; height: 100% !important; }

		/* ── Empty / error states ────────────────────────────────────── */
		.empty-state {
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			padding: 2rem;
			opacity: 0.6;
			gap: 0.5rem;
		}
	</style>
</head>
<body>

<div class="panel-header">
	<span class="panel-title">🔍 Compare Environments</span>
	<div style="display:flex;gap:0.5rem;">
		<button id="btn-refresh" title="Re-scan workspace">↺ Refresh</button>
		<button id="btn-export-csv" title="Export table as CSV">⬇ Export CSV</button>
	</div>
</div>

${noDataBanner}

<!-- Controls -->
<div class="controls">
	<div class="control-group">
		<label for="env-select">Environments</label>
		<select id="env-select" multiple title="Hold Ctrl/Cmd to select multiple">
			${envOptions}
		</select>
	</div>
	<div class="control-group">
		<label for="metric-select">Metric</label>
		<select id="metric-select">
			${metricOptions}
		</select>
	</div>
	<button id="btn-apply">Apply</button>
</div>

<!-- Summary cards -->
<div id="summary-section">
	${summaryHtml}
</div>

<!-- Comparison table -->
<div id="table-section">
	${tableHtml}
</div>

<!-- Trend chart canvas -->
<div class="chart-wrapper">
	<canvas id="trend-chart"></canvas>
</div>

<!-- Payload data for client-side use -->
<script nonce="${nonce}">
const __payload = ${savedPayloadJson};
const __vscode = acquireVsCodeApi();

// Restore last selection from VS Code persisted state
(function restoreState() {
	const state = __vscode.getState() || {};
	if (state.selectedEnvs && state.selectedEnvs.length > 0) {
		const sel = document.getElementById('env-select');
		if (sel) {
			Array.from(sel.options).forEach(opt => {
				opt.selected = state.selectedEnvs.includes(opt.value);
			});
		}
	}
	if (state.selectedMetric) {
		const sel = document.getElementById('metric-select');
		if (sel) sel.value = state.selectedMetric;
	}
})();

function getSelectedEnvs() {
	const sel = document.getElementById('env-select');
	if (!sel) return [];
	return Array.from(sel.options).filter(o => o.selected).map(o => o.value);
}

function getSelectedMetric() {
	const sel = document.getElementById('metric-select');
	return sel ? sel.value : '';
}

document.getElementById('btn-apply').addEventListener('click', function() {
	const envs = getSelectedEnvs();
	const metric = getSelectedMetric();
	__vscode.setState({ selectedEnvs: envs, selectedMetric: metric });
	__vscode.postMessage({ command: 'updateView', selectedEnvs: envs, selectedMetric: metric });
});

document.getElementById('btn-refresh').addEventListener('click', function() {
	__vscode.postMessage({ command: 'refresh' });
});

document.getElementById('btn-export-csv').addEventListener('click', function() {
	__vscode.postMessage({
		command: 'exportCsv',
		profiles: __payload.profiles,
		selectedEnvs: getSelectedEnvs(),
		selectedMetric: getSelectedMetric()
	});
});

// Handle messages from extension host
window.addEventListener('message', function(event) {
	const msg = event.data;
	if (msg.command === 'renderPartial') {
		document.getElementById('table-section').innerHTML = msg.tableHtml || '';
		document.getElementById('summary-section').innerHTML = msg.summaryHtml || '';
	}
});
</script>

${trendScript}

</body>
</html>`;
}

// ── Export helpers ────────────────────────────────────────────────────────────

async function handleExportCsv(profiles: EnvProfile[]): Promise<void> {
	if (profiles.length === 0) {
		vscode.window.showWarningMessage("No environment profile data to export.");
		return;
	}

	// Gather all metric keys
	const metricKeys = Array.from(new Set(profiles.flatMap((p) => Object.keys(p.metrics))));

	const header = ["environment", "timestamp", ...metricKeys, "tags", "sourceFile"].join(",");
	const rows = profiles.map((p) => {
		const metricCols = metricKeys.map((k) => {
			const v = p.metrics[k];
			return v !== undefined ? String(v) : "";
		});
		return [
			csvCell(p.environment),
			csvCell(p.timestamp),
			...metricCols,
			csvCell(p.tags.join("|")),
			csvCell(p.sourceFile ?? ""),
		].join(",");
	});

	const csv = [header, ...rows].join("\n");

	const uri = await vscode.window.showSaveDialog({
		defaultUri: vscode.Uri.file("env-profiles.csv"),
		filters: { CSV: ["csv"] },
	});

	if (!uri) return;

	try {
		await vscode.workspace.fs.writeFile(uri, Buffer.from(csv, "utf8"));
		vscode.window.showInformationMessage(`Exported ${profiles.length} profiles to ${uri.fsPath}`);
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		vscode.window.showErrorMessage(`Export failed: ${msg}`);
	}
}

// ── Utility ───────────────────────────────────────────────────────────────────

function getNonce(): string {
	return crypto.randomBytes(16).toString("hex");
}

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

function csvCell(val: string): string {
	if (val.includes(",") || val.includes('"') || val.includes("\n")) {
		return `"${val.replace(/"/g, '""')}"`;
	}
	return val;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface WebviewMessage {
	command: string;
	profiles?: EnvProfile[];
	selectedEnvs?: string[];
	selectedMetric?: string;
}
