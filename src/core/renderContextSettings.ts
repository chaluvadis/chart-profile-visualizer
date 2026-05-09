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
 * Chart-level profile configuration schema
 */
export interface ChartProfileConfig {
	releaseName?: string;
	namespace?: string;
	environments?: Record<string, { releaseName?: string; namespace?: string }>;
}

/**
 * Pure helper: build a RenderContext from raw configuration values.
 * Returns defaults when the provided values are empty / undefined.
 */
export function buildRenderContext(releaseName: unknown, namespace: unknown): RenderContext {
	return {
		releaseName:
			typeof releaseName === "string" && releaseName.trim() !== "" ? releaseName.trim() : DEFAULT_RELEASE_NAME,
		namespace: typeof namespace === "string" && namespace.trim() !== "" ? namespace.trim() : DEFAULT_NAMESPACE,
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
			return {
				releaseName: typeof config.releaseName === "string" ? config.releaseName : undefined,
				namespace: typeof config.namespace === "string" ? config.namespace : undefined,
				environments:
					typeof config.environments === "object" && config.environments !== null
						? (config.environments as Record<string, { releaseName?: string; namespace?: string }>)
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
 * Precedence order (highest to lowest):
 * 1. Workspace settings
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

	if (chartProfile) {
		// Check for environment-specific overrides first (these have priority over chart defaults)
		if (chartProfile.environments?.[environment]) {
			const envConfig = chartProfile.environments[environment];
			releaseName = releaseName ?? envConfig.releaseName;
			namespace = namespace ?? envConfig.namespace;
		}
		// Apply chart-level defaults (lowest priority)
		releaseName = releaseName ?? chartProfile.releaseName;
		namespace = namespace ?? chartProfile.namespace;
	}

	return buildRenderContext(releaseName, namespace);
}
