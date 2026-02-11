import type { RenderedResource } from './helmRenderer';
import * as yaml from 'js-yaml';

/**
 * Resource type categories for color coding and organization
 */
export enum ResourceCategory {
    Workload = 'Workload',
    Networking = 'Networking',
    Configuration = 'Configuration',
    Storage = 'Storage',
    RBAC = 'RBAC',
    Scaling = 'Scaling',
    Other = 'Other'
}

/**
 * Structured resource with full configuration and metadata
 */
export interface StructuredResource {
    kind: string;
    name: string;
    namespace?: string;
    apiVersion?: string;
    category: ResourceCategory;
    colorCode: string;
    icon: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    spec: any;
    metadata: any;
    status?: any;
    data?: any;
    yaml: string;
    template: string;
    chart: string;
}

/**
 * Resource hierarchy for collapsible tree display
 */
export interface ResourceHierarchy {
    kindGroups: Map<string, KindGroup>;
    totalCount: number;
}

export interface KindGroup {
    kind: string;
    category: ResourceCategory;
    colorCode: string;
    icon: string;
    resources: StructuredResource[];
    count: number;
}

/**
 * Color codes for different resource categories
 */
const CATEGORY_COLORS: Record<ResourceCategory, string> = {
    [ResourceCategory.Workload]: '#007acc',      // Blue
    [ResourceCategory.Networking]: '#4caf50',    // Green
    [ResourceCategory.Configuration]: '#ff9800', // Orange
    [ResourceCategory.Storage]: '#9c27b0',       // Purple
    [ResourceCategory.RBAC]: '#f44336',          // Red
    [ResourceCategory.Scaling]: '#00bcd4',       // Teal
    [ResourceCategory.Other]: '#9e9e9e'          // Gray
};

/**
 * Resource kind to category mapping
 */
const KIND_TO_CATEGORY: Record<string, ResourceCategory> = {
    'Deployment': ResourceCategory.Workload,
    'StatefulSet': ResourceCategory.Workload,
    'DaemonSet': ResourceCategory.Workload,
    'ReplicaSet': ResourceCategory.Workload,
    'Job': ResourceCategory.Workload,
    'CronJob': ResourceCategory.Workload,
    'Pod': ResourceCategory.Workload,
    'Service': ResourceCategory.Networking,
    'Ingress': ResourceCategory.Networking,
    'NetworkPolicy': ResourceCategory.Networking,
    'ConfigMap': ResourceCategory.Configuration,
    'Secret': ResourceCategory.Configuration,
    'PersistentVolumeClaim': ResourceCategory.Storage,
    'PersistentVolume': ResourceCategory.Storage,
    'ServiceAccount': ResourceCategory.RBAC,
    'Role': ResourceCategory.RBAC,
    'RoleBinding': ResourceCategory.RBAC,
    'ClusterRole': ResourceCategory.RBAC,
    'ClusterRoleBinding': ResourceCategory.RBAC,
    'HorizontalPodAutoscaler': ResourceCategory.Scaling,
    'Namespace': ResourceCategory.Other
};

/**
 * Parse rendered resources into structured hierarchy
 */
export function parseResources(resources: RenderedResource[]): ResourceHierarchy {
    const kindGroups = new Map<string, KindGroup>();

    for (const resource of resources) {
        const structured = parseResource(resource);
        const kind = structured.kind;

        if (!kindGroups.has(kind)) {
            kindGroups.set(kind, {
                kind,
                category: structured.category,
                colorCode: structured.colorCode,
                icon: structured.icon,
                resources: [],
                count: 0
            });
        }

        const group = kindGroups.get(kind)!;
        group.resources.push(structured);
        group.count++;
    }

    return {
        kindGroups,
        totalCount: resources.length
    };
}

/**
 * Parse a single resource with full configuration extraction
 */
