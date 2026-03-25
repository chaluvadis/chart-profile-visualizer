import * as yaml from "js-yaml";
import { TIMEOUT } from "../utils/constants";
import { validateCliIdentifier } from "../utils/cliValidation";
import { runCommand, type CliCommandOptions } from "../utils/cliRunner";

/**
 * Represents the runtime state of a Kubernetes resource
 */
export interface ResourceRuntimeState {
	kind: string;
	name: string;
	namespace: string;
	exists: boolean;
	status: ResourceStatus;
	conditions?: ResourceCondition[];
	events?: KubernetesEvent[];
	pods?: PodStatus[];
	endpoints?: EndpointStatus;
	readyReplicas?: number;
	totalReplicas?: number;
	age?: string;
	lastUpdated?: string;
	errorMessage?: string;
}

export interface ResourceStatus {
	phase?: string;
	state: "Healthy" | "Warning" | "Critical" | "Unknown" | "NotFound";
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
	lastSeen: string;
	type: string;
	reason: string;
	object: string;
	message: string;
	count: number;
}

export interface PodStatus {
	name: string;
	phase: string;
	ready: boolean;
	restartCount: number;
	age: string;
	status: string;
	containers?: ContainerStatus[];
}

export interface ContainerStatus {
	name: string;
	image: string;
	ready: boolean;
	restartCount: number;
	state: string;
	lastState?: string;
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
	version?: string;
	errorMessage?: string;
}

export interface HelmRelease {
	name: string;
	namespace: string;
	revision: number;
	updated: string;
	status: string;
	chart: string;
	appVersion: string;
}

/**
 * Parsed Kubernetes resource interface
 */
interface K8sResource {
	apiVersion?: string;
	kind?: string;
	metadata?: {
		name?: string;
		namespace?: string;
		creationTimestamp?: string;
		labels?: Record<string, string>;
		annotations?: Record<string, string>;
		ownerReferences?: Array<{
			kind: string;
			name: string;
			apiVersion: string;
		}>;
		[key: string]: unknown;
	};
	spec?: Record<string, unknown>;
	status?: Record<string, unknown>;
	[key: string]: unknown;
}

/**
 * Kubernetes cluster connector for runtime state integration
 */
export class KubernetesConnector {
	private kubeconfig?: string;
	private context?: string;
	private namespace: string;

	constructor(options?: {
		kubeconfig?: string;
		context?: string;
		namespace?: string;
	}) {
		this.kubeconfig = options?.kubeconfig;
		this.context = options?.context;
		this.namespace = options?.namespace || "default";
	}

	/**
	 * Check if kubectl is available.
	 * Returns false only when the kubectl binary cannot be found (ENOENT / not-in-PATH).
	 * Any other error (e.g. flag not supported, transient cluster error) is treated as
	 * "kubectl is present" to avoid false-negative warnings.
	 */
	async isKubectlAvailable(): Promise<boolean> {
		try {
			await this.runKubectl(["version", "--client", "-o", "json"]);
			return true;
		} catch (error: unknown) {
			// Only treat kubectl as unavailable when the binary itself is missing
			return !isKubectlNotFound(error);
		}
	}

	/**
	 * Get cluster connection info
	 */
	async getClusterInfo(): Promise<ClusterInfo> {
		try {
			const { stdout } = await this.runKubectl(["cluster-info", "--request-timeout=5s"]);
			const versionResult = await this.runKubectl(["version", "-o", "json"]);

			// Parse client version from JSON output (reliable across kubectl versions)
			let version: string | undefined;
			try {
				const versionJson = JSON.parse(versionResult.stdout) as {
					clientVersion?: { gitVersion?: string };
				};
				version = versionJson?.clientVersion?.gitVersion;
			} catch {
				// version will remain undefined — not a hard failure
			}

			// Parse server URL
			const serverMatch = stdout.match(/is running at (https?:\/\/[^\s]+)/);
			const contextResult = await this.runKubectl(["config", "current-context"]);
			const nsResult = await this.runKubectl([
				"config",
				"view",
				"--minify",
				"--output",
				"jsonpath={..namespace}",
			]);

			return {
				connected: true,
				server: serverMatch ? serverMatch[1] : undefined,
				context: contextResult.stdout.trim() || undefined,
				namespace: nsResult.stdout.trim() || "default",
				version,
			};
		} catch (error: any) {
			return {
				connected: false,
				errorMessage: error.message || "Failed to connect to cluster",
			};
		}
	}

