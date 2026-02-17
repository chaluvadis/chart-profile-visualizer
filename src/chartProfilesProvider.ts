import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { findHelmCharts, type HelmChart } from "./helmChart";
import { getIconUris, hasIcon } from "./iconManager";

export class ChartProfilesProvider implements vscode.TreeDataProvider<ChartTreeItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<ChartTreeItem | undefined | null> = new vscode.EventEmitter<
		ChartTreeItem | undefined | null
	>();
	readonly onDidChangeTreeData: vscode.Event<ChartTreeItem | undefined | null> = this._onDidChangeTreeData.event;

	constructor(private workspaceRoots: string[]) {}

	updateWorkspaceRoots(newRoots: string[]): void {
		this.workspaceRoots = newRoots;
	}

	refresh(): void {
		this._onDidChangeTreeData.fire(null);
	}

	getTreeItem(element: ChartTreeItem): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: ChartTreeItem): Promise<ChartTreeItem[]> {
		if (this.workspaceRoots.length === 0) {
			vscode.window.showInformationMessage("No workspace folder open");
			return [];
		}

		if (!element) {
			// Root level: show charts from all workspace roots
			const charts = await findHelmCharts(this.workspaceRoots);
			return charts.map(
				(chart) =>
					new ChartTreeItem(chart.name, chart.path, vscode.TreeItemCollapsibleState.Expanded, "chart", chart)
			);
		} else if (element.type === "chart") {
			// Chart level: show environments
			const environments = this.getEnvironments(element.chart!);
			return environments.map(
				(env) =>
					new ChartTreeItem(
						env,
						element.chart!.path,
						vscode.TreeItemCollapsibleState.Collapsed,
						"environment",
						element.chart,
						env
					)
			);
		} else if (element.type === "environment") {
			// Environment level: show actions
			return [
				new ChartTreeItem(
					"Visualize Chart",
					element.chart!.path,
					vscode.TreeItemCollapsibleState.None,
					"action",
					element.chart,
					element.environment,
					"visualize"
				),
				new ChartTreeItem(
					"View Merged Values",
					element.chart!.path,
					vscode.TreeItemCollapsibleState.None,
					"action",
					element.chart,
					element.environment,
					"values"
				),
				new ChartTreeItem(
					"View Rendered YAML",
					element.chart!.path,
					vscode.TreeItemCollapsibleState.None,
					"action",
					element.chart,
					element.environment,
					"rendered"
				),
				new ChartTreeItem(
					"Validate Chart",
					element.chart!.path,
					vscode.TreeItemCollapsibleState.None,
					"action",
					element.chart,
					element.environment,
					"validate"
				),
				new ChartTreeItem(
					"Check Runtime State",
					element.chart!.path,
					vscode.TreeItemCollapsibleState.None,
					"action",
					element.chart,
					element.environment,
					"runtime"
				),
				new ChartTreeItem(
					"View Dependencies",
					element.chart!.path,
					vscode.TreeItemCollapsibleState.None,
					"action",
					element.chart,
					element.environment,
					"dependencies"
				),
			];
		}

		return [];
	}

	private getEnvironments(chart: HelmChart): string[] {
		const foundEnvs: string[] = [];

		try {
			// Dynamically discover all values-*.yaml files
			const files = fs.readdirSync(chart.path);
			const valuesPattern = /^values-(.+)\.ya?ml$/;

			for (const file of files) {
				const match = file.match(valuesPattern);
				if (match && match[1]) {
					foundEnvs.push(match[1]);
				}
			}
		} catch (error) {
			console.error(`Error reading chart directory ${chart.path}:`, error);
		}

		// Sort environments alphabetically for stable ordering
		foundEnvs.sort();

		// Always include base if no specific environments found
		return foundEnvs.length > 0 ? foundEnvs : ["default"];
	}
}

export class ChartTreeItem extends vscode.TreeItem {
	private _hasOverrides?: boolean;

	constructor(
		public readonly label: string,
		public readonly chartPath: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly type: "chart" | "environment" | "action",
		public readonly chart?: HelmChart,
		public readonly environment?: string,
		public readonly action?: "values" | "rendered" | "visualize" | "validate" | "runtime" | "dependencies"
	) {
		super(label, collapsibleState);

		// Cache hasOverrides calculation for environment nodes
		if (type === "environment") {
			this._hasOverrides = this.calculateHasEnvironmentOverrides();
		}

		this.tooltip = this.getTooltip();
		// Add more specific context values for future context menu support
		this.contextValue = this.getContextValue();
		this.iconPath = this.getIcon();
		this.description = this.getDescription();

		if (type === "action") {
			if (action === "visualize") {
				this.command = {
					command: "chartProfiles.visualizeChart",
					title: "Visualize",
					arguments: [this],
				};
			} else if (action === "validate") {
				this.command = {
					command: "chartProfiles.validateChart",
					title: "Validate",
					arguments: [this],
				};
			} else if (action === "runtime") {
				this.command = {
					command: "chartProfiles.checkRuntimeState",
					title: "Check Runtime",
					arguments: [this],
				};
			} else if (action === "dependencies") {
				this.command = {
					command: "chartProfiles.viewDependencies",
					title: "View Dependencies",
					arguments: [this],
				};
			} else {
				this.command = {
					command: "chartProfiles.viewRenderedYaml",
					title: "View",
					arguments: [this],
				};
			}
		}
	}

