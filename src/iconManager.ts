import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

/**
 * Kubernetes resource icon manager
 * Loads and provides SVG icons for Kubernetes resource types
 */

// Cache for loaded SVG content
const svgCache = new Map<string, string>();

// Extension context for resolving paths
let extensionContext: vscode.ExtensionContext;

/**
 * Initialize the icon manager with extension context
 */
export function initializeIconManager(context: vscode.ExtensionContext): void {
	extensionContext = context;
}

/**
 * Get the icon file name for a Kubernetes resource kind
 */
export function getIconFileName(kind: string): string {
	return kind
		.toLowerCase()
		.replace(/([a-z])([A-Z])/g, "$1-$2")
		.toLowerCase();
}

/**
 * Get the path to an icon file
 */
export function getIconPath(kind: string, theme: "dark" | "light" = "dark"): string {
	if (!extensionContext) {
		throw new Error("Icon manager not initialized. Call initializeIconManager() first.");
	}
	const iconName = getIconFileName(kind);
	const fileName = `${iconName}-${theme}.svg`;
	return path.join(extensionContext.extensionPath, "images", "k8s", fileName);
}

/**
 * Get VS Code Uri for an icon (for TreeView items)
 */
export function getIconUri(kind: string, theme: "dark" | "light" = "dark"): vscode.Uri {
	if (!extensionContext) {
		throw new Error("Icon manager not initialized. Call initializeIconManager() first.");
	}
	const iconName = getIconFileName(kind);
	const fileName = `${iconName}-${theme}.svg`;
	const iconPath = path.join(extensionContext.extensionPath, "images", "k8s", fileName);

	// Check if file exists
	if (!fs.existsSync(iconPath)) {
		// Fall back to default icon
		return vscode.Uri.file(path.join(extensionContext.extensionPath, "images", "icon.svg"));
	}

	return vscode.Uri.file(iconPath);
}

/**
 * Get icon Uri for both light and dark themes (for TreeItem.iconPath)
 */
export function getIconUris(kind: string): {
	light: vscode.Uri;
	dark: vscode.Uri;
} {
	return {
		light: getIconUri(kind, "light"),
		dark: getIconUri(kind, "dark"),
	};
}

/**
 * Load SVG content from file
 */
