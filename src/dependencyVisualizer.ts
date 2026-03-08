import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";

/**
 * Chart dependency information
 */
export interface ChartDependency {
	name: string;
	version: string;
	repository: string;
	condition?: string;
	alias?: string;
	tags?: string[];
	enabled?: boolean;
}

/**
 * Chart metadata from Chart.yaml
 */
export interface ChartMetadata {
	name: string;
	version: string;
	appVersion?: string;
	description?: string;
	type?: string;
	dependencies?: ChartDependency[];
}

/**
 * Dependency tree node
 */
export interface DependencyNode {
	name: string;
	version: string;
	alias?: string;
	repository: string;
	enabled: boolean;
	condition?: string;
	tags?: string[];
	children: DependencyNode[];
	parent?: string;
	depth: number;
	// For subchart resources
	resources?: string[];
}

/**
 * Dependency visualization data
 */
export interface DependencyVisualization {
	rootChart: ChartMetadata;
	dependencies: DependencyNode[];
	flatDependencies: ChartDependency[];
	dependencyCount: number;
	enabledCount: number;
	disabledCount: number;
	hasConflicts: boolean;
	conflicts: DependencyConflict[];
}

/**
 * Dependency conflict
 */
export interface DependencyConflict {
	type: "version" | "repository" | "alias";
	dependency1: string;
	dependency2: string;
	details: string;
}

/**
 * Resource to subchart mapping
 */
export interface ResourceSubchartMapping {
	resourceId: string;
	kind: string;
	name: string;
	subchart?: string;
	template: string;
}

/**
 * Parse Chart.yaml and extract dependencies
 */
export function parseChartYaml(chartPath: string): ChartMetadata | null {
	const chartYamlPath = path.join(chartPath, "Chart.yaml");

	if (!fs.existsSync(chartYamlPath)) {
		return null;
	}

	try {
		const content = fs.readFileSync(chartYamlPath, "utf8");
		const chartYaml = yaml.load(content) as Record<string, unknown>;

		const dependencies: ChartDependency[] = [];
		const deps = chartYaml.dependencies as Array<Record<string, unknown>> | undefined;

		if (deps && Array.isArray(deps)) {
			for (const dep of deps) {
				dependencies.push({
					name: dep.name as string,
					version: dep.version as string,
					repository: (dep.repository as string) || "",
					condition: dep.condition as string | undefined,
					alias: dep.alias as string | undefined,
					tags: dep.tags as string[] | undefined,
					enabled: dep.enabled !== false,
				});
			}
		}

		return {
			name: chartYaml.name as string,
			version: chartYaml.version as string,
			appVersion: chartYaml.appVersion as string | undefined,
			description: chartYaml.description as string | undefined,
			type: chartYaml.type as string | undefined,
			dependencies,
		};
	} catch {
		return null;
	}
}

/**
 * Build dependency tree
 */
export function buildDependencyTree(chartPath: string, values?: Record<string, unknown>): DependencyVisualization {
	const rootChart = parseChartYaml(chartPath);

	if (!rootChart) {
		return {
			rootChart: { name: "unknown", version: "0.0.0" },
			dependencies: [],
			flatDependencies: [],
			dependencyCount: 0,
			enabledCount: 0,
			disabledCount: 0,
			hasConflicts: false,
			conflicts: [],
		};
	}

	const flatDependencies: ChartDependency[] = [];
	const conflicts: DependencyConflict[] = [];

	// Build tree recursively
	const dependencies = buildDependencyNodes(
		rootChart.dependencies || [],
		values,
		flatDependencies,
		conflicts,
		rootChart.name,
		0
	);

	// Count enabled/disabled
	let enabledCount = 0;
	let disabledCount = 0;

	function countEnabled(nodes: DependencyNode[]): void {
		for (const node of nodes) {
			if (node.enabled) {
				enabledCount++;
			} else {
				disabledCount++;
			}
			countEnabled(node.children);
		}
	}

	countEnabled(dependencies);

	return {
		rootChart,
		dependencies,
		flatDependencies,
		dependencyCount: flatDependencies.length,
		enabledCount,
		disabledCount,
		hasConflicts: conflicts.length > 0,
		conflicts,
	};
}

/**
 * Build dependency nodes recursively
 */
function buildDependencyNodes(
	dependencies: ChartDependency[],
	values: Record<string, unknown> | undefined,
	flatList: ChartDependency[],
	conflicts: DependencyConflict[],
	parent: string,
	depth: number
): DependencyNode[] {
	const nodes: DependencyNode[] = [];

	for (const dep of dependencies) {
		// Check if dependency is enabled based on condition and tags
		const isEnabled = isDependencyEnabled(dep, values);

		const node: DependencyNode = {
			name: dep.name,
			version: dep.version,
			alias: dep.alias,
			repository: dep.repository,
			enabled: isEnabled,
			condition: dep.condition,
			tags: dep.tags,
			children: [],
			parent,
			depth,
		};

		// Add to flat list
		flatList.push(dep);

		// Check for conflicts with existing dependencies
		for (const existing of flatList) {
			if (existing.name === dep.name && existing.version !== dep.version) {
				conflicts.push({
					type: "version",
					dependency1: `${parent}/${dep.name}`,
					dependency2: `${existing.name}`,
					details: `Version conflict: ${dep.version} vs ${existing.version}`,
				});
			}
		}

		// Check for alias conflicts
		if (dep.alias) {
			for (const existing of flatList) {
				if (existing.alias === dep.alias && existing.name !== dep.name) {
					conflicts.push({
						type: "alias",
						dependency1: dep.name,
						dependency2: existing.name,
						details: `Duplicate alias: ${dep.alias}`,
					});
				}
			}
		}

		nodes.push(node);
	}

	return nodes;
}

