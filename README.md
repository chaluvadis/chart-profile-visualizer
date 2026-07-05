# Helm Chart Visualizer

VS Code extension for visualizing, validating, comparing, and monitoring Helm charts.

## Features

- **Visualize Chart** - View resource architecture, values, and rendered YAML
- **Validate Chart** - Check for errors, warnings, and best practices
- **Compare Environments** - Side-by-side comparison between dev/staging/prod
- **Check Runtime State** - View cluster status against rendered resources
- **Export** - YAML, JSON, and Markdown reports

## Quick Start

1. Open a workspace with Helm charts (folders containing `Chart.yaml`)
2. Open the **Chart Profiles** view in VS Code Explorer
3. Expand a chart and click an environment
4. Select **Visualize Chart**, **Validate Chart**, or **Compare Environments**

## Chart-Specific Configuration

Add `.chart-profile.yaml` in your chart directory to configure how `helm template` is invoked, per environment:

```yaml
# Default values
releaseName: my-app
namespace: my-app

# Extra `helm template` flags, applied on top of values.yaml / values-<env>.yaml
valuesFiles:
  - values-common.yaml       # extra -f files, relative to the chart directory
setValues:
  - "global.region=us-east"  # --set overrides
apiVersions:
  - "networking.k8s.io/v1/Ingress"  # --api-versions, for .Capabilities.APIVersions checks
kubeVersion: "1.29.0"         # --kube-version, for .Capabilities.KubeVersion checks

# Environment overrides
environments:
  dev:
    releaseName: my-app-dev
    namespace: dev
    setValues:
      - "replicaCount=1"
  prod:
    releaseName: my-app
    namespace: production
```

`releaseName` and `namespace` can also be set via workspace settings; `valuesFiles`, `setValues`, `apiVersions`, and `kubeVersion` are only read from `.chart-profile.yaml`.

**Precedence order** (highest to lowest), applied independently per field:
1. Workspace settings (`releaseName` / `namespace` only)
2. Environment-specific profile
3. Chart-level profile
4. Built-in defaults

## Requirements

- VS Code `^1.110.0`
- Helm CLI (`helm`) - for rendering/validation
- kubectl - for runtime state

## Development

```bash
pnpm install
pnpm run compile
```

## License

MIT