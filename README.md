# Chart Profile Visualizer

A VS Code extension for visualizing Helm charts across multiple environments with value merging and interactive chart visualization.

## Features

- 📊 **Interactive Chart Visualization** - View resource distribution, value overrides, and chart statistics
- 🔀 **Environment Comparison** - Compare base and environment-specific values
- 📝 **Rendered Templates** - View fully rendered Helm templates with merged values
- 🎯 **Tree View Navigation** - Browse charts, environments, and actions in the Explorer sidebar
- 🔍 **Value Tracking** - See which values are overridden and their sources

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
4. Each chart shows available environments (dev, qa, prod, etc.)

### Available Actions

For each environment, you can:

#### 1. Visualize Chart
- Click "Visualize Chart" to open an interactive dashboard
- Shows:
  - Resource type distribution (bar chart)
  - Overridden vs base values (pie chart)
  - Detailed override comparison table
  - Namespace and template statistics

#### 2. View Merged Values
- See the final merged values for the environment
- Annotations show which values come from base vs environment files
- Summary of overridden values at the top

#### 3. View Rendered YAML
- View fully rendered Helm templates
- Requires Helm CLI installed (falls back to placeholder if not available)
- Shows all Kubernetes resources that would be created

## Requirements

- **VS Code**: Version 1.97.0 or higher
- **Node.js**: Version 20.0.0 or higher
- **Helm CLI** (optional): For template rendering functionality
  - Install from: https://helm.sh/docs/intro/install/

## Supported Helm Chart Structure

```
my-chart/
├── Chart.yaml
├── values.yaml              # Base values
├── values-dev.yaml          # Dev environment overrides
├── values-qa.yaml           # QA environment overrides
├── values-prod.yaml         # Production environment overrides
└── templates/
    ├── deployment.yaml
    ├── service.yaml
    └── ...
```

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
├── extension.ts                 # Extension entry point
├── chartProfilesProvider.ts     # Tree view provider
├── chartVisualizationView.ts    # Interactive chart dashboard
├── helmChart.ts                 # Chart discovery
├── helmRenderer.ts              # Template rendering
├── valuesMerger.ts              # Value merging logic
└── renderedYamlView.ts          # YAML display
```

## Troubleshooting

### Charts not showing in tree view
- Ensure your workspace contains `Chart.yaml` files
- Check that files follow Helm chart structure
- Reload the window (Ctrl+Shift+P → "Reload Window")

### Template rendering fails
- Install Helm CLI: https://helm.sh/docs/intro/install/
- Verify Helm is in your PATH: `helm version`
- Check Helm chart syntax is valid

### Extension not activating
- Check VS Code version (needs 1.97.0+)
- Look for errors in Output → Chart Profiles
- Check Developer Tools console (Help → Toggle Developer Tools)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT

## Support

For issues and feature requests, please use the [GitHub Issues](https://github.com/chaluvadis/chart-profile-visualizer/issues) page.
