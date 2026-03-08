import * as vscode from "vscode";
import {
	KubernetesConnector,
	type ResourceRuntimeState,
	type ClusterInfo,
	type HelmRelease,
} from "../k8s/kubernetesConnector";
import { renderHelmTemplate } from "../k8s/helmRenderer";

/**
 * Runtime state for all resources in a chart
 */
export interface ChartRuntimeState {
	clusterInfo: ClusterInfo;
	resources: Map<string, ResourceRuntimeState>;
	helmReleases: HelmRelease[];
	lastUpdated: string;
	isConnected: boolean;
	warnings: string[];
	errors: string[];
}

/**
 * Health summary for the chart
 */
export interface HealthSummary {
	totalResources: number;
	healthy: number;
	warning: number;
	critical: number;
	notFound: number;
	unknown: number;
	overallStatus: "healthy" | "warning" | "critical" | "disconnected";
}

/**
 * Runtime state manager for tracking cluster state
 */
export class RuntimeStateManager {
	private connector: KubernetesConnector;
	private stateCache: Map<string, ChartRuntimeState> = new Map();
	private refreshInterval: NodeJS.Timeout | null = null;
	private onDidChangeState: vscode.EventEmitter<string> = new vscode.EventEmitter<string>();

	constructor() {
		this.connector = new KubernetesConnector();
	}

	/**
	 * Escape shell argument to prevent command injection
	 */
	private shellEscape(value: string): string {
		return `'${value.replace(/'/g, "'\\''")}'`;
	}

	/**
	 * Event fired when state changes
	 */
	readonly onStateChange = this.onDidChangeState.event;

	/**
	 * Get runtime state for a chart
	 */
	async getChartRuntimeState(chartPath: string, environment: string, namespace?: string): Promise<ChartRuntimeState> {
		const cacheKey = `${chartPath}:${environment}`;

		// Check cache (5 second TTL)
		const cached = this.stateCache.get(cacheKey);
		if (cached) {
			const cacheAge = Date.now() - new Date(cached.lastUpdated).getTime();
			if (cacheAge < 5000) {
				return cached;
			}
		}

		const state = await this.fetchChartRuntimeState(chartPath, environment, namespace);
		this.stateCache.set(cacheKey, state);
		return state;
	}

	/**
	 * Fetch runtime state from cluster
	 */
	private async fetchChartRuntimeState(
		chartPath: string,
		environment: string,
		namespace?: string
	): Promise<ChartRuntimeState> {
		const warnings: string[] = [];
		const errors: string[] = [];
		const resources = new Map<string, ResourceRuntimeState>();

		// Get cluster info
		const clusterInfo = await this.connector.getClusterInfo();

		if (!clusterInfo.connected) {
			return {
				clusterInfo,
				resources,
				helmReleases: [],
				lastUpdated: new Date().toISOString(),
				isConnected: false,
				warnings: ["Not connected to Kubernetes cluster"],
				errors: [clusterInfo.errorMessage || "Connection failed"],
			};
		}

		// Get Helm releases
		const helmReleases = await this.connector.getHelmReleases(namespace);

		// Render chart to get expected resources
		try {
			const renderedResources = await renderHelmTemplate(chartPath, environment);

			// Get runtime state for each resource
			for (const resource of renderedResources) {
				if (resource.kind === "Error" || resource.kind === "Notice") {
					continue;
				}

				const resourceNamespace = resource.namespace || namespace || clusterInfo.namespace || "default";

				try {
					const runtimeState = await this.connector.getResourceState(
						resource.kind,
						resource.name,
						resourceNamespace
					);
					resources.set(`${resource.kind}/${resource.name}`, runtimeState);
				} catch (error: unknown) {
					const errorMessage = error instanceof Error ? error.message : String(error);
					warnings.push(`Could not get state for ${resource.kind}/${resource.name}: ${errorMessage}`);
				}
			}
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			errors.push(`Failed to render chart: ${errorMessage}`);
		}

		return {
			clusterInfo,
			resources,
			helmReleases,
			lastUpdated: new Date().toISOString(),
			isConnected: true,
			warnings,
			errors,
		};
	}

	/**
	 * Get health summary from runtime state
	 */
	getHealthSummary(state: ChartRuntimeState): HealthSummary {
		const summary: HealthSummary = {
			totalResources: state.resources.size,
			healthy: 0,
			warning: 0,
			critical: 0,
			notFound: 0,
			unknown: 0,
			overallStatus: "healthy",
		};

		for (const resourceState of state.resources.values()) {
			switch (resourceState.status.state) {
				case "Healthy":
					summary.healthy++;
					break;
				case "Warning":
					summary.warning++;
					break;
				case "Critical":
					summary.critical++;
					break;
				case "NotFound":
					summary.notFound++;
					break;
				default:
					summary.unknown++;
			}
		}

		// Determine overall status
		if (!state.isConnected) {
			summary.overallStatus = "disconnected";
		} else if (summary.critical > 0) {
			summary.overallStatus = "critical";
		} else if (summary.warning > 0 || summary.notFound > 0) {
			summary.overallStatus = "warning";
		}

		return summary;
	}

