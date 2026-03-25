// @ts-check
/**
 * Unit tests for drift severity classification rules.
 * Runs against the compiled environmentDiff module.
 *
 * Run with: node test/driftSeverity.test.js
 */

"use strict";

const assert = require("assert");
const { classifyFieldSeverity, DriftSeverity } = require("../out/test-modules/environmentDiff");

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

// ── Critical fields ─────────────────────────────────────────────────────────

console.log("\nCritical severity classification:");

test("image.tag path is Critical", () => {
	assert.strictEqual(classifyFieldSeverity("spec.template.spec.containers.image.tag"), DriftSeverity.Critical);
});

test("image path (without .tag) is Critical", () => {
	assert.strictEqual(classifyFieldSeverity("spec.template.spec.containers.image"), DriftSeverity.Critical);
});

test("resources path is Critical", () => {
	assert.strictEqual(classifyFieldSeverity("spec.template.spec.containers.resources"), DriftSeverity.Critical);
});

test("resources.limits path is Critical", () => {
	assert.strictEqual(classifyFieldSeverity("spec.template.spec.containers.resources.limits.cpu"), DriftSeverity.Critical);
});

test("securityContext path is Critical", () => {
	assert.strictEqual(classifyFieldSeverity("spec.template.spec.containers.securityContext"), DriftSeverity.Critical);
});

test("replicas path is Critical", () => {
	assert.strictEqual(classifyFieldSeverity("spec.replicas"), DriftSeverity.Critical);
});

// ── Warning fields ───────────────────────────────────────────────────────────

console.log("\nWarning severity classification:");

test("ingress path is Warning", () => {
	assert.strictEqual(classifyFieldSeverity("spec.ingress"), DriftSeverity.Warning);
});

test("env path is Warning", () => {
	assert.strictEqual(classifyFieldSeverity("spec.template.spec.containers.env"), DriftSeverity.Warning);
});

test("volumes path is Warning", () => {
	assert.strictEqual(classifyFieldSeverity("spec.template.spec.volumes"), DriftSeverity.Warning);
});

test("volumeMounts path is Warning", () => {
	assert.strictEqual(classifyFieldSeverity("spec.template.spec.containers.volumeMounts"), DriftSeverity.Warning);
});

test("serviceAccountName path is Warning", () => {
	assert.strictEqual(classifyFieldSeverity("spec.template.spec.serviceAccountName"), DriftSeverity.Warning);
});

test("livenessProbe path is Warning", () => {
	assert.strictEqual(classifyFieldSeverity("spec.template.spec.containers.livenessProbe"), DriftSeverity.Warning);
});

test("readinessProbe path is Warning", () => {
	assert.strictEqual(classifyFieldSeverity("spec.template.spec.containers.readinessProbe"), DriftSeverity.Warning);
});

test("ports path is Warning", () => {
	assert.strictEqual(classifyFieldSeverity("spec.template.spec.containers.ports"), DriftSeverity.Warning);
});

// ── Info fields ──────────────────────────────────────────────────────────────

console.log("\nInfo severity classification:");

test("metadata.labels path is Info", () => {
	assert.strictEqual(classifyFieldSeverity("metadata.labels.app"), DriftSeverity.Info);
});

test("metadata.annotations path is Info", () => {
	assert.strictEqual(classifyFieldSeverity("metadata.annotations.description"), DriftSeverity.Info);
});

test("spec.selector path is Info", () => {
	assert.strictEqual(classifyFieldSeverity("spec.selector.matchLabels"), DriftSeverity.Info);
});

test("unrecognised path is Info", () => {
	assert.strictEqual(classifyFieldSeverity("spec.template.metadata.labels.version"), DriftSeverity.Info);
});

// ── Case-insensitivity ───────────────────────────────────────────────────────

console.log("\nCase-insensitive matching:");

test("REPLICAS (upper-case) is Critical", () => {
	assert.strictEqual(classifyFieldSeverity("spec.REPLICAS"), DriftSeverity.Critical);
});

test("INGRESS (upper-case) is Warning", () => {
	assert.strictEqual(classifyFieldSeverity("spec.INGRESS"), DriftSeverity.Warning);
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) {
	process.exit(1);
}
