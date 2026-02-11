#!/usr/bin/env node

/**
 * Simple test script to verify resource parsing without VSCode
 */

const cp = require("child_process");
const path = require("path");
const { promisify } = require("util");
const exec = promisify(cp.exec);

async function testRendering() {
	console.log("Testing Helm template rendering...\n");

	const chartPath = path.join(__dirname, "../examples/sample-app");
	const env = "dev";
	const releaseName = "test-release";

	try {
		const command = `helm template ${releaseName} "${chartPath}" -f "${chartPath}/values.yaml" -f "${chartPath}/values-${env}.yaml"`;

		console.log(`Running: ${command}\n`);

		const { stdout } = await exec(command);

		// Parse resources
		const documents = stdout.split(/^---$/m).filter((doc) => doc.trim());

		console.log(`Found ${documents.length} resources:\n`);

		for (const doc of documents) {
			const kindMatch = doc.match(/^kind:\s*(.+)$/m);
			const nameMatch = doc.match(/^\s+name:\s*(.+)$/m);

			if (kindMatch && nameMatch) {
				const kind = kindMatch[1].trim();
				const name = nameMatch[1].trim();
				console.log(`✓ ${kind}/${name}`);
			}
		}

		console.log("\n✅ Rendering test passed!");
		return true;
	} catch (error) {
		console.error("❌ Test failed:", error.message);
		return false;
	}
}

testRendering().then((success) => {
	process.exit(success ? 0 : 1);
});
