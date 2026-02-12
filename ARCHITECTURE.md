# Helm Chart Resource Visualizer - Architecture Overview

## Component Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         VSCode Extension                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │            extension.ts (Entry Point)                    │   │
│  │  • Register Commands                                     │   │
│  │  • Create Tree View Provider                            │   │
│  │  • Setup File Watchers                                   │   │
│  └──────────────┬───────────────────────────────────────────┘   │
│                 │                                                 │
│  ┌──────────────▼───────────────────────────────────────────┐   │
│  │      chartProfilesProvider.ts (Tree View)                │   │
│  │  • Chart Discovery                                        │   │
│  │  • Environment Detection                                  │   │
│  │  • Action Items                                           │   │
│  └──────────────┬───────────────────────────────────────────┘   │
│                 │                                                 │
│                 │ User clicks "Visualize Chart"                  │
│                 │                                                 │
│  ┌──────────────▼───────────────────────────────────────────┐   │
│  │      chartVisualizationView.ts (Controller)              │   │
│  │  • Manage Webview Panel                                   │   │
│  │  • Collect Chart Data                                     │   │
│  │  • Handle Messages from Webview                           │   │
│  │  • Export Resources (YAML/JSON)                           │   │
│  │  • Live Update Management                                 │   │
│  └──────────────┬───────────────────────────────────────────┘   │
│                 │                                                 │
│        ┌────────┴────────┬─────────────┬──────────────┬──────────────┐
│        │                 │             │              │              │
│  ┌─────▼─────┐  ┌───────▼──────┐  ┌──▼────────┐  ┌──▼────────┐ ┌──▼────────┐
│  │helmRenderer│  │resourceVisual│  │environment│  │liveUpdate │ │relationship│
│  │   .ts      │  │   izer.ts    │  │  Diff.ts  │  │Manager.ts │ │Detector.ts │
│  │            │  │              │  │           │  │           │ │            │
│  │• Run helm  │  │• Parse       │  │• Compare  │  │• Watch    │ │• Detect    │
│  │  template  │  │  resources   │  │  envs     │  │  files    │ │  edges     │
│  │• Parse     │  │• Classify    │  │• Field    │  │• Debounce │ │• Build     │
│  │  YAML      │  │• Mask secrets│  │  diffs    │  │• Trigger  │ │  arch nodes│
│  │            │  │• Filter/     │  │           │  │  refresh  │ │• Metrics   │
│  │            │  │  search      │  │           │  │           │ │            │
│  └────────────┘  └──────────────┘  └───────────┘  └───────────┘ └────────────┘
│                                                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │      webviewHtmlGenerator.ts (UI Generator)               │  │
│  │  • Generate Enhanced HTML                                  │  │
│  │  • Tab-based Layout                                        │  │
│  │  • Resource Explorer                                       │  │
│  │  • Topology View                                           │  │
│  │  • JavaScript for Interactivity                            │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                   │
└───────────────────────────┬───────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Webview Panel (Browser)                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Toolbar: [Export YAML] [Export JSON] [Live] [+] [-] 🔍 │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Tabs: [ Overview ] [ Resources ] [ Topology ]          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                 Tab Content Area                         │   │
│  │                                                           │   │
│  │  Overview Tab:                                           │   │
│  │    • Stats Cards (Total Values, Overrides, Resources)    │   │
│  │    • High-Level Architecture Diagram (SVG)               │   │
│  │      - Nodes representing modules/components             │   │
│  │      - Edges showing relationships and data flow         │   │
│  │      - Critical nodes highlighted                        │   │
│  │      - Hierarchical layout by category                   │   │
│  │    • Chart.js Pie Chart (Override Rate)                  │   │
│  │    • Override Values Table                               │   │
│  │                                                           │   │
│  │  Resources Tab:                                          │   │
│  │    ┌─ Deployments (2) ────────────────────────┐         │   │
│  │    │  ▶ my-app-deployment                      │         │   │
│  │    │    • Metadata: {...}                      │         │   │
│  │    │    • Spec: {...}                          │         │   │
│  │    │  ▶ another-deployment                     │         │   │
│  │    └───────────────────────────────────────────┘         │   │
│  │    ┌─ Services (1) ──────────────────────────┐          │   │
│  │    │  ▶ my-app-service                        │          │   │
│  │    └──────────────────────────────────────────┘          │   │
│  │    ┌─ Secrets (1) ───────────────────────────┐          │   │
│  │    │  ▶ my-secret                             │          │   │
│  │    │    • Data: { key1: ••••••••, key2: •••• }│          │   │
│  │    └──────────────────────────────────────────┘          │   │
│  │                                                           │   │
│  │  Topology Tab:                                           │   │
│  │    • Enhanced SVG Graph with:                            │   │
│  │      - Resources grouped by namespace & category         │   │
│  │      - Relationship edges (Services→Pods, etc.)          │   │
│  │      - Critical nodes emphasized                         │   │
│  │      - Interactive tooltips on hover                     │   │
│  │    • Zoom/Pan/Fit Controls                               │   │
│  │    • Relationship Detection:                             │   │
│  │      - Service selectors                                 │   │
│  │      - Ingress routing                                   │   │
│  │      - ConfigMap/Secret references                       │   │
│  │      - Volume claims                                     │   │
│  │      - RBAC bindings                                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                   │
│  Message Passing:                                                │
│    Webview → Extension: { type: 'exportYaml' }                  │
│    Extension → Webview: { resources: [...] }                    │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘

