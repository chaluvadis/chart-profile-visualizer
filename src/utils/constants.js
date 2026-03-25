"use strict";
/**
 * Application-wide constants
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RELEASE_NAME_PREFIX = exports.SKIP_DIRECTORIES = exports.FILE_PATTERNS = exports.BUFFER_SIZE = exports.TIMEOUT = exports.REFRESH_INTERVAL = exports.CACHE_TTL = void 0;
// Cache TTL values (in milliseconds)
exports.CACHE_TTL = {
    /** Runtime state cache TTL */
    RUNTIME_STATE: 5000,
};
// Refresh intervals (in milliseconds)
exports.REFRESH_INTERVAL = {
    /** Auto-refresh interval for runtime state */
    AUTO_REFRESH: 30000,
};
// Command timeouts (in milliseconds)
exports.TIMEOUT = {
    /** Default command timeout */
    DEFAULT: 10000,
    /** Helm template rendering timeout */
    HELM_TEMPLATE: 30000,
    /** kubectl cluster-info timeout */
    KUBECTL_CLUSTER_INFO: 5000,
};
// Buffer sizes (in bytes)
exports.BUFFER_SIZE = {
    /** Helm template output buffer */
    HELM_OUTPUT: 10 * 1024 * 1024, // 10MB
};
// File patterns
exports.FILE_PATTERNS = {
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
exports.SKIP_DIRECTORIES = ["node_modules", ".git", ".vscode", "dist", "out", "build", ".vscode-test"];
// Release name prefix
exports.RELEASE_NAME_PREFIX = "{name}-{environment}";
//# sourceMappingURL=constants.js.map