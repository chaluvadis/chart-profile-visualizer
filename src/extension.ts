import * as fs from "node:fs";
import * as vscode from "vscode";
import { ChartProfilesProvider } from "./chartProfilesProvider";
import { show as showChartVisualization } from "./chartVisualizationView";
import { compareEnvironments, DiffType, type EnvironmentComparison } from "./environmentDiff";
import { isHelmAvailable, renderHelmTemplate } from "./helmRenderer";
import { showRenderedYaml } from "./renderedYamlView";
import { createChartValidator } from "./chartValidator";
import { getKubernetesConnector } from "./kubernetesConnector";
import { getHelmReleaseManager } from "./helmReleaseManager";
import { getRuntimeStateManager } from "./runtimeStateManager";
import { generateDependencyVisualizationData, checkDependencySecurity } from "./dependencyVisualizer";
import { initializeIconManager, preloadIcons } from "./iconManager";

function formatComparisonMarkdown(comparison: EnvironmentComparison): string {
	const lines: string[] = [];

	lines.push(`# Environment Comparison: ${comparison.leftEnv} vs ${comparison.rightEnv}`);
	lines.push(`## Chart: ${comparison.chartName}`);
	lines.push("");
	lines.push("## Summary");
	lines.push(`- **Added**: ${comparison.summary.added} resources`);
	lines.push(`- **Removed**: ${comparison.summary.removed} resources`);
	lines.push(`- **Modified**: ${comparison.summary.modified} resources`);
	lines.push(`- **Unchanged**: ${comparison.summary.unchanged} resources`);
	lines.push(`- **Total**: ${comparison.summary.total} resources`);
	lines.push("");

	// Group diffs by type
	const added = comparison.diffs.filter((d) => d.diffType === DiffType.Added);
	const removed = comparison.diffs.filter((d) => d.diffType === DiffType.Removed);
	const modified = comparison.diffs.filter((d) => d.diffType === DiffType.Modified);

	if (added.length > 0) {
		lines.push("## Added Resources");
		for (const diff of added) {
			lines.push(`- **${diff.kind}/${diff.name}** ${diff.namespace ? `(${diff.namespace})` : ""}`);
		}
		lines.push("");
	}

	if (removed.length > 0) {
		lines.push("## Removed Resources");
		for (const diff of removed) {
			lines.push(`- **${diff.kind}/${diff.name}** ${diff.namespace ? `(${diff.namespace})` : ""}`);
		}
		lines.push("");
	}

	if (modified.length > 0) {
		lines.push("## Modified Resources");
		for (const diff of modified) {
			lines.push(`### ${diff.kind}/${diff.name} ${diff.namespace ? `(${diff.namespace})` : ""}`);
			if (diff.fieldDiffs && diff.fieldDiffs.length > 0) {
				lines.push("**Changes:**");
				for (const fieldDiff of diff.fieldDiffs.slice(0, 10)) {
					// Limit to first 10 changes
					const leftVal = JSON.stringify(fieldDiff.leftValue);
					const rightVal = JSON.stringify(fieldDiff.rightValue);
					lines.push(`- \`${fieldDiff.path}\`: ${leftVal} → ${rightVal}`);
				}
				if (diff.fieldDiffs.length > 10) {
					lines.push(`- ... and ${diff.fieldDiffs.length - 10} more changes`);
				}
			}
			lines.push("");
		}
	}

	return lines.join("\n");
}

