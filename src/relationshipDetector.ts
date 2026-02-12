import type { StructuredResource } from "./resourceVisualizer";

/**
 * Represents a relationship/connection between two resources
 */
export interface ResourceRelationship {
	source: string; // resource ID (kind/name)
	target: string; // resource ID (kind/name)
	type: RelationshipType;
	label?: string;
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
}

/**
 * Detect relationships between resources for architecture diagram
 */
export function detectRelationships(resources: StructuredResource[]): ResourceRelationship[] {
	const relationships: ResourceRelationship[] = [];

	for (const resource of resources) {
		// 1. Owner references (hierarchical relationships)
		const ownerRefs = resource.metadata?.ownerReferences;
		if (ownerRefs && Array.isArray(ownerRefs)) {
			for (const owner of ownerRefs) {
				relationships.push({
					source: `${owner.kind}/${owner.name}`,
					target: `${resource.kind}/${resource.name}`,
					type: RelationshipType.Ownership,
					label: "owns",
				});
			}
		}

		// 2. Service selectors (Service -> Pods/Deployments)
		if (resource.kind === "Service" && resource.spec?.selector) {
			const selector = resource.spec.selector;
			// Find matching resources
			for (const target of resources) {
				if (
					(target.kind === "Deployment" ||
						target.kind === "StatefulSet" ||
						target.kind === "DaemonSet" ||
						target.kind === "Pod") &&
					matchesSelector(target, selector)
				) {
					relationships.push({
						source: `${resource.kind}/${resource.name}`,
						target: `${target.kind}/${target.name}`,
						type: RelationshipType.Selection,
						label: "routes to",
					});
				}
			}
		}

		// 3. Ingress -> Service
		if (resource.kind === "Ingress") {
			const rules = resource.spec?.rules || [];
			for (const rule of rules) {
				const paths = rule.http?.paths || [];
				for (const pathRule of paths) {
					const serviceName = pathRule.backend?.service?.name || pathRule.backend?.serviceName;
					if (serviceName) {
						relationships.push({
							source: `${resource.kind}/${resource.name}`,
							target: `Service/${serviceName}`,
							type: RelationshipType.Ingress,
							label: "routes to",
						});
					}
				}
			}
		}

		// 4. ConfigMap and Secret references
		if (resource.spec?.volumes) {
			for (const volume of resource.spec.volumes) {
				if (volume.configMap?.name) {
					relationships.push({
						source: `${resource.kind}/${resource.name}`,
						target: `ConfigMap/${volume.configMap.name}`,
						type: RelationshipType.Reference,
						label: "mounts",
					});
				}
				if (volume.secret?.secretName) {
					relationships.push({
						source: `${resource.kind}/${resource.name}`,
						target: `Secret/${volume.secret.secretName}`,
						type: RelationshipType.Reference,
						label: "mounts",
					});
				}
			}
		}

		// 5. EnvFrom references
		if (resource.spec?.template?.spec?.containers) {
			for (const container of resource.spec.template.spec.containers) {
				const envFrom = container.envFrom || [];
				for (const ref of envFrom) {
					if (ref.configMapRef?.name) {
						relationships.push({
							source: `${resource.kind}/${resource.name}`,
							target: `ConfigMap/${ref.configMapRef.name}`,
							type: RelationshipType.Reference,
							label: "uses",
						});
					}
					if (ref.secretRef?.name) {
						relationships.push({
							source: `${resource.kind}/${resource.name}`,
							target: `Secret/${ref.secretRef.name}`,
							type: RelationshipType.Reference,
							label: "uses",
						});
					}
				}
			}
		}

		// 6. PersistentVolumeClaim references
		if (resource.spec?.volumes) {
			for (const volume of resource.spec.volumes) {
				if (volume.persistentVolumeClaim?.claimName) {
					relationships.push({
						source: `${resource.kind}/${resource.name}`,
						target: `PersistentVolumeClaim/${volume.persistentVolumeClaim.claimName}`,
						type: RelationshipType.Storage,
						label: "uses",
					});
				}
			}
		}

		// 7. ServiceAccount references
		if (resource.spec?.template?.spec?.serviceAccountName || resource.spec?.serviceAccountName) {
			const saName = resource.spec.template?.spec?.serviceAccountName || resource.spec.serviceAccountName;
			relationships.push({
				source: `${resource.kind}/${resource.name}`,
				target: `ServiceAccount/${saName}`,
				type: RelationshipType.RBAC,
				label: "uses",
			});
		}

		// 8. RoleBinding/ClusterRoleBinding references
		if (resource.kind === "RoleBinding" || resource.kind === "ClusterRoleBinding") {
			// Role reference
			if (resource.spec?.roleRef?.name) {
				const roleKind = resource.spec.roleRef.kind || "Role";
				relationships.push({
					source: `${resource.kind}/${resource.name}`,
					target: `${roleKind}/${resource.spec.roleRef.name}`,
					type: RelationshipType.RBAC,
					label: "binds",
				});
			}
			// Subject references
			const subjects = resource.spec?.subjects || [];
			for (const subject of subjects) {
				if (subject.kind === "ServiceAccount" && subject.name) {
					relationships.push({
						source: `${subject.kind}/${subject.name}`,
						target: `${resource.kind}/${resource.name}`,
						type: RelationshipType.RBAC,
						label: "bound by",
					});
				}
			}
		}
	}

	return relationships;
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
			namespace: resource.namespace,
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
	// This helps identify key components like API gateways, shared services, etc.
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
 * Helper: Check if a resource matches a label selector
 */
function matchesSelector(resource: StructuredResource, selector: Record<string, string>): boolean {
	const resourceLabels = resource.metadata?.labels || resource.labels || {};

	// Check if all selector labels match
	for (const [key, value] of Object.entries(selector)) {
		if (resourceLabels[key] !== value) {
			return false;
		}
	}

	return true;
}