/**
 * Check if a dependency is enabled based on values
 */
function isDependencyEnabled(dep: ChartDependency, values: Record<string, unknown> | undefined): boolean {
	// Check condition
	if (dep.condition) {
		const conditionValue = getNestedValue(values, dep.condition);
		if (conditionValue === false) {
			return false;
		}
	}

	// Check tags
	if (dep.tags && dep.tags.length > 0) {
		const tagsConfig = values?.tags as Record<string, boolean> | undefined;
		if (tagsConfig) {
			// If any tag is explicitly false, disable
			for (const tag of dep.tags) {
				if (tagsConfig[tag] === false) {
					return false;
				}
			}
		}
	}

	return dep.enabled !== false;
}

/**
 * Get nested value from object
 */
function getNestedValue(obj: unknown, path: string): unknown {
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
 * Map resources to their source subchart
 */
export function mapResourcesToSubcharts(
	resources: Array<{ kind: string; name: string; template: string }>,
	dependencies: ChartDependency[]
): ResourceSubchartMapping[] {
	const mappings: ResourceSubchartMapping[] = [];

	for (const resource of resources) {
		const mapping: ResourceSubchartMapping = {
			resourceId: `${resource.kind}/${resource.name}`,
			kind: resource.kind,
			name: resource.name,
			template: resource.template,
		};

		// Check if resource comes from a subchart
		for (const dep of dependencies) {
			const chartName = dep.alias || dep.name;
			// Template path usually includes charts/<chartname>/templates/
			if (
				resource.template.includes(`charts/${chartName}/`) ||
				resource.template.includes(`${chartName}/templates/`)
			) {
				mapping.subchart = chartName;
				break;
			}
		}

		mappings.push(mapping);
	}

	return mappings;
}

/**
 * Get dependency graph edges for visualization
 */
export function getDependencyEdges(dependencies: DependencyNode[]): Array<{
	source: string;
	target: string;
	type: "dependency" | "alias";
}> {
	const edges: Array<{
		source: string;
		target: string;
		type: "dependency" | "alias";
	}> = [];

	function traverse(nodes: DependencyNode[], parent: string): void {
		for (const node of nodes) {
			const sourceId = node.alias || node.name;
			edges.push({
				source: parent,
				target: sourceId,
				type: node.alias ? "alias" : "dependency",
			});
			traverse(node.children, sourceId);
		}
	}

	traverse(dependencies, "root");
	return edges;
}

/**
 * Generate dependency visualization data for the UI
 */
export function generateDependencyVisualizationData(chartPath: string): {
	nodes: Array<{
		id: string;
		label: string;
		type: "root" | "dependency";
		version: string;
		enabled: boolean;
		repository: string;
	}>;
	edges: Array<{
		source: string;
		target: string;
		type: string;
	}>;
	summary: {
		total: number;
		enabled: number;
		disabled: number;
		conflicts: number;
	};
} {
	const viz = buildDependencyTree(chartPath);

	const nodes: Array<{
		id: string;
		label: string;
		type: "root" | "dependency";
		version: string;
		enabled: boolean;
		repository: string;
	}> = [];

	// Add root node
	nodes.push({
		id: "root",
		label: viz.rootChart.name,
		type: "root",
		version: viz.rootChart.version,
		enabled: true,
		repository: "",
	});

	// Add dependency nodes
	function addNodes(deps: DependencyNode[]): void {
		for (const dep of deps) {
			nodes.push({
				id: dep.alias || dep.name,
				label: dep.alias ? `${dep.alias} (${dep.name})` : dep.name,
				type: "dependency",
				version: dep.version,
				enabled: dep.enabled,
				repository: dep.repository,
			});
			addNodes(dep.children);
		}
	}

	addNodes(viz.dependencies);

	const edges = getDependencyEdges(viz.dependencies);

	return {
		nodes,
		edges,
		summary: {
			total: viz.dependencyCount,
			enabled: viz.enabledCount,
			disabled: viz.disabledCount,
			conflicts: viz.conflicts.length,
		},
	};
}

/**
 * Check for security issues in dependencies
 */
export function checkDependencySecurity(dependencies: ChartDependency[]): Array<{
	dependency: string;
	issue: string;
	severity: "warning" | "error";
}> {
	const issues: Array<{
		dependency: string;
		issue: string;
		severity: "warning" | "error";
	}> = [];

	for (const dep of dependencies) {
		// Check for unversioned dependencies
		if (!dep.version || dep.version === "*" || dep.version === "") {
			issues.push({
				dependency: dep.name,
				issue: "No version constraint specified - may get unexpected updates",
				severity: "warning",
			});
		}

		// Check for file:// repositories (local charts)
		if (dep.repository.startsWith("file://")) {
			issues.push({
				dependency: dep.name,
				issue: "Local file dependency - may not work in all environments",
				severity: "warning",
			});
		}

		// Check for empty repository (uses default)
		if (!dep.repository) {
			issues.push({
				dependency: dep.name,
				issue: "No repository specified - uses default repository",
				severity: "warning",
			});
		}
	}

	return issues;
}

/**
 * Get values schema for dependencies
 */
export function getDependencyValuesSchema(dependencies: ChartDependency[]): Record<string, unknown> {
	const schema: Record<string, unknown> = {};

	for (const dep of dependencies) {
		const key = dep.alias || dep.name;
		// Each subchart typically has its values under its name
		schema[key] = {
			// Common subchart patterns
			enabled: true,
		};
	}

	return schema;
}
