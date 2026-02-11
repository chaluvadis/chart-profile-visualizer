import * as vscode from 'vscode';
import * as fs from 'fs';
import { ChartProfilesProvider } from './chartProfilesProvider';
import { showRenderedYaml } from './renderedYamlView';
import { ChartVisualizationView } from './chartVisualizationView';
import { isHelmAvailable, renderHelmTemplate } from './helmRenderer';
import { compareEnvironments, formatDiff, EnvironmentComparison } from './environmentDiff';

/**
 * Format environment comparison as markdown
 */
function formatComparisonMarkdown(comparison: EnvironmentComparison): string {
    const lines: string[] = [];
    
    lines.push(`# Environment Comparison: ${comparison.leftEnv} vs ${comparison.rightEnv}`);
    lines.push(`## Chart: ${comparison.chartName}`);
    lines.push('');
    lines.push('## Summary');
    lines.push(`- **Added**: ${comparison.summary.added} resources`);
    lines.push(`- **Removed**: ${comparison.summary.removed} resources`);
    lines.push(`- **Modified**: ${comparison.summary.modified} resources`);
    lines.push(`- **Unchanged**: ${comparison.summary.unchanged} resources`);
    lines.push(`- **Total**: ${comparison.summary.total} resources`);
    lines.push('');
    
    // Group diffs by type
    const added = comparison.diffs.filter(d => d.diffType === 'Added');
    const removed = comparison.diffs.filter(d => d.diffType === 'Removed');
    const modified = comparison.diffs.filter(d => d.diffType === 'Modified');
    
    if (added.length > 0) {
        lines.push('## Added Resources');
        for (const diff of added) {
            lines.push(`- **${diff.kind}/${diff.name}** ${diff.namespace ? `(${diff.namespace})` : ''}`);
        }
        lines.push('');
    }
    
    if (removed.length > 0) {
        lines.push('## Removed Resources');
        for (const diff of removed) {
            lines.push(`- **${diff.kind}/${diff.name}** ${diff.namespace ? `(${diff.namespace})` : ''}`);
        }
        lines.push('');
    }
    
    if (modified.length > 0) {
        lines.push('## Modified Resources');
        for (const diff of modified) {
            lines.push(`### ${diff.kind}/${diff.name} ${diff.namespace ? `(${diff.namespace})` : ''}`);
            if (diff.fieldDiffs && diff.fieldDiffs.length > 0) {
                lines.push('**Changes:**');
                for (const fieldDiff of diff.fieldDiffs.slice(0, 10)) { // Limit to first 10 changes
                    const leftVal = JSON.stringify(fieldDiff.leftValue);
                    const rightVal = JSON.stringify(fieldDiff.rightValue);
                    lines.push(`- \`${fieldDiff.path}\`: ${leftVal} → ${rightVal}`);
                }
                if (diff.fieldDiffs.length > 10) {
                    lines.push(`- ... and ${diff.fieldDiffs.length - 10} more changes`);
                }
            }
            lines.push('');
        }
    }
    
    return lines.join('\n');
}

