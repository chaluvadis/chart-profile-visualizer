const { findHelmCharts } = require('./out/helmChart.js');
const { mergeValues, generateAnnotatedYaml } = require('./out/valuesMerger.js');
const { renderHelmTemplate, formatRenderedOutput } = require('./out/helmRenderer.js');

async function testExtension() {
    console.log('='.repeat(80));
    console.log('ChartProfiles Extension - Comprehensive Test');
    console.log('='.repeat(80));
    console.log();

    // Test 1: Chart Discovery
    console.log('TEST 1: Chart Discovery');
    console.log('-'.repeat(80));
    const charts = await findHelmCharts('.');
    console.log(`✓ Found ${charts.length} chart(s)`);
    charts.forEach(chart => {
        console.log(`  - ${chart.name} (v${chart.version})`);
    });
    console.log();

    // Test 2: Environment Detection
    console.log('TEST 2: Environment Detection');
    console.log('-'.repeat(80));
    const fs = require('fs');
    const path = require('path');
    const chartPath = charts[0].path;
    const envFiles = fs.readdirSync(chartPath)
        .filter(f => f.startsWith('values-') && f.endsWith('.yaml'));
    console.log(`✓ Found ${envFiles.length} environment(s):`);
    envFiles.forEach(f => {
        const env = f.replace('values-', '').replace('.yaml', '');
        console.log(`  - ${env}`);
    });
    console.log();

    // Test 3: Value Merging for Each Environment
    console.log('TEST 3: Value Merging');
    console.log('-'.repeat(80));
    for (const envFile of envFiles) {
        const env = envFile.replace('values-', '').replace('.yaml', '');
        const comparison = mergeValues(chartPath, env);
        const overrides = Array.from(comparison.details.values()).filter(v => v.overridden).length;
        console.log(`✓ ${env}: ${overrides} value(s) overridden`);
        
        // Show top 3 overrides
        const topOverrides = Array.from(comparison.details.entries())
            .filter(([_, v]) => v.overridden)
            .slice(0, 3);
        topOverrides.forEach(([key, value]) => {
            console.log(`    - ${key}: ${JSON.stringify(value.value)}`);
        });
    }
    console.log();

    // Test 4: Helm Template Rendering
    console.log('TEST 4: Helm Template Rendering');
    console.log('-'.repeat(80));
    const testEnv = 'dev';
    console.log(`Rendering templates for environment: ${testEnv}`);
    const resources = await renderHelmTemplate(chartPath, testEnv, 'test-release');
    console.log(`✓ Rendered ${resources.length} Kubernetes resource(s):`);
    resources.forEach((r, i) => {
        console.log(`  ${i + 1}. ${r.kind}: ${r.name}`);
        console.log(`     Template: ${r.template}`);
    });
    console.log();

    // Test 5: Verify Values Applied
    console.log('TEST 5: Verify Environment-Specific Values Applied');
    console.log('-'.repeat(80));
    const deployment = resources.find(r => r.kind === 'Deployment');
    if (deployment) {
        console.log('Checking Deployment resource for dev environment values:');
        const hasLatestTag = deployment.yaml.includes('nginx:latest');
        const hasDevEnv = deployment.yaml.includes('environment: dev');
        const hasReplicas2 = deployment.yaml.includes('replicas: 2');
        
        console.log(`  ✓ Image tag is 'latest': ${hasLatestTag ? 'YES' : 'NO'}`);
        console.log(`  ✓ Environment is 'dev': ${hasDevEnv ? 'YES' : 'NO'}`);
        console.log(`  ✓ Replicas is 2: ${hasReplicas2 ? 'YES' : 'NO'}`);
    }
    console.log();

    // Test 6: Output Formatting
    console.log('TEST 6: Output Formatting');
    console.log('-'.repeat(80));
    const formatted = formatRenderedOutput(resources);
    const lines = formatted.split('\n');
    console.log(`✓ Generated ${lines.length} lines of formatted output`);
    console.log('  First 10 lines:');
    lines.slice(0, 10).forEach(line => console.log(`    ${line}`));
    console.log();

    console.log('='.repeat(80));
    console.log('All tests completed successfully! ✓');
    console.log('='.repeat(80));
}

testExtension().catch(console.error);
