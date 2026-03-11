import * as fs from "node:fs";
import * as vscode from "vscode";
import { ChartProfilesProvider, ChartTreeItem } from "./core/chartProfilesProvider";
import { show as showChartVisualization } from "./visualization/chartVisualizationView";
import { isHelmAvailable, renderHelmTemplate } from "./k8s/helmRenderer";
import { showRenderedYaml } from "./utils/renderedYamlView";
import { createChartValidator } from "./processing/chartValidator";
import { getKubernetesConnector } from "./k8s/kubernetesConnector";
import { getRuntimeStateManager } from "./state/runtimeStateManager";
import { generateDependencyVisualizationData, checkDependencySecurity } from "./visualization/dependencyVisualizer";
import { initializeIconManager, preloadIcons } from "./k8s/iconManager";

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
	// Show message to confirm extension is running
	vscode.window.showInformationMessage("Chart Profile Visualizer extension activated!");

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

	// Handle tree item activation (single click execution)
	treeView.onDidChangeSelection(async (e) => {
		if (e.selection && e.selection.length > 0) {
			const item = e.selection[0];
			// Check if this is an action item with a command
			if (item.type === "action" && item.command) {
				console.log("Executing command for action:", item.command.command);
				try {
					await vscode.commands.executeCommand(item.command.command, item);
				} catch (error) {
					console.error("Error executing command:", error);
					vscode.window.showErrorMessage(`Error: ${error}`);
				}
			}
		}
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

	// Register view merged values command
	const viewMergedValuesCommand = vscode.commands.registerCommand(
		"chartProfiles.viewMergedValues",
		async (item: unknown) => {
			await showRenderedYaml(item as Parameters<typeof showRenderedYaml>[0]);
		}
	);

	// Register visualize chart command
	const visualizeChartCommand = vscode.commands.registerCommand(
		"chartProfiles.visualizeChart",
		async (item: unknown) => {
			console.log("Visualize chart command called with item:", item);
			try {
				await showChartVisualization(context, item as Parameters<typeof showChartVisualization>[1]);
			} catch (error) {
				console.error("Error in visualizeChartCommand:", error);
				vscode.window.showErrorMessage(`Error: ${error}`);
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
		viewMergedValuesCommand,
		visualizeChartCommand,
		validateChartCommand,
		checkClusterStatusCommand,
		checkRuntimeStateCommand,
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
