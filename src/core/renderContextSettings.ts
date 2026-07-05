/**
 * Pure (VS Code–free) constants and helpers for the render context.
 * Isolated from VS Code APIs so they can be unit-tested independently.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parseYamlAsUnknown } from "../utils/yaml";

/**
 * Render context used during template rendering, visualization, validation, and comparison.
 * This does NOT modify the chart itself — it only provides context for how the chart
 * is rendered within the extension.
 */
export interface RenderContext {
	/** Helm release name used in template rendering (e.g. `.Release.Name`) */
	releaseName: string;
	/** Kubernetes namespace passed to `helm template --namespace` */
	namespace: string;
	/** Additional `-f` values files, relative to the chart directory (applied after values.yaml / values-<env>.yaml) */
	valuesFiles?: string[];
	/** `--set` overrides passed verbatim to `helm template` (e.g. `"image.tag=1.2.3"`) */
	setValues?: string[];
	/** `--api-versions` entries, for charts that branch on `.Capabilities.APIVersions` */
	apiVersions?: string[];
	/** `--kube-version` override, for charts that branch on `.Capabilities.KubeVersion` */
	kubeVersion?: string;
}

/** VS Code configuration key for the render-context release name */
export const RENDER_CONTEXT_RELEASE_NAME_SETTING = "chartProfiles.renderContext.releaseName";

/** VS Code configuration key for the render-context namespace */
export const RENDER_CONTEXT_NAMESPACE_SETTING = "chartProfiles.renderContext.namespace";

/** Default release name, following Helm's naming conventions */
export const DEFAULT_RELEASE_NAME = "chart-profile";

/** Default namespace */
export const DEFAULT_NAMESPACE = "default";

/** Chart-level profile configuration file name */
export const CHART_PROFILE_FILE = ".chart-profile.yaml";

/**
 * Rendering options shared by chart-level and environment-level profile entries.
 */
export interface ChartProfileRenderOptions {
	releaseName?: string;
	namespace?: string;
	valuesFiles?: string[];
	setValues?: string[];
	apiVersions?: string[];
	kubeVersion?: string;
}

/**
 * Chart-level profile configuration schema
 */
export interface ChartProfileConfig extends ChartProfileRenderOptions {
	environments?: Record<string, ChartProfileRenderOptions>;
}

/**
 * Pure helper: build a RenderContext from raw configuration values.
 * Returns defaults when the provided values are empty / undefined.
 */
export function buildRenderContext(
	releaseName: unknown,
	namespace: unknown,
	extra?: Pick<ChartProfileRenderOptions, "valuesFiles" | "setValues" | "apiVersions" | "kubeVersion">
): RenderContext {
	const context: RenderContext = {
		releaseName:
			typeof releaseName === "string" && releaseName.trim() !== "" ? releaseName.trim() : DEFAULT_RELEASE_NAME,
		namespace: typeof namespace === "string" && namespace.trim() !== "" ? namespace.trim() : DEFAULT_NAMESPACE,
	};

	if (extra?.valuesFiles?.length) context.valuesFiles = extra.valuesFiles;
	if (extra?.setValues?.length) context.setValues = extra.setValues;
	if (extra?.apiVersions?.length) context.apiVersions = extra.apiVersions;
	if (extra?.kubeVersion) context.kubeVersion = extra.kubeVersion;

	return context;
}

/** Parse an unknown YAML value into a string array, dropping non-string entries. */
function parseStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const strings = value.filter((v): v is string => typeof v === "string" && v.trim() !== "");
	return strings.length ? strings : undefined;
}

/** Parse a raw YAML object into a `ChartProfileRenderOptions`, ignoring malformed fields. */
function parseRenderOptions(raw: Record<string, unknown>): ChartProfileRenderOptions {
	return {
		releaseName: typeof raw.releaseName === "string" ? raw.releaseName : undefined,
		namespace: typeof raw.namespace === "string" ? raw.namespace : undefined,
		valuesFiles: parseStringArray(raw.valuesFiles),
		setValues: parseStringArray(raw.setValues),
		apiVersions: parseStringArray(raw.apiVersions),
		kubeVersion: typeof raw.kubeVersion === "string" ? raw.kubeVersion : undefined,
	};
}

/**
 * Load chart-level profile configuration from .chart-profile.yaml
 */
export function loadChartProfile(chartPath: string): ChartProfileConfig | null {
	const profilePath = path.join(chartPath, CHART_PROFILE_FILE);

	try {
		const content = fs.readFileSync(profilePath, "utf8");
		const config = parseYamlAsUnknown(content);

		if (config && typeof config === "object") {
			const raw = config as Record<string, unknown>;
			const environmentsRaw =
				typeof raw.environments === "object" && raw.environments !== null
					? (raw.environments as Record<string, Record<string, unknown>>)
					: undefined;

			return {
				...parseRenderOptions(raw),
				environments: environmentsRaw
					? Object.fromEntries(Object.entries(environmentsRaw).map(([env, entry]) => [env, parseRenderOptions(entry)]))
					: undefined,
			};
		}
	} catch {
		// Profile file doesn't exist or can't be read - this is fine
	}

	return null;
}

/**
 * Get render context for a specific chart and environment, merging
 * workspace settings, chart profile, and defaults.
 *
 * Precedence order (highest to lowest), applied independently per field:
 * 1. Workspace settings (releaseName / namespace only)
 * 2. Environment-specific profile settings
 * 3. Chart-level profile defaults
 * 4. Built-in defaults
 */
export function getChartRenderContext(
	workspaceReleaseName: string | undefined,
	workspaceNamespace: string | undefined,
	chartPath: string,
	environment: string,
): RenderContext {
	// Apply chart-level profile configuration
	const chartProfile = loadChartProfile(chartPath);
	let releaseName = workspaceReleaseName;
	let namespace = workspaceNamespace;
	let valuesFiles: string[] | undefined;
	let setValues: string[] | undefined;
	let apiVersions: string[] | undefined;
	let kubeVersion: string | undefined;

	if (chartProfile) {
		const envConfig = chartProfile.environments?.[environment];
		// Environment-specific overrides take priority over chart-level defaults
		if (envConfig) {
			releaseName = releaseName ?? envConfig.releaseName;
			namespace = namespace ?? envConfig.namespace;
			valuesFiles = envConfig.valuesFiles;
			setValues = envConfig.setValues;
			apiVersions = envConfig.apiVersions;
			kubeVersion = envConfig.kubeVersion;
		}
		// Apply chart-level defaults (lowest priority)
		releaseName = releaseName ?? chartProfile.releaseName;
		namespace = namespace ?? chartProfile.namespace;
		valuesFiles = valuesFiles ?? chartProfile.valuesFiles;
		setValues = setValues ?? chartProfile.setValues;
		apiVersions = apiVersions ?? chartProfile.apiVersions;
		kubeVersion = kubeVersion ?? chartProfile.kubeVersion;
	}

	return buildRenderContext(releaseName, namespace, { valuesFiles, setValues, apiVersions, kubeVersion });
}
