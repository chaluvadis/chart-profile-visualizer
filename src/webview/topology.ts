/**
 * Topology visualization for Helm Chart Visualizer
 * Handles SVG-based resource architecture rendering with relationships
 */

// Topology state
let topologyZoom = 1;
let topologyPanX = 0;
let topologyPanY = 0;
let selectedNode: string | null = null;

// Layout constants
const MAX_AUTO_FIT_ZOOM = 1.5;
const NODE_HEIGHT = 64;
const MIN_NODE_WIDTH = 180;
const MAX_NODE_WIDTH = 400;
const CHAR_WIDTH_APPROX = 8;
const LEFT_RESERVED = 60;
const RIGHT_RESERVED = 40;

// Tier configuration
interface Tier {
	nodes: ArchitectureNode[];
	color: string;
	label: string;
	icon: string;
}

interface ArchitectureNode {
	id: string;
	kind: string;
	name: string;
	namespace?: string;
	category: string;
	colorCode: string;
	icon: string;
	inDegree: number;
	outDegree: number;
	isCritical: boolean;
	healthStatus?: string;
	healthMessage?: string;
}

interface ResourceRelationship {
	source: string;
	target: string;
	type: string;
	label?: string;
	namespace?: string;
	crossNamespace?: boolean;
}

interface NodePosition {
	x: number;
	y: number;
	node: ArchitectureNode;
	tier: string;
}

const TIERS: Record<string, Tier> = {
	Workload: { nodes: [], color: "#0078d4", label: "Workloads", icon: "⚙" },
	Networking: { nodes: [], color: "#107c10", label: "Networking", icon: "🌐" },
	Storage: { nodes: [], color: "#8661c5", label: "Storage", icon: "💾" },
	Configuration: { nodes: [], color: "#d83b01", label: "Configuration", icon: "📝" },
	RBAC: { nodes: [], color: "#e81123", label: "RBAC", icon: "🔒" },
	Scaling: { nodes: [], color: "#008272", label: "Scaling", icon: "📊" },
	Other: { nodes: [], color: "#737373", label: "Other", icon: "📦" },
};

const TIER_ORDER = ["Workload", "Networking", "Storage", "Configuration", "RBAC", "Scaling", "Other"];

// Declare global window interface
declare global {
	interface Window {
		webviewData: {
			architectureNodes: ArchitectureNode[];
			relationships: ResourceRelationship[];
			kindIcons: Record<string, string>;
			resourceCounts: Record<string, number>;
			totalValues: number;
			overriddenCount: number;
			comparisonData: unknown;
			availableEnvs: string[];
			environment: string | null;
		};
		initTopology: () => void;
		fitTopologyToScreen: () => void;
	}
}

/**
 * Initialize the topology view
 */
function initTopology(): void {
	const svg = document.getElementById("topologySvg");
	if (!svg) return;
	if (svg.hasAttribute("data-initialized")) return;
	svg.setAttribute("data-initialized", "true");

	const container = document.getElementById("topologyContent");
	if (!container) return;

	const nodes = window.webviewData.architectureNodes || [];
	const edges = window.webviewData.relationships || [];
	const kindIcons = window.webviewData.kindIcons || {};

	// Update stats in header
	updateStats(nodes, edges);

	if (nodes.length === 0) {
		container.innerHTML =
			'<text x="50%" y="50%" text-anchor="middle" font-size="14" fill="var(--vscode-descriptionForeground)">No resources to display</text>';
		return;
	}

	const width = svg.clientWidth || 1000;
	const height = svg.clientHeight || 650;

	// Reset tiers
	resetTiers();

	// Group nodes by category
	nodes.forEach((node) => {
		const category = node.category || "Other";
		if (TIERS[category]) {
			TIERS[category].nodes.push(node);
		} else {
			TIERS.Other.nodes.push(node);
		}
	});

	const activeTiers = TIER_ORDER.filter((t) => TIERS[t].nodes.length > 0);

	// Calculate node width based on longest name
	const maxNameLength = Math.max(...nodes.map((n) => n.name.length));
	const NODE_WIDTH = Math.max(
		MIN_NODE_WIDTH,
		Math.min(MAX_NODE_WIDTH, LEFT_RESERVED + maxNameLength * CHAR_WIDTH_APPROX + RIGHT_RESERVED)
	);

	// Layout calculations
	const margin = 60;
	const minTierHeight = 140;
	const calculatedTierHeight =
		activeTiers.length > 0 ? (height - 2 * margin - 60) / activeTiers.length : minTierHeight;
	const tierHeight = Math.max(minTierHeight, calculatedTierHeight);
	const startY = margin + 60;

	// Track filter state
	initTierFilter(container);

	// Position map
	const nodePositions = new Map<string, NodePosition>();

	// Render tiers and position nodes
	renderTiers(container, activeTiers, width, height, margin, tierHeight, startY, NODE_WIDTH, nodePositions);

	// Draw edges
	renderEdges(container, edges, nodePositions, NODE_WIDTH);

	// Draw nodes
	renderNodes(container, nodes, edges, nodePositions, kindIcons, NODE_WIDTH);

	// Initialize pan and zoom
	initPanAndZoom(svg, container);

	// Initialize zoom controls
	initZoomControls();

	// Auto-fit to screen
	fitTopologyToScreen();
}

