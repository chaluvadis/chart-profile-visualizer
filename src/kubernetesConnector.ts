import * as cp from "node:child_process";
import { promisify } from "node:util";
import * as yaml from "js-yaml";

const exec = promisify(cp.exec);

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
   * Check if kubectl is available
   */
  async isKubectlAvailable(): Promise<boolean> {
    try {
      await exec("kubectl version --client --short");
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get cluster connection info
   */
  async getClusterInfo(): Promise<ClusterInfo> {
    try {
      const { stdout } = await exec(
        "kubectl cluster-info --request-timeout=5s",
      );
      const versionResult = await exec("kubectl version --short");

      // Parse server URL
      const serverMatch = stdout.match(/is running at (https?:\/\/[^\s]+)/);
      const contextResult = await exec("kubectl config current-context");
      const nsResult = await exec(
        "kubectl config view --minify --output 'jsonpath={..namespace}'",
      );

      return {
        connected: true,
        server: serverMatch ? serverMatch[1] : undefined,
        context: contextResult.stdout.trim() || undefined,
        namespace: nsResult.stdout.trim() || "default",
        version:
          versionResult.stdout
            .split("\n")[0]
            ?.replace("Client Version: ", "") || undefined,
      };
    } catch (error: any) {
      return {
        connected: false,
        errorMessage: error.message || "Failed to connect to cluster",
      };
    }
  }

  /**
   * Escape shell argument to prevent command injection
   */
  private shellEscape(value: string): string {
    return `'${value.replace(/'/g, "'\\''")}'`;
  }

  /**
   * Build kubectl command with optional kubeconfig and context
   */
  private buildCommand(baseCommand: string, namespace?: string): string {
    let cmd = "kubectl";
    if (this.kubeconfig) {
      cmd += ` --kubeconfig=${this.shellEscape(this.kubeconfig)}`;
    }
    if (this.context) {
      cmd += ` --context=${this.shellEscape(this.context)}`;
    }
    if (namespace) {
      cmd += ` -n ${this.shellEscape(namespace)}`;
    }
    return `${cmd} ${baseCommand}`;
  }

  /**
   * Get runtime state for a specific resource
   */
  async getResourceState(
    kind: string,
    name: string,
    namespace?: string,
  ): Promise<ResourceRuntimeState> {
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
      const cmd = this.buildCommand(`get ${kind} ${name} -o yaml`, ns);
      const { stdout } = await exec(cmd, { timeout: 10000 });
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
      if (
        error.message?.includes("NotFound") ||
        error.message?.includes("not found")
      ) {
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
  private parseWorkloadStatus(
    resource: any,
    state: ResourceRuntimeState,
  ): void {
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
    const replicaFailure = conditions.find(
      (c: any) => c.type === "ReplicaFailure",
    );

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
  private async parseServiceStatus(
    name: string,
    namespace: string,
    state: ResourceRuntimeState,
  ): Promise<void> {
    try {
      const cmd = this.buildCommand(`get endpoints ${name} -o yaml`, namespace);
      const { stdout } = await exec(cmd, { timeout: 5000 });
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
        restartCount: containerStatuses.reduce(
          (sum: number, c: any) => sum + (c.restartCount || 0),
          0,
        ),
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
      state:
        phase === "Bound"
          ? "Healthy"
          : phase === "Lost"
            ? "Critical"
            : "Warning",
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
  private async getResourceEvents(
    kind: string,
    name: string,
    namespace: string,
  ): Promise<KubernetesEvent[]> {
    try {
      const cmd = this.buildCommand(
        `get events --field-selector involvedObject.kind=${kind},involvedObject.name=${name} -o json`,
        namespace,
      );
      const { stdout } = await exec(cmd, { timeout: 5000 });
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
  async getWorkloadPods(
    kind: string,
    name: string,
    namespace?: string,
  ): Promise<PodStatus[]> {
    const ns = namespace || this.namespace;

    try {
      // Get label selector for the workload
      const selectorCmd = this.buildCommand(
        `get ${kind} ${name} -o jsonpath='{.spec.selector.matchLabels}'`,
        ns,
      );
      const { stdout: selectorJson } = await exec(selectorCmd, {
        timeout: 5000,
      });

      // Parse selector and build label selector string
      const selector = JSON.parse(selectorJson.replace(/'/g, '"'));
      const labelSelector = Object.entries(selector)
        .map(([k, v]) => `${k}=${v}`)
        .join(",");

      // Get pods matching selector
      const podsCmd = this.buildCommand(
        `get pods -l ${labelSelector} -o json`,
        ns,
      );
      const { stdout: podsJson } = await exec(podsCmd, { timeout: 10000 });
      const podsResult = JSON.parse(podsJson);

      return (podsResult.items || []).map((pod: any) => {
        const containerStatuses = pod.status?.containerStatuses || [];
        return {
          name: pod.metadata.name,
          phase: pod.status.phase,
          ready: containerStatuses.every((c: any) => c.ready),
          restartCount: containerStatuses.reduce(
            (sum: number, c: any) => sum + (c.restartCount || 0),
            0,
          ),
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
      const { stdout } = await exec(`helm list -n "${ns}" -o json`, {
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
  async getHelmReleaseHistory(
    releaseName: string,
    namespace?: string,
  ): Promise<HelmRelease[]> {
    const ns = namespace || this.namespace;

    try {
      const { stdout } = await exec(
        `helm history "${releaseName}" -n "${ns}" -o json`,
        { timeout: 10000 },
      );
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
  async getHelmReleaseValues(
    releaseName: string,
    namespace?: string,
  ): Promise<any> {
    const ns = namespace || this.namespace;

    try {
      const { stdout } = await exec(
        `helm get values "${releaseName}" -n "${ns}" -o yaml`,
        { timeout: 10000 },
      );
      return yaml.load(stdout) || {};
    } catch {
      return {};
    }
  }

  /**
   * Get Helm release manifest (deployed)
   */
  async getHelmReleaseManifest(
    releaseName: string,
    namespace?: string,
  ): Promise<string> {
    const ns = namespace || this.namespace;

    try {
      const { stdout } = await exec(
        `helm get manifest "${releaseName}" -n "${ns}"`,
        { timeout: 10000 },
      );
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
    namespace?: string,
  ): Promise<{ valid: boolean; errors: string[]; warnings: string[] }> {
    const ns = namespace || this.namespace;
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Use kubectl apply --dry-run=client for schema validation
      // Write to temp file and use -f flag since exec doesn't support stdin input
      const tmp = await import("node:fs/promises");
      const os = await import("node:os");
      const path = await import("node:path");

      // Use mkdtemp for secure temp file creation
      const tmpDir = await tmp.mkdtemp(path.join(os.tmpdir(), "kubectl-validate-"));
      const tmpFile = path.join(tmpDir, "resource.yaml");
      await tmp.writeFile(tmpFile, resourceYaml);

      try {
        const cmd = this.buildCommand(
          `apply --dry-run=client --validate=true -f ${this.shellEscape(tmpFile)}`,
          ns,
        );
        await exec(cmd, { timeout: 10000 });

        // Also try server-side validation if connected
        try {
          const serverCmd = this.buildCommand(
            `apply --dry-run=server --validate=true -f ${this.shellEscape(tmpFile)}`,
            ns,
          );
          await exec(serverCmd, { timeout: 15000 });
        } catch (serverError: any) {
          // Server validation failed - this is a warning, not an error
          warnings.push(`Server validation: ${serverError.message}`);
        }
      } finally {
        await tmp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }

      return { valid: errors.length === 0, errors, warnings };
    } catch (error: any) {
      const errorMessage = error.message || String(error);

      // Parse kubectl error messages
      const lines = errorMessage.split("\n");
      for (const line of lines) {
        if (line.includes("Error from server") || line.includes("error:")) {
          errors.push(line.trim());
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
    newResource: string,
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
          changes.push(
            `Immutable field changed: ${field} (${oldValue} → ${newValue})`,
          );
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

export function getKubernetesConnector(options?: {
  kubeconfig?: string;
  context?: string;
  namespace?: string;
}): KubernetesConnector {
  // Always create a new instance if options are provided to avoid stale configuration
  if (options) {
    connectorInstance = new KubernetesConnector(options);
  } else if (!connectorInstance) {
    connectorInstance = new KubernetesConnector();
  }
  return connectorInstance;
}
