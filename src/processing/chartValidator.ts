import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import { getRenderContext } from "../core/renderContext";
import { isHelmAvailable, type RenderedResource, renderHelmTemplate } from "../k8s/helmRenderer";
import { getKubernetesConnector } from "../k8s/kubernetesConnector";
import { runHelm } from "../utils/cliRunner";
import { FILE_PATTERNS } from "../utils/constants";

export type ValidationSeverity = "error" | "warning" | "info";

export type ValidationCategory = "lint" | "schema" | "template" | "security" | "unused" | "breaking" | "general";

export interface ValidationIssue {
	severity: ValidationSeverity;
	code: string;
	message: string;
	resource?: string;
	line?: number;
	file?: string;
	chartPath?: string;
	remediation?: string;
	category?: ValidationCategory;
}

export interface ValidationResult {
	valid: boolean;
	issues: ValidationIssue[];
	summary: {
		errors: number;
		warnings: number;
		info: number;
	};
	chartPath: string;
	environment: string;
	timestamp: string;
}

export class ChartValidator {
	private chartPath: string;

	constructor(chartPath: string) {
		this.chartPath = chartPath;
	}

	async validateAll(environment: string): Promise<ValidationResult> {
		const issues: ValidationIssue[] = [];

		let resources: RenderedResource[] = [];
		try {
			const renderContext = getRenderContext();
			resources = await renderHelmTemplate(this.chartPath, environment, renderContext.releaseName, renderContext.namespace);
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			issues.push({
				severity: "warning",
				code: "RENDER000",
				message: `Failed to render templates: ${errorMessage}`,
			});
		}

		const [lintIssues, schemaIssues, templateIssues, securityIssues, unusedValuesIssues] = await Promise.all([
			this.runHelmLint(),
			this.validateSchemasWithResources(resources),
			this.validateTemplates(environment),
			this.runSecurityChecksWithResources(resources),
			this.checkUnusedValues(),
		]);

		issues.push(...lintIssues, ...schemaIssues, ...templateIssues, ...securityIssues, ...unusedValuesIssues);

		// Tag categories to issues
		for (const i of lintIssues) {
			i.category = "lint";
		}
		for (const i of schemaIssues) {
			i.category = "schema";
		}
		for (const i of templateIssues) {
			i.category = "template";
		}
		for (const i of securityIssues) {
			i.category = "security";
		}
		for (const i of unusedValuesIssues) {
			i.category = "unused";
		}

		const summary = {
			errors: issues.filter((i) => i.severity === "error").length,
			warnings: issues.filter((i) => i.severity === "warning").length,
			info: issues.filter((i) => i.severity === "info").length,
		};

		// Add chartPath to each issue for tracking
		for (const issue of issues) {
			if (!issue.chartPath) {
				issue.chartPath = this.chartPath;
			}
		}

		return {
			valid: summary.errors === 0,
			issues,
			summary,
			chartPath: this.chartPath,
			environment,
			timestamp: new Date().toISOString(),
		};
	}

	async runHelmLint(): Promise<ValidationIssue[]> {
		const issues: ValidationIssue[] = [];

		const helmAvailable = await isHelmAvailable();
		if (!helmAvailable) {
			issues.push({
				severity: "warning",
				code: "HELM001",
				message: "Helm CLI not available - cannot run helm lint",
				remediation: "Install Helm CLI from https://helm.sh/docs/intro/install/",
			});
			return issues;
		}

		try {
			const { stdout, stderr } = await runHelm(["lint", this.chartPath], {
				timeout: 30000,
			});

			const output = stdout + stderr;
			const lines = output.split("\n");

			for (const line of lines) {
				const errorMatch = line.match(/\[ERROR\]\s+(.+)/);
				const warningMatch = line.match(/\[WARNING\]\s+(.+)/);
				const infoMatch = line.match(/\[INFO\]\s+(.+)/);

				if (errorMatch) {
					issues.push({
						severity: "error",
						code: "LINT001",
						message: errorMatch[1],
						remediation: "Fix the chart structure or values",
					});
				} else if (warningMatch) {
					issues.push({
						severity: "warning",
						code: "LINT002",
						message: warningMatch[1],
					});
				} else if (infoMatch) {
					issues.push({
						severity: "info",
						code: "LINT003",
						message: infoMatch[1],
					});
				}
			}
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			issues.push({
				severity: "error",
				code: "LINT000",
				message: `Helm lint failed: ${errorMessage}`,
				remediation: "Check chart structure and fix syntax errors",
			});
		}

		return issues;
	}

