import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { HelmChart, findHelmCharts } from './helmChart';

export class ChartProfilesProvider implements vscode.TreeDataProvider<ChartTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ChartTreeItem | undefined | null | void> = new vscode.EventEmitter<ChartTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ChartTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private workspaceRoot: string) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ChartTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ChartTreeItem): Promise<ChartTreeItem[]> {
        if (!this.workspaceRoot) {
            vscode.window.showInformationMessage('No workspace folder open');
            return [];
        }

        if (!element) {
            // Root level: show charts
            const charts = await findHelmCharts(this.workspaceRoot);
            return charts.map(chart => new ChartTreeItem(
                chart.name,
                chart.path,
                vscode.TreeItemCollapsibleState.Expanded,
                'chart',
                chart
            ));
        } else if (element.type === 'chart') {
            // Chart level: show environments
            const environments = this.getEnvironments(element.chart!);
            return environments.map(env => new ChartTreeItem(
                env,
                element.chart!.path,
                vscode.TreeItemCollapsibleState.Collapsed,
                'environment',
                element.chart,
                env
            ));
        } else if (element.type === 'environment') {
            // Environment level: show actions
            return [
                new ChartTreeItem(
                    'Visualize Chart',
                    element.chart!.path,
                    vscode.TreeItemCollapsibleState.None,
                    'action',
                    element.chart,
                    element.environment,
                    'visualize'
                ),
                new ChartTreeItem(
                    'View Merged Values',
                    element.chart!.path,
                    vscode.TreeItemCollapsibleState.None,
                    'action',
                    element.chart,
                    element.environment,
                    'values'
                ),
                new ChartTreeItem(
                    'View Rendered YAML',
                    element.chart!.path,
                    vscode.TreeItemCollapsibleState.None,
                    'action',
                    element.chart,
                    element.environment,
                    'rendered'
                )
            ];
        }

        return [];
    }

    private getEnvironments(chart: HelmChart): string[] {
        const environments = ['dev', 'qa', 'prod'];
        const foundEnvs: string[] = [];

        // Check which environment-specific values files exist
        for (const env of environments) {
            const envValuesPath = path.join(chart.path, `values-${env}.yaml`);
            if (fs.existsSync(envValuesPath)) {
                foundEnvs.push(env);
            }
        }

        // Always include base if no specific environments found
        return foundEnvs.length > 0 ? foundEnvs : ['default'];
    }
}

export class ChartTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly chartPath: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly type: 'chart' | 'environment' | 'action',
        public readonly chart?: HelmChart,
        public readonly environment?: string,
        public readonly action?: 'values' | 'rendered' | 'visualize'
    ) {
        super(label, collapsibleState);

        this.tooltip = this.getTooltip();
        this.contextValue = type;
        this.iconPath = this.getIcon();

        if (type === 'action') {
            if (action === 'visualize') {
                this.command = {
                    command: 'chartProfiles.visualizeChart',
                    title: 'Visualize',
                    arguments: [this]
                };
            } else {
                this.command = {
                    command: 'chartProfiles.viewRenderedYaml',
                    title: 'View',
                    arguments: [this]
                };
            }
        }
    }

    private getTooltip(): string {
        if (this.type === 'chart') {
            return `Helm Chart: ${this.label}\nPath: ${this.chartPath}`;
        } else if (this.type === 'environment') {
            return `Environment: ${this.environment}`;
        } else if (this.action === 'visualize') {
            return `Visualize chart statistics for ${this.environment} environment`;
        } else if (this.action === 'values') {
            return `View merged values for ${this.environment} environment`;
        } else if (this.action === 'rendered') {
            return `View rendered YAML templates for ${this.environment} environment`;
        }
        return this.label;
    }

    private getIcon(): vscode.ThemeIcon {
        if (this.type === 'chart') {
            return new vscode.ThemeIcon('package');
        } else if (this.type === 'environment') {
            return new vscode.ThemeIcon('server-environment');
        } else if (this.action === 'visualize') {
            return new vscode.ThemeIcon('graph');
        } else if (this.action === 'values') {
            return new vscode.ThemeIcon('file-code');
        } else if (this.action === 'rendered') {
            return new vscode.ThemeIcon('output');
        }
        return new vscode.ThemeIcon('file');
    }
}
