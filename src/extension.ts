import * as vscode from "vscode";
import { ChartProfilesProvider, ChartTreeItem } from "./core/chartProfilesProvider";
import type { HelmChart } from "./k8s/helmChart";
import { show as showChartVisualization, showCompare, exportComparisonReport } from "./visualization/chartVisualizationView";
import { showValidationResults } from "./visualization/validationResultView";
import { showRuntimeStateResults } from "./visualization/runtimeStateView";
import { isHelmAvailable } from "./k8s/helmRenderer";
import { showRenderedYaml } from "./utils/renderedYamlView";
import { createChartValidator } from "./processing/chartValidator";
import { getKubernetesConnector } from "./k8s/kubernetesConnector";
import { getRuntimeStateManager } from "./state/runtimeStateManager";
import { showFirstRunWalkthrough } from "./core/firstRunWalkthrough";

import { initializeIconManager, preloadIcons } from "./k8s/iconManager";

export function activate(context: vscode.ExtensionContext) {
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

	// Register expand all command
	const expandAllCommand = vscode.commands.registerCommand("chartProfiles.expandAll", async () => {
		// Get all root items and expand them
		const roots = await chartProfilesProvider.getChildren(undefined);
		for (const root of roots) {
			await treeView.reveal(root, { expand: 3, focus: false });
		}
	});

	// Register refresh command
	const refreshCommand = vscode.commands.registerCommand("chartProfiles.refreshCharts", () => {
		chartProfilesProvider.refresh();
		chartProfilesProvider.clearCache();
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
			const typedItem = item as { chart?: unknown; environment?: unknown } | undefined;
			if (!typedItem?.chart || !typedItem?.environment) {
				vscode.window.showErrorMessage("No chart environment selected");
				return;
			}
			await showRenderedYaml(typedItem as Parameters<typeof showRenderedYaml>[0]);
		}
	);

	// Register visualize chart command
	const visualizeChartCommand = vscode.commands.registerCommand(
		"chartProfiles.visualizeChart",
		async (item: unknown) => {
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

					// Display validation results in dedicated webview panel
					await showValidationResults(context, result);

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
					const environment = typedItem.environment || "default";
					const state = await runtimeStateManager.getChartRuntimeState(chartPath, environment);

					const healthSummary = runtimeStateManager.getHealthSummary(state);
					await showRuntimeStateResults(context, {
						chartPath,
						environment,
						state,
						healthSummary,
					});
				}
			);
		}
	);

	// Register compare environments command - NEW VERSION with proper item handling
	const compareEnvironmentsCommand = vscode.commands.registerCommand(
		"chartProfiles.compareEnvironments",
		async (...args: unknown[]) => {
			let chartPath = "";
			let chartName = "";

			// Parse arguments - support multiple input formats
			if (args.length >= 2 && typeof args[0] === "string" && typeof args[1] === "string") {
				// Format: (chartPath, chartName) - from tree view
				chartPath = args[0] as string;
				chartName = args[1] as string;
			} else if (args.length === 1 && args[0] !== null && typeof args[0] === "object") {
				// Format: ({ chart, chartPath, ... }) - direct call
				const item = args[0] as {
					chartPath?: string;
					chart?: { path?: string; name?: string };
					path?: string;
					name?: string;
					label?: string;
					chartName?: string;
				};
				chartPath = item?.chartPath || item?.chart?.path || item?.path || "";
				chartName = item?.chart?.name || item?.chartName || item?.name || item?.label || item?.chartName || "";
			} else {
				vscode.window.showErrorMessage("Invalid arguments format");
				return;
			}

			// Validate we have the required data
			if (!chartPath || !chartName) {
				vscode.window.showErrorMessage(`Missing chart info: path="${chartPath}", name="${chartName}"`);
				return;
			}

			// Create properly structured ChartTreeItem for showCompare
			const chart: HelmChart = { name: chartName, path: chartPath };
			const compareItem = new ChartTreeItem(
				chartName,
				chartPath,
				vscode.TreeItemCollapsibleState.None,
				"comparison",
				chart,
				"",
				"",
				"compare"
			);

			try {
				await showCompare(context, compareItem);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				vscode.window.showErrorMessage(`Compare failed: ${message}`);
			}
		}
	);

	// Register export comparison report command
	const exportComparisonReportCommand = vscode.commands.registerCommand(
		"chartProfiles.exportComparisonReport",
		async () => {
			await exportComparisonReport();
		}
	);

	// Register getting-started walkthrough command (can be triggered manually from the Command Palette)
	const startWalkthroughCommand = vscode.commands.registerCommand(
		"chartProfiles.startWalkthrough",
		async () => {
			await showFirstRunWalkthrough(context, /* forceShow */ true);
		}
	);

	context.subscriptions.push(
		treeView,
		expandAllCommand,
		refreshCommand,
		viewRenderedCommand,
		viewMergedValuesCommand,
		visualizeChartCommand,
		validateChartCommand,
		checkClusterStatusCommand,
		checkRuntimeStateCommand,
		compareEnvironmentsCommand,
		exportComparisonReportCommand,
		startWalkthroughCommand
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

	// Show first-run walkthrough for new users (no-op when already seen or disabled)
	showFirstRunWalkthrough(context).catch((err) => {
		console.error("First-run walkthrough error:", err);
	});
}

export function deactivate() {
	const runtimeStateManager = getRuntimeStateManager();
	runtimeStateManager.dispose();
}
