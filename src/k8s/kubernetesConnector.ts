import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type * as vscode from "vscode";
import { type CliCommandOptions, runCommand } from "../utils/cliRunner";
import { validateCliIdentifier } from "../utils/cliValidation";
import { TIMEOUT } from "../utils/constants";
import { parseYamlAsUnknown, type UnknownRecord } from "../utils/yaml";

export interface ResourceRuntimeState {
	kind: string;
	name: string;
	namespace: string;
	exists: boolean;
	status: ResourceStatus;
	lastUpdated?: string;
	age?: string;
	readyReplicas?: number;
	totalReplicas?: number;
	conditions?: ResourceCondition[];
	events?: KubernetesEvent[];
	endpoints?: EndpointStatus;
	errorMessage?: string;
	[key: string]: unknown;
}

export interface ResourceStatus {
	state: string;
	message: string;
	reason?: string;
}

export interface ResourceCondition {
	type: string;
	status: string;
	reason?: string;
	message?: string;
	lastTransitionTime?: string;
}

export interface KubernetesEvent {
	type: string;
	reason: string;
	message: string;
	count?: number;
	lastTimestamp?: string;
}

export interface PodStatus {
	phase: string;
	ready: string;
	restarts: number;
	age: string;
	ip?: string;
	node?: string;
	containers?: ContainerStatus[];
}

export interface ContainerStatus {
	name: string;
	ready: boolean;
	restartCount: number;
	reason?: string;
}

export interface EndpointStatus {
	ready: number;
	notReady: number;
	addresses: string[];
}

export interface ClusterInfo {
	connected: boolean;
	server?: string;
	context?: string;
	namespace?: string;
	clientVersion?: string;
	serverVersion?: string;
	errorMessage?: string;
}

export interface HelmRelease {
	name: string;
	namespace: string;
	revision: string;
	status: string;
	chart: string;
	appVersion?: string;
	updated?: string;
}

interface K8sResource {
	apiVersion: string;
	kind: string;
	metadata?: {
		name?: string;
		namespace?: string;
		annotations?: Record<string, string>;
		labels?: Record<string, string>;
		creationTimestamp?: string;
	};
	[key: string]: unknown;
}

export class KubernetesConnector implements vscode.Disposable {
	private kubeconfig?: string;
	private context?: string;
	private namespace: string;
	private validationTempFile: string | null = null;

	constructor(options?: {
		kubeconfig?: string;
		context?: string;
		namespace?: string;
	}) {
		this.kubeconfig = options?.kubeconfig;
		this.context = options?.context;
		this.namespace = options?.namespace || "default";
	}

	dispose(): void {
		if (this.validationTempFile) {
			fs.unlink(this.validationTempFile).catch(() => {});
			this.validationTempFile = null;
		}
	}

	async getHelmReleases(namespace?: string): Promise<HelmRelease[]> {
		try {
			const ns = namespace || this.namespace;
			const { stdout } = await this.runKubectl(["get", "releases", "-o", "json"], ns, {
				timeout: TIMEOUT.DEFAULT,
			});
			const data = JSON.parse(stdout);
			return (data.items || []).map(
				(item: {
					name?: string;
					namespace?: string;
					version?: string;
					status?: string;
					chart?: string;
					app_version?: string;
					info?: { last_deployed?: string };
				}) => ({
					name: item.name || "",
					namespace: item.namespace || ns,
					revision: item.version || "1",
					status: item.status || "Unknown",
					chart: item.chart || "",
					appVersion: item.app_version,
					updated: item.info?.last_deployed,
				})
			);
		} catch {
			return [];
		}
	}

	async getResourceState(kind: string, name: string, namespace?: string): Promise<ResourceRuntimeState> {
		return this.getResourceRuntimeState(kind, name, namespace);
	}

	async isKubectlAvailable(): Promise<boolean> {
		try {
			await this.runKubectl(["version", "--client", "-o", "json"]);
			return true;
		} catch (error: unknown) {
			return !isKubectlNotFound(error);
		}
	}

	async getClusterInfo(): Promise<ClusterInfo> {
		try {
			const { stdout } = await this.runKubectl(["cluster-info", "--request-timeout=5s"]);
			const versionResult = await this.runKubectl(["version", "-o", "json"]);

			let version: string | undefined;
			try {
				const versionJson = JSON.parse(versionResult.stdout) as { clientVersion?: { gitVersion?: string } };
				version = versionJson.clientVersion?.gitVersion;
			} catch {
				// Ignore version parse errors
			}

			const serverMatch = stdout.match(/https?:\/\/[^\s]+/);
			return {
				connected: true,
				server: serverMatch ? serverMatch[0] : "unknown",
				context: this.context,
				namespace: this.namespace,
				clientVersion: version,
			};
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			return {
				connected: false,
				errorMessage,
			};
		}
	}

