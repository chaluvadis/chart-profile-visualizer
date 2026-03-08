import * as fs from "node:fs/promises";
import * as vscode from "vscode";

/**
 * Simple template engine for replacing placeholders in HTML templates
 * Uses {{variable}} syntax for variable replacement
 * Uses {{#if condition}}...{{/if}} for conditional blocks
 * Uses {{#each items}}...{{/each}} for loops
 * WARNING: All variables are automatically HTML-escaped for security
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
 * @param templatePath - The filesystem path to the template file
 * @param context - Object with values to replace placeholders
 */
export async function loadTemplate(templatePath: string, context: TemplateContext): Promise<string> {
	try {
		const template = await fs.readFile(templatePath, "utf8");
		return renderTemplate(template, context);
	} catch (error) {
		console.error(`Failed to load template: ${templatePath}`, error);
		return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Template Error</title>
</head>
<body>
    <h1>Error loading template</h1>
    <p>Failed to load: ${escapeHtml(templatePath)}</p>
</body>
</html>`;
	}
}

/**
 * Render a template string with the given context
 * Processes template in order: #each, #if, then simple variables
 */
export function renderTemplate(template: string, context: TemplateContext): string {
	let result = template;

	// Replace {{#each items}}...{{/each}} loops first (before #if to handle nested)
	result = result.replace(/\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (match, itemsKey, itemTemplate) => {
		const items = context[itemsKey];
		if (!Array.isArray(items)) return "";

		return items
			.map((item: any, index: number) => {
				let itemResult = itemTemplate;
				// Replace {{key}} and {{nested.key}} patterns with item values (with HTML escaping)
				itemResult = itemResult.replace(/\{\{([\w.]+)\}\}/g, (m: string, k: string): string => {
					if (k === "@index") return String(index);
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
		return context[key] !== undefined ? escapeHtml(String(context[key])) : match;
	});

	return result;
}

/**
 * Get the path to a template file in the webviews/templates directory
 * @param templateName - Name of the template (without extension)
 * @param extensionUri - The extension's URI (from context.extensionUri) for proper path resolution
 * @returns The filesystem path to the template file
 */
export function getTemplatePath(templateName: string, extensionUri: vscode.Uri): string {
	// Use the provided extension URI to resolve the template path
	// This works correctly in both development and bundled (production) modes
	const templateUri = vscode.Uri.joinPath(extensionUri, "src", "webviews", "templates", `${templateName}.html`);

	// Return the filesystem path from the URI
	return templateUri.fsPath;
}
