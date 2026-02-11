import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { promisify } from 'util';
import { mergeValues } from './valuesMerger';

const exec = promisify(cp.exec);

// Template variable patterns for substitution
const TEMPLATE_PATTERNS = {
    RELEASE_NAME: /\{\{\s*\.Release\.Name\s*\}\}/g,
    CHART_NAME: /\{\{\s*\.Chart\.Name\s*\}\}/g,
    CHART_VERSION: /\{\{\s*\.Chart\.Version\s*\}\}/g,
    VALUES: /\{\{\s*\.Values\.([a-zA-Z0-9_.]+)\s*\}\}/g
};

// Default chart version when Chart.yaml cannot be read
const DEFAULT_CHART_VERSION = '0.1.0';

export interface RenderedResource {
    kind: string;
    name: string;
    namespace?: string;
    apiVersion?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    yaml: string;
    template: string;
    chart: string;
}

/**
 * Renders Helm templates using helm template command with full error handling and fallback rendering
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

    // Declare command outside try block so it's accessible in catch
    let command = '';

    try {
        // Build helm template command
        // helm template [RELEASE_NAME] [CHART] -f values.yaml -f values-<env>.yaml
        const baseValuesPath = path.join(chartPath, 'values.yaml');
        const envValuesPath = path.join(chartPath, `values-${environment}.yaml`);

        command = `helm template ${releaseName} "${chartPath}"`;
        
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
        
        // Parse error message to provide helpful diagnostics
        const errorMessage = error.message || String(error);
        let errorType = 'Unknown Error';
        let remediation = 'Check the error message for details.';
        
        // Identify common Helm errors
        if (errorMessage.includes('Error: INSTALLATION FAILED') || errorMessage.includes('chart not found')) {
            errorType = 'Chart Not Found';
            remediation = 'Verify that the chart path is correct and Chart.yaml exists.';
        } else if (errorMessage.includes('parse error') || errorMessage.includes('yaml:')) {
            errorType = 'YAML Syntax Error';
            remediation = 'Check your values files for YAML syntax errors.';
        } else if (errorMessage.includes('missing required value') || errorMessage.includes('required value not found')) {
            errorType = 'Missing Required Value';
            remediation = 'Ensure all required values are defined in values.yaml or values-<env>.yaml.';
        } else if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) {
            errorType = 'Timeout';
            remediation = 'The rendering took too long. Try simplifying your templates or increase timeout.';
        } else if (errorMessage.includes('maxBuffer') || errorMessage.includes('stdout maxBuffer')) {
            errorType = 'Output Too Large';
            remediation = 'The rendered output exceeds buffer size. Consider splitting your chart.';
        }
        
        // Build structured error output
        const errorYaml = [
            '# ═══════════════════════════════════════════════════════════════',
            '# ERROR RENDERING HELM TEMPLATE',
            '# ═══════════════════════════════════════════════════════════════',
            `# Error Type: ${errorType}`,
            `# Chart: ${path.basename(chartPath)}`,
            `# Environment: ${environment}`,
            '',
            '# Command Attempted:',
            `# ${command}`,
            '',
            '# Error Message:',
            ...errorMessage.split('\n').map(line => `# ${line}`),
            '',
            '# Remediation:',
            `# ${remediation}`,
            '',
            '# Troubleshooting Steps:',
            '# 1. Verify Helm CLI is installed: helm version',
            '# 2. Check chart structure: ls -la <chart-path>',
            '# 3. Validate values files: helm lint <chart-path>',
            '# 4. Try rendering manually with the command above',
            '',
            '# If the issue persists, check:',
            '# - Chart.yaml is valid',
            '# - All template files have correct Go template syntax',
            '# - Values files contain valid YAML',
            '# - Required values are defined'
        ].join('\n');
        
        return [{
            kind: 'Error',
            name: 'helm-template-error',
            apiVersion: 'v1',
            yaml: errorYaml,
            template: 'error',
            chart: path.basename(chartPath)
        }];
    }
}

/**
 * Parses helm template output into individual resources
 * Tracks the origin of each resource and extracts metadata
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

            // Try to parse YAML properly using js-yaml
            let parsedYaml: any = null;
            let kind = 'Unknown';
            let name = 'unnamed';
            let namespace: string | undefined;
            let apiVersion: string | undefined;
            let labels: Record<string, string> | undefined;
            let annotations: Record<string, string> | undefined;

            try {
                // Remove comments before parsing
                const yamlContent = doc.replace(/^#.*$/gm, '').trim();
                parsedYaml = yaml.load(yamlContent) as any;
                
                if (parsedYaml && typeof parsedYaml === 'object') {
                    kind = parsedYaml.kind || 'Unknown';
                    apiVersion = parsedYaml.apiVersion;
                    
                    if (parsedYaml.metadata) {
                        name = parsedYaml.metadata.name || 'unnamed';
                        namespace = parsedYaml.metadata.namespace;
                        labels = parsedYaml.metadata.labels;
                        annotations = parsedYaml.metadata.annotations;
                    }
                }
            } catch (yamlError) {
                // Fall back to regex parsing if YAML parsing fails
                console.warn('YAML parsing failed, falling back to regex:', yamlError);
                
                const kindMatch = doc.match(/^kind:\s*(.+)$/m);
                const nameMatch = doc.match(/^\s+name:\s*(.+)$/m);
                const namespaceMatch = doc.match(/^\s+namespace:\s*(.+)$/m);
                const apiVersionMatch = doc.match(/^apiVersion:\s*(.+)$/m);
                
                kind = kindMatch ? kindMatch[1].trim() : 'Unknown';
                name = nameMatch ? nameMatch[1].trim() : 'unnamed';
                namespace = namespaceMatch ? namespaceMatch[1].trim() : undefined;
                apiVersion = apiVersionMatch ? apiVersionMatch[1].trim() : undefined;
            }

            const resource: RenderedResource = {
                kind,
                name,
                namespace,
                apiVersion,
                labels,
                annotations,
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
 * Returns fallback resources when Helm is not available by reading and partially rendering template files
 */