	private async runKubectl(
		args: string[],
		namespace?: string,
		options: CliCommandOptions = {}
	): Promise<{ stdout: string; stderr: string }> {
		const nsFlag = namespace ? ["--namespace", namespace] : [];
		const contextFlag = this.context ? ["--context", this.context] : [];
		const kubeconfigFlag = this.kubeconfig ? ["--kubeconfig", this.kubeconfig] : [];

		return runCommand("kubectl", [...kubeconfigFlag, ...contextFlag, ...nsFlag, ...args], {
			...options,
			timeout: options.timeout ?? TIMEOUT.DEFAULT,
		});
	}

	async getResourceRuntimeState(kind: string, name: string, namespace?: string): Promise<ResourceRuntimeState> {
		const ns = namespace || this.namespace;
		const state: ResourceRuntimeState = {
			kind,
			name,
			namespace: ns,
			exists: false,
			status: { state: "Unknown", message: "Not checked" },
		};

		try {
			const safeKind = validateCliIdentifier(kind, "resource kind");
			const safeName = validateCliIdentifier(name, "resource name");
			const { stdout } = await this.runKubectl(["get", safeKind, safeName, "-o", "yaml"], ns, {
				timeout: TIMEOUT.DEFAULT,
			});
			const resource = parseYamlAsUnknown(stdout);

			if (resource) {
				const meta = (resource.metadata as Record<string, unknown>) || {};
				state.exists = true;
				state.lastUpdated = meta.creationTimestamp as string | undefined;

				if (meta.creationTimestamp) {
					state.age = this.calculateAge(meta.creationTimestamp as string);
				}

				switch (kind.toLowerCase()) {
					case "deployment":
					case "statefulset":
					case "daemonset":
					case "replicaset":
						this.parseWorkloadStatus(resource, state);
						break;
					case "service":
						await this.parseServiceStatus(name, ns, state);
						break;
					case "ingress":
						this.parseIngressStatus(resource, state);
						break;
					case "pod":
						this.parsePodStatus(resource, state);
						break;
					case "configmap":
					case "secret":
						state.status = { state: "Healthy", message: "Configuration resource" };
						break;
					case "persistentvolumeclaim":
						this.parsePVCStatus(resource, state);
						break;
					default:
						state.status = { state: "Healthy", message: "Resource exists" };
				}

				state.events = await this.getResourceEvents(kind, name, ns);
			}
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			if (errorMessage.includes("NotFound") || errorMessage.includes("not found")) {
				state.exists = false;
				state.status = { state: "NotFound", message: "Resource does not exist in cluster" };
			} else {
				state.status = { state: "Unknown", message: errorMessage };
				state.errorMessage = errorMessage;
			}
		}

		return state;
	}

	private parseWorkloadStatus(resource: UnknownRecord, state: ResourceRuntimeState): void {
		const status = (resource.status as UnknownRecord) || {};
		const spec = (resource.spec as UnknownRecord) || {};

		state.readyReplicas = (status.readyReplicas as number) || 0;
		state.totalReplicas = (spec.replicas as number) || (status.replicas as number) || 0;

		const conditions = (status.conditions as Array<UnknownRecord>) || [];
		state.conditions = conditions.map((c) => ({
			type: c.type as string,
			status: c.status as string,
			reason: c.reason as string | undefined,
			message: c.message as string | undefined,
			lastTransitionTime: c.lastTransitionTime as string | undefined,
		}));

		const progressing = conditions.find((c) => c.type === "Progressing");
		const available = conditions.find((c) => c.type === "Available");
		const replicaFailure = conditions.find((c) => c.type === "ReplicaFailure");

		const readyReplicas = state.readyReplicas ?? 0;
		const totalReplicas = state.totalReplicas ?? 0;

		if (replicaFailure?.status === "True") {
			state.status = {
				state: "Critical",
				message: (replicaFailure.message as string) || "Replica failure",
				reason: replicaFailure.reason as string | undefined,
			};
		} else if (readyReplicas < totalReplicas) {
			state.status = { state: "Warning", message: `${readyReplicas}/${totalReplicas} replicas ready` };
		} else if (available?.status === "True") {
			state.status = { state: "Healthy", message: `${readyReplicas}/${totalReplicas} replicas ready` };
		} else if (progressing?.status === "True") {
			state.status = {
				state: "Warning",
				message: "Deployment in progress",
				reason: progressing.reason as string | undefined,
			};
		} else {
			state.status = { state: "Unknown", message: (progressing?.message as string) || "Status unknown" };
		}
	}