	/**
	 * Start auto-refresh
	 */
	startAutoRefresh(intervalMs = 30000): void {
		if (this.refreshInterval) {
			clearInterval(this.refreshInterval);
		}

		this.refreshInterval = setInterval(() => {
			// Clear cache to force refresh on next request
			this.stateCache.clear();
			this.onDidChangeState.fire("refresh");
		}, intervalMs);
	}

	/**
	 * Stop auto-refresh
	 */
	stopAutoRefresh(): void {
		if (this.refreshInterval) {
			clearInterval(this.refreshInterval);
			this.refreshInterval = null;
		}
	}

	/**
	 * Clear cache
	 */
	clearCache(): void {
		this.stateCache.clear();
	}

	/**
	 * Get resource events
	 */
	async getResourceEvents(
		kind: string,
		name: string,
		namespace?: string
	): Promise<Array<{ lastSeen: string; type: string; reason: string; message: string }>> {
		const state = await this.connector.getResourceState(kind, name, namespace);
		return (state.events || []).map((e) => ({
			lastSeen: e.lastSeen,
			type: e.type,
			reason: e.reason,
			message: e.message,
		}));
	}

	/**
	 * Get pod logs
	 */
	async getPodLogs(podName: string, namespace?: string, container?: string, tailLines = 100): Promise<string> {
		const ns = namespace || "default";
		try {
			const { exec } = await import("node:child_process");
			const { promisify } = await import("node:util");
			const execAsync = promisify(exec);

			let cmd = `kubectl logs ${this.shellEscape(podName)} -n ${this.shellEscape(ns)} --tail=${tailLines}`;
			if (container) {
				cmd += ` -c ${this.shellEscape(container)}`;
			}

			const { stdout } = await execAsync(cmd, { timeout: 10000 });
			return stdout;
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			return `Error fetching logs: ${errorMessage}`;
		}
	}

	/**
	 * Get resource YAML from cluster
	 */
	async getResourceYaml(kind: string, name: string, namespace?: string): Promise<string> {
		const ns = namespace || "default";
		try {
			const { exec } = await import("node:child_process");
			const { promisify } = await import("node:util");
			const execAsync = promisify(exec);

			const cmd = `kubectl get ${this.shellEscape(kind)} ${this.shellEscape(name)} -n ${this.shellEscape(ns)} -o yaml`;
			const { stdout } = await execAsync(cmd, { timeout: 10000 });
			return stdout;
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			throw new Error(`Error fetching resource: ${errorMessage}`);
		}
	}

	/**
	 * Compare deployed vs rendered manifest
	 */
	async compareDeployedVsRendered(
		chartPath: string,
		environment: string,
		kind: string,
		name: string,
		namespace?: string
	): Promise<{
		deployed: string;
		rendered: string;
		diff: string[];
		isInSync: boolean;
	}> {
		// Get deployed resource
		const deployed = await this.getResourceYaml(kind, name, namespace);

		// Get rendered resource
		const resources = await renderHelmTemplate(chartPath, environment);
		const resource = resources.find((r) => r.kind === kind && r.name === name);

		const rendered = resource?.yaml || "";

		// Simple diff
		const diff = this.generateDiff(deployed, rendered);

		return {
			deployed,
			rendered,
			diff,
			isInSync: diff.length === 0,
		};
	}

	/**
	 * Generate simple diff
	 */
	private generateDiff(oldStr: string, newStr: string): string[] {
		const oldLines = oldStr.split("\n");
		const newLines = newStr.split("\n");
		const diff: string[] = [];

		const maxLines = Math.max(oldLines.length, newLines.length);
		for (let i = 0; i < maxLines; i++) {
			const oldLine = oldLines[i];
			const newLine = newLines[i];

			if (oldLine !== newLine) {
				if (oldLine !== undefined) {
					diff.push(`- ${oldLine}`);
				}
				if (newLine !== undefined) {
					diff.push(`+ ${newLine}`);
				}
			}
		}

		return diff;
	}

	/**
	 * Dispose
	 */
	dispose(): void {
		this.stopAutoRefresh();
		this.onDidChangeState.dispose();
	}
}

// Singleton instance
let managerInstance: RuntimeStateManager | null = null;

export function getRuntimeStateManager(): RuntimeStateManager {
	if (!managerInstance) {
		managerInstance = new RuntimeStateManager();
	}
	return managerInstance;
}
