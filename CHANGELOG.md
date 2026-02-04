# Changelog

All notable changes to the ChartProfiles extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-02-04

### Added

#### Core Features
- VS Code extension "ChartProfiles" in TypeScript
- Support for Node.js 20+ and pnpm package manager
- VS Code engine compatibility: ^1.97.0

#### Helm Chart Discovery
- Automatic detection of Helm charts in workspace (Chart.yaml files)
- Recursive workspace scanning with intelligent directory skipping
- Chart metadata parsing (name, version, description)

#### Environment Organization
- Tree view organized by: Charts → Environments → Actions
- Automatic environment detection from values-<env>.yaml files
- Support for dev, qa, prod, and custom environments
- Environment-specific file detection and grouping

#### Value Merging
- Deep merge of base values.yaml with values-<env>.yaml
- Source tracking for all merged values
- Override detection and annotation
- Annotated YAML output showing value origins
- Comments indicating which file provided each value

#### Template Rendering
- Integration with Helm CLI via `helm template` command
- Execution with environment-specific values files
- Parsing of rendered YAML into individual resources
- Resource metadata extraction (kind, name, namespace)
- Template source tracking from Helm comments
- Formatted output with origin information

#### User Interface
- Tree view in Explorer sidebar ("Chart Profiles")
- Icons for charts, environments, and actions
- Collapsible/expandable tree structure
- Contextual commands on tree items
- "View Merged Values" action
- "View Rendered YAML" action
- Manual refresh command with icon
- Progress notifications for long-running operations

#### Developer Experience
- TypeScript with strict mode enabled
- ESLint configuration for code quality
- Source maps for debugging
- Watch mode for development
- VS Code launch configuration
- Example Helm chart for testing
- Comprehensive documentation

#### File System Integration
- Auto-refresh on file changes (Chart.yaml, values*.yaml)
- File system watcher for real-time updates
- Workspace folder support

#### Documentation
- README.md with features and usage guide
- DEVELOPER.md with architecture details
- Inline code comments explaining complex logic
- Placeholder comments for future enhancements
- Example Helm chart with multiple environments

#### Error Handling
- Graceful degradation when Helm CLI not installed
- Placeholder rendering when Helm unavailable
- Error messages for invalid operations
- Console logging for debugging

### Implementation Details

#### Placeholders and Comments for Helm Rendering Logic
The implementation includes extensive comments and placeholders for future enhancements:

1. **Enhanced Value Highlighting** (valuesMerger.ts)
   - Comments explaining how to use VS Code decorations
   - Placeholder for inline diff markers
   - Notes about hover tooltips for original values

2. **Helm Template Execution** (helmRenderer.ts)
   - Detailed comments about command construction
   - Step-by-step explanation of parsing logic
   - Placeholder resources when Helm is unavailable
   - Example output structure in comments

3. **Resource Origin Tracking** (helmRenderer.ts)
   - Comments on extracting source information
   - Explanation of mapping values to sources
   - Documentation of Helm's Source comment format

4. **Value Source Tracking** (valuesMerger.ts)
   - Comments on line number tracking
   - Explanation of source recording mechanism
   - Notes about future line-by-line tracking

5. **Interactive Diff View** (renderedYamlView.ts)
   - Placeholder function for value highlighting
   - Comments on decoration implementation
   - Notes about color coding schemes

#### Technologies Used
- **Language**: TypeScript 5.7.2
- **Runtime**: Node.js 20+
- **Package Manager**: pnpm 10.28.2
- **VS Code API**: ^1.97.0
- **Dependencies**: 
  - js-yaml 4.1.0 (YAML parsing)
  - @types/js-yaml 4.0.9 (TypeScript types)

#### Project Structure
```
chart-profile-visualizer/
├── src/
│   ├── extension.ts              # Main entry point
│   ├── chartProfilesProvider.ts  # Tree view provider
│   ├── helmChart.ts              # Chart discovery
│   ├── valuesMerger.ts           # Value merging logic
│   ├── helmRenderer.ts           # Template rendering
│   └── renderedYamlView.ts       # UI integration
├── examples/
│   └── sample-app/               # Example Helm chart
│       ├── Chart.yaml
│       ├── values.yaml
│       ├── values-dev.yaml
│       ├── values-qa.yaml
│       ├── values-prod.yaml
│       └── templates/
│           ├── deployment.yaml
│           ├── service.yaml
│           └── ingress.yaml
├── .vscode/
│   ├── launch.json               # Debug configuration
│   └── tasks.json                # Build tasks
├── package.json                  # Extension manifest
├── tsconfig.json                 # TypeScript configuration
├── eslint.config.mjs             # Linting rules
└── README.md                     # User documentation
```

### Testing
- Manual testing with example Helm chart
- Verified chart discovery
- Verified environment detection (dev, qa, prod)
- Verified value merging with override tracking
- Verified Helm template rendering with actual Helm CLI
- Verified resource parsing and origin tracking
- All TypeScript compiled without errors
- All ESLint checks passed

### Known Limitations
- Requires Helm CLI for actual template rendering
- Falls back to placeholder output when Helm not available
- Line-by-line value tracking not yet implemented
- Interactive diff view not yet implemented
- Value validation not yet implemented

### Future Enhancements (Planned)
- Enhanced value highlighting with VS Code decorations
- Line-by-line value source tracking
- Interactive diff view for base vs environment
- Value validation against chart schema
- Support for Helm dependencies
- Multi-chart workspace support
- Custom environment naming
- Export rendered manifests

## [Unreleased]

### Planned for Future Versions
- Integration tests
- Unit tests for core modules
- VS Code Marketplace publication
- Helm dependency visualization
- Chart.lock file support
- Secret value masking
- Kubernetes cluster deployment

---

For more details, see the [README](README.md) and [DEVELOPER](DEVELOPER.md) documentation.