/**
 * Reset tier nodes arrays
 */
function resetTiers(): void {
	Object.keys(TIERS).forEach((key) => {
		TIERS[key].nodes = [];
	});
}

/**
 * Update stats in header
 */
function updateStats(nodes: ArchitectureNode[], edges: ResourceRelationship[]): void {
	const nodeCount = document.getElementById("nodeCount");
	const edgeCount = document.getElementById("edgeCount");
	if (nodeCount) nodeCount.textContent = `${nodes.length} resource${nodes.length !== 1 ? "s" : ""}`;
	if (edgeCount) edgeCount.textContent = `${edges.length} connection${edges.length !== 1 ? "s" : ""}`;
}

/**
 * Initialize tier filter dropdown
 */
function initTierFilter(container: Element): void {
	const tierFilterEl = document.getElementById("tierFilter");
	if (!tierFilterEl) return;

	tierFilterEl.addEventListener("change", (e) => {
		const target = e.target as HTMLSelectElement;
		const filterTier = target.value;
		applyTierFilter(container, filterTier);
	});
}

/**
 * Apply tier filter to hide/show nodes and edges
 */
function applyTierFilter(container: Element, filterTier: string): void {
	const allNodes = container.querySelectorAll(".topo-node");
	const allEdges = container.querySelectorAll(".topo-edge");
	const allTierBgs = container.querySelectorAll(".topo-tier-bg");
	const allTierLabels = container.querySelectorAll(".topo-tier-label");

	if (filterTier === "all") {
		allNodes.forEach((n) => n.removeAttribute("data-filtered"));
		allEdges.forEach((e) => e.removeAttribute("data-filtered"));
		allTierBgs.forEach((b) => b.removeAttribute("data-filtered"));
		allTierLabels.forEach((l) => l.removeAttribute("data-filtered"));
	} else {
		// Hide all first
		allNodes.forEach((n) => n.setAttribute("data-filtered", "hidden"));
		allEdges.forEach((e) => e.setAttribute("data-filtered", "hidden"));
		allTierBgs.forEach((b) => b.setAttribute("data-filtered", "hidden"));
		allTierLabels.forEach((l) => l.setAttribute("data-filtered", "hidden"));

		// Show selected tier
		allNodes.forEach((n) => {
			if (n.getAttribute("data-tier") === filterTier) {
				n.removeAttribute("data-filtered");
			}
		});
		allTierBgs.forEach((b) => {
			if (b.getAttribute("data-tier") === filterTier) {
				b.removeAttribute("data-filtered");
			}
		});
		allTierLabels.forEach((l) => {
			if (l.getAttribute("data-tier") === filterTier) {
				l.removeAttribute("data-filtered");
			}
		});

		// Show edges that connect to visible nodes
		allEdges.forEach((edge) => {
			const sourceId = edge.getAttribute("data-source");
			const targetId = edge.getAttribute("data-target");
			const sourceNode = container.querySelector(`.topo-node[data-node-id="${sourceId}"]`);
			const targetNode = container.querySelector(`.topo-node[data-node-id="${targetId}"]`);

			if (
				sourceNode?.getAttribute("data-filtered") !== "hidden" &&
				targetNode?.getAttribute("data-filtered") !== "hidden"
			) {
				edge.removeAttribute("data-filtered");
			}
		});
	}
}