## Data Flow

1. User clicks "Visualize Chart" in Tree View
2. Extension collects chart data:
   - Runs `helm template` via helmRenderer
   - Parses resources via resourceVisualizer
   - Detects relationships via relationshipDetector
   - Builds architecture nodes with connectivity metrics
   - Builds hierarchy with color coding and icons
3. Extension generates HTML via webviewHtmlGenerator
4. Webview displays:
   - Overview tab with architecture diagram and Chart.js visualizations
   - Resources tab with collapsible hierarchy
   - Topology tab with enhanced SVG graph showing relationships
5. User interactions:
   - Search: JavaScript filters resources client-side
   - Export: Webview sends message → Extension saves file
   - Live Mode: Extension watches files → Auto-refresh
   - Compare: Command palette → Extension renders diff
   - Architecture/Topology: Interactive SVG with zoom/pan

## Icon System

Each resource type has 2 icon variants:
- Dark theme: `images/k8s/{resource}-dark.svg`
- Light theme: `images/k8s/{resource}-light.svg`

Icons are loaded via webview.asWebviewUri() and switched based on theme.

## Color Coding

Resources are color-coded by category:
- Workloads → Blue (#007acc)
- Networking → Green (#4caf50)
- Configuration → Orange (#ff9800)
- Storage → Purple (#9c27b0)
- RBAC → Red (#f44336)
- Scaling → Teal (#00bcd4)
- Other → Gray (#9e9e9e)

## Architecture Visualization

### Relationship Detection

The extension automatically detects relationships between Kubernetes resources:

1. **Owner References** - Parent-child relationships (e.g., ReplicaSet owns Pods)
2. **Service Selectors** - Services route to Deployments/StatefulSets/Pods via label selectors
3. **Ingress Routing** - Ingress resources route to Services
4. **ConfigMap/Secret References** - Workloads mount or use ConfigMaps and Secrets
5. **Volume Claims** - PersistentVolumeClaim usage
6. **ServiceAccount References** - Workloads using ServiceAccounts
7. **RBAC Bindings** - RoleBindings connect Roles to ServiceAccounts

### High-Level Architecture Diagram

The architecture diagram in the Overview tab provides:

- **Shape-Coded Nodes** - Different shapes represent resource types:
  - Rounded rectangles for workloads
  - Hexagons for networking resources
  - Cylinders for storage
  - Document shapes for configuration
  - Shield shapes for RBAC
  - Circles for other types
- **Visual Legend** - Interactive legend explaining shape meanings
- **Hierarchical Layout** - Resources grouped by category (Workloads, Networking, Configuration, etc.)
- **Node Sizing** - Node size based on connectivity (in-degree + out-degree)
- **Critical Node Detection** - Nodes with above-average connectivity highlighted
- **Directed Arrows** - Curved edges with arrowheads showing relationships and data flow direction
- **Interactive Tooltips** - Hover to see resource details, category, and connection metrics

### Enhanced Topology Tab

The topology tab offers a detailed structural view with actionable insights:

- **Tier-Based Swimlanes** - Resources organized in vertical columns by category
- **Visual Tier Boundaries** - Color-coded backgrounds with dashed borders for each tier
- **Tier Labels** - Clear headers identifying each category column
- **Relationship Edges** - Curved paths with directional arrows showing connection types
- **Critical Node Highlighting** - Important nodes with glowing effects and special borders
- **Connectivity Badges** - Orange badges on high-traffic nodes showing connection count
- **Click-to-Highlight** - Click nodes to highlight all their relationships
- **Enhanced Tooltips** - Detailed metadata including namespace, category, and connection counts
- **Zoom/Pan Controls** - Navigate large topologies easily
- **Fit to Screen** - Auto-adjust view to show all resources

## Security Features

1. Secret Masking:
   - Detects Secret resources
   - Shows keys but masks values with ••••••••
   - No secret data exposed in UI

2. Content Security Policy:
   - Nonce-based script execution
   - Restricted external sources
   - Theme CSS variables only

3. CodeQL Verified:
   - 0 vulnerabilities found
   - All code passes security checks
