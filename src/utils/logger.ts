import * as vscode from "vscode";

let outputChannel: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
	if (!outputChannel) {
		outputChannel = vscode.window.createOutputChannel("Helm Chart Visualizer");
	}
	return outputChannel;
}

export function logInfo(message: string): void {
	const timestamp = new Date().toISOString();
	getOutputChannel().appendLine(`[INFO] ${timestamp} ${message}`);
}

export function logWarn(message: string): void {
	const timestamp = new Date().toISOString();
	getOutputChannel().appendLine(`[WARN] ${timestamp} ${message}`);
}

export function logError(message: string, error?: Error): void {
	const timestamp = new Date().toISOString();
	const errorMsg = error ? `${message}: ${error.message}` : message;
	getOutputChannel().appendLine(`[ERROR] ${timestamp} ${errorMsg}`);
}

export function logDebug(message: string): void {
	const config = vscode.workspace.getConfiguration("chartProfiles");
	const debugEnabled = config.get<boolean>("debug", false);
	if (debugEnabled) {
		const timestamp = new Date().toISOString();
		getOutputChannel().appendLine(`[DEBUG] ${timestamp} ${message}`);
	}
}

export function disposeOutputChannel(): void {
	if (outputChannel) {
		outputChannel.dispose();
		outputChannel = undefined;
	}
}
