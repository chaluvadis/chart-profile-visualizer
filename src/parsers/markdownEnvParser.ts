import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import type { ComparePayload, EnvMetrics, EnvProfile } from "../types/envProfile";

/**
 * Regex to extract YAML frontmatter enclosed in `---` fences at the top of a
 * markdown file.
 */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

/**
 * Coerce a parsed YAML/JSON value into an `EnvMetrics` record.
 * Unknown keys that map to numbers are preserved as custom metrics.
 */
function toMetrics(raw: unknown): EnvMetrics {
	if (!raw || typeof raw !== "object") {
		return {};
	}
	const metrics: EnvMetrics = {};
	for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
		if (typeof v === "number") {
			metrics[k] = v;
		}
	}
	return metrics;
}

/**
 * Coerce a parsed value into a string array of tags.
 */
function toTags(raw: unknown): string[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	return raw.filter((t): t is string => typeof t === "string");
}

/**
 * Attempt to parse a single YAML/JSON string into an `EnvProfile`.
 * Returns `null` when the content is missing required fields.
 */
function parseProfileData(content: string, sourceFile?: string): EnvProfile | null {
	let data: unknown;
	try {
		// Try YAML first (superset of JSON)
		data = yaml.load(content);
	} catch {
		return null;
	}

	if (!data || typeof data !== "object") {
		return null;
	}

	const record = data as Record<string, unknown>;

	// `environment` is the only required field
	if (typeof record.environment !== "string" || !record.environment) {
		return null;
	}

	return {
		environment: record.environment,
		// Fall back to an empty string when no timestamp is provided so that
		// callers can distinguish "missing" from an actual capture time.
		timestamp: typeof record.timestamp === "string" ? record.timestamp : "",
		metrics: toMetrics(record.metrics),
		tags: toTags(record.tags),
		sourceFile,
	};
}

/**
 * Parse all environment profiles from a single markdown file.
 *
 * Supported schemas
 * -----------------
 * 1. YAML frontmatter at the top of the file (one profile per file)
 * 2. One or more ```` ```env-profile ```` fenced code blocks (YAML or JSON)
 *
 * Both schemas can coexist in the same file; duplicates are ignored.
 */
export function parseMarkdownFile(filePath: string): EnvProfile[] {
	let content: string;
	try {
		content = fs.readFileSync(filePath, "utf8");
	} catch {
		return [];
	}

	const profiles: EnvProfile[] = [];

	// ── 1. YAML frontmatter ────────────────────────────────────────────────────
	const fmMatch = FRONTMATTER_RE.exec(content);
	if (fmMatch) {
		const profile = parseProfileData(fmMatch[1], filePath);
		if (profile) {
			profiles.push(profile);
		}
	}

	// ── 2. `env-profile` code blocks ──────────────────────────────────────────
	// Recreate the regex per call to avoid stale `lastIndex` state across
	// multiple invocations of this function.
	const codeBlockRe = /```env-profile\r?\n([\s\S]*?)```/g;
	let blockMatch: RegExpExecArray | null;
	// biome-ignore lint/suspicious/noAssignInExpressions: intentional loop pattern
	while ((blockMatch = codeBlockRe.exec(content)) !== null) {
		const profile = parseProfileData(blockMatch[1], filePath);
		if (profile) {
			// Avoid duplicating a profile already captured from frontmatter
			const isDuplicate = profiles.some(
				(p) => p.environment === profile.environment && p.timestamp === profile.timestamp
			);
			if (!isDuplicate) {
				profiles.push(profile);
			}
		}
	}

	return profiles;
}

/**
 * Recursively walk the given root directories and parse every `*.md` file.
 * Returns a normalised `ComparePayload` ready for the webview.
 */
export function parseWorkspaceEnvProfiles(workspaceRoots: string[]): ComparePayload {
	const allProfiles: EnvProfile[] = [];

	for (const root of workspaceRoots) {
		collectMarkdownFiles(root).forEach((filePath) => {
			const fileProfiles = parseMarkdownFile(filePath);
			allProfiles.push(...fileProfiles);
		});
	}

	// Derive unique environment names, preserving insertion order
	const envSet = new Set<string>();
	const metricSet = new Set<string>();

	for (const p of allProfiles) {
		envSet.add(p.environment);
		for (const key of Object.keys(p.metrics)) {
			metricSet.add(key);
		}
	}

	// Sort profiles chronologically
	allProfiles.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

	return {
		profiles: allProfiles,
		environments: Array.from(envSet),
		availableMetrics: Array.from(metricSet),
	};
}

/**
 * Recursively collect all `.md` file paths under a directory.
 * Skips hidden directories (starting with `.`) and `node_modules`.
 */
function collectMarkdownFiles(dir: string): string[] {
	const results: string[] = [];

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return results;
	}

	for (const entry of entries) {
		if (entry.name.startsWith(".") || entry.name === "node_modules") {
			continue;
		}
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...collectMarkdownFiles(fullPath));
		} else if (entry.isFile() && entry.name.endsWith(".md")) {
			results.push(fullPath);
		}
	}

	return results;
}
