import type { EnvProfile } from "../../types/envProfile";

/**
 * Build the HTML markup for the side-by-side comparison table.
 *
 * For each selected metric the table shows one row per environment, plus a
 * delta column expressed as a percentage difference relative to the first
 * selected environment.
 */
export function generateCompareTableHtml(
	profiles: EnvProfile[],
	selectedEnvs: string[],
	selectedMetric: string
): string {
	if (selectedEnvs.length === 0 || profiles.length === 0) {
		return `<div class="empty-state">
			<span class="codicon codicon-info"></span>
			<p>Select at least one environment to compare.</p>
		</div>`;
	}

	// Keep only the most recent snapshot for each selected environment
	const latestByEnv = new Map<string, EnvProfile>();
	for (const env of selectedEnvs) {
		const envProfiles = profiles
			.filter((p) => p.environment === env)
			.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
		if (envProfiles.length > 0) {
			latestByEnv.set(env, envProfiles[0]);
		}
	}

	if (latestByEnv.size === 0) {
		return `<div class="empty-state">
			<span class="codicon codicon-warning"></span>
			<p>No data found for the selected environments.</p>
		</div>`;
	}

	// Derive baseline (first env with data) for delta calculations
	const baselineEnv = selectedEnvs.find((e) => latestByEnv.has(e));
	const baselineValue =
		baselineEnv !== undefined ? (latestByEnv.get(baselineEnv)?.metrics[selectedMetric] ?? null) : null;

	// Header row
	const headerCells = selectedEnvs
		.filter((e) => latestByEnv.has(e))
		.map((env) => `<th>${escapeHtml(env)}</th>`)
		.join("");

	// Data rows – current values
	const valueCells = selectedEnvs
		.filter((e) => latestByEnv.has(e))
		.map((env) => {
			const val = latestByEnv.get(env)?.metrics[selectedMetric];
			return `<td class="metric-value">${val !== undefined ? formatNumber(val) : "<em>N/A</em>"}</td>`;
		})
		.join("");

	// Delta row (% diff vs baseline)
	const deltaCells = selectedEnvs
		.filter((e) => latestByEnv.has(e))
		.map((env) => {
			if (env === baselineEnv) {
				return `<td class="delta baseline">baseline</td>`;
			}
			const val = latestByEnv.get(env)?.metrics[selectedMetric];
			if (val === undefined || baselineValue === null || baselineValue === 0) {
				return `<td class="delta">—</td>`;
			}
			const pct = ((val - baselineValue) / Math.abs(baselineValue)) * 100;
			const sign = pct > 0 ? "+" : "";
			const cls = pct > 0 ? "delta-up" : pct < 0 ? "delta-down" : "";
			return `<td class="delta ${cls}">${sign}${pct.toFixed(1)} %</td>`;
		})
		.join("");

	// Timestamp row
	const tsCells = selectedEnvs
		.filter((e) => latestByEnv.has(e))
		.map((env) => {
			const ts = latestByEnv.get(env)?.timestamp ?? "";
			return `<td class="timestamp">${formatTimestamp(ts)}</td>`;
		})
		.join("");

	// Tags row
	const tagsCells = selectedEnvs
		.filter((e) => latestByEnv.has(e))
		.map((env) => {
			const tags = latestByEnv.get(env)?.tags ?? [];
			const chips = tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join(" ");
			return `<td>${chips || "—"}</td>`;
		})
		.join("");

	return `
<div class="compare-table-wrapper">
	<table class="compare-table" id="compare-table">
		<thead>
			<tr>
				<th class="row-label">Environment</th>
				${headerCells}
			</tr>
		</thead>
		<tbody>
			<tr>
				<td class="row-label">${escapeHtml(selectedMetric)}</td>
				${valueCells}
			</tr>
			<tr class="delta-row">
				<td class="row-label">Δ vs baseline</td>
				${deltaCells}
			</tr>
			<tr>
				<td class="row-label">Last updated</td>
				${tsCells}
			</tr>
			<tr>
				<td class="row-label">Tags</td>
				${tagsCells}
			</tr>
		</tbody>
	</table>
</div>`;
}

/**
 * Build HTML summary cards showing the latest value and a simple trend
 * indicator (▲/▼/—) for each selected environment.
 */
export function generateSummaryCardsHtml(
	profiles: EnvProfile[],
	selectedEnvs: string[],
	selectedMetric: string
): string {
	if (selectedEnvs.length === 0) {
		return "";
	}

	const cards = selectedEnvs
		.map((env) => {
			const envProfiles = profiles
				.filter((p) => p.environment === env)
				.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

			if (envProfiles.length === 0) {
				return `<div class="summary-card empty">
				<div class="card-env">${escapeHtml(env)}</div>
				<div class="card-value">No data</div>
			</div>`;
			}

			const latest = envProfiles[envProfiles.length - 1];
			const previous = envProfiles.length >= 2 ? envProfiles[envProfiles.length - 2] : null;
			const latestVal = latest.metrics[selectedMetric];
			const prevVal = previous?.metrics[selectedMetric];

			let trendIcon = "—";
			let trendClass = "";
			if (latestVal !== undefined && prevVal !== undefined) {
				if (latestVal > prevVal) {
					trendIcon = "▲";
					trendClass = "trend-up";
				} else if (latestVal < prevVal) {
					trendIcon = "▼";
					trendClass = "trend-down";
				} else {
					trendIcon = "—";
				}
			}

			const displayVal = latestVal !== undefined ? formatNumber(latestVal) : "N/A";

			return `<div class="summary-card">
			<div class="card-env">${escapeHtml(env)}</div>
			<div class="card-metric-name">${escapeHtml(selectedMetric)}</div>
			<div class="card-value">${displayVal}</div>
			<div class="card-trend ${trendClass}">${trendIcon}</div>
			<div class="card-ts">${formatTimestamp(latest.timestamp)}</div>
		</div>`;
		})
		.join("\n");

	return `<div class="summary-cards">${cards}</div>`;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

function formatNumber(n: number): string {
	// Up to 4 decimal places, strip trailing zeros
	return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function formatTimestamp(ts: string): string {
	if (!ts) {
		return "—";
	}
	// Use a fixed locale and explicit options for consistent output across environments.
	try {
		return new Date(ts).toLocaleString("en-US", {
			year: "numeric",
			month: "short",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			hour12: false,
		});
	} catch {
		return ts;
	}
}
