import * as yaml from "js-yaml";
import type { RenderedResource } from "../k8s/helmRenderer";

/**
 * Diff types for resources
 */
export enum DiffType {
	Added = "Added",
	Removed = "Removed",
	Modified = "Modified",
	Unchanged = "Unchanged",
}

/**
 * Severity levels for drift classification
 */
export enum DriftSeverity {
	Info = "Info",
	Warning = "Warning",
	Critical = "Critical",
}

/**
 * Field path patterns that map to severity levels.
 * Patterns are matched against the full dot-notation field path (case-insensitive).
 */
const CRITICAL_PATTERNS: RegExp[] = [
	/\bimage\b/i,
	/\bresources\b/i,
	/\bsecurityContext\b/i,
	/\breplicas\b/i,
];

const WARNING_PATTERNS: RegExp[] = [
	/\bingress\b/i,
	/\benv\b/i,
	/\bvolumes?\b/i,
	/\bvolumeMounts?\b/i,
	/\bserviceAccountName\b/i,
	/\blivenessProbe\b/i,
	/\breadinessProbe\b/i,
	/\bstartupProbe\b/i,
	/\bports?\b/i,
	/\bhostname\b/i,
	/\baffinity\b/i,
	/\btolerations?\b/i,
];

/**
 * Classify the severity of a drift change based on the field path.
 */
export function classifyFieldSeverity(fieldPath: string): DriftSeverity {
	for (const pattern of CRITICAL_PATTERNS) {
		if (pattern.test(fieldPath)) {
			return DriftSeverity.Critical;
		}
	}
	for (const pattern of WARNING_PATTERNS) {
		if (pattern.test(fieldPath)) {
			return DriftSeverity.Warning;
		}
	}
	return DriftSeverity.Info;
}

/**
 * Diff result for a single resource
 */
export interface ResourceDiff {
	kind: string;
	name: string;
	namespace?: string;
	diffType: DiffType;
	leftYaml?: string; // Environment 1
	rightYaml?: string; // Environment 2
	fieldDiffs?: FieldDiff[];
}

/**
 * Field-level diff
 */
export interface FieldDiff {
	path: string;
	leftValue: any;
	rightValue: any;
	diffType: DiffType;
	severity: DriftSeverity;
}

/**
 * Environment comparison result
 */
export interface EnvironmentComparison {
	leftEnv: string;
	rightEnv: string;
	chartName: string;
	diffs: ResourceDiff[];
	summary: {
		added: number;
		removed: number;
		modified: number;
		unchanged: number;
		total: number;
	};
}

/**
 * Compare two sets of rendered resources from different environments
 */
export function compareEnvironments(
	leftEnv: string,
	leftResources: RenderedResource[],
	rightEnv: string,
	rightResources: RenderedResource[],
	chartName: string
): EnvironmentComparison {
	const diffs: ResourceDiff[] = [];

	// Create maps for quick lookup
	const leftMap = new Map<string, RenderedResource>();
	const rightMap = new Map<string, RenderedResource>();

	for (const resource of leftResources) {
		const key = getResourceKey(resource);
		leftMap.set(key, resource);
	}

	for (const resource of rightResources) {
		const key = getResourceKey(resource);
		rightMap.set(key, resource);
	}

	// Find added and modified resources
	for (const [key, rightResource] of rightMap) {
		const leftResource = leftMap.get(key);

		if (!leftResource) {
			// Resource added in right environment
			diffs.push({
				kind: rightResource.kind,
				name: rightResource.name,
				namespace: rightResource.namespace,
				diffType: DiffType.Added,
				rightYaml: rightResource.yaml,
			});
		} else {
			// Resource exists in both - check if modified
			const fieldDiffs = compareResourceFields(leftResource, rightResource);

			if (fieldDiffs.length > 0) {
				diffs.push({
					kind: rightResource.kind,
					name: rightResource.name,
					namespace: rightResource.namespace,
					diffType: DiffType.Modified,
					leftYaml: leftResource.yaml,
					rightYaml: rightResource.yaml,
					fieldDiffs,
				});
			} else {
				diffs.push({
					kind: rightResource.kind,
					name: rightResource.name,
					namespace: rightResource.namespace,
					diffType: DiffType.Unchanged,
					leftYaml: leftResource.yaml,
					rightYaml: rightResource.yaml,
				});
			}

			// Remove from left map to track removed resources
			leftMap.delete(key);
		}
	}

	// Remaining resources in left map were removed
	for (const [_, leftResource] of leftMap) {
		diffs.push({
			kind: leftResource.kind,
			name: leftResource.name,
			namespace: leftResource.namespace,
			diffType: DiffType.Removed,
			leftYaml: leftResource.yaml,
		});
	}

	// Calculate summary
	const summary = {
		added: diffs.filter((d) => d.diffType === DiffType.Added).length,
		removed: diffs.filter((d) => d.diffType === DiffType.Removed).length,
		modified: diffs.filter((d) => d.diffType === DiffType.Modified).length,
		unchanged: diffs.filter((d) => d.diffType === DiffType.Unchanged).length,
		total: diffs.length,
	};

	return {
		leftEnv,
		rightEnv,
		chartName,
		diffs,
		summary,
	};
}