	/**
	 * Build kubectl args with optional kubeconfig/context/namespace flags
	 */
	private buildKubectlArgs(baseArgs: string[], namespace?: string): string[] {
		const args: string[] = [];
		if (this.kubeconfig) {
			args.push("--kubeconfig", this.kubeconfig);
		}
		if (this.context) {
			args.push("--context", this.context);
		}
		if (namespace) {
			args.push("-n", namespace);
		}
		args.push(...baseArgs);
		return args;
	}

	private async runKubectl(
		baseArgs: string[],
		namespace?: string,
		options?: CliCommandOptions
	): Promise<{ stdout: string; stderr: string }> {
		const args = this.buildKubectlArgs(baseArgs, namespace);
		return runCommand("kubectl", args, options);
	}

	private async runHelm(args: string[], options?: CliCommandOptions): Promise<{ stdout: string; stderr: string }> {
		return runCommand("helm", args, options);
	}

	/**
	 * Get runtime state for a specific resource
	 */
	async getResourceState(kind: string, name: string, namespace?: string): Promise<ResourceRuntimeState> {
		const ns = namespace || this.namespace;
		const state: ResourceRuntimeState = {
			kind,
			name,
			namespace: ns,
			exists: false,
			status: { state: "Unknown", message: "Not checked" },
		};

		try {
			// Get resource
			const safeKind = validateCliIdentifier(kind, "resource kind");
			const safeName = validateCliIdentifier(name, "resource name");
			const { stdout } = await this.runKubectl(["get", safeKind, safeName, "-o", "yaml"], ns, {
				timeout: TIMEOUT.DEFAULT,
			});
			const resource = yaml.load(stdout) as any;

			state.exists = true;
			state.lastUpdated = resource.metadata?.creationTimestamp;

			// Calculate age
			if (resource.metadata?.creationTimestamp) {
				state.age = this.calculateAge(resource.metadata.creationTimestamp);
			}

			// Parse status based on resource kind
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
					state.status = {
						state: "Healthy",
						message: "Configuration resource",
					};
					break;
				case "persistentvolumeclaim":
					this.parsePVCStatus(resource, state);
					break;
				default:
					state.status = { state: "Healthy", message: "Resource exists" };
			}

			// Get events for this resource
			state.events = await this.getResourceEvents(kind, name, ns);
		} catch (error: any) {
			if (error.message?.includes("NotFound") || error.message?.includes("not found")) {
				state.exists = false;
				state.status = {
					state: "NotFound",
					message: "Resource does not exist in cluster",
				};
			} else {
				state.status = { state: "Unknown", message: error.message };
				state.errorMessage = error.message;
			}
		}

