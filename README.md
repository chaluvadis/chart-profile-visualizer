# ChartProfiles - VS Code Extension

Visualize Helm charts across environments with value merging, template rendering, and interactive chart visualization.

## Features

- 📊 **Tree View**: Organizes Helm charts by environment (dev, qa, prod)
- 📈 **Chart Visualization**: Interactive visual representation of chart statistics and resource distribution
- 🔀 **Value Merging**: Merges `values.yaml` with environment-specific `values-<env>.yaml` files
- 🎯 **Override Highlighting**: Shows which values are overridden in each environment
- 📝 **Template Rendering**: Renders final YAML using `helm template` command
- 🔍 **Resource Origin Tracking**: Shows which chart, template, and value source generated each resource

## Installation

### Prerequisites

- VS Code 1.97.0 or higher
- Node.js 20.0.0 or higher
- pnpm (installed automatically via package manager)
- Helm CLI (optional, for template rendering)

### Install from VSIX

1. Download the `.vsix` file from the releases page
2. In VS Code, go to Extensions (Ctrl+Shift+X)
3. Click the "..." menu at the top of the Extensions view
4. Select "Install from VSIX..."
5. Choose the downloaded `.vsix` file

### Build from Source

```bash
# Install dependencies
pnpm install

# Compile TypeScript
pnpm run compile

# Package extension
pnpm run package

# The generated VSIX file will be in the root directory
```

## Usage

1. Open a workspace containing Helm charts (directories with `Chart.yaml` files)
2. The **Chart Profiles** view will appear in the Explorer sidebar
3. Expand a chart to see available environments
4. Click on an action to:
   - **Visualize Chart**: See interactive charts showing statistics and resource distribution
   - **View Merged Values**: See the merged configuration with override annotations
   - **View Rendered YAML**: See the final rendered Kubernetes manifests

### Chart Visualization

The Chart Visualization feature provides:
- **Statistics Cards**: Total values, overridden values, and override percentage
- **Resource Distribution Chart**: Visual bar chart showing Kubernetes resource types and counts
- **Top Overridden Values Table**: See which values are customized for each environment
- **Environment Comparison**: Compare configurations across different environments

## How It Works

### Value Merging

The extension merges values files in this order:
1. Base `values.yaml`
2. Environment-specific `values-<env>.yaml`

Environment-specific values override base values. The merged output includes comments showing:
- Which values were overridden
- The source file for each value

### Template Rendering

When Helm CLI is installed, the extension:
1. Executes `helm template` with the appropriate values files
2. Parses the output into individual Kubernetes resources
3. Tracks which template file generated each resource
4. Annotates the output with origin information

### Environment Detection

The extension automatically detects environments by looking for files matching the pattern `values-<env>.yaml`. Common environments include:
- `values-dev.yaml` → dev environment
- `values-qa.yaml` → qa environment  
- `values-prod.yaml` → prod environment

## Architecture

```
src/
├── extension.ts              # Extension entry point
├── chartProfilesProvider.ts  # Tree view provider
├── helmChart.ts             # Chart discovery
├── valuesMerger.ts          # Value merging logic
├── helmRenderer.ts          # Template rendering
└── renderedYamlView.ts      # YAML visualization
```

## Development

```bash
# Watch mode for development
pnpm run watch

# Lint code
pnpm run lint

# Compile
pnpm run compile

# Package extension
pnpm run package
```

### Testing the Extension

1. Press F5 in VS Code to open the Extension Development Host
2. Open a folder containing Helm charts
3. Use the Chart Profiles view in the Explorer sidebar
4. Test all three actions: Visualize Chart, View Merged Values, View Rendered YAML

## Example Helm Chart Structure

```
my-chart/
├── Chart.yaml
├── values.yaml              # Base values
├── values-dev.yaml          # Dev overrides
├── values-qa.yaml           # QA overrides
├── values-prod.yaml         # Production overrides
└── templates/
    ├── deployment.yaml
    ├── service.yaml
    └── ingress.yaml
```

## Placeholders and Future Enhancements

Completed features:
- ✅ Webview-based chart visualization with statistics and resource distribution
- ✅ VSIX package generation for distribution
- ✅ Interactive visual representation using Canvas API

Potential future enhancements:
- Enhanced value highlighting with VS Code decorations
- Inline diff markers for value changes in YAML editor
- Hover tooltips showing original values
- Line-by-line value source tracking in rendered YAML
- Advanced charting with Chart.js or D3.js for more complex visualizations

## License

MIT