/**
 * Generate a unique key for a resource
 */
function getResourceKey(resource: RenderedResource): string {
	const namespace = resource.namespace || "default";
	return `${resource.kind}/${namespace}/${resource.name}`;
}

/**
 * Compare fields between two resources
 */
function compareResourceFields(left: RenderedResource, right: RenderedResource): FieldDiff[] {
	const diffs: FieldDiff[] = [];

	try {
		// Parse YAML to objects
		const leftYaml = left.yaml.replace(/^#.*$/gm, "").trim();
		const rightYaml = right.yaml.replace(/^#.*$/gm, "").trim();

		const leftObj = yaml.load(leftYaml) as any;
		const rightObj = yaml.load(rightYaml) as any;

		if (leftObj && rightObj) {
			// Compare spec, metadata, etc.
			compareObjects("spec", leftObj.spec, rightObj.spec, diffs);
			compareObjects("metadata.labels", leftObj.metadata?.labels, rightObj.metadata?.labels, diffs);
			compareObjects(
				"metadata.annotations",
				leftObj.metadata?.annotations,
				rightObj.metadata?.annotations,
				diffs
			);
		}
	} catch (error) {
		console.warn("Error comparing resource fields:", error);
	}

	return diffs;
}

/**
 * Recursively compare two objects and track differences
 */
function compareObjects(basePath: string, left: any, right: any, diffs: FieldDiff[], maxDepth = 10): void {
	if (maxDepth <= 0) {
		return;
	}

	// Handle null/undefined
	if (left === null || left === undefined) {
		if (right !== null && right !== undefined) {
			diffs.push({
				path: basePath,
				leftValue: left,
				rightValue: right,
				diffType: DiffType.Added,
				severity: classifyFieldSeverity(basePath),
			});
		}
		return;
	}

	if (right === null || right === undefined) {
		diffs.push({
			path: basePath,
			leftValue: left,
			rightValue: right,
			diffType: DiffType.Removed,
			severity: classifyFieldSeverity(basePath),
		});
		return;
	}

	// Handle primitives
	if (typeof left !== "object" || typeof right !== "object") {
		if (left !== right) {
			diffs.push({
				path: basePath,
				leftValue: left,
				rightValue: right,
				diffType: DiffType.Modified,
				severity: classifyFieldSeverity(basePath),
			});
		}
		return;
	}

	// Handle arrays
	if (Array.isArray(left) && Array.isArray(right)) {
		if (JSON.stringify(left) !== JSON.stringify(right)) {
			diffs.push({
				path: basePath,
				leftValue: left,
				rightValue: right,
				diffType: DiffType.Modified,
				severity: classifyFieldSeverity(basePath),
			});
		}
		return;
	}

	// Handle objects
	const leftKeys = new Set(Object.keys(left));
	const rightKeys = new Set(Object.keys(right));

	// Check all keys in both objects
	const allKeys = new Set([...leftKeys, ...rightKeys]);

	for (const key of allKeys) {
		const path = basePath ? `${basePath}.${key}` : key;

		if (!leftKeys.has(key)) {
			diffs.push({
				path,
				leftValue: undefined,
				rightValue: right[key],
				diffType: DiffType.Added,
				severity: classifyFieldSeverity(path),
			});
		} else if (!rightKeys.has(key)) {
			diffs.push({
				path,
				leftValue: left[key],
				rightValue: undefined,
				diffType: DiffType.Removed,
				severity: classifyFieldSeverity(path),
			});
		} else {
			// Both have the key - recurse
			compareObjects(path, left[key], right[key], diffs, maxDepth - 1);
		}
	}
}

/**
 * Format comparison for webview display with enhanced UI data
 */
export interface ComparisonWebviewData {
	header: {
		leftEnv: string;
		rightEnv: string;
		chartName: string;
	};
	summary: {
		added: number;
		removed: number;
		modified: number;
		unchanged: number;
		total: number;
		changePercentage: number;
		critical: number;
		warning: number;
		info: number;
	};
	resources: Array<{
		id: string;
		kind: string;
		name: string;
		namespace?: string;
		diffType: string;
		changeCount: number;
		maxSeverity: string;
		fields: Array<{
			path: string;
			leftValue: unknown;
			rightValue: unknown;
			diffType: string;
			severity: string;
		}>;
		leftYaml: string;
		rightYaml: string;
	}>;
	kindGroups: Array<{
		kind: string;
		count: number;
		added: number;
		removed: number;
		modified: number;
	}>;
}

/**
 * Determine the highest severity among a list of field diffs.
 */
function maxSeverityOf(fields: FieldDiff[]): DriftSeverity {
	let result = DriftSeverity.Info;
	for (const f of fields) {
		if (f.severity === DriftSeverity.Critical) return DriftSeverity.Critical;
		if (f.severity === DriftSeverity.Warning) result = DriftSeverity.Warning;
	}
	return result;
}

export function formatComparisonForWebview(comparison: EnvironmentComparison): ComparisonWebviewData {
	// Calculate change percentage
	const changed = comparison.summary.added + comparison.summary.removed + comparison.summary.modified;
	const changePercentage = comparison.summary.total > 0 ? Math.round((changed / comparison.summary.total) * 100) : 0;

	// Group resources by kind
	const kindMap = new Map<
		string,
		{ kind: string; added: number; removed: number; modified: number; count: number }
	>();

	for (const diff of comparison.diffs) {
		if (!kindMap.has(diff.kind)) {
			kindMap.set(diff.kind, { kind: diff.kind, added: 0, removed: 0, modified: 0, count: 0 });
		}
		const group = kindMap.get(diff.kind)!;
		group.count++;
		if (diff.diffType === DiffType.Added) group.added++;
		else if (diff.diffType === DiffType.Removed) group.removed++;
		else if (diff.diffType === DiffType.Modified) group.modified++;
	}

	// Build resources list for webview
	const resources = comparison.diffs
		.filter((d) => d.diffType !== DiffType.Unchanged)
		.map((diff) => {
			const fieldDiffs = diff.fieldDiffs || [];
			const resourceMaxSeverity =
				diff.diffType === DiffType.Modified ? maxSeverityOf(fieldDiffs) : DriftSeverity.Info;
			return {
				id: `${diff.kind}-${diff.name}-${diff.namespace || "default"}`,
				kind: diff.kind,
				name: diff.name,
				namespace: diff.namespace,
				diffType: diff.diffType,
				changeCount: fieldDiffs.length,
				maxSeverity: resourceMaxSeverity,
				fields: fieldDiffs.map((f) => ({
					path: f.path,
					leftValue: f.leftValue,
					rightValue: f.rightValue,
					diffType: f.diffType,
					severity: f.severity,
				})),
				leftYaml: diff.leftYaml || "",
				rightYaml: diff.rightYaml || "",
			};
		});

	// Compute severity totals across all field diffs
	let critical = 0;
	let warning = 0;
	let info = 0;
	for (const resource of resources) {
		for (const field of resource.fields) {
			if (field.severity === DriftSeverity.Critical) critical++;
			else if (field.severity === DriftSeverity.Warning) warning++;
			else info++;
		}
	}

	return {
		header: {
			leftEnv: comparison.leftEnv,
			rightEnv: comparison.rightEnv,
			chartName: comparison.chartName,
		},
		summary: {
			...comparison.summary,
			changePercentage,
			critical,
			warning,
			info,
		},
		resources,
		kindGroups: Array.from(kindMap.values()).sort((a, b) => b.count - a.count),
	};
}
