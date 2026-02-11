import * as vscode from 'vscode';
import { ChartTreeItem } from './chartProfilesProvider';
import { mergeValues, generateAnnotatedYaml } from './valuesMerger';
import { renderHelmTemplate, formatRenderedOutput } from './helmRenderer';
import * as path from 'path';

// WeakMap to store decorations for each editor to avoid using `as any`
const editorDecorations = new WeakMap<vscode.TextEditor, vscode.TextEditorDecorationType[]>();

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

    const editor = await vscode.window.showTextDocument(doc, {
        preview: false,
        viewColumn: vscode.ViewColumn.Beside
    });

    // Apply syntax highlighting to show differences
    highlightValueDifferences(editor, comparison);

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
 * Uses VS Code decorations to show overridden, added, and base values
 */
export function highlightValueDifferences(
    editor: vscode.TextEditor,
    comparison: { merged: any; details: Map<string, { value: any; source: { file: string }; overridden: boolean; missingInBase?: boolean }> }
): void {
    // Dispose previous decorations to prevent resource leaks
    const existingDecorations = editorDecorations.get(editor);
    if (existingDecorations) {
        existingDecorations.forEach(decoration => decoration.dispose());
    }

    // Create decoration types for different value sources
    const overrideDecorationType = vscode.window.createTextEditorDecorationType({
        backgroundColor: 'rgba(255, 165, 0, 0.15)', // Orange tint for overrides
        borderLeft: '3px solid rgba(255, 165, 0, 0.8)',
        gutterIconPath: vscode.Uri.parse('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiI+PGNpcmNsZSBjeD0iOCIgY3k9IjgiIHI9IjYiIGZpbGw9IiNGRkE1MDAiLz48L3N2Zz4='),
        gutterIconSize: 'contain'
    });

    const additionDecorationType = vscode.window.createTextEditorDecorationType({
        backgroundColor: 'rgba(0, 255, 0, 0.1)', // Green tint for additions
        borderLeft: '3px solid rgba(0, 255, 0, 0.6)',
        gutterIconPath: vscode.Uri.parse('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiI+PGNpcmNsZSBjeD0iOCIgY3k9IjgiIHI9IjYiIGZpbGw9IiMwMEZGMDAiLz48L3N2Zz4='),
        gutterIconSize: 'contain'
    });

    const baseDecorationType = vscode.window.createTextEditorDecorationType({
        backgroundColor: 'rgba(135, 206, 250, 0.08)', // Light blue tint for base
        borderLeft: '2px solid rgba(135, 206, 250, 0.4)'
    });

    const overrideDecorations: vscode.DecorationOptions[] = [];
    const additionDecorations: vscode.DecorationOptions[] = [];
    const baseDecorations: vscode.DecorationOptions[] = [];

    const document = editor.document;
    const text = document.getText();
    const lines = text.split('\n');

    // Precompute all annotated lines in a single pass to avoid O(N*M) complexity
    const searchPattern = /^\s*([^:]+):\s*.*#\s*\[(OVERRIDE|BASE|ADDED) from ([^\]]+)\]/i;
    const annotatedLines: Array<{ index: number; key: string; type: string; fullPath: string }> = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(searchPattern);
        if (match) {
            const [, key, type] = match;
            annotatedLines.push({
                index: i,
                key: key.trim(),
                type,
                fullPath: '' // Will be filled during matching
            });
        }
    }

    // Build a map of line index to decoration info by matching full paths
    const lineDecorations = new Map<number, { type: 'override' | 'addition' | 'base'; detail: any; path: string }>();

    // Match annotations with details using full path comparison
    for (const [keyPath, detail] of comparison.details.entries()) {
        // Use the last segment of the key path for initial matching
        const keySegment = keyPath.split('.').pop();
        if (!keySegment) {
            continue;
        }

        // Find matching annotated line by checking if the full path matches
        for (const annotated of annotatedLines) {
            // Match by full path to avoid ambiguity with duplicate leaf keys
            // The annotation contains the key at that line, build potential full path
            if (keyPath === annotated.key || keyPath.endsWith('.' + annotated.key)) {
                // Determine decoration type based on the detail
                let decorationType: 'override' | 'addition' | 'base';
                if (detail.missingInBase) {
                    decorationType = 'addition';
                } else if (detail.overridden) {
                    decorationType = 'override';
                } else {
                    decorationType = 'base';
                }

                lineDecorations.set(annotated.index, {
                    type: decorationType,
                    detail,
                    path: keyPath
                });
                break;
            }
        }
    }

    // Create decorations for each line
    for (const [lineNum, info] of lineDecorations.entries()) {
        const line = document.lineAt(lineNum);
        const range = new vscode.Range(line.range.start, line.range.end);
        
        const sourceFile = path.basename(info.detail.source.file);
        const valueStr = JSON.stringify(info.detail.value);
        
        let hoverMessage: vscode.MarkdownString;
        
        if (info.type === 'override') {
            hoverMessage = new vscode.MarkdownString();
            hoverMessage.appendMarkdown(`**Overridden Value**\n\n`);
            hoverMessage.appendMarkdown(`- **Source:** \`${sourceFile}\`\n`);
            hoverMessage.appendMarkdown(`- **Path:** \`${info.path}\`\n`);
            hoverMessage.appendMarkdown(`- **Value:** \`${valueStr}\`\n\n`);
            hoverMessage.appendMarkdown(`This value overrides the base value from \`values.yaml\``);
            
            overrideDecorations.push({
                range,
                hoverMessage
            });
        } else if (info.type === 'addition') {
            hoverMessage = new vscode.MarkdownString();
            hoverMessage.appendMarkdown(`**Added Value**\n\n`);
            hoverMessage.appendMarkdown(`- **Source:** \`${sourceFile}\`\n`);
            hoverMessage.appendMarkdown(`- **Path:** \`${info.path}\`\n`);
            hoverMessage.appendMarkdown(`- **Value:** \`${valueStr}\`\n\n`);
            hoverMessage.appendMarkdown(`This value is only defined in the environment-specific file`);
            
            additionDecorations.push({
                range,
                hoverMessage
            });
        } else {
            hoverMessage = new vscode.MarkdownString();
            hoverMessage.appendMarkdown(`**Base Value**\n\n`);
            hoverMessage.appendMarkdown(`- **Source:** \`${sourceFile}\`\n`);
            hoverMessage.appendMarkdown(`- **Path:** \`${info.path}\`\n`);
            hoverMessage.appendMarkdown(`- **Value:** \`${valueStr}\`\n\n`);
            hoverMessage.appendMarkdown(`This value is from the base \`values.yaml\` file`);
            
            baseDecorations.push({
                range,
                hoverMessage
            });
        }
    }

    // Apply decorations
    editor.setDecorations(overrideDecorationType, overrideDecorations);
    editor.setDecorations(additionDecorationType, additionDecorations);
    editor.setDecorations(baseDecorationType, baseDecorations);

    // Store decoration types for cleanup later using WeakMap
    editorDecorations.set(editor, [
        overrideDecorationType,
        additionDecorationType,
        baseDecorationType
    ]);
}
