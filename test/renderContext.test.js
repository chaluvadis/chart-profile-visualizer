// @ts-check
/**
 * Unit tests for buildRenderContext — the pure helper that assembles a
 * RenderContext from raw configuration values.
 *
 * Run with: node test/renderContext.test.js
 */

const assert = require("assert");
const {
	buildRenderContext,
	DEFAULT_RELEASE_NAME,
	DEFAULT_NAMESPACE,
	RENDER_CONTEXT_RELEASE_NAME_SETTING,
	RENDER_CONTEXT_NAMESPACE_SETTING,
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

test("DEFAULT_RELEASE_NAME is RELEASE-NAME", () => {
	assert.strictEqual(DEFAULT_RELEASE_NAME, "RELEASE-NAME");
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
	const ctx = buildRenderContext("RELEASE-NAME", "  staging  ");
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
	const ctx = buildRenderContext("RELEASE-NAME", "");
	assert.strictEqual(ctx.namespace, DEFAULT_NAMESPACE);
});

test("falls back to DEFAULT_NAMESPACE when namespace is whitespace only", () => {
	const ctx = buildRenderContext("RELEASE-NAME", "   ");
	assert.strictEqual(ctx.namespace, DEFAULT_NAMESPACE);
});

test("falls back to DEFAULT_NAMESPACE when namespace is undefined", () => {
	const ctx = buildRenderContext("RELEASE-NAME", undefined);
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

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) {
	process.exit(1);
}
