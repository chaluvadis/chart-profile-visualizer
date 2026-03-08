const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: "esbuild-problem-matcher",

  setup(build) {
    build.onStart(() => {
      console.log("[watch] build started");
    });
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        console.error(
          `    ${location.file}:${location.line}:${location.column}:`,
        );
      });
      console.log("[watch] build finished");
    });
  },
};

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ["src/core/extension.ts"],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "node",
    outfile: "out/extension.js",
    external: ["vscode"],
    logLevel: "silent",
    plugins: [
      /* add to the end of plugins array */
      esbuildProblemMatcherPlugin,
    ],
  });
  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }

  // Copy CSS file to out/webview directory
  const srcCssPath = path.join(__dirname, "src", "webview", "styles.css");
  const outCssPath = path.join(__dirname, "out", "webview", "styles.css");
  if (fs.existsSync(srcCssPath)) {
    fs.copyFileSync(srcCssPath, outCssPath);
    console.log("Copied styles.css to out/webview directory");
  }

  // Copy HTML files to out directory
  const webviewDir = path.join(__dirname, "src", "webview");
  const outWebviewDir = path.join(__dirname, "out", "webview");

  // Create out/webview directory if it doesn't exist
  if (!fs.existsSync(outWebviewDir)) {
    fs.mkdirSync(outWebviewDir, { recursive: true });
  }

  // Copy HTML files from src/webview to out/webview
  if (fs.existsSync(webviewDir)) {
    const htmlFiles = fs.readdirSync(webviewDir).filter(f => f.endsWith(".html"));
    for (const file of htmlFiles) {
      const srcPath = path.join(webviewDir, file);
      const outPath = path.join(outWebviewDir, file);
      fs.copyFileSync(srcPath, outPath);
      console.log(`Copied ${file} to out/webview directory`);
    }
  }

  // Compile TypeScript webview files to JavaScript
  const webviewTsFiles = ["src/webview/main.ts", "src/webview/topology.ts"];
  for (const tsFile of webviewTsFiles) {
    const tsPath = path.join(__dirname, tsFile);
    if (fs.existsSync(tsPath)) {
      const basename = path.basename(tsFile, ".ts");
      const outJsPath = path.join(outWebviewDir, `${basename}.js`);

      await esbuild.build({
        entryPoints: [tsPath],
        bundle: true,
        format: "iife",
        minify: production,
        sourcemap: !production,
        outfile: outJsPath,
        platform: "browser",
        target: ["es2020"],
        logLevel: "silent",
      });
      console.log(`Compiled ${basename}.ts to ${basename}.js`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