	private async parseServiceStatus(name: string, namespace: string, state: ResourceRuntimeState): Promise<void> {
		try {
			const safeName = validateCliIdentifier(name, "service name");
			const { stdout } = await this.runKubectl(["get", "endpoints", safeName, "-o", "yaml"], namespace, {
				timeout: 5000,
			});
			const endpoints = parseYamlAsUnknown(stdout);

			if (!endpoints) {
				return;
			}

			const ep = endpoints as {
				subsets?: Array<{ addresses?: Array<{ ip?: string }>; notReadyAddresses?: Array<{ ip?: string }> }>;
			};
			const subsets = ep.subsets || [];
			const readyAddresses: string[] = [];
			const notReadyAddresses: string[] = [];

			for (const subset of subsets) {
				const addresses = subset.addresses || [];
				const notReady = subset.notReadyAddresses || [];
				readyAddresses.push(...addresses.map((a) => a.ip).filter((ip): ip is string => !!ip));
				notReadyAddresses.push(...notReady.map((a) => a.ip).filter((ip): ip is string => !!ip));
			}

			state.endpoints = {
				ready: readyAddresses.length,
				notReady: notReadyAddresses.length,
				addresses: [...readyAddresses, ...notReadyAddresses],
			};
			state.status =
				readyAddresses.length === 0
					? { state: "Warning", message: "No endpoints ready" }
					: { state: "Healthy", message: `${readyAddresses.length} endpoints ready` };
		} catch {
			state.status = { state: "Warning", message: "Could not retrieve endpoints" };
		}
	}

	private parseIngressStatus(resource: UnknownRecord, state: ResourceRuntimeState): void {
		const status = (resource.status as UnknownRecord) || {};
		const alb = status.loadBalancer as { ingress?: Array<{ hostname?: string; ip?: string }> };
		if (alb?.ingress?.[0]) {
			state.status = {
				state: "Healthy",
				message: `Ingress configured: ${alb.ingress[0].hostname || alb.ingress[0].ip || "unknown"}`,
			};
		} else {
			state.status = { state: "Pending", message: "No ingress address assigned" };
		}
	}

	private parsePodStatus(resource: UnknownRecord, state: ResourceRuntimeState): void {
		const status = (resource.status as UnknownRecord) || {};
		const phase = (status.phase as string) || "Unknown";
		const containerStatuses = (status.containerStatuses as Array<UnknownRecord>) || [];
		const readyCount = containerStatuses.filter((c) => c.ready === true).length;
		const totalCount = containerStatuses.length || 1;
		state.status = {
			state: phase === "Running" ? "Healthy" : phase,
			message: `${readyCount}/${totalCount} containers ready`,
		};
	}

	private parsePVCStatus(resource: UnknownRecord, state: ResourceRuntimeState): void {
		const status = (resource.status as UnknownRecord) || {};
		const pvcPhase = (status.phase as string) || "Unknown";
		state.status = { state: pvcPhase === "Bound" ? "Healthy" : pvcPhase, message: `Status: ${pvcPhase}` };
	}

	private calculateAge(creationTimestamp: string): string {
		const created = new Date(creationTimestamp);
		const now = new Date();
		const diffMs = now.getTime() - created.getTime();
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMins / 60);
		const diffDays = Math.floor(diffHours / 24);

