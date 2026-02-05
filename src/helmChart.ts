import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

export interface HelmChart {
    name: string;
    path: string;
    version?: string;
    description?: string;
}

/**
 * Finds all Helm charts in the workspace by looking for Chart.yaml files
 */
export async function findHelmCharts(workspaceRoot: string): Promise<HelmChart[]> {
    const charts: HelmChart[] = [];

    try {
        await findChartsRecursive(workspaceRoot, charts);
    } catch (error) {
        console.error('Error finding Helm charts:', error);
    }

    return charts;
}

async function findChartsRecursive(dirPath: string, charts: HelmChart[]): Promise<void> {
    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);

            // Skip node_modules and other common directories
            if (entry.isDirectory() && !shouldSkipDirectory(entry.name)) {
                // Check if this directory contains a Chart.yaml
                const chartYamlPath = path.join(fullPath, 'Chart.yaml');
                if (fs.existsSync(chartYamlPath)) {
                    const chart = await parseChartYaml(chartYamlPath, fullPath);
                    if (chart) {
                        charts.push(chart);
                    }
                    // Don't recurse into chart directories
                    continue;
                }

                // Recurse into subdirectories
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
        const content = fs.readFileSync(chartYamlPath, 'utf8');
        const chartData = yaml.load(content) as any;

        return {
            name: chartData.name || path.basename(chartPath),
            path: chartPath,
            version: chartData.version,
            description: chartData.description
        };
    } catch (error) {
        console.error(`Error parsing Chart.yaml at ${chartYamlPath}:`, error);
        return null;
    }
}

function shouldSkipDirectory(dirName: string): boolean {
    const skipDirs = [
        'node_modules',
        '.git',
        '.vscode',
        'dist',
        'out',
        'build',
        '.vscode-test'
    ];
    return skipDirs.includes(dirName) || dirName.startsWith('.');
}
