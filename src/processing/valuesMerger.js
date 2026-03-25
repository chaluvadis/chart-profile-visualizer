"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeValues = mergeValues;
exports.generateAnnotatedYaml = generateAnnotatedYaml;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const yaml = __importStar(require("js-yaml"));
/**
 * Merges base values.yaml with environment-specific values-<env>.yaml
 * Tracks which values were overridden and their sources
 */
function mergeValues(chartPath, environment) {
    const baseValuesPath = path.join(chartPath, "values.yaml");
    const envValuesPath = path.join(chartPath, `values-${environment}.yaml`);
    const baseValues = loadYamlFile(baseValuesPath);
    const envValues = loadYamlFile(envValuesPath);
    const details = new Map();
    const merged = deepMerge(baseValues, envValues, "", details, baseValuesPath, envValuesPath);
    return {
        merged,
        details,
    };
}
/**
 * Deep merge two objects, tracking sources and overrides
 */
function deepMerge(base, override, path, details, baseFile, overrideFile) {
    if (override === undefined || override === null) {
        if (base !== undefined && base !== null) {
            recordValue(path, base, baseFile, false, details);
        }
        return base;
    }
    if (base === undefined || base === null) {
        recordValue(path, override, overrideFile, false, details, true);
        return override;
    }
    if (typeof override !== "object" || typeof base !== "object") {
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
    const result = Array.isArray(base) ? [] : {};
    const allKeys = new Set([...Object.keys(base), ...Object.keys(override)]);
    for (const key of allKeys) {
        const newPath = path ? `${path}.${key}` : key;
        const baseValue = base[key];
        const overrideValue = override[key];
        if (overrideValue !== undefined) {
            result[key] = deepMerge(baseValue, overrideValue, newPath, details, baseFile, overrideFile);
        }
        else if (baseValue !== undefined) {
            result[key] = baseValue;
            recordValue(newPath, baseValue, baseFile, false, details);
        }
    }
    return result;
}
function recordValue(path, value, file, overridden, details, missingInBase = false) {
    if (path) {
        details.set(path, {
            value,
            source: { file },
            overridden,
            missingInBase,
        });
    }
}
function loadYamlFile(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, "utf8");
            return yaml.load(content) || {};
        }
    }
    catch (error) {
        console.error(`Error loading YAML file ${filePath}:`, error);
    }
    return {};
}
/**
 * Generate a YAML representation with comments indicating value sources
 */
function generateAnnotatedYaml(comparison) {
    const lines = [];
    // Calculate statistics efficiently in a single iteration
    let overriddenCount = 0;
    let baseOnlyCount = 0;
    let envOnlyCount = 0;
    for (const [_, value] of comparison.details.entries()) {
        if (value.missingInBase) {
            envOnlyCount++;
        }
        else if (value.overridden) {
            overriddenCount++;
        }
        else {
            baseOnlyCount++;
        }
    }
    // Header with summary
    lines.push("# Merged Values with Source Annotations");
    lines.push("# Legend:");
    lines.push("#   [BASE from values.yaml] - From base values.yaml");
    lines.push("#   [OVERRIDE from values-*.yaml] - Overridden in environment-specific values file");
    lines.push("#   [ADDED from values-*.yaml] - Only in environment-specific file (not in base)");
    lines.push("");
    lines.push(`# Summary: ${overriddenCount} values overridden, ${envOnlyCount} values added, ${baseOnlyCount} values from base`);
    lines.push("");
    // Dump the merged YAML
    const yamlString = yaml.dump(comparison.merged, {
        indent: 2,
        lineWidth: -1,
        noRefs: true,
    });
    const yamlLines = yamlString.split("\n");
    // Process each line to add inline annotations
    const annotatedLines = annotateYamlLines(yamlLines, comparison.details);
    lines.push(...annotatedLines);
    return lines.join("\n");
}
/**
 * Annotate YAML lines with source information based on the details map
 */
function annotateYamlLines(yamlLines, details) {
    const result = [];
    const pathStack = [];
    let currentIndent = 0;
    for (const line of yamlLines) {
        if (!line.trim() || line.trim().startsWith("#")) {
            result.push(line);
            continue;
        }
        // Calculate indentation level
        const indent = line.search(/\S/);
        const indentLevel = indent / 2;
        // Check for array items BEFORE key-value pairs to handle "- name: value" correctly
        if (line.trim().startsWith("-")) {
            // Array item line
            // Check if it's an array item with a key-value (e.g., "- name: foo")
            const arrayItemKeyMatch = line.match(/^(\s*)-\s+([^:]+):\s*(.*)$/);
            if (arrayItemKeyMatch) {
                // Array item with key-value pair like "- name: foo"
                // This is part of an array of objects
                // We still want to annotate the array itself, not individual object fields
                result.push(line);
            }
            else {
                // Simple array item like "- value" or "- |"
                const fullPath = pathStack.join(".");
                if (details.has(fullPath)) {
                    const detail = details.get(fullPath);
                    const sourceFile = path.basename(detail.source.file);
                    let annotation;
                    if (detail.missingInBase) {
                        annotation = `# [ADDED from ${sourceFile}]`;
                    }
                    else if (detail.overridden) {
                        annotation = `# [OVERRIDE from ${sourceFile}]`;
                    }
                    else {
                        annotation = `# [BASE from ${sourceFile}]`;
                    }
                    result.push(`${line}  ${annotation}`);
                }
                else {
                    result.push(line);
                }
            }
            continue;
        }
        // Parse the line to extract key
        const keyMatch = line.match(/^(\s*)([^:]+):\s*(.*)$/);
        if (keyMatch) {
            const [, , key, value] = keyMatch;
            const trimmedKey = key.trim();
            // Adjust path stack based on indentation
            if (indentLevel < currentIndent) {
                // Going back up the hierarchy
                const levelsUp = currentIndent - indentLevel;
                for (let i = 0; i < levelsUp; i++) {
                    pathStack.pop();
                }
            }
            else if (indentLevel === currentIndent && pathStack.length > 0) {
                // Same level, replace last item
                pathStack.pop();
            }
            // Add current key to path
            pathStack.push(trimmedKey);
            currentIndent = indentLevel;
            // Build the full path
            const fullPath = pathStack.join(".");
            // Check if this is a leaf value (has actual value, not just a key)
            const trimmedValue = value.trim();
            const isLeafValue = isYamlLeafValue(trimmedValue);
            if (isLeafValue && details.has(fullPath)) {
                const detail = details.get(fullPath);
                const sourceFile = path.basename(detail.source.file);
                let annotation;
                if (detail.missingInBase) {
                    annotation = `# [ADDED from ${sourceFile}]`;
                }
                else if (detail.overridden) {
                    annotation = `# [OVERRIDE from ${sourceFile}]`;
                }
                else {
                    annotation = `# [BASE from ${sourceFile}]`;
                }
                result.push(`${line}  ${annotation}`);
            }
            else {
                result.push(line);
            }
        }
        else {
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
function isYamlLeafValue(trimmedValue) {
    return (trimmedValue.length > 0 &&
        !trimmedValue.startsWith("[") && // Not an inline array
        !trimmedValue.startsWith("{") && // Not an inline object
        trimmedValue !== "|" && // Not a block literal
        trimmedValue !== ">"); // Not a block folded
}
//# sourceMappingURL=valuesMerger.js.map