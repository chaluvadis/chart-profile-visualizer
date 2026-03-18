# Chart Profile Visualizer - Architecture

## Why This Extension?

Platform engineers and SREs managing multi-environment Kubernetes deployments face configuration drift. When development, staging, and production environments diverge, unexpected issues arise in production.

The extension provides:
- Visual representation of Helm chart resources
- Side-by-side environment comparison
- Field-level diff highlighting
- Relationship topology visualization

## Technologies

| Category | Technology |
|----------|------------|
| Language | TypeScript |
| Runtime | VS Code Extension API |
| Build | esbuild |
| Charts | Chart.js |
| Templates | Custom engine |
| Helm | helm CLI |

## Components

### Extension Layer

| Component | Role |
|-----------|------|
| extension.ts | Entry point, register commands, manage panel |
| chartProfilesProvider.ts | Discover charts, show tree view |
| chartVisualizationView.ts | Coordinate data, handle messages |

### Business Logic Layer

| Component | Role |
|-----------|------|
| helmRenderer.ts | Execute helm template, parse YAML |
| resourceVisualizer.ts | Classify resources, mask secrets |
| environmentDiff.ts | Compare environments, detect changes |
| relationshipDetector.ts | Analyze dependencies |
| valuesMerger.ts | Merge base with environment values |

### UI Layer

| Component | Role |
|-----------|------|
| webviewHtmlGenerator.ts | Generate HTML content |
| templateLoader.ts | Template engine |

## Webview Tabs

### Overview Tab
- Resource count bar chart
- Values pie chart
- Summary statistics

### Resources Tab
- Hierarchical resource tree
- Expandable details
- Search functionality

### Compare Tab
- Environment selector (two dropdowns)
- Summary stats (Added/Removed/Modified)
- Filter buttons
- Field diffs with color highlighting

## Data Flow

```
User selects chart
       |
       v
Tree View --> Controller
       |
       v
Helm Renderer --> Resource Visualizer
       |                    |
       v                    v
Relationship Detector --> Environment Diff
       |                    |
       v                    v
HTML Generator --> Webview Display
```

## Comparison Flow

```
User selects env1 + env2
       |
       v
Controller runs helm template twice
       |
       v
Diff Engine compares resources
       |
       v
Webview shows diff
- Red background: removed/old values
- Green background: added/new values
- Purple: field paths
```

## Security

```
+------------------+
| Local Processing |
| - All helm runs  |
|   locally        |
+------------------+

+------------------+
| Secret Masking   |
| - Detect Secrets |
| - Mask values    |
+------------------+

+------------------+
| Content Security |
| - Nonce scripts  |
| - No inline JS   |
+------------------+

+------------------+
| HTML Escaping    |
| - Escape user    |
|   input          |
+------------------+
```

## Lifecycle

```
Activation
    |
    v
User Selects Chart --> Render --> Display
    |
    v
Compare Environments --> Diff --> Display
    |
    v
Export (optional) --> Save File
    |
    v
Deactivation
```