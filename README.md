# ChartProfiles - VS Code Extension

Visualize Helm charts across environments with value merging and template rendering.

## Features

- 📊 **Tree View**: Organizes Helm charts by environment (dev, qa, prod)
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

### Build from Source

```bash
# Install dependencies
pnpm install

# Compile TypeScript
pnpm run compile

# Package extension (requires vsce)
pnpm install -g @vscode/vsce
vsce package
```

## Usage

1. Open a workspace containing Helm charts (directories with `Chart.yaml` files)
2. The **Chart Profiles** view will appear in the Explorer sidebar
3. Expand a chart to see available environments
4. Click on an action to:
   - **View Merged Values**: See the merged configuration with override annotations
   - **View Rendered YAML**: See the final rendered Kubernetes manifests

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
```

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

Current implementation includes placeholders for:
- Enhanced value highlighting with VS Code decorations
- Inline diff markers for value changes
- Hover tooltips showing original values
- Line-by-line value source tracking in rendered YAML

## License

MIT
