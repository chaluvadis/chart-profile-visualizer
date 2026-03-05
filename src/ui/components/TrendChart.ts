import type { EnvProfile } from "../../types/envProfile";

/**
 * Generate the inline `<script>` block that renders an overlaid line chart
 * using Chart.js (bundled with the extension via `vendor/chart.umd.js`).
 *
 * The chart is rendered into a `<canvas id="trend-chart">` element that the
 * caller is responsible for placing in the HTML.
 */
export function generateTrendChartScript(
	profiles: EnvProfile[],
	selectedEnvs: string[],
	selectedMetric: string,
	nonce: string,
	chartJsUri: string
): string {
	if (selectedEnvs.length === 0 || profiles.length === 0) {
		return "";
	}

	// Collect the superset of timestamps across selected envs (sorted)
	const allTimestamps = Array.from(
		new Set(profiles.filter((p) => selectedEnvs.includes(p.environment)).map((p) => p.timestamp))
	).sort();

	// Build one dataset per environment
	interface Dataset {
		label: string;
		data: (number | null)[];
		borderColor: string;
		backgroundColor: string;
		tension: number;
		fill: boolean;
		spanGaps: boolean;
	}

	const palette = ["#4e9df5", "#f5884e", "#4ef58d", "#f54e4e", "#c04ef5", "#f5d24e", "#4ef5f0"];

	const datasets: Dataset[] = selectedEnvs.map((env, idx) => {
		const envProfiles = profiles.filter((p) => p.environment === env);
		const byTs = new Map<string, number>();
		for (const p of envProfiles) {
			const val = p.metrics[selectedMetric];
			if (val !== undefined) {
				byTs.set(p.timestamp, val);
			}
		}

		return {
			label: env,
			data: allTimestamps.map((ts) => byTs.get(ts) ?? null),
			borderColor: palette[idx % palette.length],
			backgroundColor: `${palette[idx % palette.length]}33`,
			tension: 0.3,
			fill: false,
			spanGaps: true,
		};
	});

	// Use fixed locale and explicit options for consistent output across environments
	const labels = allTimestamps.map((ts) => {
		if (!ts) return "—";
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
	});

	const chartData = JSON.stringify({
		labels,
		datasets,
	});

	return `
<script nonce="${nonce}" src="${chartJsUri}"></script>
<script nonce="${nonce}">
(function() {
	const canvas = document.getElementById('trend-chart');
	if (!canvas) return;
	const ctx = canvas.getContext('2d');
	const data = ${chartData};
	if (window._trendChart) {
		window._trendChart.destroy();
	}
	window._trendChart = new Chart(ctx, {
		type: 'line',
		data: data,
		options: {
			responsive: true,
			maintainAspectRatio: false,
			plugins: {
				legend: { position: 'top' },
				title: {
					display: true,
					text: ${JSON.stringify(selectedMetric + " — trend over time")},
					color: 'var(--vscode-foreground)'
				}
			},
			scales: {
				x: {
					ticks: { color: 'var(--vscode-foreground)', maxRotation: 45 },
					grid: { color: 'var(--vscode-editorWidget-border)' }
				},
				y: {
					ticks: { color: 'var(--vscode-foreground)' },
					grid: { color: 'var(--vscode-editorWidget-border)' }
				}
			}
		}
	});
})();
</script>`;
}