function getPlaceholderResources(chartPath: string, environment: string): RenderedResource[] {
    const chartName = path.basename(chartPath);
    const templatesDir = path.join(chartPath, 'templates');
    const resources: RenderedResource[] = [];
    
    // Check if templates directory exists
    if (!fs.existsSync(templatesDir)) {
        return [{
            kind: 'Notice',
            name: 'no-templates-found',
            apiVersion: 'v1',
            yaml: `# Notice: Helm CLI not available and no templates directory found\n#\n# Path checked: ${templatesDir}\n#\n# To see rendered templates:\n# 1. Install Helm CLI: https://helm.sh/docs/intro/install/\n# 2. Refresh the chart view`,
            template: 'notice',
            chart: chartName
        }];
    }
    
    try {
        // Get merged values for this environment
        const comparison = mergeValues(chartPath, environment);
        const mergedValues = comparison.merged;
        
        // Read chart version from Chart.yaml
        let chartVersion = DEFAULT_CHART_VERSION;
        try {
            const chartYamlPath = path.join(chartPath, 'Chart.yaml');
            if (fs.existsSync(chartYamlPath)) {
                const chartYaml = yaml.load(fs.readFileSync(chartYamlPath, 'utf8')) as any;
                if (chartYaml && chartYaml.version) {
                    chartVersion = chartYaml.version;
                }
            }
        } catch (error) {
            console.warn('Could not read Chart.yaml version:', error);
        }
        
        // Read all template files
        const templateFiles = fs.readdirSync(templatesDir)
            .filter(file => file.endsWith('.yaml') || file.endsWith('.yml'))
            .filter(file => !file.startsWith('_')); // Skip helper files
        
        for (const templateFile of templateFiles) {
            const templatePath = path.join(templatesDir, templateFile);
            let templateContent = fs.readFileSync(templatePath, 'utf8');
            
            // Perform basic Go template variable substitution
            const releaseName = `${chartName}-${environment}`;
            
            // Replace common template variables using defined patterns
            templateContent = templateContent
                .replace(TEMPLATE_PATTERNS.RELEASE_NAME, releaseName)
                .replace(TEMPLATE_PATTERNS.CHART_NAME, chartName)
                .replace(TEMPLATE_PATTERNS.CHART_VERSION, chartVersion);
            
            // Replace .Values.* references with actual values
            templateContent = substituteValues(templateContent, mergedValues);
            
            // Try to parse the partially rendered YAML to extract metadata
            // Helm templates may contain multiple YAML documents (separated by ---)
            let kind = 'Unknown';
            let name = 'unnamed';
            let namespace: string | undefined;
            let apiVersion: string | undefined;
            
            try {
                // Remove remaining template constructs that we can't resolve for parsing
                const simplifiedYaml = templateContent
                    .replace(/\{\{-?\s*if\s+.*?\}\}/g, '')
                    .replace(/\{\{-?\s*end\s*-?\}\}/g, '')
                    .replace(/\{\{-?\s*range\s+.*?\}\}/g, '')
                    .replace(/\{\{-?\s*with\s+.*?\}\}/g, '')
                    .replace(/\{\{-?\s*else\s*-?\}\}/g, '')
                    .replace(/\{\{-?\s*toYaml\s+.*?\|\s*nindent\s+\d+\s*-?\}\}/g, '{}');
                
                // Parse all documents and pick the most appropriate one for metadata
                const docs: any[] = [];
                yaml.loadAll(simplifiedYaml, (doc: any) => {
                    if (doc && typeof doc === 'object') {
                        docs.push(doc);
                    }
                });

                if (docs.length > 0) {
                    // Prefer the first document that has a kind; otherwise use the first document
                    const primary = docs.find(d => d && typeof d === 'object' && d.kind) || docs[0];
                    kind = primary.kind || 'Unknown';
                    apiVersion = primary.apiVersion;
                    if (primary.metadata && typeof primary.metadata === 'object') {
                        name = primary.metadata.name || 'unnamed';
                        namespace = primary.metadata.namespace;
                    }
                }
            } catch (parseError) {
                // Fall back to regex extraction
                const kindMatch = templateContent.match(/^kind:\s*(.+)$/m);
                const nameMatch = templateContent.match(/^\s+name:\s*(.+)$/m);
                const apiVersionMatch = templateContent.match(/^apiVersion:\s*(.+)$/m);
                
                kind = kindMatch ? kindMatch[1].trim() : 'Unknown';
                name = nameMatch ? nameMatch[1].trim() : templateFile.replace(/\.(yaml|yml)$/, '');
                apiVersion = apiVersionMatch ? apiVersionMatch[1].trim() : undefined;
            }
            
            // Add header comments to indicate local rendering
            const yamlWithHeader = [
                `# Source: ${chartName}/templates/${templateFile}`,
                `# LOCALLY RENDERED (without Helm CLI) - Some template constructs may not be resolved`,
                `# Environment: ${environment}`,
                '',
                templateContent
            ].join('\n');
            
            resources.push({
                kind,
                name,
                namespace,
                apiVersion,
                yaml: yamlWithHeader,
                template: `${chartName}/templates/${templateFile}`,
                chart: chartName
            });
        }
        
        if (resources.length === 0) {
            return [{
                kind: 'Notice',
                name: 'no-templates-found',
                apiVersion: 'v1',
                yaml: `# Notice: Helm CLI not available and no template files found in ${templatesDir}\n#\n# To see rendered templates:\n# 1. Install Helm CLI: https://helm.sh/docs/intro/install/\n# 2. Refresh the chart view`,
                template: 'notice',
                chart: chartName
            }];
        }
        
        return resources;
    } catch (error) {
        console.error('Error generating placeholder resources:', error);
        return [{
            kind: 'Error',
            name: 'placeholder-generation-error',
            apiVersion: 'v1',
            yaml: `# Error generating fallback resources:\n# ${error}\n#\n# To see actual rendered templates:\n# 1. Install Helm CLI: https://helm.sh/docs/intro/install/\n# 2. Refresh the chart view`,
            template: 'error',
            chart: chartName
        }];
    }
}

/**
 * Substitute .Values.* references with actual values from merged values
 */
function substituteValues(template: string, values: any): string {
    let result = template;
    
    // Match patterns like {{ .Values.key.subkey }} using the defined pattern
    result = result.replace(TEMPLATE_PATTERNS.VALUES, (match, path) => {
        const value = getNestedValue(values, path);
        if (value !== undefined && value !== null) {
            // Convert value to YAML-appropriate format
            if (typeof value === 'string') {
                return value;
            } else if (typeof value === 'number' || typeof value === 'boolean') {
                return String(value);
            } else {
                // For complex values, leave the template as-is
                return match;
            }
        }
        return match; // Leave unresolved if value not found
    });
    
    return result;
}

/**
 * Get a nested value from an object using dot notation
 */
function getNestedValue(obj: any, path: string): any {
    const parts = path.split('.');
    let current = obj;
    
    for (const part of parts) {
        if (current && typeof current === 'object' && part in current) {
            current = current[part];
        } else {
            return undefined;
        }
    }
    
    return current;
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
