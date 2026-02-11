import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

export interface ValueSource {
    file: string;
    line?: number;
}

export interface MergedValue {
    value: any;
    source: ValueSource;
    overridden: boolean;
    missing?: boolean;
}

export interface ValuesComparison {
    merged: any;
    details: Map<string, MergedValue>;
}

/**
 * Merges base values.yaml with environment-specific values-<env>.yaml
 * Tracks which values were overridden and their sources
 */
export function mergeValues(chartPath: string, environment: string): ValuesComparison {
    const baseValuesPath = path.join(chartPath, 'values.yaml');
    const envValuesPath = path.join(chartPath, `values-${environment}.yaml`);

    const baseValues = loadYamlFile(baseValuesPath);
    const envValues = loadYamlFile(envValuesPath);

    const details = new Map<string, MergedValue>();
    const merged = deepMerge(baseValues, envValues, '', details, baseValuesPath, envValuesPath);

    return {
        merged,
        details
    };
}

/**
 * Deep merge two objects, tracking sources and overrides
 */
function deepMerge(
    base: any,
    override: any,
    path: string,
    details: Map<string, MergedValue>,
    baseFile: string,
    overrideFile: string
): any {
    if (override === undefined || override === null) {
        if (base !== undefined && base !== null) {
            recordValue(path, base, baseFile, false, details);
        }
        return base;
    }

    if (base === undefined || base === null) {
        recordValue(path, override, overrideFile, false, details);
        return override;
    }

    if (typeof override !== 'object' || typeof base !== 'object') {
        // Override primitive value
        recordValue(path, override, overrideFile, true, details);
        return override;
    }

    if (Array.isArray(override)) {
        // Arrays are replaced entirely
        recordValue(path, override, overrideFile, Array.isArray(base), details);
        return override;
    }

    // Merge objects
    const result: any = Array.isArray(base) ? [] : {};
    const allKeys = new Set([...Object.keys(base), ...Object.keys(override)]);

    for (const key of allKeys) {
        const newPath = path ? `${path}.${key}` : key;
        const baseValue = base[key];
        const overrideValue = override[key];

        if (overrideValue !== undefined) {
            result[key] = deepMerge(baseValue, overrideValue, newPath, details, baseFile, overrideFile);
        } else if (baseValue !== undefined) {
            result[key] = baseValue;
            recordValue(newPath, baseValue, baseFile, false, details);
        }
    }

    return result;
}

function recordValue(
    path: string,
    value: any,
    file: string,
    overridden: boolean,
    details: Map<string, MergedValue>
): void {
    if (path) {
        details.set(path, {
            value,
            source: { file },
            overridden
        });
    }
}

function loadYamlFile(filePath: string): any {
    try {
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf8');
            return yaml.load(content) || {};
        }
    } catch (error) {
        console.error(`Error loading YAML file ${filePath}:`, error);
    }
    return {};
}

/**
 * Generate a YAML representation with comments indicating value sources
 */
export function generateAnnotatedYaml(comparison: ValuesComparison): string {
    const lines: string[] = [];
    
    // Calculate statistics efficiently in a single iteration
    let overriddenCount = 0;
    let baseOnlyCount = 0;
    for (const [_, value] of comparison.details.entries()) {
        if (value.overridden) {
            overriddenCount++;
        } else {
            baseOnlyCount++;
        }
    }
    
    // Header with summary
    lines.push('# Merged Values with Source Annotations');
    lines.push('# Legend:');
    lines.push('#   [BASE from values.yaml] - From base values.yaml');
    lines.push('#   [OVERRIDE from values-*.yaml] - Overridden in environment-specific values file');
    lines.push('');
    lines.push(`# Summary: ${overriddenCount} values overridden, ${baseOnlyCount} values from base`);
    lines.push('');

    // Dump the merged YAML
    const yamlString = yaml.dump(comparison.merged, {
        indent: 2,
        lineWidth: -1,
        noRefs: true
    });

    const yamlLines = yamlString.split('\n');
    
    // Process each line to add inline annotations
    const annotatedLines = annotateYamlLines(yamlLines, comparison.details);
    lines.push(...annotatedLines);

    return lines.join('\n');
}

/**
 * Annotate YAML lines with source information based on the details map
 */
function annotateYamlLines(yamlLines: string[], details: Map<string, MergedValue>): string[] {
    const result: string[] = [];
    const pathStack: string[] = [];
    let currentIndent = 0;

    for (const line of yamlLines) {
        if (!line.trim() || line.trim().startsWith('#')) {
            result.push(line);
            continue;
        }

        // Calculate indentation level
        const indent = line.search(/\S/);
        const indentLevel = indent / 2;

        // Parse the line to extract key
        const keyMatch = line.match(/^(\s*)([^:]+):\s*(.*)$/);
        
        if (keyMatch) {
            const [, spaces, key, value] = keyMatch;
            const trimmedKey = key.trim();
            
            // Adjust path stack based on indentation
            if (indentLevel < currentIndent) {
                // Going back up the hierarchy
                const levelsUp = currentIndent - indentLevel;
                for (let i = 0; i < levelsUp; i++) {
                    pathStack.pop();
                }
            } else if (indentLevel === currentIndent && pathStack.length > 0) {
                // Same level, replace last item
                pathStack.pop();
            }
            
            // Add current key to path
            pathStack.push(trimmedKey);
            currentIndent = indentLevel;
            
            // Build the full path
            const fullPath = pathStack.join('.');
            
            // Check if this is a leaf value (has actual value, not just a key)
            const trimmedValue = value.trim();
            const isLeafValue = isYamlLeafValue(trimmedValue);
            
            if (isLeafValue && details.has(fullPath)) {
                const detail = details.get(fullPath)!;
                const sourceFile = path.basename(detail.source.file);
                const annotation = detail.overridden 
                    ? `# [OVERRIDE from ${sourceFile}]`
                    : `# [BASE from ${sourceFile}]`;
                result.push(`${line}  ${annotation}`);
            } else {
                result.push(line);
            }
        } else if (line.trim().startsWith('-')) {
            // Array item - use parent path for annotation
            const fullPath = pathStack.join('.');
            if (details.has(fullPath)) {
                const detail = details.get(fullPath)!;
                const sourceFile = path.basename(detail.source.file);
                const annotation = detail.overridden 
                    ? `# [OVERRIDE from ${sourceFile}]`
                    : `# [BASE from ${sourceFile}]`;
                result.push(`${line}  ${annotation}`);
            } else {
                result.push(line);
            }
        } else {
            result.push(line);
        }
    }

    return result;
}

/**
 * Determines if a YAML value string represents a leaf value (primitive) or a complex structure.
 * 
 * Returns false for:
 * - Arrays (starting with '[')
 * - Objects (starting with '{')
 * - Block scalars (indicated by '|' or '>')
 * - Empty values
 * 
 * Returns true for primitive values like strings, numbers, booleans.
 */
function isYamlLeafValue(trimmedValue: string): boolean {
    return trimmedValue.length > 0 && 
           !trimmedValue.startsWith('[') &&  // Not an inline array
           !trimmedValue.startsWith('{') &&  // Not an inline object
           trimmedValue !== '|' &&            // Not a block literal
           trimmedValue !== '>';              // Not a block folded
}
