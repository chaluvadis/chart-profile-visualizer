/**
 * Application-wide constants
 */

import * as vscode from "vscode";

/**
 * Get configuration value with fallback to default
 */
function getConfigValue<T>(key: string, defaultValue: T): T {
	const config = vscode.workspace.getConfiguration("chartProfiles");
	const value = config.get<T>(key);
	return value !== undefined ? value : defaultValue;
}

// Cache TTL values (in milliseconds)
export const CACHE_TTL = {
	/** Runtime state cache TTL */
	RUNTIME_STATE: 5000,
};

// Refresh intervals (in milliseconds)
export const REFRESH_INTERVAL = {
	/** Auto-refresh interval for runtime state */
	get AUTO_REFRESH(): number {
		return getConfigValue("autoRefreshInterval", 30000);
	},
};

// Command timeouts (in milliseconds)
export const TIMEOUT = {
	/** Default command timeout */
	get DEFAULT(): number {
		return getConfigValue("timeouts.kubectl", 10000);
	},
	/** Helm template rendering timeout */
	get HELM_TEMPLATE(): number {
		return getConfigValue("timeouts.helmTemplate", 30000);
	},
	/** kubectl cluster-info timeout */
	get KUBECTL_CLUSTER_INFO(): number {
		return getConfigValue("timeouts.clusterInfo", 5000);
	},
};

// Buffer sizes (in bytes)
export const BUFFER_SIZE = {
	/** Helm template output buffer */
	HELM_OUTPUT: 10 * 1024 * 1024, // 10MB
};

// File patterns
export const FILE_PATTERNS = {
	/** Chart.yaml file name */
	CHART_YAML: "Chart.yaml",
	/** Base values file */
	VALUES_YAML: "values.yaml",
	/** Environment values file pattern (replace {env} with environment name) */
	VALUES_ENV: "values-{env}.yaml",
	/** Regex for matching environment values files */
	VALUES_ENV_REGEX: /^values-(.+)\.ya?ml$/,
};

// Directories to skip when scanning
export const SKIP_DIRECTORIES = ["node_modules", ".git", ".vscode", "dist", "out", "build", ".vscode-test"];

// Release name prefix
export const RELEASE_NAME_PREFIX = "{name}-{environment}";
