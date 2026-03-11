import * as yaml from "js-yaml";

/**
 * Generic YAML parsing with type safety
 */
export function parseYaml<T>(content: string): T | null {
	try {
		return yaml.load(content) as T;
	} catch (error) {
		console.error("Error parsing YAML:", error);
		return null;
	}
}

/**
 * Get nested value from an object using dot notation path
 */
export function getNestedValue(obj: unknown, path: string): unknown {
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
 * Set nested value in an object using dot notation path
 */
export function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
	const parts = path.split(".");
	let current: Record<string, unknown> = obj;

	for (let i = 0; i < parts.length - 1; i++) {
		const part = parts[i];
		if (!(part in current) || typeof current[part] !== "object") {
			current[part] = {};
		}
		current = current[part] as Record<string, unknown>;
	}

	current[parts[parts.length - 1]] = value;
}

/**
 * Chart.yaml interface for type-safe parsing
 */
export interface ChartYaml {
	name: string;
	version?: string;
	appVersion?: string;
	description?: string;
	type?: string;
	apiVersion?: string;
	dependencies?: ChartDependency[];
}

export interface ChartDependency {
	name: string;
	version: string;
	repository?: string;
	condition?: string;
	alias?: string;
	tags?: string[];
	enabled?: boolean;
}

/**
 * Values file interface
 */
export interface ValuesFile {
	[key: string]: unknown;
}

/**
 * Kubernetes resource metadata
 */
export interface K8sMetadata {
	name: string;
	namespace?: string;
	labels?: Record<string, string>;
	annotations?: Record<string, string>;
	ownerReferences?: Array<{
		kind: string;
		name: string;
		apiVersion: string;
	}>;
	creationTimestamp?: string;
}

/**
 * Kubernetes resource spec
 */
export interface K8sSpec {
	[key: string]: unknown;
}

/**
 * Parsed Kubernetes resource
 */
export interface K8sResource {
	apiVersion: string;
	kind: string;
	metadata: K8sMetadata;
	spec?: K8sSpec;
	status?: Record<string, unknown>;
}
