import type { RenderedResource } from './helmRenderer';
import * as yaml from 'js-yaml';

/**
 * Diff types for resources
 */
export enum DiffType {
    Added = 'Added',
    Removed = 'Removed',
    Modified = 'Modified',
    Unchanged = 'Unchanged'
}

/**
 * Diff result for a single resource
 */
export interface ResourceDiff {
    kind: string;
    name: string;
    namespace?: string;
    diffType: DiffType;
    leftYaml?: string;  // Environment 1
    rightYaml?: string; // Environment 2
    fieldDiffs?: FieldDiff[];
}

/**
 * Field-level diff
 */
export interface FieldDiff {
    path: string;
    leftValue: any;
    rightValue: any;
    diffType: DiffType;
}

/**
 * Environment comparison result
 */
export interface EnvironmentComparison {
    leftEnv: string;
    rightEnv: string;
    chartName: string;
    diffs: ResourceDiff[];
    summary: {
        added: number;
        removed: number;
        modified: number;
        unchanged: number;
        total: number;
    };
}

/**
 * Compare two sets of rendered resources from different environments
 */
export function compareEnvironments(
    leftEnv: string,
    leftResources: RenderedResource[],
    rightEnv: string,
    rightResources: RenderedResource[],
    chartName: string
): EnvironmentComparison {
    const diffs: ResourceDiff[] = [];

    // Create maps for quick lookup
    const leftMap = new Map<string, RenderedResource>();
    const rightMap = new Map<string, RenderedResource>();

    for (const resource of leftResources) {
        const key = getResourceKey(resource);
        leftMap.set(key, resource);
    }

    for (const resource of rightResources) {
        const key = getResourceKey(resource);
        rightMap.set(key, resource);
    }

    // Find added and modified resources
    for (const [key, rightResource] of rightMap) {
        const leftResource = leftMap.get(key);

        if (!leftResource) {
            // Resource added in right environment
            diffs.push({
                kind: rightResource.kind,
                name: rightResource.name,
                namespace: rightResource.namespace,
                diffType: DiffType.Added,
                rightYaml: rightResource.yaml
            });
        } else {
            // Resource exists in both - check if modified
            const fieldDiffs = compareResourceFields(leftResource, rightResource);

            if (fieldDiffs.length > 0) {
                diffs.push({
                    kind: rightResource.kind,
                    name: rightResource.name,
                    namespace: rightResource.namespace,
                    diffType: DiffType.Modified,
                    leftYaml: leftResource.yaml,
                    rightYaml: rightResource.yaml,
                    fieldDiffs
                });
            } else {
                diffs.push({
                    kind: rightResource.kind,
                    name: rightResource.name,
                    namespace: rightResource.namespace,
                    diffType: DiffType.Unchanged,
                    leftYaml: leftResource.yaml,
                    rightYaml: rightResource.yaml
                });
            }

            // Remove from left map to track removed resources
            leftMap.delete(key);
        }
    }

    // Remaining resources in left map were removed
    for (const [_, leftResource] of leftMap) {
        diffs.push({
            kind: leftResource.kind,
            name: leftResource.name,
            namespace: leftResource.namespace,
            diffType: DiffType.Removed,
            leftYaml: leftResource.yaml
        });
    }

    // Calculate summary
    const summary = {
        added: diffs.filter(d => d.diffType === DiffType.Added).length,
        removed: diffs.filter(d => d.diffType === DiffType.Removed).length,
        modified: diffs.filter(d => d.diffType === DiffType.Modified).length,
        unchanged: diffs.filter(d => d.diffType === DiffType.Unchanged).length,
        total: diffs.length
    };

    return {
        leftEnv,
        rightEnv,
        chartName,
        diffs,
        summary
    };
}

/**
 * Generate a unique key for a resource
 */
function getResourceKey(resource: RenderedResource): string {
    const namespace = resource.namespace || 'default';
    return `${resource.kind}/${namespace}/${resource.name}`;
}

/**
 * Compare fields between two resources
 */
