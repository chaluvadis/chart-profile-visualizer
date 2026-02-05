# ChartProfiles Extension - Visual Guide

## Tree View Structure

The ChartProfiles extension provides a hierarchical tree view in the VS Code Explorer:

```
📦 CHART PROFILES
└── 📦 sample-app (Helm Chart: sample-app)
    ├── 🌐 dev (Environment: dev)
    │   ├── 📄 View Merged Values
    │   └── 📤 View Rendered YAML
    ├── 🌐 qa (Environment: qa)
    │   ├── 📄 View Merged Values
    │   └── 📤 View Rendered YAML
    └── 🌐 prod (Environment: prod)
        ├── 📄 View Merged Values
        └── 📤 View Rendered YAML
```

### Icons Legend
- 📦 **Package Icon**: Helm Chart
- 🌐 **Server Environment Icon**: Environment
- 📄 **File Code Icon**: View Merged Values action
- 📤 **Output Icon**: View Rendered YAML action

## Merged Values Output Example

When clicking "View Merged Values" for the `dev` environment:

```yaml
# Merged Values with Source Annotations
# Legend:
#   [BASE] - From base values.yaml
#   [OVERRIDE] - Overridden in environment-specific values file

# Overridden Values:
#   replicaCount: 2 [from values-dev.yaml]
#   image.tag: "latest" [from values-dev.yaml]
#   ingress.enabled: true [from values-dev.yaml]
#   ingress.hosts: [{"host":"dev.example.com",...}] [from values-dev.yaml]
#   resources.limits.cpu: "200m" [from values-dev.yaml]
#   resources.limits.memory: "256Mi" [from values-dev.yaml]
#   resources.requests.cpu: "100m" [from values-dev.yaml]
#   resources.requests.memory: "128Mi" [from values-dev.yaml]
#   environment: "dev" [from values-dev.yaml]

replicaCount: 2                    # [OVERRIDE] from values-dev.yaml
image:
  repository: nginx                # [BASE] from values.yaml
  tag: latest                      # [OVERRIDE] from values-dev.yaml
  pullPolicy: IfNotPresent         # [BASE] from values.yaml
service:
  type: ClusterIP                  # [BASE] from values.yaml
  port: 80                         # [BASE] from values.yaml
ingress:
  enabled: true                    # [OVERRIDE] from values-dev.yaml
  className: ''                    # [BASE] from values.yaml
  hosts:
    - host: dev.example.com        # [OVERRIDE] from values-dev.yaml
      paths:
        - path: /
          pathType: ImplementationSpecific
resources:
  limits:
    cpu: 200m                      # [OVERRIDE] from values-dev.yaml
    memory: 256Mi                  # [OVERRIDE] from values-dev.yaml
  requests:
    cpu: 100m                      # [OVERRIDE] from values-dev.yaml
    memory: 128Mi                  # [OVERRIDE] from values-dev.yaml
environment: dev                   # [OVERRIDE] from values-dev.yaml
```

### Key Features Highlighted
- ✅ Shows all overridden values at the top
- ✅ Indicates source file for each value
- ✅ Preserves YAML structure for easy reading
- ✅ Opens in new editor tab with YAML syntax highlighting

## Rendered YAML Output Example

When clicking "View Rendered YAML" for the `dev` environment (with Helm CLI installed):

```yaml
# Helm Template Rendering Output
# Environment-specific values have been merged and applied

# Total Resources: 3

---
# Resource 1/3
# Kind: Service
# Name: sample-app-service
# Template Source: sample-app/templates/service.yaml
# Chart: sample-app

# Source: sample-app/templates/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: sample-app-service
  labels:
    app: sample-app
spec:
  type: ClusterIP
  ports:
  - port: 80
    targetPort: 80
    protocol: TCP
    name: http
  selector:
    app: sample-app

---
# Resource 2/3
# Kind: Deployment
# Name: sample-app-deployment
# Template Source: sample-app/templates/deployment.yaml
# Chart: sample-app

# Source: sample-app/templates/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: sample-app-deployment
  labels:
    app: sample-app
    environment: dev                # ← From values-dev.yaml
spec:
  replicas: 2                       # ← Overridden: was 1, now 2
  selector:
    matchLabels:
      app: sample-app
  template:
    metadata:
      labels:
        app: sample-app
        environment: dev
    spec:
      containers:
      - name: sample-app
        image: "nginx:latest"       # ← Overridden: was nginx:1.21
        imagePullPolicy: IfNotPresent
        ports:
        - containerPort: 80
        resources:
          limits:
            cpu: 200m               # ← Overridden: was 100m
            memory: 256Mi           # ← Overridden: was 128Mi
          requests:
            cpu: 100m               # ← Overridden: was 50m
            memory: 128Mi           # ← Overridden: was 64Mi

---
# Resource 3/3
# Kind: Ingress
# Name: sample-app-ingress
# Template Source: sample-app/templates/ingress.yaml
# Chart: sample-app

# Source: sample-app/templates/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: sample-app-ingress
  labels:
    app: sample-app
spec:
  rules:
  - host: dev.example.com          # ← Environment-specific host
    http:
      paths:
      - path: /
        pathType: ImplementationSpecific
        backend:
          service:
            name: sample-app-service
            port:
              number: 80
```