	async validateSchemasWithResources(resources: RenderedResource[]): Promise<ValidationIssue[]> {
		const issues: ValidationIssue[] = [];

		try {
			const connector = getKubernetesConnector();
			const kubectlAvailable = await connector.isKubectlAvailable();

			if (!kubectlAvailable) {
				issues.push({
					severity: "warning",
					code: "KCTL001",
					message: "kubectl not found - cannot validate against Kubernetes schema",
					remediation: "Install kubectl from https://kubernetes.io/docs/tasks/tools/",
					category: "schema",
				});
				return issues;
			}

			try {
				const clusterInfo = await connector.getClusterInfo();
				if (!clusterInfo.connected) {
					issues.push({
						severity: "info",
						code: "KCTL002",
						message: "No Kubernetes cluster connection - skipping schema validation",
						remediation: "Connect to a cluster to enable schema validation",
						category: "schema",
					});
					return issues;
				}
			} catch {
				issues.push({
					severity: "info",
					code: "KCTL002",
					message: "No Kubernetes cluster connection - skipping schema validation",
					remediation: "Connect to a cluster to enable schema validation",
					category: "schema",
				});
				return issues;
			}

			for (const resource of resources) {
				if (resource.kind === "Error" || resource.kind === "Notice") {
					continue;
				}

				const result = await connector.validateResource(resource.yaml);
				let filePath = this.chartPath;
				if (resource.template) {
					const chartName = path.basename(this.chartPath);
					const templatePath = resource.template.startsWith(`${chartName}/`)
						? resource.template.substring(chartName.length + 1)
						: resource.template;
					filePath = path.join(this.chartPath, templatePath);
				}

				if (!result.valid) {
					for (const error of result.errors) {
						issues.push({
							severity: "error",
							code: "SCHEMA001",
							message: error,
							resource: `${resource.kind}/${resource.name}`,
							file: filePath,
							remediation: "Fix the resource definition to match Kubernetes schema",
							category: "schema",
						});
					}
				}

				for (const warning of result.warnings) {
					issues.push({
						severity: "warning",
						code: "SCHEMA002",
						message: warning,
						resource: `${resource.kind}/${resource.name}`,
						file: filePath,
						category: "schema",
					});
				}
			}
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			issues.push({
				severity: "error",
				code: "SCHEMA000",
				message: `Schema validation failed: ${errorMessage}`,
				remediation: "Ensure templates render correctly",
				category: "schema",
			});
		}

		return issues;
	}

	async runSecurityChecksWithResources(resources: RenderedResource[]): Promise<ValidationIssue[]> {
		const issues: ValidationIssue[] = [];

		try {
			for (const resource of resources) {
				if (!["Deployment", "StatefulSet", "DaemonSet", "Pod", "Job", "CronJob"].includes(resource.kind)) {
					continue;
				}

				const yamlContent = yaml.load(resource.yaml) as Record<string, unknown>;
				const spec = this.getPodSpec(yamlContent);

				if (!spec) continue;

				this.checkSecurityIssues(spec, resource, issues);
			}
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			issues.push({
				severity: "warning",
				code: "SEC000",
				message: `Security check failed: ${errorMessage}`,
			});
		}

		return issues;
	}

