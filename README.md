# Helm Chart Visualizer

Visualize, validate, compare, and monitor Helm chart environments directly inside VS Code.

This extension is designed for teams managing multiple environment overlays (`values-dev.yaml`, `values-qa.yaml`, `values-prod.yaml`, etc.) and wanting a fast, consistent desktop workflow for release confidence.

![Build & Release VS Code Extension](https://github.com/chaluvadis/chart-profile-visualizer/actions/workflows/workflow.yml/badge.svg)

## What You Can Do

- Visualize a chart environment with architecture and resource insights
- Validate chart quality and best-practice issues in an actionable UI
- Compare two environments with field-level change details
- Check runtime state against the cluster in a dedicated runtime dashboard
- Export rendered manifests as YAML or JSON

## Tree View Experience

In Explorer, open **Chart Profiles** and expand:

- `Chart`
  - `Compare Environments`
  - `Environment (dev/qa/staging/prod...)`
    - `Visualize Chart`
    - `Validate Chart`
    - `Check Runtime State`

The tree is environment-aware and supports multi-root workspaces.

## Core Workflows

## 1) Visualize Chart

`Visualize Chart` opens a desktop-first webview with:

- **Overview tab**
  - Resource architecture graph/topology
  - Values and override summary cards
  - Chart-level metrics
- **Resources tab**
  - Grouped resources by Kubernetes kind
  - Expandable resource cards with YAML
  - Copy resource YAML action
- **Toolbar actions**
  - Export YAML
  - Export JSON

## 2) Validate Chart

`Validate Chart` opens a dedicated validation view with:

- Status header aligned to result severity
- Error/Warning/Info summaries
- Search and severity filtering
- Cards view and table view
- Grouping, sorting, and actionable filtering
- Quick actions:
  - Copy issue text
  - Jump to file/line when location is available

## 3) Compare Environments

`Compare Environments` provides:

- Side-by-side environment comparison
- Added/Removed/Modified resource categorization
- Field-level value differences
- Change filters and grouped summaries

## 4) Check Runtime State

`Check Runtime State` opens a runtime dashboard (not raw markdown):

- Cluster context and connection state
- Healthy/Warning/Critical/NotFound/Unknown summaries
- Structured resource status sections
- All resources list with quick actions:
  - **View YAML**
- Helm release summary table

## Requirements

- VS Code `^1.110.0`
- Helm CLI (`helm`) for rendering/validation flows
- Kubernetes CLI (`kubectl`) for runtime state flows

## Example Chart Layout

```text
sample-app/
  Chart.yaml
  values.yaml
  values-dev.yaml
  values-qa.yaml
  values-staging.yaml
  values-prod.yaml
  templates/
```
## Development

```bash
pnpm install
pnpm run compile
```

Useful scripts:

- `pnpm run compile` - build extension + webview assets
- `pnpm run lint` - lint with Biome
- `pnpm run format` - format with Biome
- `pnpm run package` - compile and produce `.vsix`

## Security and Privacy Notes

- Local-first processing: chart rendering and analysis happen on your machine
- Runtime queries are executed through local CLIs (`kubectl`, `helm`)
- HTML output uses escaping and constrained templating paths
- Sensitive manifest content handling includes redaction safeguards in resource flows

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for module-level design and data flow.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT

## Support

Issues and feature requests:

- https://github.com/chaluvadis/chart-profile-visualizer/issues
