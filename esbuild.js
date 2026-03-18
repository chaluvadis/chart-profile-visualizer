const { context, build: _build } = require("esbuild");
const { existsSync, copyFileSync, mkdirSync, readdirSync } = require("fs");
const { join, basename: _basename } = require("path");

// __dirname is available natively in CommonJS

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
          // @ts-ignore
          `    ${location.file}:${location.line}:${location.column}:`,
        );
      });
      console.log("[watch] build finished");
    });
  },
};

async function main() {
  const ctx = await context({
    entryPoints: ["src/extension.ts"],
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

  // Setup paths for copying HTML and CSS files to out/webview
  const webviewDir = join(__dirname, "src", "webview");
  const outWebviewDir = join(__dirname, "out", "webview");

  // Create out/webview directory if it doesn't exist
  if (!existsSync(outWebviewDir)) {
    mkdirSync(outWebviewDir, { recursive: true });
  }

  // Copy CSS file to out/webview directory
  const srcCssPath = join(__dirname, "src", "webview", "styles.css");
  const outCssPath = join(__dirname, "out", "webview", "styles.css");
  if (existsSync(srcCssPath)) {
    copyFileSync(srcCssPath, outCssPath);
    console.log("Copied styles.css to out/webview directory");
  }

  // Copy HTML files from src/webview to out/webview
  if (existsSync(webviewDir)) {
    const htmlFiles = readdirSync(webviewDir).filter(f => f.endsWith(".html"));
    for (const file of htmlFiles) {
      const srcPath = join(webviewDir, file);
      const outPath = join(outWebviewDir, file);
      copyFileSync(srcPath, outPath);
      console.log(`Copied ${file} to out/webview directory`);
    }
  }

  // Compile TypeScript webview files to JavaScript
  const webviewTsFiles = ["src/webview/main.ts", "src/webview/topology.ts"];
  for (const tsFile of webviewTsFiles) {
    const tsPath = join(__dirname, tsFile);
    if (existsSync(tsPath)) {
      const basename = _basename(tsFile, ".ts");
      const outJsPath = join(outWebviewDir, `${basename}.js`);

      await _build({
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