/**
 * Render tier backgrounds and labels, position nodes
 */
function renderTiers(
	container: Element,
	activeTiers: string[],
	width: number,
	height: number,
	margin: number,
	tierHeight: number,
	startY: number,
	NODE_WIDTH: number,
	nodePositions: Map<string, NodePosition>
): void {
	const nodeSpacing = NODE_WIDTH + 40;

	activeTiers.forEach((tierName, tierIndex) => {
		const tier = TIERS[tierName];
		const tierY = startY + tierIndex * tierHeight;

		// Draw tier background
		const tierBg = createSvgElement("rect", {
			class: "topo-tier-bg",
			"data-tier": tierName,
			x: margin - 10,
			y: tierY + 5,
			width: width - 2 * margin + 20,
			height: tierHeight - 25,
			fill: tier.color,
		});
		container.appendChild(tierBg);

		// Tier label
		const tierLabel = createSvgElement("text", {
			class: "topo-tier-label",
			"data-tier": tierName,
			x: margin + 5,
			y: tierY + 22,
			"text-anchor": "start",
			"dominant-baseline": "middle",
			fill: tier.color,
		});
		tierLabel.textContent = `${tier.icon} ${tier.label}`;
		container.appendChild(tierLabel);

		// Position nodes horizontally within this tier
		const tierNodeCount = tier.nodes.length;
		if (tierNodeCount === 0) return;

		const availableWidth = width - 2 * margin - 100;
		const minNodeSpacing = NODE_WIDTH + 40;

		let startX: number;
		let spacing: number;
		if (tierNodeCount === 1) {
			startX = width / 2;
			spacing = 0;
		} else {
			const evenSpacing = availableWidth / (tierNodeCount - 1);
			spacing = Math.max(evenSpacing, minNodeSpacing);
			const totalWidth = (tierNodeCount - 1) * spacing;
			startX = (width - totalWidth) / 2;
		}

		const labelBottomY = tierY + 22 + 5;
		const tierBottomY = tierY + tierHeight - 20;
		const availableHeight = tierBottomY - labelBottomY;
		const y = labelBottomY + availableHeight / 2;

		tier.nodes.forEach((node, i) => {
			const x = startX + i * spacing;
			nodePositions.set(node.id, { x, y, node, tier: tierName });
		});
	});
}

/**
 * Render edges between nodes
 */
function renderEdges(
	container: Element,
	edges: ResourceRelationship[],
	nodePositions: Map<string, NodePosition>,
	NODE_WIDTH: number
): void {
	edges.forEach((edge) => {
		const source = nodePositions.get(edge.source);
		const target = nodePositions.get(edge.target);
		if (!source || !target) return;

		const dx = target.x - source.x;
		const dy = target.y - source.y;
		const distance = Math.sqrt(dx * dx + dy * dy);

		if (distance < NODE_WIDTH) return;

		let sourceX: number;
		let sourceY: number;
		let targetX: number;
		let targetY: number;

		if (Math.abs(dx) > Math.abs(dy)) {
			if (dx > 0) {
				sourceX = source.x + NODE_WIDTH / 2;
				targetX = target.x - NODE_WIDTH / 2 - 10;
			} else {
				sourceX = source.x - NODE_WIDTH / 2;
				targetX = target.x + NODE_WIDTH / 2 + 10;
			}
			sourceY = source.y;
			targetY = target.y;
		} else {
			if (dy > 0) {
				sourceY = source.y + NODE_HEIGHT / 2;
				targetY = target.y - NODE_HEIGHT / 2 - 10;
			} else {
				sourceY = source.y - NODE_HEIGHT / 2;
				targetY = target.y + NODE_HEIGHT / 2 + 10;
			}
			sourceX = source.x;
			targetX = target.x;
		}

		const midX = (sourceX + targetX) / 2;
		const midY = (sourceY + targetY) / 2;

		let d: string;
		if (Math.abs(dx) > Math.abs(dy)) {
			d = `M${sourceX},${sourceY} C${midX},${sourceY} ${midX},${targetY} ${targetX},${targetY}`;
		} else {
			d = `M${sourceX},${sourceY} C${sourceX},${midY} ${targetX},${midY} ${targetX},${targetY}`;
		}

		const path = createSvgElement("path", {
			class: `topo-edge${edge.type === "ownership" ? " critical-path" : ""}`,
			"data-source": edge.source,
			"data-target": edge.target,
			d: d,
			stroke: edge.type === "ownership" ? "#ffa500" : "var(--vscode-foreground)",
			"stroke-width": "2",
			fill: "none",
			"marker-end": edge.type === "ownership" ? "url(#arrowhead-critical)" : "url(#arrowhead)",
		});

		const title = createSvgElement("title", {});
		title.textContent = `${edge.source} → ${edge.target}\nType: ${edge.type || "connection"}${edge.label ? `\n${edge.label}` : ""}`;
		path.appendChild(title);

		container.appendChild(path);
	});
}

