import * as vscode from "vscode";
import {
	buildRenderContext,
	DEFAULT_NAMESPACE,
	DEFAULT_RELEASE_NAME,
	RENDER_CONTEXT_NAMESPACE_SETTING,
	RENDER_CONTEXT_RELEASE_NAME_SETTING,
	type RenderContext,
} from "./renderContextSettings";

// Re-export everything from the pure settings module for convenience
export {
	buildRenderContext,
	DEFAULT_NAMESPACE,
	DEFAULT_RELEASE_NAME,
	RENDER_CONTEXT_NAMESPACE_SETTING,
	RENDER_CONTEXT_RELEASE_NAME_SETTING,
	type RenderContext,
};

/**
 * Read the current render context from workspace settings.
 * Falls back to defaults when settings are not configured.
 */
export function getRenderContext(): RenderContext {
	const config = vscode.workspace.getConfiguration("chartProfiles");
	const releaseName = config.get<string>("renderContext.releaseName");
	const namespace = config.get<string>("renderContext.namespace");
	return buildRenderContext(releaseName, namespace);
}

/**
 * Prompt the user to configure the render context via Quick Input.
 * Persists the chosen values to workspace settings and returns the result.
 */
export async function promptRenderContext(): Promise<RenderContext | undefined> {
	const current = getRenderContext();

	const releaseName = await vscode.window.showInputBox({
		title: "Render Context: Release Name",
		prompt: "Enter the Helm release name used during template rendering",
		value: current.releaseName,
		placeHolder: DEFAULT_RELEASE_NAME,
		ignoreFocusOut: true,
		validateInput: (v) => (v.trim() === "" ? "Release name cannot be empty" : undefined),
	});

	if (releaseName === undefined) {
		// User cancelled
		return undefined;
	}

	const namespace = await vscode.window.showInputBox({
		title: "Render Context: Namespace",
		prompt: "Enter the Kubernetes namespace used during template rendering",
		value: current.namespace,
		placeHolder: DEFAULT_NAMESPACE,
		ignoreFocusOut: true,
		validateInput: (v) => (v.trim() === "" ? "Namespace cannot be empty" : undefined),
	});

	if (namespace === undefined) {
		// User cancelled
		return undefined;
	}

	const context = buildRenderContext(releaseName, namespace);

	// Persist to workspace settings
	const config = vscode.workspace.getConfiguration("chartProfiles");
	await config.update(
		RENDER_CONTEXT_RELEASE_NAME_SETTING.replace("chartProfiles.", ""),
		context.releaseName,
		vscode.ConfigurationTarget.Workspace
	);
	await config.update(
		RENDER_CONTEXT_NAMESPACE_SETTING.replace("chartProfiles.", ""),
		context.namespace,
		vscode.ConfigurationTarget.Workspace
	);

	return context;
}