### Key Features Highlighted
- ✅ Shows total number of resources rendered
- ✅ Each resource annotated with metadata (Kind, Name, Namespace, Template Source)
- ✅ Includes original Helm `# Source:` comments
- ✅ Ready-to-deploy Kubernetes manifests
- ✅ All environment-specific values applied

## Progress Notifications

The extension shows helpful notifications:

### Information Messages
- "Charts refreshed" - After manual refresh
- "Merged values for sample-app (dev): 9 overridden values" - After viewing merged values
- "Rendered templates for sample-app (dev)" - After successful rendering

### Progress Indicators
- "Rendering Helm templates for sample-app (dev)..." - While executing helm template

### Error Messages
- "Error displaying YAML: <message>" - If rendering fails
- Helpful placeholder output when Helm CLI not installed

## File Watcher Behavior

The extension automatically refreshes when files change:

```
File Change Detected:
  examples/sample-app/values-dev.yaml

Action Taken:
  ↓ Refresh chart discovery
  ↓ Update tree view
  ↓ User sees updated environments/values
```

Watched patterns:
- `**/{Chart.yaml,values*.yaml}`

## Workspace Structure Example

Recommended workspace layout:

```
my-workspace/
├── backend-chart/
│   ├── Chart.yaml
│   ├── values.yaml
│   ├── values-dev.yaml
│   ├── values-qa.yaml
│   ├── values-prod.yaml
│   └── templates/
│       └── ...
├── frontend-chart/
│   ├── Chart.yaml
│   ├── values.yaml
│   ├── values-dev.yaml
│   ├── values-qa.yaml
│   ├── values-prod.yaml
│   └── templates/
│       └── ...
└── .vscode/
    └── settings.json
```

The extension will discover both charts and show them in the tree view:

```
📦 CHART PROFILES
├── 📦 backend-chart
│   ├── 🌐 dev
│   ├── 🌐 qa
│   └── 🌐 prod
└── 📦 frontend-chart
    ├── 🌐 dev
    ├── 🌐 qa
    └── 🌐 prod
```

## Command Palette

Available commands via `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac):

- `ChartProfiles: Refresh Charts` - Manually refresh the chart list

## Context Menu

Right-click on tree items for actions (when implemented):
- Future: "Copy Merged Values"
- Future: "Export Rendered YAML"
- Future: "Deploy to Cluster"

## Keyboard Shortcuts

Default VS Code shortcuts apply:
- `Ctrl+Shift+E` - Focus on Explorer (where ChartProfiles view lives)
- `Enter` - Execute selected action (View Merged Values / View Rendered YAML)
- `Arrow Keys` - Navigate tree view
- `Space` - Expand/collapse tree nodes

## Tips for Best Experience

1. **Keep Helm CLI Updated**: Install latest Helm for best template rendering
   ```bash
   # Check version
   helm version
   
   # Update (macOS)
   brew upgrade helm
   
   # Update (Linux)
   curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
   ```

2. **Use Consistent Naming**: Name environment files consistently:
   - `values-dev.yaml`
   - `values-qa.yaml`
   - `values-prod.yaml`

3. **Organize Values**: Keep base values minimal, put environment-specific overrides in env files

4. **Preview Before Deploy**: Always review rendered YAML before deploying to cluster

5. **Use Version Control**: Commit all values files to track changes over time

## Troubleshooting

### Chart Not Appearing?
1. Verify `Chart.yaml` exists and is valid
2. Check file isn't in ignored directory (node_modules, .git, etc.)
3. Try manual refresh via command palette

### Helm Template Fails?
1. Check Helm is installed: `helm version`
2. Verify chart templates are valid: `helm lint .`
3. Check Debug Console for error details

### Values Not Merging Correctly?
1. Verify YAML syntax is correct
2. Check for tabs vs spaces (use spaces)
3. Ensure no duplicate keys in same file
4. Review merged output for unexpected results

## What's Next?

Future UI enhancements planned:
- Side-by-side diff view for base vs environment values
- Inline value highlighting with color coding
- Hover tooltips showing value sources
- Quick fixes for common issues
- Integration with Kubernetes clusters for deployment