/**
 * Render nodes with icons, labels, and indicators
 */
function renderNodes(
	container: Element,
	nodes: ArchitectureNode[],
	edges: ResourceRelationship[],
	nodePositions: Map<string, NodePosition>,
	kindIcons: Record<string, string>,
	NODE_WIDTH: number
): void {
	nodePositions.forEach(({ x, y, node, tier }) => {
		const g = createSvgElement("g", {
			class: `topo-node${node.isCritical ? " critical" : ""}`,
			"data-node-id": node.id,
			"data-tier": tier,
			transform: `translate(${x}, ${y})`,
		});

		const nodeWidth = NODE_WIDTH;
		const nodeHeight = NODE_HEIGHT;
		const tierColor = TIERS[tier]?.color || "#0078d4";

		// Card background
		const rect = createSvgElement("rect", {
			class: "topo-node-rect",
			x: -nodeWidth / 2,
			y: -nodeHeight / 2,
			width: nodeWidth,
			height: nodeHeight,
			rx: "4",
			fill: "var(--vscode-editor-background)",
			stroke: node.isCritical ? "#f44336" : "var(--vscode-panel-border)",
			"stroke-width": node.isCritical ? "1.5" : "1",
		});
		g.appendChild(rect);

		// Left accent bar
		const accentBar = createSvgElement("rect", {
			x: -nodeWidth / 2,
			y: -nodeHeight / 2,
			width: "4",
			height: nodeHeight,
			rx: "0",
			fill: tierColor,
		});
		g.appendChild(accentBar);

		// Icon
		const iconDataUri = kindIcons[node.kind];
		const iconX = -nodeWidth / 2 + 12;

		if (iconDataUri) {
			const iconImg = createSvgElement("image", {
				href: iconDataUri,
				x: iconX,
				y: -10,
				width: 18,
				height: 18,
			});
			g.appendChild(iconImg);
		}

		// Text content
		const textStartX = iconDataUri ? iconX + 24 : iconX + 8;

		// Kind label
		const kindText = createSvgElement("text", {
			x: textStartX,
			y: -8,
			"text-anchor": "start",
			"dominant-baseline": "middle",
			"font-size": "10",
			fill: "var(--vscode-descriptionForeground)",
			"font-family": "var(--vscode-font-family)",
		});
		kindText.textContent = node.kind;
		g.appendChild(kindText);

		// Name label
		const nameText = createSvgElement("text", {
			x: textStartX,
			y: 6,
			"text-anchor": "start",
			"dominant-baseline": "middle",
			"font-size": "13",
			"font-weight": "600",
			fill: "var(--vscode-foreground)",
			"font-family": "var(--vscode-font-family)",
		});
		nameText.textContent = node.name;
		g.appendChild(nameText);

		// Namespace tag
		if (node.namespace) {
			const nsText = createSvgElement("text", {
				x: textStartX,
				y: 20,
				"text-anchor": "start",
				"dominant-baseline": "middle",
				"font-size": "9",
				fill: "var(--vscode-descriptionForeground)",
				"font-family": "var(--vscode-font-family)",
			});
			nsText.textContent = `ns: ${node.namespace}`;
			g.appendChild(nsText);
		}

		// Status indicators
		const indicatorX = nodeWidth / 2 - 14;

		// Critical indicator
		if (node.isCritical) {
			const criticalBadge = createCriticalBadge(indicatorX);
			g.appendChild(criticalBadge);
		}

		// Connectivity indicator
		const totalConnections = node.inDegree + node.outDegree;
		if (totalConnections >= 3) {
			const connY = node.isCritical ? 14 : 0;
			const connBadge = createConnectivityBadge(indicatorX, connY, totalConnections);
			g.appendChild(connBadge);
		}

		// Tooltip
		const title = createSvgElement("title", {});
		const criticalStr = node.isCritical ? " [CRITICAL]" : "";
		const connectionsStr = `Connections: ${totalConnections} (In: ${node.inDegree}, Out: ${node.outDegree})`;
		title.textContent = `${node.kind}: ${node.name}${criticalStr}${node.namespace ? `\nNamespace: ${node.namespace}` : ""}\nCategory: ${node.category}\n${connectionsStr}`;
		g.appendChild(title);

		// Click handler
		g.style.cursor = "pointer";
		g.addEventListener("click", (e) => {
			e.stopPropagation();
			handleNodeClick(container, nodes, edges, node.id, g);
		});

		container.appendChild(g);
	});
}

