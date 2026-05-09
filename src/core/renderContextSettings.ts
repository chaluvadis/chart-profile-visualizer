/**
 * Pure (VS Code–free) constants and helpers for the render context.
 * Isolated from VS Code APIs so they can be unit-tested independently.
 */

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

/** Default release name, matching Helm's own placeholder */
export const DEFAULT_RELEASE_NAME = "RELEASE-NAME";

/** Default namespace */
export const DEFAULT_NAMESPACE = "default";

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
