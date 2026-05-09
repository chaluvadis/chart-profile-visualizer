// @ts-check
/**
 * Unit tests for buildRenderContext — the pure helper that assembles a
 * RenderContext from raw configuration values.
 *
 * Run with: node test/renderContext.test.js
 */

const assert = require("assert");
const path = require("node:path");
const fs = require("node:fs");
const {
	buildRenderContext,
	DEFAULT_RELEASE_NAME,
	DEFAULT_NAMESPACE,
	RENDER_CONTEXT_RELEASE_NAME_SETTING,
	RENDER_CONTEXT_NAMESPACE_SETTING,
	loadChartProfile,
	getChartRenderContext,
} = require("../out/test-modules/core/renderContextSettings");

let passed = 0;
let failed = 0;

/**
 * Simple test runner helper.
 * @param {string} name
 * @param {() => void} fn
 */
function test(name, fn) {
	try {
		fn();
		console.log(`  ✔ ${name}`);
		passed++;
	} catch (err) {
		console.error(`  ✘ ${name}`);
		console.error(`      ${err.message}`);
		failed++;
	}
}

// ── Defaults ─────────────────────────────────────────────────────────────────

console.log("\nDefault values:");

test("DEFAULT_RELEASE_NAME is chart-profile", () => {
	assert.strictEqual(DEFAULT_RELEASE_NAME, "chart-profile");
});

test("DEFAULT_NAMESPACE is default", () => {
	assert.strictEqual(DEFAULT_NAMESPACE, "default");
});

// ── buildRenderContext with valid inputs ─────────────────────────────────────

console.log("\nbuildRenderContext with valid inputs:");

test("uses provided releaseName and namespace", () => {
	const ctx = buildRenderContext("my-release", "production");
	assert.strictEqual(ctx.releaseName, "my-release");
	assert.strictEqual(ctx.namespace, "production");
});

test("trims whitespace from releaseName", () => {
	const ctx = buildRenderContext("  my-release  ", "default");
	assert.strictEqual(ctx.releaseName, "my-release");
});

test("trims whitespace from namespace", () => {
	const ctx = buildRenderContext("chart-profile", "  staging  ");
	assert.strictEqual(ctx.namespace, "staging");
});

// ── buildRenderContext with empty / falsy inputs ──────────────────────────────

console.log("\nbuildRenderContext with empty / falsy inputs:");

test("falls back to DEFAULT_RELEASE_NAME when releaseName is empty string", () => {
	const ctx = buildRenderContext("", "default");
	assert.strictEqual(ctx.releaseName, DEFAULT_RELEASE_NAME);
});

test("falls back to DEFAULT_RELEASE_NAME when releaseName is whitespace only", () => {
	const ctx = buildRenderContext("   ", "default");
	assert.strictEqual(ctx.releaseName, DEFAULT_RELEASE_NAME);
});

test("falls back to DEFAULT_RELEASE_NAME when releaseName is undefined", () => {
	const ctx = buildRenderContext(undefined, "default");
	assert.strictEqual(ctx.releaseName, DEFAULT_RELEASE_NAME);
});

test("falls back to DEFAULT_RELEASE_NAME when releaseName is null", () => {
	const ctx = buildRenderContext(null, "default");
	assert.strictEqual(ctx.releaseName, DEFAULT_RELEASE_NAME);
});

test("falls back to DEFAULT_NAMESPACE when namespace is empty string", () => {
	const ctx = buildRenderContext("my-release", "");
	assert.strictEqual(ctx.namespace, DEFAULT_NAMESPACE);
});

test("falls back to DEFAULT_NAMESPACE when namespace is whitespace only", () => {
	const ctx = buildRenderContext("my-release", "   ");
	assert.strictEqual(ctx.namespace, DEFAULT_NAMESPACE);
});

test("falls back to DEFAULT_NAMESPACE when namespace is undefined", () => {
	const ctx = buildRenderContext("my-release", undefined);
	assert.strictEqual(ctx.namespace, DEFAULT_NAMESPACE);
});

test("falls back to both defaults when both inputs are undefined", () => {
	const ctx = buildRenderContext(undefined, undefined);
	assert.strictEqual(ctx.releaseName, DEFAULT_RELEASE_NAME);
	assert.strictEqual(ctx.namespace, DEFAULT_NAMESPACE);
});

// ── Exported setting constants ───────────────────────────────────────────────

console.log("\nExported setting constants:");

test("RENDER_CONTEXT_RELEASE_NAME_SETTING contains 'chartProfiles'", () => {
	assert.ok(RENDER_CONTEXT_RELEASE_NAME_SETTING.includes("chartProfiles"));
});

