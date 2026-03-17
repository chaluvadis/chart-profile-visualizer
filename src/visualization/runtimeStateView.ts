import * as vscode from "vscode";
import type { ChartRuntimeState, HealthSummary } from "../state/runtimeStateManager";
import type { ResourceRuntimeState } from "../k8s/kubernetesConnector";
import { getRuntimeStateManager } from "../state/runtimeStateManager";
import { validateCliIdentifier } from "../utils/cliValidation";
import { getTemplatePath, loadTemplate } from "../webview/templateLoader";

export interface RuntimeStateViewInput {
	chartPath: string;
	environment: string;
	state: ChartRuntimeState;
	healthSummary: HealthSummary;
}

let runtimeStatePanel: vscode.WebviewPanel | undefined;
let runtimeStateContext: vscode.ExtensionContext | undefined;
let currentInput: RuntimeStateViewInput | undefined;

type RuntimeStateWebviewCommand = "refresh" | "viewResourceYaml";

interface RuntimeStateWebviewMessage {
	command: RuntimeStateWebviewCommand;
	kind?: string;
	name?: string;
	namespace?: string;
}

interface RuntimeResourceItem {
	id: string;
	kind: string;
	name: string;
	namespace: string;
	message: string;
	details?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function parseRuntimeStateMessage(raw: unknown): RuntimeStateWebviewMessage | null {
	if (!isRecord(raw) || typeof raw.command !== "string") {
		return null;
	}

	if (raw.command === "refresh") {
		return { command: "refresh" };
	}

	if (raw.command === "viewResourceYaml" && typeof raw.kind === "string" && typeof raw.name === "string") {
		return {
			command: raw.command,
			kind: raw.kind,
			name: raw.name,
			namespace: typeof raw.namespace === "string" ? raw.namespace : undefined,
		};
	}

	return null;
}

function createNonce(): string {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	let nonce = "";
	for (let i = 0; i < 32; i++) {
		nonce += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return nonce;
}

function getStatusUi(overallStatus: HealthSummary["overallStatus"]): {
	statusClass: string;
	statusIcon: string;
	statusTitle: string;
	statusSubtitle: string;
} {
	switch (overallStatus) {
		case "critical":
			return {
				statusClass: "critical",
				statusIcon: "✗",
				statusTitle: "Runtime State Critical",
				statusSubtitle: "One or more resources are unhealthy",
			};
		case "warning":
			return {
				statusClass: "warning",
				statusIcon: "!",
				statusTitle: "Runtime State Warning",
				statusSubtitle: "Resources need attention",
			};
		case "disconnected":
			return {
				statusClass: "critical",
				statusIcon: "⚠",
				statusTitle: "Cluster Disconnected",
				statusSubtitle: "Unable to reach Kubernetes cluster",
			};
		default:
			return {
				statusClass: "healthy",
				statusIcon: "✓",
				statusTitle: "Runtime State Healthy",
				statusSubtitle: "All checked resources are healthy",
			};
	}
}

function formatResourceDetails(resourceState: ResourceRuntimeState): string {
	const parts: string[] = [];
	if (typeof resourceState.readyReplicas === "number" && typeof resourceState.totalReplicas === "number") {
		parts.push(`${resourceState.readyReplicas}/${resourceState.totalReplicas} replicas ready`);
	}
	if (resourceState.age) {
		parts.push(`age ${resourceState.age}`);
	}
	if (resourceState.status.reason) {
		parts.push(resourceState.status.reason);
	}
	return parts.join(" • ");
}

function categorizeResources(state: ChartRuntimeState): {
	criticalItems: RuntimeResourceItem[];
	warningItems: RuntimeResourceItem[];
	notFoundItems: RuntimeResourceItem[];
	unknownItems: RuntimeResourceItem[];
	healthyItems: RuntimeResourceItem[];
} {
	const criticalItems: RuntimeResourceItem[] = [];
	const warningItems: RuntimeResourceItem[] = [];
	const notFoundItems: RuntimeResourceItem[] = [];
	const unknownItems: RuntimeResourceItem[] = [];
	const healthyItems: RuntimeResourceItem[] = [];

	for (const [id, resourceState] of state.resources) {
		const item: RuntimeResourceItem = {
			id,
			kind: resourceState.kind,
			name: resourceState.name,
			namespace: resourceState.namespace,
			message: resourceState.status.message,
			details: formatResourceDetails(resourceState),
		};

		switch (resourceState.status.state) {
			case "Critical":
				criticalItems.push(item);
				break;
			case "Warning":
				warningItems.push(item);
				break;
			case "NotFound":
				notFoundItems.push(item);
				break;
			case "Unknown":
				unknownItems.push(item);
				break;
			default:
				healthyItems.push(item);
		}
	}

	return { criticalItems, warningItems, notFoundItems, unknownItems, healthyItems };
}

function prepareTemplateData(input: RuntimeStateViewInput): Record<string, unknown> {
	const chartName = input.chartPath.split("/").pop() || "Chart";
	const statusUi = getStatusUi(input.healthSummary.overallStatus);
	const categorized = categorizeResources(input.state);
	const timestamp = new Date(input.state.lastUpdated).toLocaleString();

	return {
		chartName,
		environment: input.environment,
		timestamp,
		connectedText: input.state.isConnected ? "Connected" : "Disconnected",
		clusterContext: input.state.clusterInfo.context || "n/a",
		clusterNamespace: input.state.clusterInfo.namespace || "default",
		clusterServer: input.state.clusterInfo.server || "n/a",
		helmReleaseCount: input.state.helmReleases.length,
		...statusUi,
		totalResources: input.healthSummary.totalResources,
		healthyCount: input.healthSummary.healthy,
		warningCount: input.healthSummary.warning,
		criticalCount: input.healthSummary.critical,
		notFoundCount: input.healthSummary.notFound,
		unknownCount: input.healthSummary.unknown,
		hasWarnings: input.state.warnings.length > 0,
		hasErrors: input.state.errors.length > 0,
		warnings: input.state.warnings,
		errors: input.state.errors,
		hasCriticalItems: categorized.criticalItems.length > 0,
		hasWarningItems: categorized.warningItems.length > 0,
		hasNotFoundItems: categorized.notFoundItems.length > 0,
		hasUnknownItems: categorized.unknownItems.length > 0,
		hasHealthyItems: categorized.healthyItems.length > 0,
		criticalItems: categorized.criticalItems,
		warningItems: categorized.warningItems,
		notFoundItems: categorized.notFoundItems,
		unknownItems: categorized.unknownItems,
		healthyItems: categorized.healthyItems,
		allResources: Array.from(input.state.resources.entries()).map(([id, resourceState]) => ({
			id,
			kind: resourceState.kind,
			name: resourceState.name,
			namespace: resourceState.namespace,
			status: resourceState.status.state,
			message: resourceState.status.message,
			details: formatResourceDetails(resourceState),
		})),
		hasReleases: input.state.helmReleases.length > 0,
		releases: input.state.helmReleases.map((release) => ({
			name: release.name,
			namespace: release.namespace,
			status: release.status,
			chart: release.chart,
			revision: release.revision,
			updated: release.updated,
		})),
	};
}

async function updateRuntimeStatePanel(input: RuntimeStateViewInput): Promise<void> {
	if (!runtimeStatePanel || !runtimeStateContext) {
		return;
	}

	const nonce = createNonce();
	const templateData = {
		...prepareTemplateData(input),
		nonce,
	};
	runtimeStatePanel.webview.html = await loadTemplate(
		getTemplatePath("runtime-state", runtimeStateContext.extensionUri),
		templateData
	);
}

async function handleRuntimeStateMessage(message: RuntimeStateWebviewMessage): Promise<void> {
	const runtimeStateManager = getRuntimeStateManager();

	switch (message.command) {
		case "refresh": {
			if (!currentInput) {
				return;
			}

			const refreshedState = await runtimeStateManager.getChartRuntimeState(
				currentInput.chartPath,
				currentInput.environment
			);
			const refreshedHealth = runtimeStateManager.getHealthSummary(refreshedState);
			currentInput = {
				...currentInput,
				state: refreshedState,
				healthSummary: refreshedHealth,
			};
			await updateRuntimeStatePanel(currentInput);
			vscode.window.showInformationMessage("Runtime state refreshed");
			break;
		}
		case "viewResourceYaml": {
			if (!message.kind || !message.name) {
				return;
			}
			const safeKind = validateCliIdentifier(message.kind, "resource kind");
			const safeName = validateCliIdentifier(message.name, "resource name");
			const safeNamespace = validateCliIdentifier(message.namespace || "default", "namespace");
			const yaml = await runtimeStateManager.getResourceYaml(safeKind, safeName, safeNamespace);
			const doc = await vscode.workspace.openTextDocument({
				content: yaml,
				language: "yaml",
			});
			await vscode.window.showTextDocument(doc, { preview: true });
			break;
		}
	}
}

export async function showRuntimeStateResults(
	context: vscode.ExtensionContext,
	input: RuntimeStateViewInput
): Promise<void> {
	runtimeStateContext = context;
	currentInput = input;

	const columnToShowIn = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;
	const chartName = input.chartPath.split("/").pop() || "Chart";
	const panelTitle = `Runtime State: ${chartName}`;

	if (runtimeStatePanel) {
		runtimeStatePanel.reveal(columnToShowIn);
	} else {
		runtimeStatePanel = vscode.window.createWebviewPanel(
			"chartRuntimeState",
			panelTitle,
			columnToShowIn || vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [context.extensionUri, vscode.Uri.file(context.extensionPath)],
			}
		);

		runtimeStatePanel.webview.onDidReceiveMessage(async (rawMessage: unknown) => {
			const message = parseRuntimeStateMessage(rawMessage);
			if (!message) {
				vscode.window.showWarningMessage("Ignored invalid runtime state message");
				return;
			}

			try {
				await handleRuntimeStateMessage(message);
			} catch (error) {
				const messageText = error instanceof Error ? error.message : String(error);
				vscode.window.showErrorMessage(`Runtime action failed: ${messageText}`);
			}
		});

		runtimeStatePanel.onDidDispose(() => {
			runtimeStatePanel = undefined;
			currentInput = undefined;
		});
	}

	runtimeStatePanel.title = `${panelTitle} (${input.environment})`;
	await updateRuntimeStatePanel(input);
}
