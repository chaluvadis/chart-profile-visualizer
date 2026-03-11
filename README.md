# Chart Profile Visualizer

Visualize and compare Helm chart configurations across environments (dev/stage/prod) to detect risky drift before deployment.

> Best for platform engineers, SREs, and teams managing multi-environment Kubernetes releases.

![Build & Release VS Code Extension](https://github.com/chaluvadis/chart-profile-visualizer/actions/workflows/workflow.yml/badge.svg)

## Why this extension

Chart Profile Visualizer helps you:

- **Detect config drift early** across environments
- **Reduce deployment risk** by highlighting high-impact differences
- **Speed up reviews** with visual and structured comparisons
- **Improve release confidence** before promotion to production

## Quick Start

1. **Open a Helm chart** in your workspace (a directory containing `Chart.yaml` and `values*.yaml` files)
2. **Look for the Chart Profile Visualizer** in the VS Code sidebar (explorer panel)
3. **Expand the tree view** to see available environment profiles
4. **Click on any profile** to visualize its resources
5. **Use the Compare tab** to compare environments side-by-side

![Extension Demo](./images/screen_record.gif)

## Features

### 📊 Overview Tab
- **Resource Count Chart** - Visual bar chart showing resource distribution by kind (Deployment, Service, ConfigMap, etc.)
- **Values Overview** - Pie chart showing overridden vs base values
- **Summary Statistics** - Quick metrics on total resources and overridden values

### 📋 Resources Tab
- **Hierarchical View** - Resources organized by Kubernetes kind
- **Expandable Details** - Click to see full YAML for each resource
- **Color Coding** - Visual indicators for different resource types
- **Search** - Filter resources by name or kind

### ⚖️ Compare Environments Tab
- **Side-by-Side Comparison** - Select two environments to compare
- **Visual Diff Highlighting** - Red for removed/old values, green for added/new values
- **Field-Level Changes** - See exactly which fields differ between environments
- **Filter by Change Type** - Filter by Added, Removed, or Modified resources
- **Summary Stats** - Quick overview of changes (X Added, Y Removed, Z Modified)

### 🔧 Additional Features
- **Export** - Export rendered resources as YAML or JSON
- **Copy to Clipboard** - Quickly copy individual resource YAMLs
- **Multiple Chart Support** - Work with multiple Helm charts in one workspace

## Example Workflow

The extension works with any Helm chart. Example files are provided in `examples/`:

```bash
examples/
├── Chart.yaml
├── values.yaml              # Base values
├── values-dev.yaml          # Development overrides
├── values-qa.yaml          # QA overrides
├── values-staging.yaml     # Staging overrides
└── values-prod.yaml        # Production overrides
```

### Comparing Environments

1. Click on any profile in the tree view to load it
2. Go to the **Compare Environments** tab
3. Select base environment (e.g., "dev") from the first dropdown
4. Select compare environment (e.g., "prod") from the second dropdown
5. Click **Compare** to see the differences
6. Use filter buttons to focus on Added, Removed, or Modified resources

## Architecture

The extension consists of:

- **Tree View Provider** - Shows Helm charts and profiles in sidebar
- **Webview Panel** - Interactive visualization interface
- **Helm Renderer** - Renders chart templates with values
- **Diff Engine** - Compares environment configurations
- **Template System** - Custom HTML template processing

For detailed architecture information, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Compatibility

- **VS Code**: 1.70+
- **Helm**: 3.0+
- **Helm values format**: YAML
- **OS**: macOS / Linux / Windows

## Data Handling & Privacy

- All processing is performed locally within VS Code
- No chart values are transmitted to external servers
- Telemetry (if enabled) is anonymized and excludes secrets

## Troubleshooting

### "Failed to load template" error
- Ensure you're running the latest version of the extension
- Try reloading the VS Code window (Developer: Reload Window)

### No comparison output
- Confirm selected files are valid YAML
- Verify your chart has multiple values files for comparison
- Check the Output panel for logs

### Tree view not showing
- Open a folder containing a Helm chart (Chart.yaml)
- Check that the chart directory is in your workspace

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and contribution guidelines.

## License

MIT

## Support

For issues and feature requests, use [GitHub Issues](https://github.com/chaluvadis/chart-profile-visualizer/issues).
