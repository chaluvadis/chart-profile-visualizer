// @ts-check
/**
 * Unit tests for isKubectlNotFound — the helper that decides whether a command
 * error means "kubectl binary is missing" vs. "kubectl is present but failed".
 *
 * Run with: node test/kubectlDetection.test.js
 */

"use strict";

const assert = require("assert");
const { isKubectlNotFound } = require("../out/test-modules/k8s/kubernetesConnector");

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

// ── Binary-missing errors — should return true ───────────────────────────────

console.log("\nBinary-missing errors (should return true):");

test("Error with code ENOENT", () => {
	const err = Object.assign(new Error("spawn kubectl ENOENT"), { code: "ENOENT" });
	assert.strictEqual(isKubectlNotFound(err), true);
});

test("Error message contains 'enoent' (lower-case)", () => {
	assert.strictEqual(isKubectlNotFound(new Error("spawn kubectl enoent")), true);
});

test("Unix 'command not found' shell message", () => {
	assert.strictEqual(isKubectlNotFound(new Error("command not found: kubectl")), true);
});

test("Unix 'kubectl: not found' shell message", () => {
	assert.strictEqual(isKubectlNotFound(new Error("kubectl: not found")), true);
});

test("Windows 'is not recognized' message", () => {
	assert.strictEqual(isKubectlNotFound(new Error("'kubectl' is not recognized as an internal or external command")), true);
});

test("'no such file or directory' message", () => {
	assert.strictEqual(isKubectlNotFound(new Error("no such file or directory: kubectl")), true);
});

test("Case-insensitive: 'Command Not Found'", () => {
	assert.strictEqual(isKubectlNotFound(new Error("Command Not Found: kubectl")), true);
});

test("String (non-Error) with ENOENT text", () => {
	assert.strictEqual(isKubectlNotFound("ENOENT: kubectl binary missing"), true);
});

// ── Runtime / transient errors — should return false ────────────────────────

console.log("\nRuntime / transient errors (should return false):");

test("'--short' flag deprecated warning", () => {
	assert.strictEqual(isKubectlNotFound(new Error("unknown flag: --short")), false);
});

test("Connection refused (cluster unreachable)", () => {
	assert.strictEqual(isKubectlNotFound(new Error("dial tcp: connection refused")), false);
});

test("Timeout error", () => {
	assert.strictEqual(isKubectlNotFound(new Error("context deadline exceeded")), false);
});

test("Generic non-zero exit error", () => {
	const err = Object.assign(new Error("Command failed with exit code 1"), { code: 1 });
	assert.strictEqual(isKubectlNotFound(err), false);
});

test("null value", () => {
	assert.strictEqual(isKubectlNotFound(null), false);
});

test("undefined value", () => {
	assert.strictEqual(isKubectlNotFound(undefined), false);
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) {
	process.exit(1);
}
