import type { StructuredResource } from "./resourceVisualizer";

/**
 * Represents a relationship/connection between two resources
 */
export interface ResourceRelationship {
	source: string; // resource ID (kind/name)
	target: string; // resource ID (kind/name)
	type: RelationshipType;
	label?: string;
	namespace?: string; // For cross-namespace relationships
	crossNamespace?: boolean;
}

/**
 * Types of relationships between resources
 */
export enum RelationshipType {
	Ownership = "ownership", // ownerReferences
	Selection = "selection", // label selectors (Service -> Pods, etc.)
	Reference = "reference", // Direct references (ConfigMapRef, SecretRef, etc.)
	Ingress = "ingress", // Ingress -> Service
	Storage = "storage", // PVC references
	RBAC = "rbac", // ServiceAccount, Role bindings
	HPA = "hpa", // HorizontalPodAutoscaler -> Deployment
	NetworkPolicy = "networkpolicy", // NetworkPolicy -> Pods/Namespaces
	Dependency = "dependency", // Chart dependencies
}

/**
 * Label selector with matchLabels and matchExpressions support
 */
export interface LabelSelector {
	matchLabels?: Record<string, string>;
	matchExpressions?: LabelSelectorRequirement[];
}

/**
 * Label selector requirement (for matchExpressions)
 */
export interface LabelSelectorRequirement {
	key: string;
	operator: "In" | "NotIn" | "Exists" | "DoesNotExist";
	values?: string[];
}

/**
 * Node in the architecture diagram
 */
export interface ArchitectureNode {
	id: string;
	kind: string;
	name: string;
	namespace?: string;
	category: string;
	colorCode: string;
	icon: string;
	// Metrics for importance
	inDegree: number;
	outDegree: number;
	isCritical: boolean;
	// Runtime state
	healthStatus?: "Healthy" | "Warning" | "Critical" | "Unknown" | "NotFound";
	healthMessage?: string;
	// Dependency info
	dependencySource?: string; // Which subchart/dependency this came from
}

/**
 * Parse a label selector from a resource
 */
function parseLabelSelector(selector: any): LabelSelector {
	if (!selector) return {};

	const result: LabelSelector = {};

	// Handle matchLabels
	if (selector.matchLabels && typeof selector.matchLabels === "object") {
		result.matchLabels = selector.matchLabels;
	} else if (typeof selector === "object" && !selector.matchExpressions) {
		// Simple key-value selector (like Service.spec.selector)
		result.matchLabels = selector;
	}

	// Handle matchExpressions
	if (selector.matchExpressions && Array.isArray(selector.matchExpressions)) {
		result.matchExpressions = selector.matchExpressions.map((expr: any) => ({
			key: expr.key,
			operator: expr.operator,
			values: expr.values,
		}));
	}

	return result;
}

/**
 * Check if a resource matches a label selector (with matchExpressions support)
 */
function matchesLabelSelector(resource: StructuredResource, selector: LabelSelector): boolean {
	const resourceLabels = resource.metadata?.labels || resource.labels || {};

	// Check matchLabels (all must match)
	if (selector.matchLabels) {
		for (const [key, value] of Object.entries(selector.matchLabels)) {
			if (resourceLabels[key] !== value) {
				return false;
			}
		}
	}

	// Check matchExpressions
	if (selector.matchExpressions) {
		for (const expr of selector.matchExpressions) {
			const labelValue = resourceLabels[expr.key];

			switch (expr.operator) {
				case "In":
					if (!expr.values || !expr.values.includes(labelValue)) {
						return false;
					}
					break;
				case "NotIn":
					if (expr.values && expr.values.includes(labelValue)) {
						return false;
					}
					break;
				case "Exists":
					if (!(expr.key in resourceLabels)) {
						return false;
					}
					break;
				case "DoesNotExist":
					if (expr.key in resourceLabels) {
						return false;
					}
					break;
			}
		}
	}

	return true;
}

/**
 * Detect relationships between resources for architecture diagram
 */
