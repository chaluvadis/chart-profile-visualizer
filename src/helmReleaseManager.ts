import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import * as yaml from "js-yaml";
import { getKubernetesConnector } from "./kubernetesConnector";

const exec = promisify(cp.exec);

/**
 * Helm release information
 */
export interface HelmRelease {
  name: string;
  namespace: string;
  revision: number;
  updated: string;
  status: ReleaseStatus;
  chart: string;
  appVersion: string;
}

/**
 * Release status types
 */
export type ReleaseStatus =
  | "deployed"
  | "failed"
  | "pending-install"
  | "pending-upgrade"
  | "pending-rollback"
  | "superseded"
  | "uninstalled"
  | "uninstalling";

/**
 * Release history entry
 */
export interface ReleaseHistoryEntry {
  revision: number;
  updated: string;
  status: ReleaseStatus;
  chart: string;
  appVersion: string;
  description: string;
}

/**
 * Release diff result
 */
export interface ReleaseDiff {
  fromRevision: number;
  toRevision: number;
  addedResources: string[];
  removedResources: string[];
  modifiedResources: ResourceChange[];
  manifestDiff?: string;
  valuesDiff?: string;
}

/**
 * Resource change details
 */
export interface ResourceChange {
  resourceId: string;
  kind: string;
  name: string;
  changes: FieldChange[];
}

/**
 * Field-level change
 */
export interface FieldChange {
  path: string;
  oldValue: unknown;
  newValue: unknown;
  isBreaking: boolean;
}

/**
 * Upgrade plan
 */
export interface UpgradePlan {
  currentRelease?: HelmRelease;
  targetChart: string;
  targetVersion: string;
  changes: string[];
  warnings: string[];
  breakingChanges: string[];
  requiredValues: string[];
  recommendedActions: string[];
  canUpgrade: boolean;
  riskLevel: "low" | "medium" | "high";
}

/**
 * Rollback assessment
 */
export interface RollbackAssessment {
  canRollback: boolean;
  targetRevision: number;
  currentRevision: number;
  warnings: string[];
  immutableFieldChanges: string[];
  dataLossWarnings: string[];
  recommendedActions: string[];
  riskLevel: "low" | "medium" | "high";
}

/**
 * Helm release manager for upgrade/rollback intelligence
 */
export class HelmReleaseManager {
  private kubeconfig?: string;
  private context?: string;

  constructor(options?: { kubeconfig?: string; context?: string }) {
    this.kubeconfig = options?.kubeconfig;
    this.context = options?.context;
  }

  /**
   * Build helm command with optional kubeconfig and context
   */
  private buildHelmCommand(baseCommand: string, namespace?: string): string {
    let cmd = "helm";
    if (this.kubeconfig) {
      cmd += ` --kubeconfig="${this.kubeconfig}"`;
    }
    if (this.context) {
      cmd += ` --kube-context="${this.context}"`;
    }
    if (namespace) {
      cmd += ` -n "${namespace}"`;
    }
    return `${cmd} ${baseCommand}`;
  }