export function parseResource(resource: RenderedResource): StructuredResource {
    const category = KIND_TO_CATEGORY[resource.kind] || ResourceCategory.Other;
    const colorCode = CATEGORY_COLORS[category];
    const icon = getIconName(resource.kind);

    // Parse YAML to extract full configuration
    let spec: any = {};
    let metadata: any = {};
    let status: any = {};
    let data: any = {};

    try {
        // Parse the YAML string to extract structured data
        const yamlContent = resource.yaml.replace(/^#.*$/gm, '').trim();
        const parsed = yaml.load(yamlContent) as any;

        if (parsed && typeof parsed === 'object') {
            spec = parsed.spec || {};
            metadata = parsed.metadata || {};
            status = parsed.status;
            data = parsed.data;

            // Mask secret data
            if (resource.kind === 'Secret' && data) {
                data = maskSecretData(data);
            }
        }
    } catch (error) {
        console.warn(`Error parsing YAML for ${resource.kind}/${resource.name}:`, error);
    }

    return {
        kind: resource.kind,
        name: resource.name,
        namespace: resource.namespace,
        apiVersion: resource.apiVersion,
        category,
        colorCode,
        icon,
        labels: resource.labels,
        annotations: resource.annotations,
        spec,
        metadata,
        status,
        data,
        yaml: resource.yaml,
        template: resource.template,
        chart: resource.chart
    };
}

/**
 * Mask secret data values while keeping keys visible
 */
function maskSecretData(data: Record<string, any>): Record<string, any> {
    const masked: Record<string, any> = {};
    for (const key in data) {
        masked[key] = '••••••••';
    }
    return masked;
}

/**
 * Get icon name for a resource kind
 */
function getIconName(kind: string): string {
    return kind.toLowerCase().replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * Search/filter resources based on criteria
 */
export interface SearchCriteria {
    searchText?: string;
    kinds?: string[];
    namespaces?: string[];
    hasOverrides?: boolean;
}

export function filterResources(
    hierarchy: ResourceHierarchy,
    criteria: SearchCriteria
): ResourceHierarchy {
    const filtered = new Map<string, KindGroup>();
    let totalCount = 0;

    for (const [kind, group] of hierarchy.kindGroups) {
        // Filter by kind
        if (criteria.kinds && criteria.kinds.length > 0 && !criteria.kinds.includes(kind)) {
            continue;
        }

        const filteredResources = group.resources.filter(resource => {
            // Filter by search text
            if (criteria.searchText) {
                const search = criteria.searchText.toLowerCase();
                const matchesName = resource.name.toLowerCase().includes(search);
                const matchesKind = resource.kind.toLowerCase().includes(search);
                const matchesNamespace = resource.namespace?.toLowerCase().includes(search);
                const matchesLabels = Object.values(resource.labels || {}).some(v =>
                    String(v).toLowerCase().includes(search)
                );

                if (!matchesName && !matchesKind && !matchesNamespace && !matchesLabels) {
                    return false;
                }
            }

            // Filter by namespace
            if (criteria.namespaces && criteria.namespaces.length > 0) {
                if (!criteria.namespaces.includes(resource.namespace || 'default')) {
                    return false;
                }
            }

            return true;
        });

        if (filteredResources.length > 0) {
            filtered.set(kind, {
                ...group,
                resources: filteredResources,
                count: filteredResources.length
            });
            totalCount += filteredResources.length;
        }
    }

    return {
        kindGroups: filtered,
        totalCount
    };
}

/**
 * Get unique namespaces from resources
 */
export function getUniqueNamespaces(hierarchy: ResourceHierarchy): string[] {
    const namespaces = new Set<string>();

    for (const group of hierarchy.kindGroups.values()) {
        for (const resource of group.resources) {
            namespaces.add(resource.namespace || 'default');
        }
    }

    return Array.from(namespaces).sort();
}

/**
 * Get unique kinds from resources
 */
export function getUniqueKinds(hierarchy: ResourceHierarchy): string[] {
    return Array.from(hierarchy.kindGroups.keys()).sort();
}
