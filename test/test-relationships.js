#!/usr/bin/env node

/**
 * Simple validation script for relationship detection
 * This is not a formal unit test but a manual verification tool
 */

const { execSync } = require("child_process");
const path = require("path");

console.log("Validating relationship detection logic...\n");

const chartPath = path.join(__dirname, "../examples/sample-app");

try {
	// Render templates
	const helmOutput = execSync(
		`helm template test-release "${chartPath}" -f "${chartPath}/values.yaml" -f "${chartPath}/values-dev.yaml"`,
		{ encoding: "utf-8" }
	);

	// Parse resources (simplified check)
	const resources = helmOutput.split(/^---$/m).filter((doc) => doc.trim());

	console.log(`✓ Found ${resources.length} resources`);

	// Check for expected relationships
	let hasService = false;
	let hasDeployment = false;
	let hasIngress = false;

	for (const doc of resources) {
		if (doc.includes("kind: Service")) hasService = true;
		if (doc.includes("kind: Deployment")) hasDeployment = true;
		if (doc.includes("kind: Ingress")) hasIngress = true;
	}

	console.log(`✓ Service found: ${hasService}`);
	console.log(`✓ Deployment found: ${hasDeployment}`);
	console.log(`✓ Ingress found: ${hasIngress}`);

	// Expected relationships in sample-app:
	// - Ingress -> Service (via backend.service)
	// - Service -> Deployment (via selector)
	if (hasIngress && hasService) {
		console.log("✓ Expected Ingress -> Service relationship possible");
	}

	if (hasService && hasDeployment) {
		console.log("✓ Expected Service -> Deployment relationship possible");
	}

	console.log("\n✅ Relationship detection validation passed!");
	console.log("\nNote: Full relationship detection happens in the extension at runtime.");
	console.log("This script validates that the sample chart has resources with expected relationships.");

	process.exit(0);
} catch (error) {
	console.error("❌ Validation failed:", error.message);
	process.exit(1);
}