  /**
   * Check if helm is available
   */
  async isHelmAvailable(): Promise<boolean> {
    try {
      await exec("helm version --short");
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List all releases in a namespace
   */
  async listReleases(namespace?: string): Promise<HelmRelease[]> {
    try {
      const cmd = this.buildHelmCommand("list -o json", namespace);
      const { stdout } = await exec(cmd, { timeout: 10000 });
      const releases = JSON.parse(stdout);

      return releases.map((r: Record<string, unknown>) => ({
        name: r.name as string,
        namespace: r.namespace as string,
        revision: r.revision as number,
        updated: r.updated as string,
        status: r.status as ReleaseStatus,
        chart: r.chart as string,
        appVersion: (r.app_version as string) || "",
      }));
    } catch {
      return [];
    }
  }

  /**
   * Get release history
   */
  async getReleaseHistory(
    releaseName: string,
    namespace?: string,
  ): Promise<ReleaseHistoryEntry[]> {
    try {
      const cmd = this.buildHelmCommand(
        `history ${releaseName} -o json`,
        namespace,
      );
      const { stdout } = await exec(cmd, { timeout: 10000 });
      const history = JSON.parse(stdout);

      return history.map((h: Record<string, unknown>) => ({
        revision: h.revision as number,
        updated: h.updated as string,
        status: h.status as ReleaseStatus,
        chart: h.chart as string,
        appVersion: (h.app_version as string) || "",
        description: (h.description as string) || "",
      }));
    } catch {
      return [];
    }
  }

  /**
   * Get release values
   */
  async getReleaseValues(
    releaseName: string,
    namespace?: string,
    revision?: number,
  ): Promise<Record<string, unknown>> {
    try {
      let cmd = this.buildHelmCommand(
        `get values ${releaseName} -o yaml`,
        namespace,
      );
      if (revision) {
        cmd = this.buildHelmCommand(
          `get values ${releaseName} --revision ${revision} -o yaml`,
          namespace,
        );
      }
      const { stdout } = await exec(cmd, { timeout: 10000 });
      return (yaml.load(stdout) as Record<string, unknown>) || {};
    } catch {
      return {};
    }
  }

  /**
   * Get release manifest
   */
  async getReleaseManifest(
    releaseName: string,
    namespace?: string,
    revision?: number,
  ): Promise<string> {
    try {
      let cmd = this.buildHelmCommand(`get manifest ${releaseName}`, namespace);
      if (revision) {
        cmd = this.buildHelmCommand(
          `get manifest ${releaseName} --revision ${revision}`,
          namespace,
        );
      }
      const { stdout } = await exec(cmd, { timeout: 30000 });
      return stdout;
    } catch {
      return "";
    }
  }

  /**
   * Get release notes
   */
  async getReleaseNotes(
    releaseName: string,
    namespace?: string,
  ): Promise<string> {
    try {
      const cmd = this.buildHelmCommand(`get notes ${releaseName}`, namespace);
      const { stdout } = await exec(cmd, { timeout: 10000 });
      return stdout;
    } catch {
      return "";
    }
  }

  /**
   * Compare two release revisions
   */
  async compareRevisions(
    releaseName: string,
    fromRevision: number,
    toRevision: number,
    namespace?: string,
  ): Promise<ReleaseDiff> {
    const [fromManifest, toManifest, fromValues, toValues] = await Promise.all([
      this.getReleaseManifest(releaseName, namespace, fromRevision),
      this.getReleaseManifest(releaseName, namespace, toRevision),
      this.getReleaseValues(releaseName, namespace, fromRevision),
      this.getReleaseValues(releaseName, namespace, toRevision),
    ]);

    const fromResources = this.parseManifest(fromManifest);
    const toResources = this.parseManifest(toManifest);

    const addedResources: string[] = [];
    const removedResources: string[] = [];
    const modifiedResources: ResourceChange[] = [];

    // Find added and modified resources
    for (const [id, resource] of toResources) {
      if (!fromResources.has(id)) {
        addedResources.push(id);
      } else {
        const changes = this.compareResources(fromResources.get(id)!, resource);
        if (changes.length > 0) {
          const metadata = resource.metadata as
            | Record<string, unknown>
            | undefined;
          modifiedResources.push({
            resourceId: id,
            kind: resource.kind as string,
            name: (metadata?.name as string) || "unknown",
            changes,
          });
        }
      }
    }

    // Find removed resources
    for (const id of fromResources.keys()) {
      if (!toResources.has(id)) {
        removedResources.push(id);
      }
    }

    // Generate diffs
    const manifestDiff = await this.generateDiff(fromManifest, toManifest);
    const valuesDiff = await this.generateDiff(
      yaml.dump(fromValues),
      yaml.dump(toValues),
    );

    return {
      fromRevision,
      toRevision,
      addedResources,
      removedResources,
      modifiedResources,
      manifestDiff,
      valuesDiff,
    };
  }

  /**
   * Plan an upgrade
   */
  async planUpgrade(
    releaseName: string,
    chartPath: string,
    namespace?: string,
    valuesPath?: string,
  ): Promise<UpgradePlan> {
    const plan: UpgradePlan = {
      targetChart: path.basename(chartPath),
      targetVersion: "",
      changes: [],
      warnings: [],
      breakingChanges: [],
      requiredValues: [],
      recommendedActions: [],
      canUpgrade: true,
      riskLevel: "low",
    };

    // Get current release
    const releases = await this.listReleases(namespace);
    const currentRelease = releases.find((r) => r.name === releaseName);
    plan.currentRelease = currentRelease;

    // Get chart version
    try {
      const chartYamlPath = path.join(chartPath, "Chart.yaml");
      if (fs.existsSync(chartYamlPath)) {
        const chartYaml = yaml.load(
          fs.readFileSync(chartYamlPath, "utf8"),
        ) as Record<string, unknown>;
        plan.targetVersion = (chartYaml.version as string) || "";
      }
    } catch {
      plan.warnings.push("Could not read Chart.yaml");
    }

    // Check if release exists
    if (!currentRelease) {
      plan.changes.push("New installation (no existing release)");
      plan.riskLevel = "low";
      return plan;
    }

    // Get current manifest and new manifest
    const currentManifest = await this.getReleaseManifest(
      releaseName,
      namespace,
    );
    const connector = getKubernetesConnector();

    // Render new manifest using helm template
    let newManifest = "";
    try {
      let cmd = `helm template ${releaseName} "${chartPath}"`;
      if (valuesPath) {
        cmd += ` -f "${valuesPath}"`;
      }
      const { stdout } = await exec(cmd, { timeout: 30000 });
      newManifest = stdout;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      plan.warnings.push(`Could not render new manifest: ${errorMessage}`);
      plan.canUpgrade = false;
      return plan;
    }

    // Compare manifests
    const currentResources = this.parseManifest(currentManifest);
    const newResources = this.parseManifest(newManifest);

    // Check for removed resources
    for (const id of currentResources.keys()) {
      if (!newResources.has(id)) {
        plan.changes.push(`Resource removed: ${id}`);
        plan.riskLevel = "medium";
      }
    }

    // Check for breaking changes
    for (const [id, newResource] of newResources) {
      const currentResource = currentResources.get(id);
      if (currentResource) {
        const breakingChanges = await this.detectBreakingChanges(
          currentResource,
          newResource,
        );
        if (breakingChanges.length > 0) {
          plan.breakingChanges.push(
            ...breakingChanges.map((c) => `${id}: ${c}`),
          );
          plan.riskLevel = "high";
        }
      }
    }

    // Check for required values
    try {
      const valuesYamlPath = path.join(chartPath, "values.yaml");
      if (fs.existsSync(valuesYamlPath)) {
        const valuesYaml = yaml.load(
          fs.readFileSync(valuesYamlPath, "utf8"),
        ) as Record<string, unknown>;
        const requiredValues = this.findRequiredValues(valuesYaml);
        plan.requiredValues = requiredValues;
      }
    } catch {
      // Ignore
    }

    // Add recommended actions
    if (plan.breakingChanges.length > 0) {
      plan.recommendedActions.push("Review breaking changes before upgrading");
      plan.recommendedActions.push(
        "Consider running `helm upgrade --dry-run` first",
      );
    }
    if (plan.riskLevel === "high") {
      plan.recommendedActions.push("Create a backup before upgrading");
      plan.recommendedActions.push("Plan a rollback strategy");
    }

    return plan;
  }

  /**
   * Assess rollback feasibility
   */
  async assessRollback(
    releaseName: string,
    targetRevision: number,
    namespace?: string,
  ): Promise<RollbackAssessment> {
    const assessment: RollbackAssessment = {
      canRollback: true,
      targetRevision,
      currentRevision: 0,
      warnings: [],
      immutableFieldChanges: [],
      dataLossWarnings: [],
      recommendedActions: [],
      riskLevel: "low",
    };

    // Get release history
    const history = await this.getReleaseHistory(releaseName, namespace);
    if (history.length === 0) {
      assessment.canRollback = false;
      assessment.warnings.push("No release history found");
      return assessment;
    }

    // Find current revision
    const currentEntry = history.find((h) => h.status === "deployed");
    if (currentEntry) {
      assessment.currentRevision = currentEntry.revision;
    }

    // Check if target revision exists
    const targetEntry = history.find((h) => h.revision === targetRevision);
    if (!targetEntry) {
      assessment.canRollback = false;
      assessment.warnings.push(
        `Revision ${targetRevision} not found in history`,
      );
      return assessment;
    }

    // Compare manifests
    const diff = await this.compareRevisions(
      releaseName,
      assessment.currentRevision,
      targetRevision,
      namespace,
    );

    // Check for removed resources (data loss)
    for (const resourceId of diff.removedResources) {
      assessment.dataLossWarnings.push(
        `Resource will be removed: ${resourceId}`,
      );
      assessment.riskLevel = "medium";
    }

    // Check for immutable field changes
    for (const change of diff.modifiedResources) {
      for (const fieldChange of change.changes) {
        if (fieldChange.isBreaking) {
          assessment.immutableFieldChanges.push(
            `${change.resourceId}: ${fieldChange.path}`,
          );
          assessment.riskLevel = "high";
        }
      }
    }

    // Add recommended actions
    if (assessment.dataLossWarnings.length > 0) {
      assessment.recommendedActions.push("Backup data before rollback");
    }
    if (assessment.immutableFieldChanges.length > 0) {
      assessment.recommendedActions.push(
        "Some resources may need to be deleted and recreated",
      );
    }
    assessment.recommendedActions.push(
      "Run `helm rollback --dry-run` to preview changes",
    );

    return assessment;
  }

  /**
   * Parse manifest into resources
   */
  private parseManifest(
    manifest: string,
  ): Map<string, Record<string, unknown>> {
    const resources = new Map<string, Record<string, unknown>>();

    const documents = manifest.split(/^---$/m).filter((doc) => doc.trim());

    for (const doc of documents) {
      try {
        const resource = yaml.load(doc) as Record<string, unknown>;
        if (resource && resource.kind && resource.metadata) {
          const metadata = resource.metadata as Record<string, unknown>;
          const name = metadata.name as string;
          const namespace = (metadata.namespace as string) || "default";
          const id = `${resource.kind}/${namespace}/${name}`;
          resources.set(id, resource);
        }
      } catch {
        // Skip invalid documents
      }
    }

    return resources;
  }

  /**
   * Compare two resources and return field changes
   */
  private compareResources(
    oldResource: Record<string, unknown>,
    newResource: Record<string, unknown>,
  ): FieldChange[] {
    const changes: FieldChange[] = [];
    this.compareObjects(oldResource, newResource, "", changes);
    return changes;
  }

  /**
   * Recursively compare objects
   */
  private compareObjects(
    oldObj: unknown,
    newObj: unknown,
    path: string,
    changes: FieldChange[],
  ): void {
    if (
      typeof oldObj !== typeof newObj ||
      Array.isArray(oldObj) !== Array.isArray(newObj)
    ) {
      changes.push({
        path,
        oldValue: oldObj,
        newValue: newObj,
        isBreaking: this.isBreakingChange(path),
      });
      return;
    }

    if (typeof oldObj !== "object" || oldObj === null || newObj === null) {
      if (oldObj !== newObj) {
        changes.push({
          path,
          oldValue: oldObj,
          newValue: newObj,
          isBreaking: this.isBreakingChange(path),
        });
      }
      return;
    }

    const oldRecord = oldObj as Record<string, unknown>;
    const newRecord = newObj as Record<string, unknown>;

    const allKeys = new Set([
      ...Object.keys(oldRecord),
      ...Object.keys(newRecord),
    ]);

    for (const key of allKeys) {
      const newPath = path ? `${path}.${key}` : key;
      if (!(key in oldRecord)) {
        changes.push({
          path: newPath,
          oldValue: undefined,
          newValue: newRecord[key],
          isBreaking: false,
        });
      } else if (!(key in newRecord)) {
        changes.push({
          path: newPath,
          oldValue: oldRecord[key],
          newValue: undefined,
          isBreaking: this.isBreakingChange(newPath),
        });
      } else {
        this.compareObjects(oldRecord[key], newRecord[key], newPath, changes);
      }
    }
  }

  /**
   * Check if a path represents a breaking change
   */
  private isBreakingChange(path: string): boolean {
    const breakingPaths = [
      "spec.clusterIP",
      "spec.volumeName",
      "spec.accessModes",
      "spec.storageClassName",
      "spec.selector.matchLabels",
    ];

    return breakingPaths.some((bp) => path.startsWith(bp));
  }

  /**
   * Detect breaking changes between resources
   */
  private async detectBreakingChanges(
    oldResource: Record<string, unknown>,
    newResource: Record<string, unknown>,
  ): Promise<string[]> {
    const changes: string[] = [];

    // Check immutable fields
    const immutableFields = [
      { path: "spec.clusterIP", name: "Service clusterIP" },
      { path: "spec.volumeName", name: "PVC volumeName" },
      { path: "spec.accessModes", name: "PVC accessModes" },
    ];

    for (const field of immutableFields) {
      const oldValue = this.getNestedValue(oldResource, field.path);
      const newValue = this.getNestedValue(newResource, field.path);

      if (
        oldValue &&
        newValue &&
        JSON.stringify(oldValue) !== JSON.stringify(newValue)
      ) {
        changes.push(
          `${field.name} changed from ${JSON.stringify(oldValue)} to ${JSON.stringify(newValue)}`,
        );
      }
    }

    // Check selector changes
    const oldSelector = this.getNestedValue(
      oldResource,
      "spec.selector.matchLabels",
    );
    const newSelector = this.getNestedValue(
      newResource,
      "spec.selector.matchLabels",
    );

    if (oldSelector && newSelector) {
      for (const [key, value] of Object.entries(
        oldSelector as Record<string, unknown>,
      )) {
        const newSelectorRecord = newSelector as Record<string, unknown>;
        if (!(key in newSelectorRecord) || newSelectorRecord[key] !== value) {
          changes.push(`Selector label removed or changed: ${key}`);
        }
      }
    }

    return changes;
  }

  /**
   * Get nested value from object
   */
  private getNestedValue(obj: unknown, path: string): unknown {
    if (!obj || typeof obj !== "object") return undefined;

    const parts = path.split(".");
    let current: unknown = obj;

    for (const part of parts) {
      if (current && typeof current === "object" && part in current) {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return current;
  }

  /**
   * Generate diff between two strings
   */
  private async generateDiff(oldStr: string, newStr: string): Promise<string> {
    const oldLines = oldStr.split("\n");
    const newLines = newStr.split("\n");
    const diff: string[] = [];

    // Simple line-by-line diff
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
      } else if (oldLine !== undefined) {
        diff.push(`  ${oldLine}`);
      }
    }

    return diff.join("\n");
  }

  /**
   * Find required values in values.yaml
   */
  private findRequiredValues(
    values: Record<string, unknown>,
    prefix = "",
  ): string[] {
    const required: string[] = [];

    for (const [key, value] of Object.entries(values)) {
      const path = prefix ? `${prefix}.${key}` : key;

      if (value === null || value === "") {
        required.push(path);
      } else if (typeof value === "object" && !Array.isArray(value)) {
        required.push(
          ...this.findRequiredValues(value as Record<string, unknown>, path),
        );
      }
    }

    return required;
  }
}

// Singleton instance
let managerInstance: HelmReleaseManager | null = null;

export function getHelmReleaseManager(options?: {
  kubeconfig?: string;
  context?: string;
}): HelmReleaseManager {
  if (!managerInstance || options) {
    managerInstance = new HelmReleaseManager(options);
  }
  return managerInstance;
}
