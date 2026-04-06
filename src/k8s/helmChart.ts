import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { SKIP_DIRECTORIES } from "../utils/constants";
import { type ChartYaml, parseYaml } from "../utils/yaml";

export interface HelmChart {
	name: string;
	path: string;
	version?: string;
	description?: string;
}

/**
 * Finds all Helm charts in the workspace by looking for Chart.yaml files
 * Supports multiple workspace roots
 */
export async function findHelmCharts(workspaceRoots: string[]): Promise<HelmChart[]> {
	const charts: HelmChart[] = [];

	try {
		for (const root of workspaceRoots) {
			await findChartsRecursive(root, charts);
		}
	} catch (error) {
		console.error("Error finding Helm charts:", error);
	}

	return charts;
}

async function findChartsRecursive(dirPath: string, charts: HelmChart[]): Promise<void> {
	try {
		const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

		for (const entry of entries) {
			const fullPath = path.join(dirPath, entry.name);

			// Skip node_modules and other common directories
			if (entry.isDirectory() && !shouldSkipDirectory(entry.name)) {
				// Check if this directory contains a Chart.yaml
				const chartYamlPath = path.join(fullPath, "Chart.yaml");
				let chartYamlExists = false;
				try {
					await fs.promises.access(chartYamlPath);
					chartYamlExists = true;
				} catch {
					// Chart.yaml does not exist
				}

				if (chartYamlExists) {
					const chart = await parseChartYaml(chartYamlPath, fullPath);
					if (chart) {
						charts.push(chart);
					}
					// DO NOT recurse into subdirectories - only find top-level charts
					// Sub-charts (in charts/ subdirectory) are dependencies, not standalone charts
					continue;
				}

				// Recurse into subdirectories that don't have Chart.yaml
				await findChartsRecursive(fullPath, charts);
			}
		}
	} catch (error) {
		// Silently skip directories we can't read
		console.error(`Error reading directory ${dirPath}:`, error);
	}
}

async function parseChartYaml(chartYamlPath: string, chartPath: string): Promise<HelmChart | null> {
	try {
		const content = await fs.promises.readFile(chartYamlPath, "utf8");
		const chartData = parseYaml<ChartYaml>(content);

		if (!chartData) {
			return null;
		}

		return {
			name: chartData.name || path.basename(chartPath),
			path: chartPath,
			version: chartData.version,
			description: chartData.description,
		};
	} catch (error) {
		console.error(`Error parsing Chart.yaml at ${chartYamlPath}:`, error);
		return null;
	}
}

function shouldSkipDirectory(dirName: string): boolean {
	// Get configured ignore directories from VS Code settings
	const config = vscode.workspace.getConfiguration("chartProfiles");
	const userIgnored = config.get<string[]>("ignoredDirectories", []);

	// Merge default and user-configured ignores
	const skipDirs = [...SKIP_DIRECTORIES, ...userIgnored];

	return skipDirs.includes(dirName) || dirName.startsWith(".");
}