test("RENDER_CONTEXT_NAMESPACE_SETTING contains 'chartProfiles'", () => {
	assert.ok(RENDER_CONTEXT_NAMESPACE_SETTING.includes("chartProfiles"));
});

test("RENDER_CONTEXT_RELEASE_NAME_SETTING contains 'releaseName'", () => {
	assert.ok(RENDER_CONTEXT_RELEASE_NAME_SETTING.includes("releaseName"));
});

test("RENDER_CONTEXT_NAMESPACE_SETTING contains 'namespace'", () => {
	assert.ok(RENDER_CONTEXT_NAMESPACE_SETTING.includes("namespace"));
});

// ── Chart Profile Configuration Tests ───────────────────────────────────────────

console.log("\nChart Profile Configuration:");

test("loadChartProfile returns null for non-existent file", () => {
	const profile = loadChartProfile("/nonexistent/chart/path");
	assert.strictEqual(profile, null);
});

test("loadChartProfile parses valid chart profile", () => {
	const tempDir = path.join(__dirname, "temp-profile-test");
	fs.mkdirSync(tempDir, { recursive: true });
	const profilePath = path.join(tempDir, ".chart-profile.yaml");
	fs.writeFileSync(profilePath, "releaseName: my-release\nnamespace: my-namespace\n");

	const profile = loadChartProfile(tempDir);
	assert.strictEqual(profile.releaseName, "my-release");
	assert.strictEqual(profile.namespace, "my-namespace");

	fs.rmSync(tempDir, { recursive: true });
});

test("loadChartProfile parses environment-specific settings", () => {
	const tempDir = path.join(__dirname, "temp-profile-env-test");
	fs.mkdirSync(tempDir, { recursive: true });
	const profilePath = path.join(tempDir, ".chart-profile.yaml");
	fs.writeFileSync(profilePath, `
releaseName: default-release
namespace: default-ns
environments:
  dev:
    releaseName: dev-release
    namespace: dev-ns
  prod:
    releaseName: prod-release
`);

	const profile = loadChartProfile(tempDir);
	assert.strictEqual(profile.releaseName, "default-release");
	assert.strictEqual(profile.namespace, "default-ns");
	assert.strictEqual(profile.environments.dev.releaseName, "dev-release");
	assert.strictEqual(profile.environments.dev.namespace, "dev-ns");
	assert.strictEqual(profile.environments.prod.releaseName, "prod-release");

	fs.rmSync(tempDir, { recursive: true });
});

test("getChartRenderContext uses workspace settings as base", () => {
	const ctx = getChartRenderContext("workspace-release", "workspace-ns", "/some/chart", "dev");
	assert.strictEqual(ctx.releaseName, "workspace-release");
	assert.strictEqual(ctx.namespace, "workspace-ns");
});

test("getChartRenderContext applies chart profile overrides", () => {
	const tempDir = path.join(__dirname, "temp-profile-override-test");
	fs.mkdirSync(tempDir, { recursive: true });
	const profilePath = path.join(tempDir, ".chart-profile.yaml");
	fs.writeFileSync(profilePath, "releaseName: chart-release\nnamespace: chart-ns\n");

	const ctx = getChartRenderContext(undefined, undefined, tempDir, "dev");
	assert.strictEqual(ctx.releaseName, "chart-release");
	assert.strictEqual(ctx.namespace, "chart-ns");

	fs.rmSync(tempDir, { recursive: true });
});

test("getChartRenderContext applies environment-specific overrides", () => {
	const tempDir = path.join(__dirname, "temp-profile-env-override-test");
	fs.mkdirSync(tempDir, { recursive: true });
	const profilePath = path.join(tempDir, ".chart-profile.yaml");
	fs.writeFileSync(profilePath, `
releaseName: default-release
namespace: default-ns
environments:
  dev:
    releaseName: dev-release
    namespace: dev-ns
`);

	const ctx = getChartRenderContext(undefined, undefined, tempDir, "dev");
	assert.strictEqual(ctx.releaseName, "dev-release");
	assert.strictEqual(ctx.namespace, "dev-ns");

	fs.rmSync(tempDir, { recursive: true });
});

test("getChartRenderContext workspace settings take precedence over chart defaults", () => {
	const tempDir = path.join(__dirname, "temp-profile-prec-test");
	fs.mkdirSync(tempDir, { recursive: true });
	const profilePath = path.join(tempDir, ".chart-profile.yaml");
	fs.writeFileSync(profilePath, "releaseName: chart-release\nnamespace: chart-ns\n");

	const ctx = getChartRenderContext("workspace-release", undefined, tempDir, "dev");
	assert.strictEqual(ctx.releaseName, "workspace-release");
	assert.strictEqual(ctx.namespace, "chart-ns");

	fs.rmSync(tempDir, { recursive: true });
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) {
	process.exit(1);
}
