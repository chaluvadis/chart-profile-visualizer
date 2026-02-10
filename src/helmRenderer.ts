import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';

const exec = promisify(cp.exec);

export interface RenderedResource {
    kind: string;
    name: string;
    namespace?: string;
    yaml: string;
    template: string;
    chart: string;
}

/**
 * Renders Helm templates using `helm template` command
 * This is a placeholder implementation with comments explaining the full logic
 */
export async function renderHelmTemplate(
    chartPath: string,
    environment: string,
    releaseName: string = 'release'
): Promise<RenderedResource[]> {
    // Check if helm is available
    const helmAvailable = await isHelmAvailable();
    
    if (!helmAvailable) {
        console.warn('Helm CLI not found. Using placeholder rendering.');
        return getPlaceholderResources(chartPath, environment);
    }

    try {
        // Build helm template command
        // helm template [RELEASE_NAME] [CHART] -f values.yaml -f values-<env>.yaml
        const baseValuesPath = path.join(chartPath, 'values.yaml');
        const envValuesPath = path.join(chartPath, `values-${environment}.yaml`);

        let command = `helm template ${releaseName} "${chartPath}"`;
        
        if (fs.existsSync(baseValuesPath)) {
            command += ` -f "${baseValuesPath}"`;
        }
        
        if (fs.existsSync(envValuesPath)) {
            command += ` -f "${envValuesPath}"`;
        }

        console.log(`Executing: ${command}`);
        
        const { stdout, stderr } = await exec(command, {
            maxBuffer: 10 * 1024 * 1024, // 10MB buffer
            timeout: 30000 // 30 second timeout
        });

        if (stderr) {
            console.warn('Helm template stderr:', stderr);
        }

        // Parse the output into individual resources
        return parseHelmOutput(stdout, chartPath);
    } catch (error: any) {
        console.error('Error rendering Helm template:', error);
        
        // Return placeholder with error information
        return [{
            kind: 'Error',
            name: 'helm-template-error',
            yaml: `# Error rendering Helm template:\n# ${error.message}\n\n# This is a placeholder. Full implementation would:\n# 1. Execute 'helm template' command with appropriate values files\n# 2. Parse the output YAML documents\n# 3. Extract resource kind, name, namespace\n# 4. Track which template file generated each resource\n# 5. Map values back to their source (chart, template, values file)`,
            template: 'unknown',
            chart: path.basename(chartPath)
        }];
    }
}

/**
 * Parses helm template output into individual resources
 * Tracks the origin of each resource
 */
function parseHelmOutput(output: string, chartPath: string): RenderedResource[] {
    const resources: RenderedResource[] = [];
    
    // Split by YAML document separator
    const documents = output.split(/^---$/m).filter(doc => doc.trim());

    for (const doc of documents) {
        try {
            // Extract metadata from YAML comments
            // Helm adds comments like: # Source: mychart/templates/deployment.yaml
            const sourceMatch = doc.match(/# Source: (.+)/);
            const templateFile = sourceMatch ? sourceMatch[1] : 'unknown';

            // Parse basic resource info
            const kindMatch = doc.match(/^kind:\s*(.+)$/m);
            const nameMatch = doc.match(/^\s+name:\s*(.+)$/m);
            const namespaceMatch = doc.match(/^\s+namespace:\s*(.+)$/m);

            const resource: RenderedResource = {
                kind: kindMatch ? kindMatch[1].trim() : 'Unknown',
                name: nameMatch ? nameMatch[1].trim() : 'unnamed',
                namespace: namespaceMatch ? namespaceMatch[1].trim() : undefined,
                yaml: doc.trim(),
                template: templateFile,
                chart: path.basename(chartPath)
            };

            resources.push(resource);
        } catch (error) {
            console.error('Error parsing helm output document:', error);
        }
    }

    return resources;
}

/**
 * Checks if Helm CLI is available
 */
export async function isHelmAvailable(): Promise<boolean> {
    try {
        await exec('helm version --short');
        return true;
    } catch {
        return false;
    }
}

/**
 * Returns placeholder resources when Helm is not available
 */
function getPlaceholderResources(chartPath: string, environment: string): RenderedResource[] {
    const chartName = path.basename(chartPath);
    
    return [{
        kind: 'Placeholder',
        name: 'example-deployment',
        namespace: 'default',
        yaml: `# PLACEHOLDER: Rendered YAML for ${chartName} (${environment})
#
# This is a placeholder output. To see actual rendered templates:
# 1. Install Helm CLI: https://helm.sh/docs/intro/install/
# 2. Refresh the chart view
#
# The full implementation would:
# - Execute: helm template ${chartName} ${chartPath} -f values.yaml -f values-${environment}.yaml
# - Parse the resulting YAML documents
# - Track resource origins (which template file, which values)
# - Highlight overridden values from environment-specific files
# - Show comments indicating value sources
#
# Example expected output structure:
---
# Source: ${chartName}/templates/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: example-deployment
  namespace: default
  # Value from: values-${environment}.yaml
  labels:
    app: example
    environment: ${environment}
spec:
  replicas: 3  # Value from: values.yaml (base)
  selector:
    matchLabels:
      app: example
  template:
    metadata:
      labels:
        app: example
    spec:
      containers:
      - name: app
        image: nginx:latest  # Value from: values-${environment}.yaml (overridden)
        ports:
        - containerPort: 80`,
        template: `${chartName}/templates/deployment.yaml`,
        chart: chartName
    }];
}

/**
 * Formats rendered resources with origin information
 */
export function formatRenderedOutput(resources: RenderedResource[]): string {
    const lines: string[] = [];
    
    lines.push('# Helm Template Rendering Output');
    lines.push('# Environment-specific values have been merged and applied');
    lines.push('');
    lines.push(`# Total Resources: ${resources.length}`);
    lines.push('');

    for (let i = 0; i < resources.length; i++) {
        const resource = resources[i];
        
        lines.push('---');
        lines.push(`# Resource ${i + 1}/${resources.length}`);
        lines.push(`# Kind: ${resource.kind}`);
        lines.push(`# Name: ${resource.name}`);
        if (resource.namespace) {
            lines.push(`# Namespace: ${resource.namespace}`);
        }
        lines.push(`# Template Source: ${resource.template}`);
        lines.push(`# Chart: ${resource.chart}`);
        lines.push('');
        lines.push(resource.yaml);
        lines.push('');
    }

    return lines.join('\n');
}