/**
 * Create critical badge SVG group
 */
function createCriticalBadge(indicatorX: number): SVGGElement {
	const criticalBadge = createSvgElement("g", {});

	const criticalBg = createSvgElement("rect", {
		x: indicatorX - 12,
		y: -10,
		width: 24,
		height: 20,
		rx: "3",
		fill: "#f44336",
	});
	criticalBadge.appendChild(criticalBg);

	const criticalText = createSvgElement("text", {
		x: indicatorX,
		y: 2,
		"text-anchor": "middle",
		"font-size": "10",
		"font-weight": "600",
		fill: "#fff",
	});
	criticalText.textContent = "!";
	criticalBadge.appendChild(criticalText);

	return criticalBadge as SVGGElement;
}

/**
 * Create connectivity badge SVG group
 */
function createConnectivityBadge(indicatorX: number, connY: number, totalConnections: number): SVGGElement {
	const connBadge = createSvgElement("g", {});

	const connBg = createSvgElement("circle", {
		cx: indicatorX,
		cy: connY,
		r: "10",
		fill: "var(--vscode-button-secondaryBackground)",
	});
	connBadge.appendChild(connBg);

	const connText = createSvgElement("text", {
		x: indicatorX,
		y: connY + 3,
		"text-anchor": "middle",
		"font-size": "9",
		"font-weight": "600",
		fill: "var(--vscode-button-secondaryForeground)",
	});
	connText.textContent = String(totalConnections);
	connBadge.appendChild(connText);

	return connBadge as SVGGElement;
}

/**
 * Handle node click for selection and highlighting
 */
function handleNodeClick(
	container: Element,
	nodes: ArchitectureNode[],
	edges: ResourceRelationship[],
	nodeId: string,
	nodeElement: Element
): void {
	// Clear previous selection
	container.querySelectorAll(".topo-node").forEach((n) => {
		n.classList.remove("selected");
	});
	container.querySelectorAll(".topo-edge").forEach((e) => {
		e.classList.remove("highlighted");
	});

	if (selectedNode === nodeId) {
		selectedNode = null;
		return;
	}

	selectedNode = nodeId;
	nodeElement.classList.add("selected");

	// Highlight connected edges
	edges
		.filter((e) => e.source === nodeId || e.target === nodeId)
		.forEach((edge) => {
			const edgePath = container.querySelector(
				`path[data-source="${edge.source}"][data-target="${edge.target}"]`
			);
			if (edgePath) {
				edgePath.classList.add("highlighted");
			}
		});
}

/**
 * Initialize pan and zoom functionality
 */