function compareResourceFields(left: RenderedResource, right: RenderedResource): FieldDiff[] {
    const diffs: FieldDiff[] = [];

    try {
        // Parse YAML to objects
        const leftYaml = left.yaml.replace(/^#.*$/gm, '').trim();
        const rightYaml = right.yaml.replace(/^#.*$/gm, '').trim();

        const leftObj = yaml.load(leftYaml) as any;
        const rightObj = yaml.load(rightYaml) as any;

        if (leftObj && rightObj) {
            // Compare spec, metadata, etc.
            compareObjects('spec', leftObj.spec, rightObj.spec, diffs);
            compareObjects('metadata.labels', leftObj.metadata?.labels, rightObj.metadata?.labels, diffs);
            compareObjects('metadata.annotations', leftObj.metadata?.annotations, rightObj.metadata?.annotations, diffs);
        }
    } catch (error) {
        console.warn('Error comparing resource fields:', error);
    }

    return diffs;
}

/**
 * Recursively compare two objects and track differences
 */
function compareObjects(basePath: string, left: any, right: any, diffs: FieldDiff[], maxDepth: number = 10): void {
    if (maxDepth <= 0) {
        return;
    }

    // Handle null/undefined
    if (left === null || left === undefined) {
        if (right !== null && right !== undefined) {
            diffs.push({
                path: basePath,
                leftValue: left,
                rightValue: right,
                diffType: DiffType.Added
            });
        }
        return;
    }

    if (right === null || right === undefined) {
        diffs.push({
            path: basePath,
            leftValue: left,
            rightValue: right,
            diffType: DiffType.Removed
        });
        return;
    }

    // Handle primitives
    if (typeof left !== 'object' || typeof right !== 'object') {
        if (left !== right) {
            diffs.push({
                path: basePath,
                leftValue: left,
                rightValue: right,
                diffType: DiffType.Modified
            });
        }
        return;
    }

    // Handle arrays
    if (Array.isArray(left) && Array.isArray(right)) {
        if (JSON.stringify(left) !== JSON.stringify(right)) {
            diffs.push({
                path: basePath,
                leftValue: left,
                rightValue: right,
                diffType: DiffType.Modified
            });
        }
        return;
    }

    // Handle objects
    const leftKeys = new Set(Object.keys(left));
    const rightKeys = new Set(Object.keys(right));

    // Check all keys in both objects
    const allKeys = new Set([...leftKeys, ...rightKeys]);

    for (const key of allKeys) {
        const path = basePath ? `${basePath}.${key}` : key;

        if (!leftKeys.has(key)) {
            diffs.push({
                path,
                leftValue: undefined,
                rightValue: right[key],
                diffType: DiffType.Added
            });
        } else if (!rightKeys.has(key)) {
            diffs.push({
                path,
                leftValue: left[key],
                rightValue: undefined,
                diffType: DiffType.Removed
            });
        } else {
            // Both have the key - recurse
            compareObjects(path, left[key], right[key], diffs, maxDepth - 1);
        }
    }
}

/**
 * Format a diff for display
 */
export function formatDiff(diff: ResourceDiff): string {
    const lines: string[] = [];

    lines.push(`## ${diff.kind}/${diff.name}`);
    if (diff.namespace) {
        lines.push(`Namespace: ${diff.namespace}`);
    }
    lines.push(`Status: ${diff.diffType}`);
    lines.push('');

    if (diff.diffType === DiffType.Added) {
        lines.push('### Added in Right Environment');
        lines.push('```yaml');
        lines.push(diff.rightYaml || '');
        lines.push('```');
    } else if (diff.diffType === DiffType.Removed) {
        lines.push('### Removed from Left Environment');
        lines.push('```yaml');
        lines.push(diff.leftYaml || '');
        lines.push('```');
    } else if (diff.diffType === DiffType.Modified) {
        lines.push('### Field Differences');
        if (diff.fieldDiffs && diff.fieldDiffs.length > 0) {
            for (const fieldDiff of diff.fieldDiffs) {
                const leftVal = typeof fieldDiff.leftValue === 'object'
                    ? JSON.stringify(fieldDiff.leftValue)
                    : String(fieldDiff.leftValue);
                const rightVal = typeof fieldDiff.rightValue === 'object'
                    ? JSON.stringify(fieldDiff.rightValue)
                    : String(fieldDiff.rightValue);
                lines.push(`- **${fieldDiff.path}**: ${leftVal} → ${rightVal}`);
            }
        }
        lines.push('');
        lines.push('### Left Environment');
        lines.push('```yaml');
        lines.push(diff.leftYaml || '');
        lines.push('```');
        lines.push('');
        lines.push('### Right Environment');
        lines.push('```yaml');
        lines.push(diff.rightYaml || '');
        lines.push('```');
    }

    return lines.join('\n');
}
