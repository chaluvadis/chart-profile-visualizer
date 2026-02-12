# Chart Profile Visualizer

A VS Code extension for visualizing Helm charts across multiple environments with value merging and interactive chart visualization.

## Features

- 🏗️ **High-Level Architecture Diagram** - Visualize system architecture with shape-coded nodes (workloads, networking, storage, config, RBAC) and directional arrows showing data flow
- 🗺️ **Enhanced Topology View** - Interactive tier-based swimlane layout with critical node highlighting, connectivity badges, and click-to-highlight relationships
- 📊 **Interactive Chart Visualization** - View value overrides and chart statistics with multiple visualization tabs
- 🎯 **Resource Explorer** - Browse all Kubernetes resources with full configuration details in a collapsible hierarchy
- 🔍 **Search & Filter** - Instantly search resources by name, kind, namespace, or labels
- 🔗 **Relationship Detection** - Automatically detect and visualize connections between resources (Services, Ingress, ConfigMaps, Secrets, etc.)
- 📤 **Export Resources** - Export rendered resources as YAML or JSON files
- 🔄 **Live Mode** - Auto-refresh visualization when chart files change
- 🔀 **Environment Comparison** - Compare resources between two environments to see what changed
- 📝 **Rendered Templates** - View fully rendered Helm templates with merged values
- 🎨 **Kubernetes Icons** - Official-style icons for all resource types with dark/light theme support
- 🎯 **Tree View Navigation** - Browse charts, environments, and actions in the Explorer sidebar
- 🔐 **Secret Masking** - Automatically masks secret data while showing keys
- 📋 **Copy to Clipboard** - Quickly copy individual resource YAML to clipboard
- 🌍 **Dynamic Environment Discovery** - Automatically detects all `values-*.yaml` files
- 📁 **Multi-Root Workspace Support** - Works seamlessly with multi-root VS Code workspaces
- 💡 **Enhanced Tooltips** - Rich tooltips showing chart metadata, versions, and values files
- 🔔 **Helm CLI Status** - Warnings when Helm is not available for template rendering

## Installation

### From VSIX File
1. Download the `.vsix` file from the releases page
2. Open VS Code
3. Navigate to Extensions (Ctrl+Shift+X / Cmd+Shift+X)
4. Click the "..." menu → "Install from VSIX..."
5. Select the downloaded `.vsix` file

### From Source
```bash
git clone https://github.com/chaluvadis/chart-profile-visualizer.git
cd chart-profile-visualizer
pnpm install
pnpm run compile
pnpm run package  # Generates .vsix file
```

## Usage

### Activating the Extension
The extension automatically activates when you open a workspace containing Helm charts (directories with `Chart.yaml` files).

### Viewing Charts
1. Open the **Explorer** sidebar in VS Code
2. Look for the **Chart Profiles** view
3. Expand to see all Helm charts in your workspace
4. Each chart shows available environments (automatically discovered from `values-*.yaml` files)
5. Environments with no overrides are marked with a hollow circle icon and "(no overrides)" label

### Available Actions

For each environment, you can:

#### 1. Visualize Chart
- Click "Visualize Chart" to open an interactive dashboard with three tabs:

**Overview Tab:**
  - **High-Level Architecture Diagram** - Visual representation of system architecture using distinct shapes:
    - Different shapes for resource types: rounded rectangles (workloads), hexagons (networking), cylinders (storage), documents (configuration), shields (RBAC)
    - Directional arrows showing relationships and data flow
    - Node size reflects connectivity (larger = more connections)
    - Critical nodes highlighted based on centrality
    - Color-coded by resource category
    - Interactive legend explaining visual elements
  - Detailed override comparison table
  - Namespace and template statistics

**Resources Tab:**
  - Complete resource explorer with collapsible hierarchy
  - All Kubernetes resources grouped by kind
  - Full configuration details (metadata, spec, status, data)
  - Color-coded by resource category (workloads, networking, storage, RBAC, etc.)
  - Kubernetes-style icons for each resource type
  - Secret data is automatically masked (shows keys, hides values)
  - Copy individual resources to clipboard
  - Search functionality to filter resources instantly
  - Expand/collapse all controls

**Topology Tab:**
  - **Enhanced System Topology** - Detailed structural view with actionable insights:
    - Tier-based swimlane layout organizing resources by category (Workload, Networking, Storage, etc.)
    - Visual tier boundaries with color-coded backgrounds
    - Relationship edges with directional arrows showing connection types
    - Critical nodes with glowing indicators and special highlighting
    - Connectivity badges showing number of connections for high-traffic nodes
    - Click nodes to highlight their relationships
    - Enhanced tooltips with detailed resource metadata
    - Zoom, pan, and fit-to-screen controls
    - Curved edges for better visual clarity
  - Relationships detected:
    - Service selectors to workloads
    - Ingress routing to services
    - ConfigMap and Secret references
    - Volume claims and mounts
    - RBAC bindings
    - Owner references

**Toolbar Features:**
  - 📄 **Export YAML** - Save all rendered resources to a YAML file
  - 📋 **Export JSON** - Save all rendered resources to a JSON file
  - 🔄 **Live Mode** - Enable auto-refresh when chart files change
  - ➕ **Expand All** - Expand all resource groups and details
  - ➖ **Collapse All** - Collapse all resource groups and details
  - 🔍 **Search Box** - Filter resources by name, kind, namespace, or labels

#### 2. View Merged Values
- See the final merged values for the environment
- Annotations show which values come from base vs environment files
- Summary of overridden values at the top

