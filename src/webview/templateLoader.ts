import * as vscode from "vscode";

/**
 * Simple template engine for replacing placeholders in HTML templates
 * Uses {{variable}} syntax for variable replacement (HTML-escaped)
 * Uses {{{variable}}} syntax for raw/unescaped output (for URIs, JSON, etc.)
 * Uses {{#if condition}}...{{/if}} for conditional blocks
 * Uses {{#each items}}...{{/each}} for loops
 * WARNING: {{variable}} (double braces) are automatically HTML-escaped for security
 * Use {{{variable}}} (triple braces) for raw output without escaping
 */

interface TemplateContext {
	[key: string]: any;
}

/**
 * Escape HTML special characters to prevent XSS attacks
 */
export function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

/**
 * Load a template file and replace placeholders with values from context
 * @param templateUri - The VS Code URI to the template file
 * @param context - Object with values to replace placeholders
 */
export async function loadTemplate(templateUri: vscode.Uri, context: TemplateContext): Promise<string> {
	try {
		// Use VS Code's workspace API to read the file, which works with vscode-resource URIs
		const templateBuffer = await vscode.workspace.fs.readFile(templateUri);
		const template = new TextDecoder().decode(templateBuffer);

		const result = renderTemplate(template, context);

		// Check for any remaining {{ placeholders
		const remaining = result.match(/\{\{[^}]+\}\}/g);
		if (remaining) {
			console.warn("WARNING - Remaining placeholders:", remaining);
		}

		return result;
	} catch (error) {
		console.error(`Failed to load template: ${templateUri.fsPath}`, error);
		return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Template Error</title>
</head>
<body>
    <h1>Error loading template</h1>
    <p>Failed to load: ${escapeHtml(templateUri.fsPath)}</p>
    <pre>${escapeHtml(String(error))}</pre>
</body>
</html>`;
	}
}

/**
 * Render a template string with the given context
 * Processes template in order: #each, #if, then simple variables
 * Use {{variable}} for HTML-escaped output
 * Use {{{variable}}} for raw/unescaped output (for URIs, JSON, etc.)
 */
export function renderTemplate(template: string, context: TemplateContext): string {
	let result = template;

	// First: Replace triple-brace {{{variable}}} with RAW (unescaped) values
	result = result.replace(/\{\{\{(\w+)\}\}\}/g, (match, key) => {
		return context[key] !== undefined ? String(context[key]) : "";
	});

	// Replace {{#each items}}...{{/each}} loops first (before #if to handle nested)
	result = result.replace(/\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (match, itemsKey, itemTemplate) => {
		const items = context[itemsKey];
		if (!Array.isArray(items)) return "";

		return items
			.map((item: any, index: number) => {
				let itemResult = itemTemplate;
				// Replace {{key}} and {{nested.key}} patterns with item values (with HTML escaping)
				// Also handle {{this}} as a special keyword for the current item
				itemResult = itemResult.replace(/\{\{([\w.]+|this)\}\}/g, (m: string, k: string): string => {
					if (k === "@index") return String(index);
					if (k === "this") return item !== undefined ? escapeHtml(String(item)) : m;
					// Handle nested property access like "item.nested.key"
					const value = k.split(".").reduce((obj: any, key: string) => obj?.[key], item);
					return value !== undefined ? escapeHtml(String(value)) : m;
				});
				return itemResult;
			})
			.join("");
	});

	// Replace {{#if condition}}...{{/if}} blocks
	// Process #if blocks and re-apply variable substitution to the selected content
	result = result.replace(
		/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
		(match: string, condition: string, content: string): string => {
			if (!context[condition]) {
				return "";
			}
			// Process simple {{variable}} placeholders within the if-block content
			return content.replace(/\{\{(\w+)\}\}/g, (m: string, key: string): string => {
				return context[key] !== undefined ? escapeHtml(String(context[key])) : m;
			});
		}
	);

	// Handle {{#if condition}}...{{else}}...{{/if}} blocks
	result = result.replace(
		/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{else\}\}([\s\S]*?)\{\{\/if\}\}/g,
		(match: string, condition: string, ifContent: string, elseContent: string): string => {
			const selectedContent = context[condition] ? ifContent : elseContent;
			// Process simple {{variable}} placeholders within the selected content
			return selectedContent.replace(/\{\{(\w+)\}\}/g, (m: string, key: string): string => {
				return context[key] !== undefined ? escapeHtml(String(context[key])) : m;
			});
		}
	);

	// Replace remaining simple {{variable}} placeholders (with HTML escaping for security)
	result = result.replace(/\{\{(\w+)\}\}/g, (match, key) => {
		return context[key] !== undefined ? escapeHtml(String(context[key])) : "";
	});

	return result;
}

/**
 * Get the URI to a template file in the webview directory
 * @param templateName - Name of the template (without extension)
 * @param extensionUri - The extension's URI (from context.extensionUri) for proper path resolution
 * @returns The URI to the template file
 */
export function getTemplatePath(templateName: string, extensionUri: vscode.Uri): vscode.Uri {
	// Use the provided extension URI to resolve the template path
	// This works correctly in both development and bundled (production) modes
	// Note: Templates are copied to out/webview by esbuild.js during build
	return vscode.Uri.joinPath(extensionUri, "out", "webview", `${templateName}.html`);
}
