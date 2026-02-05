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
    lines.push('# Merged Values with Source Annotations');
    lines.push('# Legend:');
    lines.push('#   [BASE] - From base values.yaml');
    lines.push('#   [OVERRIDE] - Overridden in environment-specific values file');
    lines.push('');

    const yamlString = yaml.dump(comparison.merged, {
        indent: 2,
        lineWidth: -1,
        noRefs: true
    });

    const yamlLines = yamlString.split('\n');
    
    // Placeholder: In a full implementation, we would parse the YAML structure
    // and insert comments next to each value based on the details map
    // For now, we'll append a summary at the top
    
    lines.push('# Overridden Values:');
    const overridden = Array.from(comparison.details.entries()).filter(([_, v]) => v.overridden);
    if (overridden.length === 0) {
        lines.push('#   (none)');
    } else {
        for (const [key, value] of overridden) {
            lines.push(`#   ${key}: ${JSON.stringify(value.value)} [from ${path.basename(value.source.file)}]`);
        }
    }
    lines.push('');
    
    lines.push(...yamlLines);

    return lines.join('\n');
}
