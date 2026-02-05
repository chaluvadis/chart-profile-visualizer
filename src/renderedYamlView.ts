import * as vscode from 'vscode';
import { ChartTreeItem } from './chartProfilesProvider';
import { mergeValues, generateAnnotatedYaml } from './valuesMerger';
import { renderHelmTemplate, formatRenderedOutput } from './helmRenderer';
import * as path from 'path';

/**
 * Shows rendered YAML or merged values in a new editor
 */
export async function showRenderedYaml(item: ChartTreeItem): Promise<void> {
    if (!item || !item.chart || !item.environment) {
        vscode.window.showErrorMessage('Invalid item selected');
        return;
    }

    const chartPath = item.chart.path;
    const environment = item.environment;

    try {
        if (item.action === 'values') {
            // Show merged values with annotations
            await showMergedValues(chartPath, environment, item.chart.name);
        } else if (item.action === 'rendered') {
            // Show rendered Helm templates
            await showRenderedTemplates(chartPath, environment, item.chart.name);
        }
    } catch (error: any) {
        vscode.window.showErrorMessage(`Error displaying YAML: ${error.message}`);
    }
}

async function showMergedValues(chartPath: string, environment: string, chartName: string): Promise<void> {
    // Merge values and generate annotated output
    const comparison = mergeValues(chartPath, environment);
    const annotatedYaml = generateAnnotatedYaml(comparison);

    // Create and show document
    const doc = await vscode.workspace.openTextDocument({
        content: annotatedYaml,
        language: 'yaml'
    });

    await vscode.window.showTextDocument(doc, {
        preview: false,
        viewColumn: vscode.ViewColumn.Beside
    });

    // Show summary
    const overriddenCount = Array.from(comparison.details.values()).filter(v => v.overridden).length;
    vscode.window.showInformationMessage(
        `Merged values for ${chartName} (${environment}): ${overriddenCount} overridden values`
    );
}

async function showRenderedTemplates(chartPath: string, environment: string, chartName: string): Promise<void> {
    // Show progress
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Rendering Helm templates for ${chartName} (${environment})...`,
        cancellable: false
    }, async (progress) => {
        progress.report({ increment: 0 });

        // Render templates
        const releaseName = `${chartName}-${environment}`;
        const resources = await renderHelmTemplate(chartPath, environment, releaseName);

        progress.report({ increment: 50 });

        // Format output
        const output = formatRenderedOutput(resources);

        progress.report({ increment: 80 });

        // Create and show document
        const doc = await vscode.workspace.openTextDocument({
            content: output,
            language: 'yaml'
        });

        await vscode.window.showTextDocument(doc, {
            preview: false,
            viewColumn: vscode.ViewColumn.Beside
        });

        progress.report({ increment: 100 });

        return resources;
    });

    vscode.window.showInformationMessage(`Rendered templates for ${chartName} (${environment})`);
}

/**
 * Highlights differences between base and environment-specific values
 * This is a placeholder for future enhancement
 */
export function highlightValueDifferences(baseValues: any, envValues: any): void {
    // Placeholder: In a full implementation, this would:
    // 1. Use VS Code decorations to highlight overridden values
    // 2. Show inline diff markers
    // 3. Provide hover tooltips showing original values
    // 4. Use different colors for additions, modifications, deletions
    console.log('Placeholder: Value highlighting not yet implemented');
}