function formatValidationMarkdown(result: {
	valid: boolean;
	issues: Array<{
		severity: string;
		code: string;
		message: string;
		resource?: string;
		remediation?: string;
	}>;
	summary: { errors: number; warnings: number; info: number };
}): string {
	const lines: string[] = [];

	lines.push("# Chart Validation Report");
	lines.push("");
	lines.push("## Summary");
	lines.push(`- **Status**: ${result.valid ? "✅ Valid" : "❌ Invalid"}`);
	lines.push(`- **Errors**: ${result.summary.errors}`);
	lines.push(`- **Warnings**: ${result.summary.warnings}`);
	lines.push(`- **Info**: ${result.summary.info}`);
	lines.push("");

	// Group by severity
	const errors = result.issues.filter((i) => i.severity === "error");
	const warnings = result.issues.filter((i) => i.severity === "warning");
	const info = result.issues.filter((i) => i.severity === "info");

	if (errors.length > 0) {
		lines.push("## ❌ Errors");
		for (const issue of errors) {
			lines.push(`- **[${issue.code}]** ${issue.message}`);
			if (issue.resource) lines.push(`  - Resource: ${issue.resource}`);
			if (issue.remediation) lines.push(`  - Fix: ${issue.remediation}`);
		}
		lines.push("");
	}

	if (warnings.length > 0) {
		lines.push("## ⚠️ Warnings");
		for (const issue of warnings) {
			lines.push(`- **[${issue.code}]** ${issue.message}`);
			if (issue.resource) lines.push(`  - Resource: ${issue.resource}`);
			if (issue.remediation) lines.push(`  - Suggestion: ${issue.remediation}`);
		}
		lines.push("");
	}

	if (info.length > 0) {
		lines.push("## ℹ️ Info");
		for (const issue of info) {
			lines.push(`- **[${issue.code}]** ${issue.message}`);
		}
		lines.push("");
	}

	return lines.join("\n");
}