		return state;
	}

	/**
	 * Parse workload (Deployment, StatefulSet, etc.) status
	 */
	private parseWorkloadStatus(resource: any, state: ResourceRuntimeState): void {
		const status = resource.status || {};
		const spec = resource.spec || {};

		state.readyReplicas = status.readyReplicas || 0;
		state.totalReplicas = spec.replicas || status.replicas || 0;

		const conditions = status.conditions || [];
		state.conditions = conditions.map((c: any) => ({
			type: c.type,
			status: c.status,
			reason: c.reason,
			message: c.message,
			lastTransitionTime: c.lastTransitionTime,
		}));

		// Determine health state
		const progressing = conditions.find((c: any) => c.type === "Progressing");
		const available = conditions.find((c: any) => c.type === "Available");
		const replicaFailure = conditions.find((c: any) => c.type === "ReplicaFailure");

		const readyReplicas = state.readyReplicas ?? 0;
		const totalReplicas = state.totalReplicas ?? 0;

		if (replicaFailure?.status === "True") {
			state.status = {
				state: "Critical",
				message: replicaFailure.message || "Replica failure",
				reason: replicaFailure.reason,
			};
		} else if (readyReplicas < totalReplicas) {
			state.status = {
				state: "Warning",
				message: `${readyReplicas}/${totalReplicas} replicas ready`,
			};
		} else if (available?.status === "True") {
			state.status = {
				state: "Healthy",
				message: `${readyReplicas}/${totalReplicas} replicas ready`,
			};
		} else if (progressing?.status === "True") {
			state.status = {
				state: "Warning",
				message: "Deployment in progress",
				reason: progressing.reason,
			};
		} else {
			state.status = {
				state: "Unknown",
				message: progressing?.message || "Status unknown",
			};
		}
	}

	/**
	 * Parse Service status and get endpoints
	 */
	private async parseServiceStatus(name: string, namespace: string, state: ResourceRuntimeState): Promise<void> {
		try {
			const safeName = validateCliIdentifier(name, "service name");
			const { stdout } = await this.runKubectl(["get", "endpoints", safeName, "-o", "yaml"], namespace, {
				timeout: 5000,
			});
			const endpoints = yaml.load(stdout) as any;

			const subsets = endpoints.subsets || [];
			const readyAddresses: string[] = [];
			const notReadyAddresses: string[] = [];

			for (const subset of subsets) {
				const addresses = subset.addresses || [];
				const notReady = subset.notReadyAddresses || [];
				readyAddresses.push(...addresses.map((a: any) => a.ip));
				notReadyAddresses.push(...notReady.map((a: any) => a.ip));
			}

			state.endpoints = {
				ready: readyAddresses.length,
				notReady: notReadyAddresses.length,
				addresses: [...readyAddresses, ...notReadyAddresses],
			};

			if (readyAddresses.length === 0) {
				state.status = {
					state: "Warning",
					message: "No endpoints ready - no pods match selector",
				};
			} else {
				state.status = {
					state: "Healthy",
					message: `${readyAddresses.length} endpoints ready`,
				};
			}
		} catch {
			state.status = {
				state: "Warning",
				message: "Could not retrieve endpoints",
			};
		}
	}

	/**
	 * Parse Ingress status
	 */
	private parseIngressStatus(resource: any, state: ResourceRuntimeState): void {
		const status = resource.status || {};
		const loadBalancer = status.loadBalancer || {};
		const ingress = loadBalancer.ingress || [];

		if (ingress.length > 0) {
			const hosts = ingress.map((i: any) => i.hostname || i.ip).filter(Boolean);
			state.status = {
				state: "Healthy",
				message: `LoadBalancer assigned: ${hosts.join(", ")}`,
			};
		} else {
			state.status = {
				state: "Warning",
				message: "No LoadBalancer assigned yet",
			};
		}
	}

	/**
	 * Parse Pod status
	 */
	private parsePodStatus(resource: any, state: ResourceRuntimeState): void {
		const status = resource.status || {};
		const phase = status.phase;

		state.status = {
			phase,
			state: this.phaseToState(phase),
			message: phase,
		};

		// Parse container statuses
		const containerStatuses = status.containerStatuses || [];
		state.pods = [
			{
				name: resource.metadata.name,
				phase,
				ready: containerStatuses.every((c: any) => c.ready),
				restartCount: containerStatuses.reduce((sum: number, c: any) => sum + (c.restartCount || 0), 0),
				age: state.age || "",
				status: phase,
				containers: containerStatuses.map((c: any) => ({
					name: c.name,
					image: c.image,
					ready: c.ready,
					restartCount: c.restartCount || 0,
					state: Object.keys(c.state || {})[0] || "unknown",
					lastState: Object.keys(c.lastState || {})[0] || undefined,
				})),
			},
		];

		// Check for issues
		const waiting = containerStatuses.find((c: any) => c.state?.waiting);
		if (waiting) {
			state.status = {
				state: "Critical",
				message: `Container ${waiting.name} waiting: ${waiting.state.waiting.reason}`,
				reason: waiting.state.waiting.reason,
			};
		}

		// Add conditions
		state.conditions = (status.conditions || []).map((c: any) => ({
			type: c.type,
			status: c.status,
			reason: c.reason,
			message: c.message,
			lastTransitionTime: c.lastTransitionTime,
		}));
	}

	/**
	 * Parse PVC status
	 */
	private parsePVCStatus(resource: any, state: ResourceRuntimeState): void {
		const status = resource.status || {};
		const phase = status.phase;

		state.status = {
			phase,
			state: phase === "Bound" ? "Healthy" : phase === "Lost" ? "Critical" : "Warning",
			message: `Phase: ${phase}`,
		};

		state.conditions = (status.conditions || []).map((c: any) => ({
			type: c.type,
			status: c.status,
			reason: c.reason,
			message: c.message,
			lastTransitionTime: c.lastTransitionTime,
		}));
	}

	/**
	 * Get events for a resource
	 */
	private async getResourceEvents(kind: string, name: string, namespace: string): Promise<KubernetesEvent[]> {
		try {
			const safeKind = validateCliIdentifier(kind, "resource kind");
			const safeName = validateCliIdentifier(name, "resource name");
			const fieldSelector = `involvedObject.kind=${safeKind},involvedObject.name=${safeName}`;
			const { stdout } = await this.runKubectl(
				["get", "events", "--field-selector", fieldSelector, "-o", "json"],
				namespace,
				{ timeout: 5000 }
			);
			const result = JSON.parse(stdout);

			return (result.items || []).map((item: any) => ({
				lastSeen: item.lastTimestamp || item.eventTime || "",
				type: item.type,
				reason: item.reason,
				object: item.involvedObject?.name || "",
				message: item.message,
				count: item.count || 1,
			}));
		} catch {
			return [];
		}
	}

	/**
	 * Get pods for a workload (Deployment, StatefulSet, etc.)
	 */
	async getWorkloadPods(kind: string, name: string, namespace?: string): Promise<PodStatus[]> {
		const ns = namespace || this.namespace;

		try {
			const safeKind = validateCliIdentifier(kind, "workload kind");
			const safeName = validateCliIdentifier(name, "workload name");

			// Get label selector for the workload
			const { stdout: workloadJson } = await this.runKubectl(["get", safeKind, safeName, "-o", "json"], ns, {
				timeout: 5000,
			});
			const workload = JSON.parse(workloadJson);

			// Parse selector and build label selector string
			const selector = workload?.spec?.selector?.matchLabels;
			if (!selector || typeof selector !== "object") {
				return [];
			}
			const labelSelector = Object.entries(selector)
				.map(([k, v]) => `${k}=${v}`)
				.join(",");

			// Get pods matching selector
			const { stdout: podsJson } = await this.runKubectl(["get", "pods", "-l", labelSelector, "-o", "json"], ns, {
				timeout: 10000,
			});
			const podsResult = JSON.parse(podsJson);

			return (podsResult.items || []).map((pod: any) => {
				const containerStatuses = pod.status?.containerStatuses || [];
				return {
					name: pod.metadata.name,
					phase: pod.status.phase,
					ready: containerStatuses.every((c: any) => c.ready),
					restartCount: containerStatuses.reduce((sum: number, c: any) => sum + (c.restartCount || 0), 0),
					age: this.calculateAge(pod.metadata.creationTimestamp),
					status: this.getPodDisplayStatus(pod.status),
					containers: containerStatuses.map((c: any) => ({
						name: c.name,
						image: c.image,
						ready: c.ready,
						restartCount: c.restartCount || 0,
						state: Object.keys(c.state || {})[0] || "unknown",
						lastState: Object.keys(c.lastState || {})[0] || undefined,
					})),
				};
			});
		} catch {
			return [];
		}
	}

	/**
	 * Get Helm releases in namespace
	 */
	async getHelmReleases(namespace?: string): Promise<HelmRelease[]> {
		const ns = namespace || this.namespace;

		try {
			const safeNs = validateCliIdentifier(ns, "namespace");
			const { stdout } = await this.runHelm(["list", "-n", safeNs, "-o", "json"], {
				timeout: 10000,
			});
			const releases = JSON.parse(stdout);

			return releases.map((r: any) => ({
				name: r.name,
				namespace: r.namespace,
				revision: r.revision,
				updated: r.updated,
				status: r.status,
				chart: r.chart,
				appVersion: r.app_version,
			}));
		} catch {
			return [];
		}
	}

	/**
	 * Get Helm release history
	 */
	async getHelmReleaseHistory(releaseName: string, namespace?: string): Promise<HelmRelease[]> {
		const ns = namespace || this.namespace;

		try {
			const safeNs = validateCliIdentifier(ns, "namespace");
			const safeReleaseName = validateCliIdentifier(releaseName, "release name");
			const { stdout } = await this.runHelm(["history", safeReleaseName, "-n", safeNs, "-o", "json"], {
				timeout: 10000,
			});
			const history = JSON.parse(stdout);

			return history.map((h: any) => ({
				name: h.name,
				namespace: ns,
				revision: h.revision,
				updated: h.updated,
				status: h.status,
				chart: h.chart,
				appVersion: h.app_version || "",
			}));
		} catch {
			return [];
		}
	}

	/**
	 * Get Helm release values (deployed)
	 */
	async getHelmReleaseValues(releaseName: string, namespace?: string): Promise<any> {
		const ns = namespace || this.namespace;

		try {
			const safeNs = validateCliIdentifier(ns, "namespace");
			const safeReleaseName = validateCliIdentifier(releaseName, "release name");
			const { stdout } = await this.runHelm(["get", "values", safeReleaseName, "-n", safeNs, "-o", "yaml"], {
				timeout: 10000,
			});
			return yaml.load(stdout) || {};
		} catch {
			return {};
		}
	}

	/**
	 * Get Helm release manifest (deployed)
	 */
	async getHelmReleaseManifest(releaseName: string, namespace?: string): Promise<string> {
		const ns = namespace || this.namespace;

		try {
			const safeNs = validateCliIdentifier(ns, "namespace");
			const safeReleaseName = validateCliIdentifier(releaseName, "release name");
			const { stdout } = await this.runHelm(["get", "manifest", safeReleaseName, "-n", safeNs], {
				timeout: 10000,
			});
			return stdout;
		} catch {
			return "";
		}
	}

	/**
	 * Convert phase to state
	 */
	private phaseToState(phase: string): ResourceStatus["state"] {
		switch (phase) {
			case "Running":
			case "Succeeded":
				return "Healthy";
			case "Pending":
				return "Warning";
			case "Failed":
			case "Unknown":
				return "Critical";
			default:
				return "Unknown";
		}
	}

	/**
	 * Get display status for pod
	 */
	private getPodDisplayStatus(podStatus: any): string {
		if (podStatus.phase === "Running") {
			const containerStatuses = podStatus.containerStatuses || [];
			const waiting = containerStatuses.find((c: any) => c.state?.waiting);
			if (waiting) {
				return `${waiting.state.waiting.reason}`;
			}
			return "Running";
		}
		return podStatus.phase;
	}

	/**
	 * Calculate age from timestamp
	 */
	private calculateAge(timestamp: string): string {
		const created = new Date(timestamp).getTime();
		const now = Date.now();
		const diffMs = now - created;
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMins / 60);
		const diffDays = Math.floor(diffHours / 24);

		if (diffDays > 0) return `${diffDays}d`;
		if (diffHours > 0) return `${diffHours}h`;
		if (diffMins > 0) return `${diffMins}m`;
		return "just now";
	}

	/**
	 * Validate resource against Kubernetes schema (dry-run)
	 */
	async validateResource(
		resourceYaml: string,
		namespace?: string
	): Promise<{ valid: boolean; errors: string[]; warnings: string[] }> {
		const ns = namespace || this.namespace;
		const errors: string[] = [];
		const warnings: string[] = [];

		try {
			// Use kubectl apply --dry-run=client for schema validation
			// Write to temp file and use -f flag since exec doesn't support stdin input
			const fs = await import("node:fs/promises");
			const os = await import("node:os");
			const path = await import("node:path");

			// Use mkdtemp for secure temp file creation
			const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kubectl-validate-"));
			const tmpFile = path.join(tmpDir, "resource.yaml");
			await fs.writeFile(tmpFile, resourceYaml);

			try {
				await this.runKubectl(["apply", "--dry-run=client", "--validate=true", "-f", tmpFile], ns, {
					timeout: 10000,
				});

				// Also try server-side validation if connected
				try {
					await this.runKubectl(["apply", "--dry-run=server", "--validate=true", "-f", tmpFile], ns, {
						timeout: 15000,
					});
				} catch (serverError: any) {
					// Server validation failed - this is a warning, not an error
					warnings.push(`Server validation: ${serverError.message}`);
				}
			} finally {
				await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
			}

			return { valid: errors.length === 0, errors, warnings };
		} catch (error: any) {
			// execFileAsync attaches stdout/stderr to the thrown error on non-zero exit
			const stderr: string = error.stderr || "";
			const stdout: string = error.stdout || "";
			const errorMessage: string = error.message || String(error);

			// Prefer stderr for Kubernetes error messages; fall back to stdout then the
			// general error message so no context is lost.
			const combinedOutput = [stderr, stdout, errorMessage].join("\n");
			const lines = combinedOutput.split("\n");
			for (const line of lines) {
				const trimmed = line.trim();
				const lower = trimmed.toLowerCase();
				if (trimmed && (lower.includes("error from server") || lower.startsWith("error:"))) {
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

	/**
	 * Check for breaking changes between two resource versions
	 */
	async detectBreakingChanges(
		oldResource: string,
		newResource: string
	): Promise<{ hasBreakingChanges: boolean; changes: string[] }> {
		const changes: string[] = [];
		let hasBreakingChanges = false;

		try {
			const oldYaml = yaml.load(oldResource) as any;
			const newYaml = yaml.load(newResource) as any;

			// Check immutable field changes
			const immutableFields = [
				"spec.clusterIP", // Service
				"spec.volumeName", // PVC
				"spec.accessModes", // PVC
				"spec.storageClassName", // PVC (sometimes)
			];

			for (const field of immutableFields) {
				const oldValue = this.getNestedValue(oldYaml, field);
				const newValue = this.getNestedValue(newYaml, field);

				if (oldValue && newValue && oldValue !== newValue) {
					changes.push(`Immutable field changed: ${field} (${oldValue} → ${newValue})`);
					hasBreakingChanges = true;
				}
			}

			// Check for removed fields
			if (oldYaml?.spec?.selector && newYaml?.spec?.selector) {
				const oldSelector = oldYaml.spec.selector;
				const newSelector = newYaml.spec.selector;

				// Check matchLabels
				if (oldSelector.matchLabels) {
					for (const [key, value] of Object.entries(oldSelector.matchLabels)) {
						if (!newSelector.matchLabels?.[key]) {
							changes.push(`Selector label removed: ${key}=${value}`);
							hasBreakingChanges = true;
						}
					}
				}
			}

			// Check for deprecated APIs
			const deprecatedAPIs: Record<string, string> = {
				"extensions/v1beta1/Ingress": "networking.k8s.io/v1/Ingress",
				"extensions/v1beta1/Deployment": "apps/v1/Deployment",
				"apps/v1beta1/Deployment": "apps/v1/Deployment",
				"apps/v1beta2/Deployment": "apps/v1/Deployment",
			};

			const oldAPI = `${oldYaml?.apiVersion}/${oldYaml?.kind}`;
			const newAPI = `${newYaml?.apiVersion}/${newYaml?.kind}`;

			if (deprecatedAPIs[oldAPI] && oldAPI !== newAPI) {
				changes.push(`API version changed from ${oldAPI} to ${newAPI}`);
			}

			return { hasBreakingChanges, changes };
		} catch {
			return {
				hasBreakingChanges: false,
				changes: ["Could not parse resources for comparison"],
			};
		}
	}

	/**
	 * Get nested value from object
	 */
	private getNestedValue(obj: any, path: string): any {
		const parts = path.split(".");
		let current = obj;
		for (const part of parts) {
			if (current && typeof current === "object" && part in current) {
				current = current[part];
			} else {
				return undefined;
			}
		}
		return current;
	}
}

// Singleton instance
let connectorInstance: KubernetesConnector | null = null;

/**
 * Returns true when an error indicates that the kubectl binary could not be
 * found on the system.  Covers ENOENT, Windows "is not recognized", and the
 * common Unix shell "command not found" / "not found" variants.
 * The check is intentionally case-insensitive and cross-platform.
 */
export function isKubectlNotFound(error: unknown): boolean {
	const code = (error as { code?: string })?.code;
	const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
	return (
		code === "ENOENT" ||
		message.includes("enoent") ||
		message.includes("not found") ||
		message.includes("is not recognized") ||
		message.includes("command not found") ||
		message.includes("no such file or directory")
	);
}

export function getKubernetesConnector(options?: {
	kubeconfig?: string;
	context?: string;
	namespace?: string;
}): KubernetesConnector {
	// Return a fresh instance when custom options are provided so that different
	// callers cannot accidentally share or overwrite each other's configuration.
	if (options) {
		return new KubernetesConnector(options);
	}
	if (!connectorInstance) {
		connectorInstance = new KubernetesConnector();
	}
	return connectorInstance;
}