function initPanAndZoom(svg: Element, container: Element): void {
	let isPanning = false;
	let panStart = { x: 0, y: 0 };

	svg.addEventListener("mousedown", (e) => {
		const target = e.target as Element;
		if (
			target === svg ||
			target === container ||
			(target.tagName === "rect" && target.classList.contains("topo-tier-bg"))
		) {
			isPanning = true;
			panStart = { x: e.clientX - topologyPanX, y: e.clientY - topologyPanY };
		}
	});

	svg.addEventListener("mousemove", (e) => {
		if (isPanning) {
			topologyPanX = e.clientX - panStart.x;
			topologyPanY = e.clientY - panStart.y;
			updateTopologyZoom(container);
		}
	});

	svg.addEventListener("mouseup", () => {
		isPanning = false;
	});

	svg.addEventListener("mouseleave", () => {
		isPanning = false;
	});

	// Mouse wheel zoom
	svg.addEventListener("wheel", (e) => {
		e.preventDefault();
		const delta = e.deltaY > 0 ? -0.1 : 0.1;
		topologyZoom = Math.max(0.3, Math.min(3, topologyZoom + delta));
		updateTopologyZoom(container);
	});

	// Click on background to deselect
	svg.addEventListener("click", (e) => {
		const target = e.target as Element;
		if (target === svg || target === container) {
			container.querySelectorAll(".topo-node").forEach((n) => n.classList.remove("selected"));
			container.querySelectorAll(".topo-edge").forEach((ev) => ev.classList.remove("highlighted"));
			selectedNode = null;
		}
	});
}

/**
 * Initialize zoom control buttons
 */
function initZoomControls(): void {
	const zoomInBtn = document.getElementById("zoomInBtn");
	const zoomOutBtn = document.getElementById("zoomOutBtn");
	const resetZoomBtn = document.getElementById("resetZoomBtn");
	const fitToScreenBtn = document.getElementById("fitToScreen");

	if (zoomInBtn) {
		zoomInBtn.addEventListener("click", () => {
			topologyZoom = Math.min(topologyZoom + 0.2, 3);
			updateTopologyZoom(document.getElementById("topologyContent"));
		});
	}

	if (zoomOutBtn) {
		zoomOutBtn.addEventListener("click", () => {
			topologyZoom = Math.max(topologyZoom - 0.2, 0.3);
			updateTopologyZoom(document.getElementById("topologyContent"));
		});
	}

	if (resetZoomBtn) {
		resetZoomBtn.addEventListener("click", () => {
			topologyZoom = 1;
			topologyPanX = 0;
			topologyPanY = 0;
			updateTopologyZoom(document.getElementById("topologyContent"));
		});
	}

	if (fitToScreenBtn) {
		fitToScreenBtn.addEventListener("click", fitTopologyToScreen);
	}
}

/**
 * Fit topology to screen
 */
function fitTopologyToScreen(): void {
	const svg = document.getElementById("topologySvg");
	const container = document.getElementById("topologyContent");
	if (!svg || !container) return;

	try {
		const bbox = (container as SVGGraphicsElement).getBBox();
		const svgWidth = svg.clientWidth || 1000;
		const svgHeight = svg.clientHeight || 650;

		const scaleX = svgWidth / (bbox.width + 100);
		const scaleY = svgHeight / (bbox.height + 100);
		topologyZoom = Math.min(scaleX, scaleY, MAX_AUTO_FIT_ZOOM);

		// Center the content
		const scaledWidth = bbox.width * topologyZoom;
		const scaledHeight = bbox.height * topologyZoom;
		topologyPanX = (svgWidth - scaledWidth) / 2 - bbox.x * topologyZoom;
		topologyPanY = (svgHeight - scaledHeight) / 2 - bbox.y * topologyZoom;
	} catch {
		topologyZoom = 0.8;
		topologyPanX = 0;
		topologyPanY = 0;
	}
	updateTopologyZoom(container);
}

/**
 * Update topology zoom transform
 */
function updateTopologyZoom(container: Element | null): void {
	if (container) {
		container.setAttribute("transform", `translate(${topologyPanX}, ${topologyPanY}) scale(${topologyZoom})`);
	}
}

/**
 * Helper to create SVG element with attributes
 */
function createSvgElement(tag: string, attributes: Record<string, string>): Element {
	const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
	for (const [key, value] of Object.entries(attributes)) {
		element.setAttribute(key, value);
	}
	return element;
}

// Export for use in main.ts
window.initTopology = initTopology;
window.fitTopologyToScreen = fitTopologyToScreen;

export {};