export function activate(context: vscode.ExtensionContext) {
	console.log("ChartProfiles extension is now active");

	// Initialize icon manager and preload icons
	initializeIconManager(context);
	preloadIcons();

	// Get all workspace folders for multi-root support
	const workspaceRoots = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) || [];

	// Create tree view provider
	const chartProfilesProvider = new ChartProfilesProvider(workspaceRoots);

	// Initialize runtime state manager
	const runtimeStateManager = getRuntimeStateManager();

	// Register tree view
	const treeView = vscode.window.createTreeView("chartProfiles", {
		treeDataProvider: chartProfilesProvider,
		showCollapseAll: true,
	});

	// Register refresh command
	const refreshCommand = vscode.commands.registerCommand("chartProfiles.refreshCharts", () => {
		chartProfilesProvider.refresh();
		runtimeStateManager.clearCache();
		vscode.window.showInformationMessage("Charts refreshed");
	});

	// Register view rendered YAML command
	const viewRenderedCommand = vscode.commands.registerCommand(
		"chartProfiles.viewRenderedYaml",
		async (item: unknown) => {
			// Check Helm availability before attempting to render
			const helmAvailable = await isHelmAvailable();
			const typedItem = item as { action?: string };
			if (!helmAvailable && typedItem?.action === "rendered") {
				const result = await vscode.window.showWarningMessage(
					"Helm CLI is not installed or not in PATH. Rendered YAML will show placeholder content.",
					"Continue Anyway",
					"Learn More"
				);

				if (result === "Learn More") {
					vscode.env.openExternal(vscode.Uri.parse("https://helm.sh/docs/intro/install/"));
					return;
				} else if (result !== "Continue Anyway") {
					return;
				}
			}

			await showRenderedYaml(item as Parameters<typeof showRenderedYaml>[0]);
		}
	);

	// Register visualize chart command
	const visualizeChartCommand = vscode.commands.registerCommand(
		"chartProfiles.visualizeChart",
		async (item: unknown) => {
			await showChartVisualization(context, item as Parameters<typeof showChartVisualization>[1]);
		}
	);

	// Register compare environments command
	const compareEnvironmentsCommand = vscode.commands.registerCommand(
		"chartProfiles.compareEnvironments",
		async () => {
			// Get current workspace roots
			const currentWorkspaceRoots = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) || [];

			// Get all available charts and environments
			const charts = await import("./helmChart").then((m) => m.findHelmCharts(currentWorkspaceRoots));

			if (charts.length === 0) {
				vscode.window.showErrorMessage("No Helm charts found in workspace");
				return;
			}

			// Let user select a chart
			const chartItems = charts.map((c) => ({ label: c.name, chart: c }));
			const selectedChart = await vscode.window.showQuickPick(chartItems, {
				placeHolder: "Select a chart to compare",
			});

			if (!selectedChart) {
				return;
			}

			// Get available environments for this chart
			const chartPath = selectedChart.chart.path;
			const envFiles = fs
				.readdirSync(chartPath)
				.filter((f: string) => f.match(/^values-(.+)\.ya?ml$/))
				.map((f: string) => f.match(/^values-(.+)\.ya?ml$/)![1]);

			if (envFiles.length < 2) {
				vscode.window.showErrorMessage("Need at least 2 environments to compare");
				return;
			}

			// Select two environments
			const env1 = await vscode.window.showQuickPick(envFiles, {
				placeHolder: "Select first environment",
			});

			if (!env1) {
				return;
			}

			const env2 = await vscode.window.showQuickPick(
				envFiles.filter((e) => e !== env1),
				{
					placeHolder: "Select second environment",
				}
			);

			if (!env2) {
				return;
			}

			// Render both environments
			vscode.window.showInformationMessage(`Comparing ${env1} vs ${env2}...`);

			try {
				const releaseName1 = `${selectedChart.chart.name}-${env1}`;
				const releaseName2 = `${selectedChart.chart.name}-${env2}`;

				const resources1 = await renderHelmTemplate(chartPath, env1, releaseName1);
				const resources2 = await renderHelmTemplate(chartPath, env2, releaseName2);

				const comparison = compareEnvironments(env1, resources1, env2, resources2, selectedChart.chart.name);

				// Display comparison in new document
				const doc = await vscode.workspace.openTextDocument({
					content: formatComparisonMarkdown(comparison),
					language: "markdown",
				});

				await vscode.window.showTextDocument(doc);
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				vscode.window.showErrorMessage(`Comparison failed: ${errorMessage}`);
			}
		}
	);

	// Register validate chart command
	const validateChartCommand = vscode.commands.registerCommand(
		"chartProfiles.validateChart",
		async (item: unknown) => {
			const typedItem = item as { chartPath?: string; environment?: string };
			if (!typedItem?.chartPath) {
				vscode.window.showErrorMessage("No chart selected");
				return;
			}

			const chartPath = typedItem.chartPath;
			const environment = typedItem.environment || "default";

			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: "Validating chart...",
					cancellable: false,
				},
				async () => {
					const validator = createChartValidator(chartPath);
					const result = await validator.validateAll(environment);

					// Display validation report
					const doc = await vscode.workspace.openTextDocument({
						content: formatValidationMarkdown(result),
						language: "markdown",
					});

					await vscode.window.showTextDocument(doc);

					if (result.valid) {
						vscode.window.showInformationMessage("Chart validation passed!");
					} else {
						vscode.window.showWarningMessage(
							`Chart validation found ${result.summary.errors} errors and ${result.summary.warnings} warnings`
						);
					}
				}
			);
		}
	);

	// Register check cluster status command
	const checkClusterStatusCommand = vscode.commands.registerCommand("chartProfiles.checkClusterStatus", async () => {
		const connector = getKubernetesConnector();
		const clusterInfo = await connector.getClusterInfo();

		if (!clusterInfo.connected) {
			vscode.window.showErrorMessage(`Not connected to cluster: ${clusterInfo.errorMessage}`);
			return;
		}

		const message = `Connected to: ${clusterInfo.server}\nContext: ${clusterInfo.context}\nNamespace: ${clusterInfo.namespace}`;
		vscode.window.showInformationMessage(message);
	});

	// Register check runtime state command
	const checkRuntimeStateCommand = vscode.commands.registerCommand(
		"chartProfiles.checkRuntimeState",
		async (item: unknown) => {
			const typedItem = item as { chartPath?: string; environment?: string };
			if (!typedItem?.chartPath) {
				vscode.window.showErrorMessage("No chart selected");
				return;
			}

			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: "Checking runtime state...",
					cancellable: false,
				},
				async () => {
					const chartPath = typedItem.chartPath;
					if (!chartPath) {
						vscode.window.showErrorMessage("Chart path not found");
						return;
					}
					const state = await runtimeStateManager.getChartRuntimeState(
						chartPath,
						typedItem.environment || "default"
					);

					const healthSummary = runtimeStateManager.getHealthSummary(state);

					// Build report
					const lines: string[] = [];
					lines.push("# Runtime State Report");
					lines.push("");
					lines.push("## Cluster Info");
					lines.push(`- **Connected**: ${state.isConnected ? "Yes" : "No"}`);
					if (state.clusterInfo.server) {
						lines.push(`- **Server**: ${state.clusterInfo.server}`);
					}
					if (state.clusterInfo.context) {
						lines.push(`- **Context**: ${state.clusterInfo.context}`);
					}
					lines.push("");

					lines.push("## Health Summary");
					lines.push(`- **Overall Status**: ${healthSummary.overallStatus.toUpperCase()}`);
					lines.push(`- **Total Resources**: ${healthSummary.totalResources}`);
					lines.push(`- **Healthy**: ${healthSummary.healthy}`);
					lines.push(`- **Warning**: ${healthSummary.warning}`);
					lines.push(`- **Critical**: ${healthSummary.critical}`);
					lines.push(`- **Not Found**: ${healthSummary.notFound}`);
					lines.push("");

					// List resources by status
					const critical: string[] = [];
					const warning: string[] = [];
					const notFound: string[] = [];

					for (const [id, resourceState] of state.resources) {
						if (resourceState.status.state === "Critical") {
							critical.push(`${id}: ${resourceState.status.message}`);
						} else if (resourceState.status.state === "Warning") {
							warning.push(`${id}: ${resourceState.status.message}`);
						} else if (resourceState.status.state === "NotFound") {
							notFound.push(id);
						}
					}

					if (critical.length > 0) {
						lines.push("## ❌ Critical Issues");
						for (const c of critical) {
							lines.push(`- ${c}`);
						}
						lines.push("");
					}

					if (warning.length > 0) {
						lines.push("## ⚠️ Warnings");
						for (const w of warning) {
							lines.push(`- ${w}`);
						}
						lines.push("");
					}

					if (notFound.length > 0) {
						lines.push("## 🚫 Not Deployed");
						for (const n of notFound) {
							lines.push(`- ${n}`);
						}
						lines.push("");
					}

					const doc = await vscode.workspace.openTextDocument({
						content: lines.join("\n"),
						language: "markdown",
					});

					await vscode.window.showTextDocument(doc);
				}
			);
		}
	);

	// Register plan upgrade command
	const planUpgradeCommand = vscode.commands.registerCommand("chartProfiles.planUpgrade", async (item: unknown) => {
		const typedItem = item as { chartPath?: string; name?: string };
		if (!typedItem?.chartPath) {
			vscode.window.showErrorMessage("No chart selected");
			return;
		}

		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: "Planning upgrade...",
				cancellable: false,
			},
			async () => {
				const chartPath = typedItem.chartPath;
				if (!chartPath) {
					vscode.window.showErrorMessage("Chart path not found");
					return;
				}
				const releaseManager = getHelmReleaseManager();
				const plan = await releaseManager.planUpgrade(typedItem.name || "release", chartPath);

				// Build report
				const lines: string[] = [];
				lines.push("# Upgrade Plan");
				lines.push("");

				if (plan.currentRelease) {
					lines.push("## Current Release");
					lines.push(`- **Name**: ${plan.currentRelease.name}`);
					lines.push(`- **Version**: ${plan.currentRelease.chart}`);
					lines.push(`- **Status**: ${plan.currentRelease.status}`);
					lines.push("");
				}

				lines.push("## Target Chart");
				lines.push(`- **Chart**: ${plan.targetChart}`);
				lines.push(`- **Version**: ${plan.targetVersion}`);
				lines.push("");

				lines.push("## Risk Assessment");
				lines.push(`- **Risk Level**: ${plan.riskLevel.toUpperCase()}`);
				lines.push(`- **Can Upgrade**: ${plan.canUpgrade ? "Yes" : "No"}`);
				lines.push("");

				if (plan.changes.length > 0) {
					lines.push("## Changes");
					for (const change of plan.changes) {
						lines.push(`- ${change}`);
					}
					lines.push("");
				}

				if (plan.breakingChanges.length > 0) {
					lines.push("## ⚠️ Breaking Changes");
					for (const bc of plan.breakingChanges) {
						lines.push(`- ${bc}`);
					}
					lines.push("");
				}

				if (plan.warnings.length > 0) {
					lines.push("## Warnings");
					for (const w of plan.warnings) {
						lines.push(`- ${w}`);
					}
					lines.push("");
				}

				if (plan.recommendedActions.length > 0) {
					lines.push("## Recommended Actions");
					for (const action of plan.recommendedActions) {
						lines.push(`- ${action}`);
					}
					lines.push("");
				}

				const doc = await vscode.workspace.openTextDocument({
					content: lines.join("\n"),
					language: "markdown",
				});

				await vscode.window.showTextDocument(doc);
			}
		);
	});

	// Register assess rollback command
	const assessRollbackCommand = vscode.commands.registerCommand(
		"chartProfiles.assessRollback",
		async (item: unknown) => {
			const typedItem = item as { name?: string; namespace?: string };
			const releaseName = typedItem?.name;

			if (!releaseName) {
				// Let user select a release
				const releaseManager = getHelmReleaseManager();
				const releases = await releaseManager.listReleases(typedItem?.namespace);

				if (releases.length === 0) {
					vscode.window.showErrorMessage("No Helm releases found");
					return;
				}

				const selected = await vscode.window.showQuickPick(
					releases.map((r) => ({
						label: r.name,
						description: r.chart,
						release: r,
					})),
					{ placeHolder: "Select a release" }
				);

				if (!selected) return;
			}

			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: "Assessing rollback...",
					cancellable: false,
				},
				async () => {
					const releaseManager = getHelmReleaseManager();
					const history = await releaseManager.getReleaseHistory(releaseName || "", typedItem?.namespace);

					if (history.length < 2) {
						vscode.window.showErrorMessage("Need at least 2 revisions to assess rollback");
						return;
					}

					// Let user select target revision
					const selectedRevision = await vscode.window.showQuickPick(
						history.map((h) => ({
							label: `Revision ${h.revision}`,
							description: `${h.chart} - ${h.status}`,
							revision: h.revision,
						})),
						{ placeHolder: "Select target revision" }
					);

					if (!selectedRevision) return;

					const assessment = await releaseManager.assessRollback(
						releaseName || "",
						selectedRevision.revision,
						typedItem?.namespace
					);

					// Build report
					const lines: string[] = [];
					lines.push("# Rollback Assessment");
					lines.push("");

					lines.push("## Rollback Info");
					lines.push(`- **Release**: ${releaseName}`);
					lines.push(`- **Current Revision**: ${assessment.currentRevision}`);
					lines.push(`- **Target Revision**: ${assessment.targetRevision}`);
					lines.push(`- **Can Rollback**: ${assessment.canRollback ? "Yes" : "No"}`);
					lines.push(`- **Risk Level**: ${assessment.riskLevel.toUpperCase()}`);
					lines.push("");

					if (assessment.warnings.length > 0) {
						lines.push("## Warnings");
						for (const w of assessment.warnings) {
							lines.push(`- ${w}`);
						}
						lines.push("");
					}

					if (assessment.immutableFieldChanges.length > 0) {
						lines.push("## ⚠️ Immutable Field Changes");
						for (const c of assessment.immutableFieldChanges) {
							lines.push(`- ${c}`);
						}
						lines.push("");
					}

					if (assessment.dataLossWarnings.length > 0) {
						lines.push("## 🗑️ Data Loss Warnings");
						for (const w of assessment.dataLossWarnings) {
							lines.push(`- ${w}`);
						}
						lines.push("");
					}

					if (assessment.recommendedActions.length > 0) {
						lines.push("## Recommended Actions");
						for (const action of assessment.recommendedActions) {
							lines.push(`- ${action}`);
						}
						lines.push("");
					}

					const doc = await vscode.workspace.openTextDocument({
						content: lines.join("\n"),
						language: "markdown",
					});

					await vscode.window.showTextDocument(doc);
				}
			);
		}
	);

	// Register view dependencies command
	const viewDependenciesCommand = vscode.commands.registerCommand(
		"chartProfiles.viewDependencies",
		async (item: unknown) => {
			const typedItem = item as { chartPath?: string };
			if (!typedItem?.chartPath) {
				vscode.window.showErrorMessage("No chart selected");
				return;
			}

			const viz = generateDependencyVisualizationData(typedItem.chartPath);
			const securityIssues = checkDependencySecurity(
				viz.nodes
					.filter((n) => n.type === "dependency")
					.map((n) => ({
						name: n.label,
						version: n.version,
						repository: n.repository,
						enabled: n.enabled,
					}))
			);

			// Build report
			const lines: string[] = [];
			lines.push("# Chart Dependencies");
			lines.push("");

			lines.push("## Summary");
			lines.push(`- **Total Dependencies**: ${viz.summary.total}`);
			lines.push(`- **Enabled**: ${viz.summary.enabled}`);
			lines.push(`- **Disabled**: ${viz.summary.disabled}`);
			lines.push(`- **Conflicts**: ${viz.summary.conflicts}`);
			lines.push("");

			if (viz.nodes.length > 1) {
				lines.push("## Dependency Tree");
				for (const node of viz.nodes) {
					if (node.type === "root") continue;
					const indent = "  ".repeat(1);
					const status = node.enabled ? "✅" : "⬜";
					lines.push(`${indent}- ${status} **${node.label}** (${node.version})`);
					if (node.repository) {
						lines.push(`${indent}  - Repository: ${node.repository}`);
					}
				}
				lines.push("");
			}

			if (securityIssues.length > 0) {
				lines.push("## ⚠️ Security Issues");
				for (const issue of securityIssues) {
					lines.push(`- **${issue.dependency}**: ${issue.issue}`);
				}
				lines.push("");
			}

			const doc = await vscode.workspace.openTextDocument({
				content: lines.join("\n"),
				language: "markdown",
			});

			await vscode.window.showTextDocument(doc);
		}
	);

	context.subscriptions.push(
		treeView,
		refreshCommand,
		viewRenderedCommand,
		visualizeChartCommand,
		compareEnvironmentsCommand,
		validateChartCommand,
		checkClusterStatusCommand,
		checkRuntimeStateCommand,
		planUpgradeCommand,
		assessRollbackCommand,
		viewDependenciesCommand
	);

	// Auto-refresh when workspace files change
	const fileWatcher = vscode.workspace.createFileSystemWatcher("**/{Chart.yaml,values*.yaml}");
	fileWatcher.onDidCreate(() => chartProfilesProvider.refresh());
	fileWatcher.onDidChange(() => chartProfilesProvider.refresh());
	fileWatcher.onDidDelete(() => chartProfilesProvider.refresh());
	context.subscriptions.push(fileWatcher);

	// Auto-refresh when workspace folders change (multi-root support)
	const workspaceFoldersChangeListener = vscode.workspace.onDidChangeWorkspaceFolders(() => {
		const newRoots = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) || [];
		chartProfilesProvider.updateWorkspaceRoots(newRoots);
		chartProfilesProvider.refresh();
	});
	context.subscriptions.push(workspaceFoldersChangeListener);

	// Start runtime state auto-refresh (every 30 seconds)
	runtimeStateManager.startAutoRefresh(30000);
}

export function deactivate() {
	console.log("ChartProfiles extension is now deactivated");
	const runtimeStateManager = getRuntimeStateManager();
	runtimeStateManager.dispose();
}
