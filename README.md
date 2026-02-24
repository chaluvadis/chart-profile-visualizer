# Helm Chart Visualizer

A VS Code extension for visualizing Helm charts across multiple environments with value merging and interactive chart visualization.

![Build & Release VS Code Extension](https://github.com/chaluvadis/chart-profile-visualizer/actions/workflows/workflow.yml/badge.svg)

## Demo

![Extension Demo](./images/screen_record.gif)

## Features

- 📊 **Interactive Chart Visualization** - View value overrides, chart statistics, and resource distribution
- 🏗️ **Resource Architecture Diagram** - Interactive tier-based visualization with relationship arrows
- 🎯 **Resource Explorer** - Browse all Kubernetes resources with full configuration details
- 🔗 **Relationship Detection** - Automatically detect connections between resources
- 🔀 **Environment Comparison** - Compare resources between two environments
- 🔐 **Runtime State Management** - Check health status of deployed resources
- 📋 **Helm Release Management** - Plan upgrades and assess rollbacks
- 🎨 **Kubernetes Icons** - Official-style icons for all resource types

## Installation

### From VSIX File

1. Download the `.vsix` file from the releases page
2. Open VS Code → Extensions (Ctrl+Shift+X)
3. Click "..." → "Install from VSIX..."
4. Select the downloaded file

### From Source

```bash
git clone https://github.com/chaluvadis/chart-profile-visualizer.git
cd chart-profile-visualizer
pnpm install
pnpm run compile
pnpm run package
```

## Usage

The extension activates automatically when you open a workspace containing Helm charts (directories with `Chart.yaml`).

### Viewing Charts

1. Open the **Explorer** sidebar
2. Find the **Chart Profiles** view
3. Expand to see charts and their environments

### Available Actions

- **Visualize Chart** - Open interactive dashboard with architecture diagram and resource explorer
- **View Merged Values** - See final merged values with override annotations
- **View Rendered YAML** - View fully rendered Helm templates
- **Validate Chart** - Check chart configuration and best practices
- **Check Runtime State** - View health status of deployed resources
- **View Dependencies** - See chart dependencies and security issues

### Commands

Access via Command Palette (Ctrl+Shift+P):

- **Compare Environments** - Compare two environments side-by-side
- **Check Cluster Status** - View Kubernetes cluster connection
- **Refresh Charts** - Reload all charts from workspace

## Requirements

- **VS Code**: 1.109.0 or higher
- **Helm CLI** (optional): For template rendering
- **kubectl** (optional): For runtime state features

## Supported Helm Chart Structure

```
my-chart/
├── Chart.yaml
├── values.yaml              # Base values
├── values-dev.yaml          # Dev environment
├── values-staging.yaml      # Staging environment
├── values-prod.yaml         # Production environment
└── templates/
```

Any file matching `values-*.yaml` or `values-*.yml` is detected as an environment.

## Supported Kubernetes Resources

| Category      | Resources                                                          |
| ------------- | ------------------------------------------------------------------ |
| Workloads     | Deployment, StatefulSet, DaemonSet, ReplicaSet, Job, CronJob, Pod  |
| Networking    | Service, Ingress, NetworkPolicy                                    |
| Configuration | ConfigMap, Secret                                                  |
| Storage       | PersistentVolumeClaim, PersistentVolume                            |
| RBAC          | Role, RoleBinding, ClusterRole, ClusterRoleBinding, ServiceAccount |
| Scaling       | HorizontalPodAutoscaler                                            |

## Configuration

```json
{
  "chartProfiles.ignoredDirectories": ["vendor", "tmp"]
}
```

## Troubleshooting

- **Environments not appearing**: Ensure files follow `values-*.yaml` pattern
- **Template rendering fails**: Install Helm CLI and verify with `helm version`
- **Runtime state not showing**: Install kubectl and check cluster connection

## License

MIT

## Support

For issues and feature requests, use [GitHub Issues](https://github.com/chaluvadis/chart-profile-visualizer/issues).