	async validateTemplates(_environment: string): Promise<ValidationIssue[]> {
		const issues: ValidationIssue[] = [];
		const templatesDir = path.join(this.chartPath, "templates");

		if (!fs.existsSync(templatesDir)) {
			issues.push({
				severity: "error",
				code: "TMPL001",
				message: "Templates directory not found",
				file: this.chartPath,
				remediation: "Create a templates directory with at least one template file",
			});
			return issues;
		}

		const templateFiles = this.getTemplateFiles(templatesDir);

		for (const templateFile of templateFiles) {
			const content = fs.readFileSync(templateFile, "utf8");
			const relativePath = path.relative(this.chartPath, templateFile);

			this.checkTemplateSyntax(content, relativePath, issues);
			this.checkBestPractices(content, relativePath, issues);
		}

		const chartYamlPath = path.join(this.chartPath, "Chart.yaml");
		if (!fs.existsSync(chartYamlPath)) {
			issues.push({
				severity: "error",
				code: "CHART001",
				message: "Chart.yaml not found",
				file: this.chartPath,
				remediation: "Create a valid Chart.yaml file",
			});
		} else {
			try {
				const chartYaml = yaml.load(fs.readFileSync(chartYamlPath, "utf8")) as Record<string, unknown>;
				this.validateChartYaml(chartYaml, issues);
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				issues.push({
					severity: "error",
					code: "CHART002",
					message: `Invalid Chart.yaml: ${errorMessage}`,
					file: "Chart.yaml",
					remediation: "Fix YAML syntax in Chart.yaml",
				});
			}
		}

		const valuesYamlPath = path.join(this.chartPath, "values.yaml");
		if (!fs.existsSync(valuesYamlPath)) {
			issues.push({
				severity: "warning",
				code: "VAL001",
				message: "values.yaml not found - using empty values",
				file: this.chartPath,
				remediation: "Create a values.yaml file with default values",
			});
		}

		return issues;
	}

