import * as vscode from 'vscode';
import { ChartProfilesProvider } from './chartProfilesProvider';
import { showRenderedYaml } from './renderedYamlView';

export function activate(context: vscode.ExtensionContext) {
    console.log('ChartProfiles extension is now active');

    // Create tree view provider
    const chartProfilesProvider = new ChartProfilesProvider(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '');
    
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
    const viewRenderedCommand = vscode.commands.registerCommand('chartProfiles.viewRenderedYaml', async (item) => {
        await showRenderedYaml(item);
    });

    context.subscriptions.push(treeView, refreshCommand, viewRenderedCommand);

    // Auto-refresh when workspace files change
    const fileWatcher = vscode.workspace.createFileSystemWatcher('**/{Chart.yaml,values*.yaml}');
    fileWatcher.onDidCreate(() => chartProfilesProvider.refresh());
    fileWatcher.onDidChange(() => chartProfilesProvider.refresh());
    fileWatcher.onDidDelete(() => chartProfilesProvider.refresh());
    context.subscriptions.push(fileWatcher);
}

export function deactivate() {
    console.log('ChartProfiles extension is now deactivated');
}
