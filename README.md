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

## Quick Start (2 minutes)

![Extension Demo](./images/screen_record.gif)

✅ Expected outcome: You see a structured comparison of chart values and identified drift.

## Example workflow

Use sample files in `examples/`:

- `examples/values-dev.yaml`
- `examples/values-qa.yaml`
- `examples/values-staging.yaml`
- `examples/values-prod.yaml`

## Core features

- Environment profile comparison
- Visual diff for Helm values
- Drift categorization (config groups)
- Fast local analysis in VS Code

## Environment Profiles — Markdown format

The **Compare Environment Profiles** panel reads environment snapshots from
markdown files in your workspace.  Two schemas are supported:

### 1. YAML frontmatter (one profile per file)

Place a YAML block between `---` fences at the very top of any `.md` file:

```markdown
---
environment: production
timestamp: "2024-01-15T10:30:00Z"
metrics:
  latency: 45.2
  error_rate: 0.01
  throughput: 1250
  cost: 850.00
tags:
  - production
  - us-east
---

# Production snapshot

Any additional documentation can follow the frontmatter.
```

### 2. Fenced `env-profile` code blocks (multiple profiles per file)

Embed one or more ` ```env-profile ` blocks anywhere in a markdown file.
Both YAML and JSON are accepted inside the block:

````markdown
```env-profile
environment: staging
timestamp: "2024-01-15T08:00:00Z"
metrics:
  latency: 72.1
  error_rate: 0.04
  throughput: 980
tags:
  - staging
```

```env-profile
environment: dev
timestamp: "2024-01-15T07:00:00Z"
metrics:
  latency: 120.5
  error_rate: 0.10
  throughput: 450
tags:
  - dev
```
````

### Schema reference

| Field         | Type             | Required | Description                              |
|---------------|------------------|----------|------------------------------------------|
| `environment` | string           | ✅       | Logical environment name                 |
| `timestamp`   | ISO-8601 string  |          | When the snapshot was captured           |
| `metrics`     | object           |          | Key→number pairs (latency, error_rate …) |
| `tags`        | string array     |          | Free-form labels for filtering           |

Any metric key is accepted; common ones are `latency` (ms), `error_rate` (0–1),
`throughput` (req/s), and `cost` (USD/hr).

### Using the panel

1. Open the **Chart Profiles** sidebar view.
2. Click **Compare Environment Profiles** (graph icon) in the toolbar, or run  
   `Chart Profiles: Compare Environment Profiles` from the Command Palette.
3. Use the **Environments** multi-select and **Metric** dropdown to filter the view.
4. Click **Apply** to refresh the comparison table, summary cards, and trend chart.
5. Click **Export CSV** to save all profile data as a CSV file.

## Recommended next features (roadmap)

- Severity scoring: `Info / Warning / Critical`
- Risk-focused presets (security/network/resources)
- Export comparison report (Markdown/JSON)
- PR comment integration for release checks

## Compatibility

- VS Code: `<min-version>`
- Helm values format: YAML
- OS: macOS / Linux / Windows

## Data handling & privacy

- Processing is performed locally in VS Code.
- No chart values are transmitted externally unless explicitly configured by user.
- Telemetry (if enabled) is anonymized and excludes secrets/chart payloads.

## Troubleshooting

### “VS Code API has already been acquired” error
- Ensure webview API is acquired only once per webview lifecycle.
- Reload window and retry command.
- Update to latest extension version.

### No comparison output
- Confirm selected files are valid YAML.
- Verify file paths and environment mapping.
- Check output panel logs.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md).

## License

MIT

## Support

For issues and feature requests, use [GitHub Issues](https://github.com/chaluvadis/chart-profile-visualizer/issues).
