import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import {
	FIRST_RUN_STATE_KEY,
	QUICK_START_URL,
	shouldShowWalkthrough,
} from "./walkthroughSettings";

/**
 * Returns true when the first-run walkthrough should be shown to the user.
 */
export function isFirstRun(context: vscode.ExtensionContext): boolean {
	const hasCompletedBefore = context.globalState.get<boolean>(FIRST_RUN_STATE_KEY, false);
	const configEnabled = vscode.workspace
		.getConfiguration("chartProfiles")
		.get<boolean>("showWalkthroughOnFirstRun");
	return shouldShowWalkthrough(hasCompletedBefore, configEnabled);
}

/**
 * Persists the "walkthrough seen" flag so it is not shown again.
 */
export async function markFirstRunComplete(context: vscode.ExtensionContext): Promise<void> {
	await context.globalState.update(FIRST_RUN_STATE_KEY, true);
}

/**
 * Shows the first-run guided walkthrough if it has not been seen before.
 * Safe to call on every activation — it exits immediately when the flag is set
 * or when the setting is disabled.
 *
 * @param forceShow - When true, bypasses the "already seen" and "disabled" checks.
 *                    Used when the user manually triggers the walkthrough.
 */
export async function showFirstRunWalkthrough(
	context: vscode.ExtensionContext,
	forceShow = false,
): Promise<void> {
	if (!forceShow && !isFirstRun(context)) {
		return;
	}

	const choice = await vscode.window.showInformationMessage(
		"Welcome to Helm Chart Visualizer! Compare environment profiles side-by-side. " +
			"Would you like to explore with sample files or read the quick-start guide?",
		"Use Sample Files",
		"Open Quick Start",
		"Don't Show Again",
	);

	// User dismissed the dialog without making a choice — leave the flag unset so
	// the walkthrough can appear again on the next activation.
	if (choice === undefined) {
		return;
	}

	// Record that the user has engaged with the walkthrough so it is not shown
	// automatically again (they can always re-open it via the Command Palette).
	await markFirstRunComplete(context);

	if (choice === "Use Sample Files") {
		await copySampleFilesToWorkspace(context);
	} else if (choice === "Open Quick Start") {
		vscode.env.openExternal(vscode.Uri.parse(QUICK_START_URL));
	} else if (choice === "Don't Show Again") {
		await disableWalkthrough();
	}
}

// ── Private helpers ──────────────────────────────────────────────────────────

async function disableWalkthrough(): Promise<void> {
	await vscode.workspace
		.getConfiguration("chartProfiles")
		.update("showWalkthroughOnFirstRun", false, vscode.ConfigurationTarget.Global);
}

async function copySampleFilesToWorkspace(context: vscode.ExtensionContext): Promise<void> {
	const targetUri = await vscode.window.showOpenDialog({
		canSelectFiles: false,
		canSelectFolders: true,
		canSelectMany: false,
		openLabel: "Choose folder for sample files",
		title: "Choose a folder to copy the sample Helm chart into",
	});

	if (!targetUri || targetUri.length === 0) {
		return;
	}

	const targetFolder = targetUri[0].fsPath;
	const sampleSource = path.join(context.extensionPath, "examples", "sample-app");

	if (!fs.existsSync(sampleSource)) {
		const result = await vscode.window.showErrorMessage(
			"Sample files not found in this installation. " +
				"Please visit the quick-start guide for manual setup instructions.",
			"Open Quick Start",
		);
		if (result === "Open Quick Start") {
			vscode.env.openExternal(vscode.Uri.parse(QUICK_START_URL));
		}
		return;
	}

	const destPath = path.join(targetFolder, "sample-app");

	try {
		copyDirectorySync(sampleSource, destPath);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const result = await vscode.window.showErrorMessage(
			`Failed to copy sample files: ${message}. ` +
				"Try manually copying the examples/ directory, or open the quick-start guide.",
			"Open Quick Start",
		);
		if (result === "Open Quick Start") {
			vscode.env.openExternal(vscode.Uri.parse(QUICK_START_URL));
		}
		return;
	}

	const openChoice = await vscode.window.showInformationMessage(
		`Sample chart copied to ${destPath}. Open it now to start comparing environments?`,
		"Open Folder",
		"Add to Workspace",
	);

	if (openChoice === "Open Folder") {
		await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(destPath));
	} else if (openChoice === "Add to Workspace") {
		vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders?.length ?? 0, 0, {
			uri: vscode.Uri.file(destPath),
		});
		vscode.window.showInformationMessage(
			`sample-app added to workspace. Expand it in the Chart Profiles panel to start exploring.`,
		);
	}
}

/**
 * Recursively copies a directory tree from `src` to `dest`.
 * Creates `dest` (and any intermediate directories) if they do not exist.
 */
function copyDirectorySync(src: string, dest: string): void {
	if (!fs.existsSync(dest)) {
		fs.mkdirSync(dest, { recursive: true });
	}

	for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
		const srcPath = path.join(src, entry.name);
		const destPath = path.join(dest, entry.name);

		if (entry.isDirectory()) {
			copyDirectorySync(srcPath, destPath);
		} else {
			fs.copyFileSync(srcPath, destPath);
		}
	}
}
