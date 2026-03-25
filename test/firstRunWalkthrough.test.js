// @ts-check
/**
 * Unit tests for shouldShowWalkthrough — the pure helper that decides whether
 * the first-run walkthrough prompt should be displayed.
 *
 * Run with: node test/firstRunWalkthrough.test.js
 */

"use strict";

const assert = require("assert");
const {
	shouldShowWalkthrough,
	FIRST_RUN_STATE_KEY,
	QUICK_START_URL,
	WALKTHROUGH_ENABLED_SETTING,
} = require("../out/test-modules/core/walkthroughSettings");

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

// ── New user (first run) ─────────────────────────────────────────────────────

console.log("\nNew-user scenarios (should return true):");

test("shows walkthrough when never seen and setting is true", () => {
	assert.strictEqual(shouldShowWalkthrough(false, true), true);
});

test("shows walkthrough when never seen and setting is undefined (default on)", () => {
	assert.strictEqual(shouldShowWalkthrough(false, undefined), true);
});

test("shows walkthrough when never seen and setting is null (default on)", () => {
	assert.strictEqual(shouldShowWalkthrough(false, null), true);
});

// ── Returning user (already completed) ──────────────────────────────────────

console.log("\nReturning-user scenarios (should return false):");

test("hides walkthrough when already seen and setting is true", () => {
	assert.strictEqual(shouldShowWalkthrough(true, true), false);
});

test("hides walkthrough when already seen and setting is undefined", () => {
	assert.strictEqual(shouldShowWalkthrough(true, undefined), false);
});

// ── Setting explicitly disabled ──────────────────────────────────────────────

console.log("\nDisabled-by-setting scenarios (should return false):");

test("hides walkthrough when setting is false, even on first run", () => {
	assert.strictEqual(shouldShowWalkthrough(false, false), false);
});

test("hides walkthrough when setting is false and already seen", () => {
	assert.strictEqual(shouldShowWalkthrough(true, false), false);
});

// ── Exported constants ───────────────────────────────────────────────────────

console.log("\nExported constants:");

test("FIRST_RUN_STATE_KEY is a non-empty string", () => {
	assert.strictEqual(typeof FIRST_RUN_STATE_KEY, "string");
	assert.ok(FIRST_RUN_STATE_KEY.length > 0);
});

test("QUICK_START_URL starts with https://", () => {
	assert.ok(QUICK_START_URL.startsWith("https://"));
});

test("WALKTHROUGH_ENABLED_SETTING contains 'chartProfiles'", () => {
	assert.ok(WALKTHROUGH_ENABLED_SETTING.includes("chartProfiles"));
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) {
	process.exit(1);
}