export function activate(context: vscode.ExtensionContext) {
    console.log('ChartProfiles extension is now active');

    // Get all workspace folders for multi-root support
    const workspaceRoots = vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) || [];

    // Create tree view provider
    const chartProfilesProvider = new ChartProfilesProvider(workspaceRoots);
    
    // Register tree view
    const treeView = vscode.window.createTreeView('chartProfiles', {
        treeDataProvider: chartProfilesProvider,
        showCollapseAll: true
    });

    // Register refresh command
    const refreshCommand = vscode.commands.registerCommand('chartProfiles.refreshCharts', () => {
        chartProfilesProvider.refresh();
        vscode.window.showInformationMessage('Charts refreshed');
    });

    // Register view rendered YAML command
    const viewRenderedCommand = vscode.commands.registerCommand('chartProfiles.viewRenderedYaml', async (item: any) => {
        // Check Helm availability before attempting to render
        const helmAvailable = await isHelmAvailable();
        if (!helmAvailable && item?.action === 'rendered') {
            const result = await vscode.window.showWarningMessage(
                'Helm CLI is not installed or not in PATH. Rendered YAML will show placeholder content.',
                'Continue Anyway',
                'Learn More'
            );
            
            if (result === 'Learn More') {
                vscode.env.openExternal(vscode.Uri.parse('https://helm.sh/docs/intro/install/'));
                return;
            } else if (result !== 'Continue Anyway') {
                return;
            }
        }
        
        await showRenderedYaml(item);
    });

    // Register visualize chart command
    const visualizeChartCommand = vscode.commands.registerCommand('chartProfiles.visualizeChart', async (item: any) => {
        await ChartVisualizationView.show(context, item);
    });

    // Register compare environments command
    const compareEnvironmentsCommand = vscode.commands.registerCommand('chartProfiles.compareEnvironments', async () => {
        // Get current workspace roots
        const currentWorkspaceRoots = vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) || [];
        
        // Get all available charts and environments
        const charts = await import('./helmChart').then(m => m.findHelmCharts(currentWorkspaceRoots));
        
        if (charts.length === 0) {
            vscode.window.showErrorMessage('No Helm charts found in workspace');
            return;
        }

        // Let user select a chart
        const chartItems = charts.map(c => ({ label: c.name, chart: c }));
        const selectedChart = await vscode.window.showQuickPick(chartItems, {
            placeHolder: 'Select a chart to compare'
        });

        if (!selectedChart) {
            return;
        }

        // Get available environments for this chart
        const chartPath = selectedChart.chart.path;
        const envFiles = fs.readdirSync(chartPath)
            .filter((f: string) => f.match(/^values-(.+)\.ya?ml$/))
            .map((f: string) => f.match(/^values-(.+)\.ya?ml$/)![1]);

        if (envFiles.length < 2) {
            vscode.window.showErrorMessage('Need at least 2 environments to compare');
            return;
        }

        // Select two environments
        const env1 = await vscode.window.showQuickPick(envFiles, {
            placeHolder: 'Select first environment'
        });

        if (!env1) {
            return;
        }

        const env2 = await vscode.window.showQuickPick(envFiles.filter(e => e !== env1), {
            placeHolder: 'Select second environment'
        });

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
                language: 'markdown'
            });
            
            await vscode.window.showTextDocument(doc);
        } catch (error: any) {
            vscode.window.showErrorMessage(`Comparison failed: ${error.message}`);
        }
    });

    // Register export resources command (placeholder - actual export handled in webview)
    const exportResourcesCommand = vscode.commands.registerCommand('chartProfiles.exportResources', async () => {
        vscode.window.showInformationMessage('Use the Export buttons in the visualization view');
    });

    context.subscriptions.push(treeView, refreshCommand, viewRenderedCommand, visualizeChartCommand, compareEnvironmentsCommand, exportResourcesCommand);

    // Auto-refresh when workspace files change
    const fileWatcher = vscode.workspace.createFileSystemWatcher('**/{Chart.yaml,values*.yaml}');
    fileWatcher.onDidCreate(() => chartProfilesProvider.refresh());
    fileWatcher.onDidChange(() => chartProfilesProvider.refresh());
    fileWatcher.onDidDelete(() => chartProfilesProvider.refresh());
    context.subscriptions.push(fileWatcher);

    // Auto-refresh when workspace folders change (multi-root support)
    const workspaceFoldersChangeListener = vscode.workspace.onDidChangeWorkspaceFolders(() => {
        const newRoots = vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) || [];
        chartProfilesProvider.updateWorkspaceRoots(newRoots);
        chartProfilesProvider.refresh();
    });
    context.subscriptions.push(workspaceFoldersChangeListener);
}

export function deactivate() {
    console.log('ChartProfiles extension is now deactivated');
}
