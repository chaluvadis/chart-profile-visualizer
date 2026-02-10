import * as vscode from 'vscode';
import { ChartProfilesProvider } from './chartProfilesProvider';
import { showRenderedYaml } from './renderedYamlView';
import { ChartVisualizationView } from './chartVisualizationView';
import { isHelmAvailable } from './helmRenderer';

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

    context.subscriptions.push(treeView, refreshCommand, viewRenderedCommand, visualizeChartCommand);

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
