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
│  │  Topology Tab (Redesigned):                             │   │
│  │    • Modern horizontal tier layout with:                │   │
│  │      - Resources in horizontal bands by category        │   │
│  │      - Card-based nodes with gradients & shadows        │   │
│  │      - Interactive legend and tier filtering            │   │
│  │      - Resource and connection statistics in header     │   │
│  │    • Enhanced node design:                              │   │
│  │      - Critical badges (⚠) for important resources      │   │
│  │      - Connectivity badges (count) for busy nodes       │   │
│  │      - Smooth animations and transitions                │   │
│  │      - Modern color scheme aligned with VSCode themes   │   │
│  │    • Improved interactions:                             │   │
│  │      - Click to highlight relationships                 │   │
│  │      - Mouse drag to pan, wheel to zoom                 │   │
│  │      - Tier filter dropdown                             │   │
│  │    • Advanced Controls:                                 │   │
│  │      - Zoom in/out, Reset view, Fit to screen          │   │
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

Resources are color-coded by category using modern, accessible colors:
- Workloads → Blue (#0078d4)
- Networking → Green (#107c10)
- Storage → Purple (#8661c5)
- Configuration → Orange (#d83b01)
- RBAC → Red (#e81123)
- Scaling → Teal (#008272)
- Other → Gray (#737373)

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

### Redesigned Topology Tab

The topology tab has been completely redesigned with a modern, intuitive interface:

**Layout Architecture:**
- **Horizontal Tier Layout** - Resources organized in horizontal bands (rows) instead of vertical columns
  - Each tier (Workload, Networking, Storage, etc.) gets a horizontal band across the canvas
  - Nodes within each tier are distributed horizontally for better space utilization
  - More intuitive left-to-right flow, especially on widescreen displays
  
**Visual Design:**
- **Modern Node Cards** - Card-based design with:
  - Gradient overlays for visual depth
  - Drop shadows for elevation (filter: url(#dropShadow))
  - Smooth rounded corners (rx: 6)
  - Dynamic sizing based on connectivity (larger nodes = more connections)
  - Color-coded by tier with modern, accessible color palette
  
- **Smart Badges:**
  - **Critical Badge (⚠)** - Orange warning badge on critical resources
    - Positioned at top-right corner
    - Pulsing glow animation for attention
    - Indicates high importance in system architecture
  - **Connectivity Badge** - Blue circular badge showing connection count
    - Appears on nodes with 5+ connections
    - Positioned at top-left corner
    - Shows exact number of total connections
    
**Enhanced Header:**
- Resource and connection statistics
- Tier filter dropdown to focus on specific categories
- Modern control buttons with improved styling

**Interactive Features:**
- **Click Selection** - Click nodes to highlight their relationships
  - Selected node gets brighter with blue glow effect
  - Connected edges highlighted in blue with increased thickness
  - Smooth transitions (0.25s cubic-bezier easing)
- **Pan and Zoom:**
  - Mouse drag to pan the view
  - Mouse wheel to zoom in/out
  - Zoom buttons: +/− for precise control
  - Reset button to return to default view
  - Fit-to-screen automatically calculates optimal zoom and centering
  
**Edge Rendering:**
- **Smooth Cubic Bezier Curves** - More aesthetically pleasing than straight lines
  - Formula: C[source.x + offset], [source.y] [target.x - offset], [target.y] [target.x], [target.y]
  - Control point offset = 50% of horizontal distance
  - Creates natural flowing connections
- **Edge Types:**
  - Regular connections: subtle gray, low opacity (0.25)
  - Critical paths (ownership): orange, medium opacity (0.6)
  - Highlighted edges: bright blue, high opacity (0.9)
- **Directional Arrows** - Markers showing relationship direction

**Legend System:**
- Two-section legend showing:
  1. **Resource Tiers** - Color swatches for each category
  2. **Indicators** - Badge examples (critical, connectivity)
- Compact design that doesn't clutter the interface

**Tier Filtering:**
- Dropdown to filter view by specific tier
- "All Tiers" shows complete topology
- Selecting a tier hides other tiers and shows only relevant connections
- Smooth show/hide transitions

**Performance Optimizations:**
- Efficient SVG rendering tuned for typical topology sizes
- Transition animations use CSS transforms for smooth updates
- Per-node event listeners, appropriate for current node counts
- Initialization occurs when the topology view is opened

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