	private getContextValue(): string {
		if (this.type === "chart") {
			return "chart";
		} else if (this.type === "environment") {
			// Use cached value (should always be defined for environment nodes)
			return (this._hasOverrides ?? false) ? "environment" : "environment-no-overrides";
		} else if (this.type === "action") {
			return `action-${this.action}`;
		}
		return this.type;
	}

	private calculateHasEnvironmentOverrides(): boolean {
		if (!this.chart || !this.environment || this.environment === "default") {
			return false;
		}

		const envValuesPath = path.join(this.chart.path, `values-${this.environment}.yaml`);
		try {
			if (fs.existsSync(envValuesPath)) {
				const content = fs.readFileSync(envValuesPath, "utf8");
				// Check if file has meaningful content (not just comments/whitespace)
				const lines = content.split("\n");
				for (const line of lines) {
					const trimmed = line.trim();
					if (trimmed && !trimmed.startsWith("#")) {
						return true;
					}
				}
				return false;
			}
		} catch (error) {
			console.error(`Error checking overrides for ${envValuesPath}:`, error);
		}
		return false;
	}

	private getDescription(): string | undefined {
		if (this.type === "environment") {
			// Use cached value
			const hasOverrides = this._hasOverrides ?? false;
			if (!hasOverrides && this.environment !== "default") {
				return "(no overrides)";
			}
		}
		return undefined;
	}

	private getTooltip(): string | vscode.MarkdownString {
		if (this.type === "chart") {
			const tooltip = new vscode.MarkdownString();
			tooltip.appendMarkdown(`**Helm Chart:** ${this.label}\n\n`);
			tooltip.appendMarkdown(`**Path:** \`${this.chartPath}\`\n\n`);
			if (this.chart?.version) {
				tooltip.appendMarkdown(`**Version:** ${this.chart.version}\n\n`);
			}
			if (this.chart?.description) {
				tooltip.appendMarkdown(`**Description:** ${this.chart.description}\n\n`);
			}
			return tooltip;
		} else if (this.type === "environment") {
			const tooltip = new vscode.MarkdownString();
			tooltip.appendMarkdown(`**Environment:** ${this.environment}\n\n`);

			// Show which values file is used
			if (this.environment === "default") {
				tooltip.appendMarkdown(`**Values file:** \`values.yaml\` (base only)\n\n`);
			} else {
				const envValuesPath = path.join(this.chartPath, `values-${this.environment}.yaml`);
				const envValuesExists = fs.existsSync(envValuesPath);

				if (envValuesExists) {
					tooltip.appendMarkdown(`**Values files:**\n`);
					tooltip.appendMarkdown(`- \`values.yaml\` (base)\n`);
					tooltip.appendMarkdown(`- \`values-${this.environment}.yaml\` (overrides)\n\n`);

					// Use cached value
					const hasOverrides = this._hasOverrides ?? false;
					if (!hasOverrides) {
						tooltip.appendMarkdown(`⚠️ *Environment file exists but contains no overrides*\n\n`);
					}
				} else {
					tooltip.appendMarkdown(`**Values file:** \`values.yaml\` (base only)\n\n`);
				}
			}

			return tooltip;
		} else if (this.action === "visualize") {
			return `Visualize chart statistics and resource distribution for ${this.environment} environment`;
		} else if (this.action === "values") {
			return `View merged values from base and ${this.environment}-specific files`;
		} else if (this.action === "rendered") {
			return `View rendered YAML templates for ${this.environment} environment using Helm CLI`;
		} else if (this.action === "validate") {
			return `Validate chart configuration and check for best practices`;
		} else if (this.action === "runtime") {
			return `Check runtime state of deployed resources in ${this.environment} environment`;
		} else if (this.action === "dependencies") {
			return `View chart dependencies and check for security issues`;
		}
		return this.label;
	}

	private getIcon(): vscode.ThemeIcon | { light: vscode.Uri; dark: vscode.Uri } {
		if (this.type === "chart") {
			// Use custom package icon if available, otherwise fall back to theme icon
			if (hasIcon("package")) {
				return getIconUris("package");
			}
			return new vscode.ThemeIcon("package");
		} else if (this.type === "environment") {
			// Add visual indicator for environments with no overrides
			const hasOverrides = this._hasOverrides ?? false;
			if (!hasOverrides && this.environment !== "default") {
				return new vscode.ThemeIcon("circle-outline"); // hollow icon for no overrides
			}
			// Use custom environment icon
			if (hasIcon("namespace")) {
				return getIconUris("namespace");
			}
			return new vscode.ThemeIcon("server-environment");
		} else if (this.action === "visualize") {
			// Use custom graph/topology icon
			if (hasIcon("networkpolicy")) {
				return getIconUris("networkpolicy");
			}
			return new vscode.ThemeIcon("graph");
		} else if (this.action === "values") {
			// Use configmap icon for values
			if (hasIcon("configmap")) {
				return getIconUris("configmap");
			}
			return new vscode.ThemeIcon("file-code");
		} else if (this.action === "rendered") {
			// Use deployment icon for rendered output
			if (hasIcon("deployment")) {
				return getIconUris("deployment");
			}
			return new vscode.ThemeIcon("output");
		} else if (this.action === "validate") {
			return new vscode.ThemeIcon("check");
		} else if (this.action === "runtime") {
			return new vscode.ThemeIcon("pulse");
		} else if (this.action === "dependencies") {
			return new vscode.ThemeIcon("type-hierarchy");
		}
		return new vscode.ThemeIcon("file");
	}
}
