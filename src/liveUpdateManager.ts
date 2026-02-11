import * as vscode from "vscode";
export type UpdateCallback = () => void | Promise<void>;
export class LiveUpdateManager {
	private fileWatcher?: vscode.FileSystemWatcher;
	private updateCallback?: UpdateCallback;
	private debounceTimer?: NodeJS.Timeout;
	private readonly debounceDelay = 1000; // 1 second
	private isEnabled = false;
	private chartPath?: string;

	enable(chartPath: string, callback: UpdateCallback): void {
		if (this.isEnabled && this.chartPath === chartPath) {
			return;
		}

		this.disable();

		this.chartPath = chartPath;
		this.updateCallback = callback;
		this.isEnabled = true;

		// Watch for changes in values files and templates
		const valuesPattern = new vscode.RelativePattern(
			chartPath,
			"{values*.yaml,values*.yml,templates/**/*.yaml,templates/**/*.yml}"
		);

		this.fileWatcher = vscode.workspace.createFileSystemWatcher(valuesPattern);

		this.fileWatcher.onDidCreate(() => this.scheduleUpdate());
		this.fileWatcher.onDidChange(() => this.scheduleUpdate());
		this.fileWatcher.onDidDelete(() => this.scheduleUpdate());

		console.log(`Live updates enabled for chart: ${chartPath}`);
	}

	disable(): void {
		if (this.fileWatcher) {
			this.fileWatcher.dispose();
			this.fileWatcher = undefined;
		}

		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = undefined;
		}

		this.updateCallback = undefined;
		this.chartPath = undefined;
		this.isEnabled = false;

		console.log("Live updates disabled");
	}

	private scheduleUpdate(): void {
		if (!this.isEnabled || !this.updateCallback) {
			return;
		}

		// Clear existing timer
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
		}

		// Schedule new update
		this.debounceTimer = setTimeout(async () => {
			if (this.updateCallback) {
				console.log("Triggering live update...");
				try {
					await this.updateCallback();
				} catch (error) {
					console.error("Error during live update:", error);
					const errorMessage = error instanceof Error ? error.message : String(error);
					vscode.window.showErrorMessage(`Live update failed: ${errorMessage}`);
				}
			}
			this.debounceTimer = undefined;
		}, this.debounceDelay);
	}
}