export function loadSvgContent(kind: string, theme: "dark" | "light" = "dark"): string {
	const cacheKey = `${kind}-${theme}`;

	if (svgCache.has(cacheKey)) {
		return svgCache.get(cacheKey)!;
	}

	const iconPath = getIconPath(kind, theme);

	try {
		if (fs.existsSync(iconPath)) {
			let content = fs.readFileSync(iconPath, "utf8");

			// For dark theme icons, ensure the stroke color is visible
			// Replace any stroke color with a high-contrast color
			if (theme === "dark") {
				// Use white stroke for dark theme icons for better visibility
				content = content.replace(/stroke="[^"]*"/g, 'stroke="#ffffff"');
			} else {
				// Use dark stroke for light theme icons
				content = content.replace(/stroke="[^"]*"/g, 'stroke="#333333"');
			}

			svgCache.set(cacheKey, content);
			return content;
		}
	} catch (error) {
		console.warn(`Failed to load icon for ${kind}:`, error);
	}

	// Return a default placeholder SVG
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${theme === "dark" ? "#ffffff" : "#333333"}" stroke-width="2">
		<rect x="3" y="3" width="18" height="18" rx="2"/>
	</svg>`;
}

/**
 * Convert SVG to base64 data URI for embedding in HTML
 */
export function svgToDataUri(svgContent: string): string {
	// Encode for data URI
	const encoded = Buffer.from(svgContent).toString("base64");
	return `data:image/svg+xml;base64,${encoded}`;
}

/**
 * Get icon as base64 data URI for webview embedding
 */
export function getIconDataUri(kind: string, theme: "dark" | "light" = "dark"): string {
	const svgContent = loadSvgContent(kind, theme);
	return svgToDataUri(svgContent);
}

/**
 * Get icon as inline SVG for webview (allows CSS styling)
 */
export function getInlineSvg(kind: string, theme: "dark" | "light" = "dark", className?: string): string {
	const svgContent = loadSvgContent(kind, theme);

	// Add class attribute if provided
	if (className) {
		return svgContent.replace("<svg", `<svg class="${className}"`);
	}

	return svgContent;
}

/**
 * Preload all icons into cache
 */
export function preloadIcons(): void {
	const k8sDir = path.join(extensionContext.extensionPath, "images", "k8s");

	try {
		const files = fs.readdirSync(k8sDir);

		for (const file of files) {
			if (file.endsWith(".svg")) {
				const match = file.match(/^(.+)-(dark|light)\.svg$/);
				if (match) {
					const kind = match[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
					const theme = match[2] as "dark" | "light";
					const cacheKey = `${kind}-${theme}`;

					if (!svgCache.has(cacheKey)) {
						let content = fs.readFileSync(path.join(k8sDir, file), "utf8");

						// Apply stroke color transformation for visibility
						if (theme === "dark") {
							content = content.replace(/stroke="[^"]*"/g, 'stroke="#ffffff"');
						} else {
							content = content.replace(/stroke="[^"]*"/g, 'stroke="#333333"');
						}

						svgCache.set(cacheKey, content);
					}
				}
			}
		}
	} catch (error) {
		console.warn("Failed to preload icons:", error);
	}
}

/**
 * Get all available icon kinds
 */
export function getAvailableIconKinds(): string[] {
	const k8sDir = path.join(extensionContext.extensionPath, "images", "k8s");
	const kinds = new Set<string>();

	try {
		const files = fs.readdirSync(k8sDir);

		for (const file of files) {
			if (file.endsWith(".svg")) {
				const match = file.match(/^(.+)-dark\.svg$/);
				if (match) {
					const kind = match[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
					kinds.add(kind);
				}
			}
		}
	} catch (error) {
		console.warn("Failed to get available icons:", error);
	}

	return Array.from(kinds);
}

/**
 * Map of Kubernetes kinds to their icon names
 */
export const KIND_ICON_MAP: Record<string, string> = {
	// Workloads
	Deployment: "deployment",
	Deployments: "deployment",
	StatefulSet: "statefulset",
	StatefulSets: "statefulset",
	DaemonSet: "daemonset",
	DaemonSets: "daemonset",
	ReplicaSet: "replicaset",
	ReplicaSets: "replicaset",
	Pod: "pod",
	Pods: "pod",
	Job: "job",
	Jobs: "job",
	CronJob: "cronjob",
	CronJobs: "cronjob",

	// Networking
	Service: "service",
	Services: "service",
	Ingress: "ingress",
	Ingresses: "ingress",
	NetworkPolicy: "networkpolicy",
	NetworkPolicies: "networkpolicy",
	Endpoint: "service",
	Endpoints: "service",
	EndpointSlice: "service",
	EndpointSlices: "service",

	// Configuration
	ConfigMap: "configmap",
	ConfigMaps: "configmap",
	Secret: "secret",
	Secrets: "secret",

	// Storage
	PersistentVolume: "persistentvolume",
	PersistentVolumes: "persistentvolume",
	PersistentVolumeClaim: "persistentvolumeclaim",
	PersistentVolumeClaims: "persistentvolumeclaim",
	StorageClass: "persistentvolume",
	StorageClasses: "persistentvolume",

	// RBAC
	Role: "role",
	Roles: "role",
	RoleBinding: "rolebinding",
	RoleBindings: "rolebinding",
	ClusterRole: "clusterrole",
	ClusterRoleBinding: "clusterrolebinding",
	ClusterRoleBindings: "clusterrolebinding",
	ServiceAccount: "serviceaccount",
	ServiceAccounts: "serviceaccount",

	// Scaling
	HorizontalPodAutoscaler: "horizontalpodautoscaler",
	HorizontalPodAutoscalers: "horizontalpodautoscaler",

	// Other
	Namespace: "namespace",
	Namespaces: "namespace",
	Node: "pod",
	Nodes: "pod",
	Event: "pod",
	Events: "pod",

	// Helm-specific
	Package: "package",
	HelmChart: "package",
	Chart: "package",
};

/**
 * Get the normalized icon name for a Kubernetes kind
 * Handles plural forms, different casings, and provides fallback
 */
export function getNormalizedIconName(kind: string): string {
	// First try exact match
	if (KIND_ICON_MAP[kind]) {
		return KIND_ICON_MAP[kind];
	}

	// Try singular form (remove trailing 's')
	if (kind.endsWith("s") && KIND_ICON_MAP[kind.slice(0, -1)]) {
		return KIND_ICON_MAP[kind.slice(0, -1)];
	}

	// Try with first letter lowercase
	const lowerKind = kind.charAt(0).toLowerCase() + kind.slice(1);
	if (KIND_ICON_MAP[lowerKind]) {
		return KIND_ICON_MAP[lowerKind];
	}

	// Fall back to file name conversion
	return getIconFileName(kind);
}

/**
 * Get fallback icon based on category
 * Used when no specific icon exists for a resource kind
 */
export function getFallbackIconByCategory(category: string): string {
	const categoryIcons: Record<string, string> = {
		Workload: "deployment",
		Networking: "service",
		Storage: "persistentvolume",
		Configuration: "configmap",
		RBAC: "role",
		Scaling: "horizontalpodautoscaler",
		Other: "deployment",
	};
	return categoryIcons[category] || "deployment";
}

/**
 * Check if an icon exists for a given kind
 */
export function hasIcon(kind: string): boolean {
	if (!extensionContext) {
		throw new Error("Icon manager not initialized. Call initializeIconManager() first.");
	}
	const iconName = getNormalizedIconName(kind);
	const darkPath = path.join(extensionContext.extensionPath, "images", "k8s", `${iconName}-dark.svg`);
	return fs.existsSync(darkPath);
}

/**
 * Get icon data URI with automatic fallback
 * If icon doesn't exist for the given kind, falls back to category-based icon
 */
export function getIconDataUriWithFallback(kind: string, category: string, theme: "dark" | "light" = "dark"): string {
	try {
		const normalizedKind = getNormalizedIconName(kind);
		// Try to get the specific icon
		if (hasIcon(normalizedKind)) {
			return getIconDataUri(normalizedKind, theme);
		}
	} catch (error) {
		console.warn(`Failed to get icon for ${kind}, trying fallback:`, error);
	}

	// Fallback to category-based icon
	const fallbackIcon = getFallbackIconByCategory(category);
	try {
		return getIconDataUri(fallbackIcon, theme);
	} catch (error) {
		console.warn(`Failed to get fallback icon for category ${category}:`, error);
		// Ultimate fallback - return empty string, CSS will handle display
		return "";
	}
}