		if (diffDays > 0) return `${diffDays}d`;
		if (diffHours > 0) return `${diffHours}h`;
		if (diffMins > 0) return `${diffMins}m`;
		return "just now";
	}

	async getResourceEvents(kind: string, name: string, namespace?: string): Promise<KubernetesEvent[]> {
		const ns = namespace || this.namespace;
		try {
			const safeKind = validateCliIdentifier(kind, "resource kind");
			const safeName = validateCliIdentifier(name, "resource name");
			const fieldSelector = `involvedObject.name=${safeName},involvedObject.kind=${safeKind}`;
			const { stdout } = await this.runKubectl(
				["get", "events", "--field-selector", fieldSelector, "-o", "json"],
				ns,
				{ timeout: 5000 }
			);
			const eventsData = JSON.parse(stdout);
			return (eventsData.items || []).map(
				(item: {
					type?: string;
					reason?: string;
					message?: string;
					count?: number;
					lastTimestamp?: string;
				}) => ({
					type: item.type || "Normal",
					reason: item.reason || "",
					message: item.message || "",
					count: item.count,
					lastTimestamp: item.lastTimestamp,
				})
			);
		} catch {
			return [];
		}
	}

	async validateResource(
		resourceYaml: string,
		namespace?: string
	): Promise<{ valid: boolean; errors: string[]; warnings: string[] }> {
		const ns = namespace || this.namespace;
		const errors: string[] = [];
		const warnings: string[] = [];

		try {
			if (!this.validationTempFile) {
				this.validationTempFile = path.join(os.tmpdir(), `k8s-validate-${process.pid}.yaml`);
			}
			await fs.writeFile(this.validationTempFile, resourceYaml);

			try {
				await this.runKubectl(
					["apply", "--dry-run=client", "--validate=true", "-f", this.validationTempFile],
					ns,
					{ timeout: 10000 }
				);
				try {
					await this.runKubectl(
						["apply", "--dry-run=server", "--validate=true", "-f", this.validationTempFile],
						ns,
						{ timeout: 15000 }
					);
				} catch (serverError: unknown) {
					const errorMessage = serverError instanceof Error ? serverError.message : String(serverError);
					warnings.push(`Server validation: ${errorMessage}`);
				}
			} finally {
				await fs.writeFile(this.validationTempFile, "").catch(() => {});
			}

			return { valid: errors.length === 0, errors, warnings };
		} catch (error: unknown) {
			const stderr = (error as { stderr?: string }).stderr || "";
			const stdout = (error as { stdout?: string }).stdout || "";
			const errorMessage = error instanceof Error ? error.message : String(error);
			const combinedOutput = [stderr, stdout, errorMessage].join("\n");
			const lines = combinedOutput.split("\n");

			for (const line of lines) {
				const trimmed = line.trim().toLowerCase();
				if (trimmed && (trimmed.includes("error from server") || trimmed.startsWith("error:"))) {
					if (!errors.includes(trimmed)) {
						errors.push(trimmed);
					}
				}
			}

			if (errors.length === 0) {
				errors.push(errorMessage);
			}

			return { valid: false, errors, warnings };
		}
	}

	async detectBreakingChanges(
		oldResource: string,
		newResource: string
	): Promise<{ hasBreakingChanges: boolean; changes: string[] }> {
		const changes: string[] = [];
		let hasBreakingChanges = false;

		try {
			const oldYaml = parseYamlAsUnknown(oldResource);
			const newYaml = parseYamlAsUnknown(newResource);

			const immutableFields = ["spec.clusterIP", "spec.volumeName", "spec.accessModes", "spec.storageClassName"];

			const oldSpec = (oldYaml?.spec as UnknownRecord) || {};
			const newSpec = (newYaml?.spec as UnknownRecord) || {};

			for (const field of immutableFields) {
				const oldValue = this.getNestedValue(oldSpec, field);
				const newValue = this.getNestedValue(newSpec, field);
				if (oldValue !== undefined && newValue !== undefined && oldValue !== newValue) {
					changes.push(`Immutable field changed: ${field} (${oldValue} → ${newValue})`);
					hasBreakingChanges = true;
				}
			}

			const oldSpecSel = oldSpec.selector as { matchLabels?: Record<string, string> } | undefined;
			const newSpecSel = newSpec.selector as { matchLabels?: Record<string, string> } | undefined;
			if (oldSpecSel?.matchLabels && newSpecSel?.matchLabels) {
				for (const [key, value] of Object.entries(oldSpecSel.matchLabels)) {
					if (!newSpecSel.matchLabels?.[key]) {
						changes.push(`Selector label removed: ${key}=${value}`);
						hasBreakingChanges = true;
					}
				}
			}
		} catch (error) {
			console.warn("Error detecting breaking changes:", error);
		}

		return { hasBreakingChanges, changes };
	}

	private getNestedValue(obj: UnknownRecord, path: string): unknown {
		const parts = path.split(".");
		let current: unknown = obj;
		for (const part of parts) {
			if (current && typeof current === "object") {
				current = (current as Record<string, unknown>)[part];
			} else {
				return undefined;
			}
		}
		return current;
	}

	async updateDependencies(chartPath: string): Promise<{ success: boolean; output: string }> {
		try {
			const { stdout, stderr } = await runCommand("helm", ["dependency", "update", chartPath], {
				timeout: 120000,
			});
			return { success: true, output: stdout + stderr };
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			return { success: false, output: errorMessage };
		}
	}
}

export function isKubectlNotFound(error: unknown): boolean {
	if (error instanceof Error) {
		return (
			error.message.includes("ENOENT") ||
			error.message.includes("not found") ||
			error.message.includes("not found or not executable")
		);
	}
	return false;
}

let connectorInstance: KubernetesConnector | null = null;

export function getKubernetesConnector(options?: {
	kubeconfig?: string;
	context?: string;
	namespace?: string;
}): KubernetesConnector {
	if (!connectorInstance) {
		connectorInstance = new KubernetesConnector(options);
	}
	return connectorInstance;
}