	private getTemplateFiles(dir: string): string[] {
		const files: string[] = [];

		const entries = fs.readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				files.push(...this.getTemplateFiles(fullPath));
			} else if (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml") || entry.name.endsWith(".tpl")) {
				files.push(fullPath);
			}
		}

		return files;
	}

	private checkTemplateSyntax(content: string, file: string, issues: ValidationIssue[]): void {
		const openTags = (content.match(/\{\{/g) || []).length;
		const closeTags = (content.match(/\}\}/g) || []).length;

		if (openTags !== closeTags) {
			issues.push({
				severity: "error",
				code: "SYNTAX001",
				message: "Unclosed template tags detected",
				file,
				remediation: "Ensure all {{ are matched with }}",
			});
		}

		const lines = content.split("\n");
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const lineNum = i + 1;

			if (line.includes("{{ .") && !line.includes("}}")) {
				if (i + 1 < lines.length && !lines[i + 1].includes("}}")) {
					issues.push({
						severity: "warning",
						code: "SYNTAX002",
						message: "Possible unclosed template expression",
						file,
						line: lineNum,
					});
				}
			}

			if (line.includes("{{.Values") && !line.includes("{{ .Values")) {
				issues.push({
					severity: "info",
					code: "STYLE001",
					message: "Consider adding space after {{ for readability",
					file,
					line: lineNum,
				});
			}
		}
	}

	private checkBestPractices(content: string, file: string, issues: ValidationIssue[]): void {
		if (content.includes("replicas: 1") && !content.includes(".Values")) {
			issues.push({
				severity: "info",
				code: "BP001",
				message: "Consider making replica count configurable via values",
				file,
			});
		}

		if (content.includes("kind: Deployment") || content.includes("kind: StatefulSet")) {
			if (!content.includes("app.kubernetes.io/version")) {
				issues.push({
					severity: "info",
					code: "BP002",
					message: "Consider adding app.kubernetes.io/version label",
					file,
					remediation: "Add standard Kubernetes labels for better resource management",
				});
			}
		}

		if (content.includes("containers:")) {
			if (!content.includes("resources:") && !content.includes(".Values.resources")) {
				issues.push({
					severity: "warning",
					code: "BP003",
					message: "No resource limits defined - this may cause issues in production",
					file,
					remediation: "Define resource requests and limits for containers",
				});
			}
		}
	}

	private validateChartYaml(chartYaml: Record<string, unknown>, issues: ValidationIssue[]): void {
		if (!chartYaml.name) {
			issues.push({
				severity: "error",
				code: "CHART003",
				message: "Chart name is required in Chart.yaml",
				file: "Chart.yaml",
			});
		}

		if (!chartYaml.version) {
			issues.push({
				severity: "error",
				code: "CHART004",
				message: "Chart version is required in Chart.yaml",
				file: "Chart.yaml",
			});
		} else {
			const semverRegex = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?$/;
			if (typeof chartYaml.version === "string" && !semverRegex.test(chartYaml.version)) {
				issues.push({
					severity: "warning",
					code: "CHART005",
					message: `Version "${chartYaml.version}" is not valid semver`,
					file: "Chart.yaml",
					remediation: "Use semantic versioning (e.g., 1.0.0)",
				});
			}
		}

		if (chartYaml.apiVersion === "v1") {
			issues.push({
				severity: "info",
				code: "CHART006",
				message: "Using deprecated apiVersion v1, consider using v2",
				file: "Chart.yaml",
			});
		}
	}

	private getPodSpec(resource: Record<string, unknown>): Record<string, unknown> | null {
		if (!resource) return null;

		const kind = resource.kind as string;
		const spec = resource.spec as Record<string, unknown> | undefined;

		switch (kind) {
			case "Pod":
				return spec || null;
			case "Deployment":
			case "StatefulSet":
			case "DaemonSet":
			case "ReplicaSet": {
				const template = spec?.template as Record<string, unknown> | undefined;
				return template?.spec as Record<string, unknown> | null;
			}
			case "Job": {
				const template = spec?.template as Record<string, unknown> | undefined;
				return template?.spec as Record<string, unknown> | null;
			}
			case "CronJob": {
				const jobTemplate = spec?.jobTemplate as Record<string, unknown> | undefined;
				const jobSpec = jobTemplate?.spec as Record<string, unknown> | undefined;
				const template = jobSpec?.template as Record<string, unknown> | undefined;
				return template?.spec as Record<string, unknown> | null;
			}
			default:
				return null;
		}
	}

	private checkSecurityIssues(
		spec: Record<string, unknown>,
		resource: { kind: string; name: string },
		issues: ValidationIssue[]
	): void {
		const containers = (spec.containers as Record<string, unknown>[]) || [];
		const initContainers = (spec.initContainers as Record<string, unknown>[]) || [];
		const allContainers = [...containers, ...initContainers];

		for (const container of allContainers) {
			const containerName = (container.name as string) || "unnamed";
			const securityContext = container.securityContext as Record<string, unknown> | undefined;

			if (securityContext?.privileged) {
				issues.push({
					severity: "warning",
					code: "SEC001",
					message: `Container "${containerName}" is running as privileged`,
					resource: `${resource.kind}/${resource.name}`,
					remediation: "Avoid privileged containers unless absolutely necessary",
				});
			}

			if (securityContext?.runAsUser === 0) {
				issues.push({
					severity: "warning",
					code: "SEC002",
					message: `Container "${containerName}" is running as root (UID 0)`,
					resource: `${resource.kind}/${resource.name}`,
					remediation: "Set runAsNonRoot: true or use a non-root user",
				});
			}

			if (spec.hostNetwork) {
				issues.push({
					severity: "warning",
					code: "SEC003",
					message: "Pod is using host network namespace",
					resource: `${resource.kind}/${resource.name}`,
					remediation: "Avoid hostNetwork unless necessary for the application",
				});
			}

			if (spec.hostPID) {
				issues.push({
					severity: "warning",
					code: "SEC004",
					message: "Pod is using host PID namespace",
					resource: `${resource.kind}/${resource.name}`,
				});
			}

			const volumes = (spec.volumes as Record<string, unknown>[]) || [];
			for (const volume of volumes) {
				const hostPath = volume.hostPath as Record<string, unknown> | undefined;
				if (hostPath) {
					issues.push({
						severity: "warning",
						code: "SEC005",
						message: `Pod mounts host path: ${(hostPath.path as string) || (volume.name as string)}`,
						resource: `${resource.kind}/${resource.name}`,
						remediation: "Use PersistentVolumes instead of hostPath when possible",
					});
				}
			}

			if (!securityContext) {
				issues.push({
					severity: "info",
					code: "SEC006",
					message: `Container "${containerName}" has no security context defined`,
					resource: `${resource.kind}/${resource.name}`,
					remediation: "Define securityContext with runAsNonRoot, readOnlyRootFilesystem, etc.",
				});
			}

			const env = (container.env as Record<string, unknown>[]) || [];
			for (const envVar of env) {
				const name = ((envVar.name as string) || "").toLowerCase();
				if (
					name.includes("password") ||
					name.includes("secret") ||
					name.includes("key") ||
					name.includes("token")
				) {
					if (envVar.value && !envVar.valueFrom) {
						issues.push({
							severity: "warning",
							code: "SEC007",
							message: `Sensitive environment variable "${envVar.name as string}" has hardcoded value`,
							resource: `${resource.kind}/${resource.name}`,
							remediation: "Use Secret references instead of hardcoded values",
						});
					}
				}
			}
		}
	}

	async checkBreakingChanges(fromEnvironment: string, toEnvironment: string): Promise<ValidationIssue[]> {
		const issues: ValidationIssue[] = [];

		try {
			const fromResources = await renderHelmTemplate(this.chartPath, fromEnvironment);
			const toResources = await renderHelmTemplate(this.chartPath, toEnvironment);

			const connector = getKubernetesConnector();

			const fromMap = new Map(fromResources.map((r) => [`${r.kind}/${r.name}`, r]));
			const toMap = new Map(toResources.map((r) => [`${r.kind}/${r.name}`, r]));

			for (const [key] of fromMap) {
				if (!toMap.has(key)) {
					issues.push({
						severity: "warning",
						code: "BREAK001",
						message: `Resource ${key} exists in ${fromEnvironment} but not in ${toEnvironment}`,
						resource: key,
						remediation: "Verify this removal is intentional",
						category: "breaking",
					});
				}
			}

			for (const [key, toResource] of toMap) {
				const fromResource = fromMap.get(key);
				if (fromResource) {
					const result = await connector.detectBreakingChanges(fromResource.yaml, toResource.yaml);

					if (result.hasBreakingChanges) {
						for (const change of result.changes) {
							issues.push({
								severity: "warning",
								code: "BREAK002",
								message: change,
								resource: key,
								remediation: "This change may require resource recreation",
								category: "breaking",
							});
						}
					}
				}
			}
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			issues.push({
				severity: "error",
				code: "BREAK000",
				message: `Breaking change check failed: ${errorMessage}`,
				category: "breaking",
			});
		}

		return issues;
	}

	async checkUnusedValues(): Promise<ValidationIssue[]> {
		const issues: ValidationIssue[] = [];
		const valuesFiles = this.getValuesFiles();

		if (valuesFiles.length === 0) {
			return issues;
		}

		const allValuePaths = new Set<string>();
		const valueFileContents = new Map<string, Record<string, unknown>>();

		for (const valuesFile of valuesFiles) {
			try {
				const content = fs.readFileSync(valuesFile, "utf8");
				const values = yaml.load(content) as Record<string, unknown>;
				valueFileContents.set(valuesFile, values);

				const paths = this.extractValuePaths("", values);
				for (const p of paths) {
					allValuePaths.add(p);
				}
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				issues.push({
					severity: "warning",
					code: "UNUSED_PARSE",
					message: `Failed to parse values file: ${errorMessage}`,
					file: valuesFile,
					category: "unused",
				});
			}
		}

		const templateFiles = this.getTemplateFiles(path.join(this.chartPath, "templates"));
		const allTemplateContent = templateFiles
			.map((f) => {
				try {
					return fs.readFileSync(f, "utf8");
				} catch {
					return "";
				}
			})
			.join("\n");

		const allTemplatesContent = this.getAllTemplatesContent();
		const combinedContent = allTemplateContent + "\n" + allTemplatesContent;

		// Precompute paths per values file to avoid redundant re-computation later
		const filePathsMap = new Map<string, string[]>();
		for (const [file, values] of valueFileContents) {
			filePathsMap.set(file, this.extractValuePaths("", values));
		}

		let unusedCounter = 0;

		for (const valuePath of allValuePaths) {
			if (this.isCommonlyExcluded(valuePath)) {
				continue;
			}

			const normalizedPath = valuePath.replace(/^\./, "");
			const usageBoundary = String.raw`(?=$|[\s|)\]}:,])`;

			const patterns = [
				new RegExp(`\\.Values\\.${this.escapeRegex(normalizedPath)}${usageBoundary}`),
				new RegExp(`\\.Values\\["${this.escapeRegex(normalizedPath)}"\\]${usageBoundary}`),
				new RegExp(`\\.Values\\['${this.escapeRegex(normalizedPath)}'\\]${usageBoundary}`),
				new RegExp(`\\(optional\\).*${this.escapeRegex(normalizedPath)}${usageBoundary}`),
			];

			let isUsed = false;
			for (const pattern of patterns) {
				if (pattern.test(combinedContent)) {
					isUsed = true;
					break;
				}
			}

			if (!isUsed) {
				const relevantFiles = valuesFiles.filter((f) => {
					const paths = filePathsMap.get(f);
					return paths ? paths.includes(valuePath) : false;
				});

				unusedCounter++;
				issues.push({
					severity: "info",
					code: `UNUSED${String(unusedCounter).padStart(3, "0")}`,
					message: `Value "${valuePath}" is defined but not referenced in any template`,
					file: relevantFiles.length > 0 ? relevantFiles[0] : "values.yaml",
					chartPath: this.chartPath,
					remediation: "Remove unused value or ensure it's referenced in templates",
					category: "unused",
				});
			}
		}

		return issues;
	}

	private escapeRegex(str: string): string {
		return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}

	private isCommonlyExcluded(path: string): boolean {
		const exclusions = [
			"global",
			"fullnameOverride",
			"nameOverride",
			"serviceAccountName",
			"ingress",
			"networkPolicy",
			"resources",
			"autoscaling",
		];

		const topLevel = path.split(".")[0];
		return exclusions.includes(topLevel);
	}

	private extractValuePaths(prefix: string, obj: Record<string, unknown>): string[] {
		const paths: string[] = [];

		if (obj === null || typeof obj !== "object") {
			return paths;
		}

		for (const [key, value] of Object.entries(obj)) {
			const currentPath = prefix ? `${prefix}.${key}` : key;

			if (value !== null && typeof value === "object" && !Array.isArray(value)) {
				const nestedPaths = this.extractValuePaths(currentPath, value as Record<string, unknown>);
				if (nestedPaths.length > 0) {
					// Only add nested paths; the parent is covered when any descendant is checked
					paths.push(...nestedPaths);
				} else {
					// Empty object — treat the key itself as a leaf
					paths.push(currentPath);
				}
			} else {
				paths.push(currentPath);
			}
		}

		return paths;
	}

	private getValuesFiles(): string[] {
		const files: string[] = [];
		const valuesYamlPath = path.join(this.chartPath, "values.yaml");

		if (fs.existsSync(valuesYamlPath)) {
			files.push(valuesYamlPath);
		}

		// Scan values-{env}.yaml files in the chart root (e.g., values-dev.yaml)
		try {
			const rootEntries = fs.readdirSync(this.chartPath);
			for (const entry of rootEntries) {
				if (FILE_PATTERNS.VALUES_ENV_REGEX.test(entry)) {
					files.push(path.join(this.chartPath, entry));
				}
			}
		} catch {
			// ignore read errors
		}

		// Also scan environments/ sub-directory
		const envDir = path.join(this.chartPath, "environments");
		if (fs.existsSync(envDir) && fs.statSync(envDir).isDirectory()) {
			const envFiles = fs.readdirSync(envDir);
			for (const file of envFiles) {
				if (file.endsWith(".yaml") || file.endsWith(".yml")) {
					files.push(path.join(envDir, file));
				}
			}
		}

		return files;
	}

	private getAllTemplatesContent(): string {
		let content = "";

		const chartsDir = path.join(this.chartPath, "charts");
		if (fs.existsSync(chartsDir) && fs.statSync(chartsDir).isDirectory()) {
			const chartDirs = fs.readdirSync(chartsDir);
			for (const chartDir of chartDirs) {
				const chartPath = path.join(chartsDir, chartDir);
				if (fs.statSync(chartPath).isDirectory()) {
					const templatesDir = path.join(chartPath, "templates");
					if (fs.existsSync(templatesDir)) {
						const templateFiles = this.getTemplateFiles(templatesDir);
						for (const templateFile of templateFiles) {
							try {
								content += fs.readFileSync(templateFile, "utf8") + "\n";
							} catch {
								// Skip files that can't be read
							}
						}
					}
				} else if (chartDir.endsWith(".tgz")) {
					// Can't check inside tgz files without extraction
				}
			}
		}

		return content;
	}
}

export function createChartValidator(chartPath: string): ChartValidator {
	return new ChartValidator(chartPath);
}
