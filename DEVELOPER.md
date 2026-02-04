# ChartProfiles Extension - Developer Guide

## Overview

The ChartProfiles extension provides a comprehensive view of Helm charts across different environments, with intelligent value merging and template rendering capabilities.

## Architecture

### Core Components

1. **extension.ts** - Main entry point
   - Activates when workspace contains Chart.yaml files
   - Registers tree view and commands
   - Sets up file watchers for auto-refresh

2. **chartProfilesProvider.ts** - Tree View Provider
   - Implements VS Code TreeDataProvider interface
   - Organizes charts hierarchically: Charts → Environments → Actions
   - Detects environments by scanning for values-<env>.yaml files

3. **helmChart.ts** - Chart Discovery
   - Recursively searches workspace for Chart.yaml files
   - Parses chart metadata
   - Skips common directories (node_modules, .git, etc.)

4. **valuesMerger.ts** - Value Merging Logic
   - Deep merges base values.yaml with environment-specific overrides
   - Tracks value sources and override information
   - Generates annotated YAML with source comments

5. **helmRenderer.ts** - Template Rendering
   - Executes `helm template` command with merged values
   - Parses output into individual Kubernetes resources
   - Tracks template sources from Helm comments

6. **renderedYamlView.ts** - UI Integration
   - Opens merged values or rendered templates in editor
   - Displays progress notifications
   - Formats output with helpful annotations

## Key Features Explained

### Environment Detection

The extension automatically detects environments by looking for files matching:
- `values-dev.yaml` → dev environment
- `values-qa.yaml` → qa environment
- `values-prod.yaml` → prod environment
- Any `values-<name>.yaml` → custom environment

### Value Merging Algorithm

```typescript
// Deep merge with tracking
function deepMerge(base, override, path, details) {
  // Arrays: completely replaced
  // Objects: recursively merged
  // Primitives: overridden
  // Tracks: which file provided each value
}
```

### Helm Template Execution

```bash
# Command structure
helm template <release-name> <chart-path> \
  -f values.yaml \
  -f values-<env>.yaml
```

The extension:
1. Checks if Helm CLI is available
2. Constructs command with appropriate values files
3. Executes with timeout and buffer limits
4. Parses YAML output into resources
5. Extracts source information from Helm comments

### Resource Origin Tracking

Each rendered resource includes:
- **Kind**: Kubernetes resource type (Deployment, Service, etc.)
- **Name**: Resource name from metadata
- **Namespace**: Target namespace (if specified)
- **Template**: Source template file (from `# Source:` comment)
- **Chart**: Chart name
- **Values**: Which values file provided each configuration

## Extension Points

### Commands

- `chartProfiles.refreshCharts`: Manually refresh the chart tree
- `chartProfiles.viewRenderedYaml`: View merged values or rendered templates

### Views

- `chartProfiles`: Main tree view in Explorer sidebar

### Activation Events

- `workspaceContains:**/Chart.yaml`: Auto-activates when charts are present

## Future Enhancements (Placeholders)

The current implementation includes placeholders and comments for:

1. **Enhanced Value Highlighting**
   ```typescript
   // TODO: Use VS Code decorations to highlight overridden values
   // - Different colors for base vs override
   // - Inline diff markers
   // - Hover tooltips showing original values
   ```

2. **Line-by-Line Value Tracking**
   ```typescript
   // TODO: Track exact line numbers in YAML files
   // - Link values to source line numbers
   // - Enable jump-to-definition functionality
   ```

3. **Interactive Diff View**
   ```typescript
   // TODO: Implement side-by-side diff view
   // - Compare base vs environment values
   // - Show additions/modifications/deletions
   ```

4. **Value Validation**
   ```typescript
   // TODO: Validate values against chart schema
   // - Check required values are present
   // - Validate types and formats
   // - Warn about deprecated values
   ```

## Testing Locally

### Running the Extension

1. Open the project in VS Code
2. Press F5 to launch Extension Development Host
3. The extension will load with the `examples` folder open
4. Check the "Chart Profiles" view in the Explorer sidebar

### Manual Testing Checklist

- [ ] Chart discovery finds sample-app
- [ ] Environments (dev, qa, prod) are shown for sample-app
- [ ] "View Merged Values" shows correct overrides
- [ ] "View Rendered YAML" executes helm template (if Helm installed)
- [ ] File watcher auto-refreshes when values files change
- [ ] Error handling works when Helm is not installed

### Creating Test Charts

To test with your own charts:
```bash
mkdir -p test-chart/templates
cd test-chart

# Create Chart.yaml
cat > Chart.yaml << EOF
apiVersion: v2
name: test-chart
version: 1.0.0
EOF

# Create base values
cat > values.yaml << EOF
replicas: 1
image: nginx:1.21
EOF

# Create environment overrides
cat > values-dev.yaml << EOF
replicas: 2
image: nginx:latest
EOF
```

## Debugging

### Enable Debug Logging

The extension logs to the Debug Console in VS Code. To see logs:
1. Open Debug Console (Ctrl+Shift+Y)
2. Run the extension in debug mode (F5)
3. Look for messages from ChartProfiles

### Common Issues

**Issue**: Chart not appearing in tree view
- Check if Chart.yaml exists and is valid YAML
- Verify file watcher is active
- Try manual refresh

**Issue**: Helm template fails
- Check if Helm CLI is installed: `helm version`
- Verify chart templates are valid
- Check Helm output in Debug Console

**Issue**: Values not merging correctly
- Verify YAML syntax in values files
- Check for duplicate keys
- Review merge algorithm in valuesMerger.ts

## Performance Considerations

- Chart discovery uses recursive file system scanning
  - Skips node_modules and hidden directories
  - Caches results until file changes detected
  
- Helm template execution
  - Uses 30-second timeout
  - 10MB output buffer
  - Runs asynchronously with progress indicator

- Tree view
  - Lazy loading of children
  - Collapsible states preserved
  - Automatic refresh on file changes

## Security Notes

- Never commits sensitive values to version control
- Use encrypted secrets for production values
- Helm rendering executes in local shell environment
- No external API calls made by extension

## Contributing

When adding features:
1. Follow TypeScript strict mode
2. Add comments for complex logic
3. Update README.md with new features
4. Test with multiple chart structures
5. Consider error handling and edge cases
