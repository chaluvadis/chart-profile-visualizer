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
│        ┌────────┴────────┬─────────────┬──────────────┐         │
│        │                 │             │              │          │
│  ┌─────▼─────┐  ┌───────▼──────┐  ┌──▼────────┐  ┌──▼────────┐│
│  │helmRenderer│  │resourceVisual│  │environment│  │liveUpdate ││
│  │   .ts      │  │   izer.ts    │  │  Diff.ts  │  │Manager.ts ││
│  │            │  │              │  │           │  │           ││
│  │• Run helm  │  │• Parse       │  │• Compare  │  │• Watch    ││
│  │  template  │  │  resources   │  │  envs     │  │  files    ││
│  │• Parse     │  │• Classify    │  │• Field    │  │• Debounce ││
│  │  YAML      │  │• Mask secrets│  │  diffs    │  │• Trigger  ││
│  │            │  │• Filter/     │  │           │  │  refresh  ││
│  │            │  │  search      │  │           │  │           ││
│  └────────────┘  └──────────────┘  └───────────┘  └───────────┘│
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
│  │    • Chart.js Bar Chart (Resource Distribution)          │   │
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
│  │    • SVG Graph with Resource Nodes                       │   │
│  │    • Zoom/Pan Controls                                   │   │
│  │    • Connected Resources                                 │   │
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
   - Builds hierarchy with color coding and icons
3. Extension generates HTML via webviewHtmlGenerator
4. Webview displays:
   - Overview tab with Chart.js visualizations
   - Resources tab with collapsible hierarchy
   - Topology tab with SVG graph
5. User interactions:
   - Search: JavaScript filters resources client-side
   - Export: Webview sends message → Extension saves file
   - Live Mode: Extension watches files → Auto-refresh
   - Compare: Command palette → Extension renders diff

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
