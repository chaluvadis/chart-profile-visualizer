/**
 * Key metrics captured for an environment profile snapshot.
 * All numeric values are optional so that partial data is still usable.
 */
export interface EnvMetrics {
	/** Average response latency in milliseconds */
	latency?: number;
	/** Error rate as a fraction (0–1); values outside this range are accepted
	 *  but should be treated as anomalies by rendering layers */
	error_rate?: number;
	/** Requests (or messages) per second */
	throughput?: number;
	/** Monetary cost per hour in USD */
	cost?: number;
	/** Any additional custom metric key → value pairs */
	[key: string]: number | undefined;
}

/**
 * A single data-point snapshot describing one environment at one point in time.
 * Parsed from markdown frontmatter or from a fenced `env-profile` code block.
 */
export interface EnvProfile {
	/** Logical name of the environment, e.g. "production", "staging", "dev" */
	environment: string;
	/** ISO-8601 timestamp when this snapshot was captured */
	timestamp: string;
	/** Numeric performance / cost metrics */
	metrics: EnvMetrics;
	/** Free-form labels for filtering, e.g. ["us-east", "critical"] */
	tags: string[];
	/** Absolute path to the source markdown file */
	sourceFile?: string;
}

/**
 * The data model fed into the comparison panel webview.
 */
export interface ComparePayload {
	/** All profile snapshots discovered in the workspace */
	profiles: EnvProfile[];
	/** Distinct environment names derived from the profiles */
	environments: string[];
	/** All metric keys that appear in at least one profile */
	availableMetrics: string[];
}