#### 3. View Rendered YAML
- View fully rendered Helm templates
- Requires Helm CLI installed (falls back to placeholder if not available)
- Shows all Kubernetes resources that would be created

#### 4. Compare Environments (Command Palette)
- Use Command Palette (Ctrl+Shift+P / Cmd+Shift+P)
- Search for "Compare Environments"
- Select chart and two environments to compare
- View side-by-side diff showing added, removed, and modified resources
- Field-level change details for modified resources

## Requirements

- **VS Code**: Version 1.97.0 or higher
- **Node.js**: Version 20.0.0 or higher
- **Helm CLI** (optional): For template rendering functionality
  - Install from: https://helm.sh/docs/intro/install/
  - The extension will warn you if Helm is not available when attempting to render templates

## Configuration

The extension can be customized through VS Code settings:

### `chartProfiles.ignoredDirectories`

**Type:** `array`  
**Default:** `[]`

Additional directories to ignore when discovering Helm charts. The extension always ignores common directories like `node_modules`, `.git`, `.vscode`, `dist`, `out`, `build`, and hidden directories (starting with `.`).

**Example:**
```json
{
  "chartProfiles.ignoredDirectories": ["vendor", "tmp", "cache"]
}
```

## Multi-Root Workspace Support

The extension fully supports multi-root workspaces. Charts from all workspace folders will be displayed in the tree view:

1. Open a multi-root workspace in VS Code
2. All Helm charts across all folders will be discovered automatically
3. The tree view will show charts from all workspace roots
4. Adding or removing workspace folders will automatically refresh the chart list

## Supported Helm Chart Structure

The extension automatically discovers environments based on your `values-*.yaml` files:

```
my-chart/
├── Chart.yaml
├── values.yaml              # Base values
├── values-dev.yaml          # Dev environment (automatically discovered)
├── values-staging.yaml      # Staging environment (automatically discovered)
├── values-qa.yaml           # QA environment (automatically discovered)
├── values-prod.yaml         # Production environment (automatically discovered)
└── templates/
    ├── deployment.yaml
    ├── service.yaml
    └── ...
```

**Note:** Any file matching the pattern `values-*.yaml` or `values-*.yml` will be detected as an environment.

## Supported Kubernetes Resources

The extension provides full support for visualizing these Kubernetes resource types with dedicated icons and color coding:

### Workloads (Blue)
- Deployment, StatefulSet, DaemonSet, ReplicaSet
- Job, CronJob, Pod

### Networking (Green)
- Service, Ingress, NetworkPolicy

### Configuration (Orange)
- ConfigMap, Secret (with automatic data masking)

### Storage (Purple)
- PersistentVolumeClaim, PersistentVolume

### RBAC (Red)
- Role, RoleBinding, ClusterRole, ClusterRoleBinding
- ServiceAccount

### Scaling (Teal)
- HorizontalPodAutoscaler

### Other (Gray)
- Namespace
- Any other Kubernetes resources (will be displayed but may not have dedicated icons)

## Development

### Building from Source
```bash
# Install dependencies
pnpm install

# Compile TypeScript
pnpm run compile

# Watch mode for development
pnpm run watch

# Create VSIX package
pnpm run package
```

### Project Structure
```
src/
├── extension.ts                 # Extension entry point & command registration
├── chartProfilesProvider.ts     # Tree view provider
├── chartVisualizationView.ts    # Main visualization view controller
├── webviewHtmlGenerator.ts      # Enhanced HTML generation for webview
├── resourceVisualizer.ts        # Resource parsing & hierarchy builder
├── relationshipDetector.ts      # Resource relationship detection & architecture nodes
├── environmentDiff.ts           # Environment comparison logic
├── liveUpdateManager.ts         # File watching & auto-refresh
├── helmChart.ts                 # Chart discovery
├── helmRenderer.ts              # Template rendering with Helm CLI
├── valuesMerger.ts              # Value merging logic
└── renderedYamlView.ts          # YAML display

images/
├── icon.svg                     # Extension icon (dark theme)
├── icon-light.svg               # Extension icon (light theme)
└── k8s/                         # Kubernetes resource icons
    ├── deployment-dark.svg
    ├── deployment-light.svg
    ├── service-dark.svg
    ├── service-light.svg
    └── ... (40+ icons for all resource types)
```

## Troubleshooting

### Charts not showing in tree view
- Ensure your workspace contains `Chart.yaml` files
- Check that files follow Helm chart structure
- If using ignored directories, verify they're not blocking chart discovery
- Reload the window (Ctrl+Shift+P → "Reload Window")
- Check if charts are in directories configured in `chartProfiles.ignoredDirectories`

### Environments not appearing
- Ensure environment-specific values files follow the pattern `values-*.yaml` or `values-*.yml`
- Check file permissions and that files are readable
- Refresh the chart view using the refresh button

### Template rendering fails
- Install Helm CLI: https://helm.sh/docs/intro/install/
- Verify Helm is in your PATH: `helm version`
- Check Helm chart syntax is valid
- The extension will show a warning dialog if Helm is not available

### Extension not activating
- Check VS Code version (needs 1.97.0+)
- Look for errors in Output → Chart Profiles
- Check Developer Tools console (Help → Toggle Developer Tools)

### Multi-root workspace issues
- Verify all workspace folders contain Helm charts
- Check that workspace folders are properly configured in VS Code
- Use the refresh command to reload charts from all roots

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT

## Support

For issues and feature requests, please use the [GitHub Issues](https://github.com/chaluvadis/chart-profile-visualizer/issues) page.