export function detectRelationships(resources: StructuredResource[]): ResourceRelationship[] {
	const relationships: ResourceRelationship[] = [];

	for (const resource of resources) {
		const resourceNamespace = resource.namespace || resource.metadata?.namespace;

		// 1. Owner references (hierarchical relationships)
		const ownerRefs = resource.metadata?.ownerReferences;
		if (ownerRefs && Array.isArray(ownerRefs)) {
			for (const owner of ownerRefs) {
				relationships.push({
					source: `${owner.kind}/${owner.name}`,
					target: `${resource.kind}/${resource.name}`,
					type: RelationshipType.Ownership,
					label: "owns",
					namespace: resourceNamespace,
				});
			}
		}

		// 2. Service selectors (Service -> Pods/Deployments) with matchExpressions support
		if (resource.kind === "Service" && resource.spec?.selector) {
			const selector = parseLabelSelector(resource.spec.selector);
			// Find matching resources
			for (const target of resources) {
				if (
					(target.kind === "Deployment" ||
						target.kind === "StatefulSet" ||
						target.kind === "DaemonSet" ||
						target.kind === "Pod" ||
						target.kind === "ReplicaSet") &&
					matchesLabelSelector(target, selector)
				) {
					const targetNamespace = target.namespace || target.metadata?.namespace;
					relationships.push({
						source: `${resource.kind}/${resource.name}`,
						target: `${target.kind}/${target.name}`,
						type: RelationshipType.Selection,
						label: "routes to",
						namespace: resourceNamespace,
						crossNamespace: resourceNamespace !== targetNamespace,
					});
				}
			}
		}

		// 3. Ingress -> Service (with cross-namespace support)
		if (resource.kind === "Ingress") {
			const rules = resource.spec?.rules || [];
			const defaultBackend = resource.spec?.defaultBackend;

			// Handle default backend
			if (defaultBackend?.service?.name) {
				const targetNs = defaultBackend.service.namespace || resourceNamespace;
				relationships.push({
					source: `${resource.kind}/${resource.name}`,
					target: `Service/${defaultBackend.service.name}`,
					type: RelationshipType.Ingress,
					label: "routes to",
					namespace: resourceNamespace,
					crossNamespace: targetNs !== resourceNamespace,
				});
			}

			// Handle rules
			for (const rule of rules) {
				const paths = rule.http?.paths || [];
				for (const pathRule of paths) {
					const serviceName = pathRule.backend?.service?.name || pathRule.backend?.serviceName;
					const serviceNamespace = pathRule.backend?.service?.namespace;

					if (serviceName) {
						const targetNs = serviceNamespace || resourceNamespace;
						relationships.push({
							source: `${resource.kind}/${resource.name}`,
							target: `Service/${serviceName}`,
							type: RelationshipType.Ingress,
							label: "routes to",
							namespace: resourceNamespace,
							crossNamespace: targetNs !== resourceNamespace,
						});
					}
				}
			}
		}

		// 4. ConfigMap and Secret references (enhanced)
		detectConfigReferences(resource, relationships, resourceNamespace);

		// 5. PersistentVolumeClaim references
		detectStorageReferences(resource, relationships, resourceNamespace);

		// 6. ServiceAccount references
		detectRBACReferences(resource, resources, relationships, resourceNamespace);

		// 7. HorizontalPodAutoscaler references
		if (resource.kind === "HorizontalPodAutoscaler") {
			const scaleTargetRef = resource.spec?.scaleTargetRef;
			if (scaleTargetRef) {
				relationships.push({
					source: `${resource.kind}/${resource.name}`,
					target: `${scaleTargetRef.kind}/${scaleTargetRef.name}`,
					type: RelationshipType.HPA,
					label: "scales",
					namespace: resourceNamespace,
				});
			}
		}

		// 8. NetworkPolicy references
		if (resource.kind === "NetworkPolicy") {
			detectNetworkPolicyReferences(resource, resources, relationships, resourceNamespace);
		}

		// 9. PodDisruptionBudget references
		if (resource.kind === "PodDisruptionBudget") {
			const selector = resource.spec?.selector;
			if (selector) {
				const labelSelector = parseLabelSelector(selector);
				for (const target of resources) {
					if (
						(target.kind === "Deployment" ||
							target.kind === "StatefulSet" ||
							target.kind === "DaemonSet") &&
						matchesLabelSelector(target, labelSelector)
					) {
						relationships.push({
							source: `${resource.kind}/${resource.name}`,
							target: `${target.kind}/${target.name}`,
							type: RelationshipType.Reference,
							label: "protects",
							namespace: resourceNamespace,
						});
					}
				}
			}
		}

		// 10. CronJob -> Job template reference
		if (resource.kind === "CronJob") {
			const jobTemplate = resource.spec?.jobTemplate;
			if (jobTemplate) {
				// CronJob creates Jobs with owner reference
				relationships.push({
					source: `${resource.kind}/${resource.name}`,
					target: `Job/${resource.name}-*`,
					type: RelationshipType.Ownership,
					label: "creates",
					namespace: resourceNamespace,
				});
			}
		}
	}

	return relationships;
}

