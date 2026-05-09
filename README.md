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

Add `.chart-profile.yaml` in your chart directory to configure release name and namespace per environment:

```yaml
# Default values
releaseName: my-app
namespace: my-app

# Environment overrides
environments:
  dev:
    releaseName: my-app-dev
    namespace: dev
  prod:
    releaseName: my-app
    namespace: production
```

**Precedence order** (highest to lowest):
1. Workspace settings
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