/**
 * Detect ConfigMap and Secret references
 */
function detectConfigReferences(
	resource: StructuredResource,
	relationships: ResourceRelationship[],
	namespace?: string
): void {
	// Volume mounts
	if (resource.spec?.volumes) {
		for (const volume of resource.spec.volumes) {
			if (volume.configMap?.name) {
				relationships.push({
					source: `${resource.kind}/${resource.name}`,
					target: `ConfigMap/${volume.configMap.name}`,
					type: RelationshipType.Reference,
					label: "mounts",
					namespace,
				});
			}
			if (volume.secret?.secretName) {
				relationships.push({
					source: `${resource.kind}/${resource.name}`,
					target: `Secret/${volume.secret.secretName}`,
					type: RelationshipType.Reference,
					label: "mounts",
					namespace,
				});
			}
		}
	}

	// EnvFrom references
	const podSpec = resource.spec?.template?.spec || resource.spec;
	if (podSpec?.containers) {
		for (const container of podSpec.containers) {
			const envFrom = container.envFrom || [];
			for (const ref of envFrom) {
				if (ref.configMapRef?.name) {
					const targetNs = ref.configMapRef.namespace || namespace;
					relationships.push({
						source: `${resource.kind}/${resource.name}`,
						target: `ConfigMap/${ref.configMapRef.name}`,
						type: RelationshipType.Reference,
						label: "uses",
						namespace,
						crossNamespace: targetNs !== namespace,
					});
				}
				if (ref.secretRef?.name) {
					const targetNs = ref.secretRef.namespace || namespace;
					relationships.push({
						source: `${resource.kind}/${resource.name}`,
						target: `Secret/${ref.secretRef.name}`,
						type: RelationshipType.Reference,
						label: "uses",
						namespace,
						crossNamespace: targetNs !== namespace,
					});
				}
			}

			// Individual env vars
			const env = container.env || [];
			for (const envVar of env) {
				if (envVar.valueFrom?.configMapKeyRef?.name) {
					relationships.push({
						source: `${resource.kind}/${resource.name}`,
						target: `ConfigMap/${envVar.valueFrom.configMapKeyRef.name}`,
						type: RelationshipType.Reference,
						label: "uses",
						namespace,
					});
				}
				if (envVar.valueFrom?.secretKeyRef?.name) {
					relationships.push({
						source: `${resource.kind}/${resource.name}`,
						target: `Secret/${envVar.valueFrom.secretKeyRef.name}`,
						type: RelationshipType.Reference,
						label: "uses",
						namespace,
					});
				}
			}
		}

		// Also check initContainers
		const initContainers = podSpec.initContainers || [];
		for (const container of initContainers) {
			const envFrom = container.envFrom || [];
			for (const ref of envFrom) {
				if (ref.configMapRef?.name) {
					relationships.push({
						source: `${resource.kind}/${resource.name}`,
						target: `ConfigMap/${ref.configMapRef.name}`,
						type: RelationshipType.Reference,
						label: "uses",
						namespace,
					});
				}
				if (ref.secretRef?.name) {
					relationships.push({
						source: `${resource.kind}/${resource.name}`,
						target: `Secret/${ref.secretRef.name}`,
						type: RelationshipType.Reference,
						label: "uses",
						namespace,
					});
				}
			}
		}
	}
}

/**
 * Detect storage references
 */
function detectStorageReferences(
	resource: StructuredResource,
	relationships: ResourceRelationship[],
	namespace?: string
): void {
	const volumes = resource.spec?.volumes || resource.spec?.template?.spec?.volumes || [];

	for (const volume of volumes) {
		if (volume.persistentVolumeClaim?.claimName) {
			relationships.push({
				source: `${resource.kind}/${resource.name}`,
				target: `PersistentVolumeClaim/${volume.persistentVolumeClaim.claimName}`,
				type: RelationshipType.Storage,
				label: "uses",
				namespace,
			});
		}

		// Ephemeral storage
		if (volume.ephemeral?.volumeClaimTemplate) {
			relationships.push({
				source: `${resource.kind}/${resource.name}`,
				target: `PersistentVolumeClaim/ephemeral-${resource.name}`,
				type: RelationshipType.Storage,
				label: "creates ephemeral",
				namespace,
			});
		}
	}

	// CSI storage
	if (resource.kind === "PersistentVolumeClaim") {
		const dataSource = resource.spec?.dataSource;
		if (dataSource) {
			relationships.push({
				source: `${resource.kind}/${resource.name}`,
				target: `${dataSource.kind}/${dataSource.name}`,
				type: RelationshipType.Storage,
				label: "from",
				namespace,
			});
		}
	}
}

/**
 * Detect RBAC references
 */
function detectRBACReferences(
	resource: StructuredResource,
	allResources: StructuredResource[],
	relationships: ResourceRelationship[],
	namespace?: string
): void {
	// ServiceAccount usage
	const podSpec = resource.spec?.template?.spec || resource.spec;
	const saName = podSpec?.serviceAccountName || resource.spec?.serviceAccountName;

	if (saName) {
		relationships.push({
			source: `${resource.kind}/${resource.name}`,
			target: `ServiceAccount/${saName}`,
			type: RelationshipType.RBAC,
			label: "uses",
			namespace,
		});
	}

	// RoleBinding/ClusterRoleBinding
	if (resource.kind === "RoleBinding" || resource.kind === "ClusterRoleBinding") {
		// Role reference
		const roleRef = resource.spec?.roleRef;
		if (roleRef?.name) {
			const roleKind = roleRef.kind || "Role";
			relationships.push({
				source: `${resource.kind}/${resource.name}`,
				target: `${roleKind}/${roleRef.name}`,
				type: RelationshipType.RBAC,
				label: "binds",
				namespace,
			});
		}

		// Subject references
		const subjects = resource.spec?.subjects || [];
		for (const subject of subjects) {
			if (subject.kind === "ServiceAccount" && subject.name) {
				const subjectNs = subject.namespace || namespace;
				relationships.push({
					source: `${subject.kind}/${subject.name}`,
					target: `${resource.kind}/${resource.name}`,
					type: RelationshipType.RBAC,
					label: "bound by",
					namespace: subjectNs,
					crossNamespace: subjectNs !== namespace,
				});
			}
		}
	}

	// ServiceAccount -> ImagePullSecrets
	if (resource.kind === "ServiceAccount") {
		const spec = resource.spec as Record<string, unknown> | undefined;
		const imagePullSecrets = (spec?.imagePullSecrets || spec?.secrets || []) as Array<{ name?: string } | string>;
		for (const secret of imagePullSecrets) {
			const secretName = typeof secret === "string" ? secret : secret.name;
			if (secretName) {
				relationships.push({
					source: `${resource.kind}/${resource.name}`,
					target: `Secret/${secretName}`,
					type: RelationshipType.Reference,
					label: "pulls from",
					namespace,
				});
			}
		}
	}
}

/**
 * Detect NetworkPolicy references
 */
function detectNetworkPolicyReferences(
	resource: StructuredResource,
	allResources: StructuredResource[],
	relationships: ResourceRelationship[],
	namespace?: string
): void {
	const podSelector = resource.spec?.podSelector;
	if (podSelector) {
		const selector = parseLabelSelector(podSelector);
		for (const target of allResources) {
			if (
				(target.kind === "Deployment" ||
					target.kind === "StatefulSet" ||
					target.kind === "DaemonSet" ||
					target.kind === "Pod") &&
				matchesLabelSelector(target, selector)
			) {
				relationships.push({
					source: `${resource.kind}/${resource.name}`,
					target: `${target.kind}/${target.name}`,
					type: RelationshipType.NetworkPolicy,
					label: "applies to",
					namespace,
				});
			}
		}
	}

	// NamespaceSelector for cross-namespace policies
	const ingressRules = resource.spec?.ingress || [];
	const egressRules = resource.spec?.egress || [];

	for (const rule of [...ingressRules, ...egressRules]) {
		const fromTo = rule.from || rule.to || [];
		for (const peer of fromTo) {
			if (peer.namespaceSelector) {
				// Cross-namespace traffic
				relationships.push({
					source: `${resource.kind}/${resource.name}`,
					target: `Namespace/${peer.namespaceSelector.matchLabels?.name || "any"}`,
					type: RelationshipType.NetworkPolicy,
					label: "allows traffic from",
					namespace,
					crossNamespace: true,
				});
			}
			if (peer.ipBlock) {
				relationships.push({
					source: `${resource.kind}/${resource.name}`,
					target: `IPBlock/${peer.ipBlock.cidr}`,
					type: RelationshipType.NetworkPolicy,
					label: "allows traffic from",
					namespace,
				});
			}
		}
	}
}

/**
 * Build architecture nodes from resources with relationship metrics
 */
export function buildArchitectureNodes(
	resources: StructuredResource[],
	relationships: ResourceRelationship[]
): ArchitectureNode[] {
	const nodes: Map<string, ArchitectureNode> = new Map();

	// Create nodes
	for (const resource of resources) {
		const id = `${resource.kind}/${resource.name}`;
		nodes.set(id, {
			id,
			kind: resource.kind,
			name: resource.name,
			namespace: resource.namespace || resource.metadata?.namespace,
			category: resource.category,
			colorCode: resource.colorCode,
			icon: resource.icon,
			inDegree: 0,
			outDegree: 0,
			isCritical: false,
		});
	}

	// Calculate degree metrics
	for (const rel of relationships) {
		const source = nodes.get(rel.source);
		const target = nodes.get(rel.target);
		if (source) source.outDegree++;
		if (target) target.inDegree++;
	}

	// Identify critical nodes (high centrality)
	const nodeArray = Array.from(nodes.values());

	// Critical node threshold: nodes with connectivity 1.5x above average are considered critical
	const CRITICAL_NODE_THRESHOLD = 1.5;

	// Calculate average degree (handle empty array case)
	const avgDegree =
		nodeArray.length > 0 ? nodeArray.reduce((sum, n) => sum + n.inDegree + n.outDegree, 0) / nodeArray.length : 0;

	for (const node of nodeArray) {
		const totalDegree = node.inDegree + node.outDegree;
		// Critical if above average connectivity
		node.isCritical = totalDegree > avgDegree * CRITICAL_NODE_THRESHOLD;
	}

	return nodeArray;
}

/**
 * Get relationship summary for a resource
 */
export function getResourceRelationshipSummary(
	resourceId: string,
	relationships: ResourceRelationship[]
): {
	incoming: ResourceRelationship[];
	outgoing: ResourceRelationship[];
	totalConnections: number;
} {
	const incoming = relationships.filter((r) => r.target === resourceId);
	const outgoing = relationships.filter((r) => r.source === resourceId);

	return {
		incoming,
		outgoing,
		totalConnections: incoming.length + outgoing.length,
	};
}

/**
 * Find all resources connected to a given resource (transitive closure)
 */
export function findConnectedResources(
	resourceId: string,
	relationships: ResourceRelationship[],
	maxDepth = 3
): Set<string> {
	const connected = new Set<string>();
	const queue: { id: string; depth: number }[] = [{ id: resourceId, depth: 0 }];

	while (queue.length > 0) {
		const current = queue.shift()!;
		if (current.depth >= maxDepth) continue;

		for (const rel of relationships) {
			if (rel.source === current.id && !connected.has(rel.target)) {
				connected.add(rel.target);
				queue.push({ id: rel.target, depth: current.depth + 1 });
			}
			if (rel.target === current.id && !connected.has(rel.source)) {
				connected.add(rel.source);
				queue.push({ id: rel.source, depth: current.depth + 1 });
			}
		}
	}

	return connected;
}
