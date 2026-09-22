const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

function copyStaticMedia() {
  const srcDir = path.join(__dirname, "media");
  const outDir = path.join(__dirname, "dist", "media");
  fs.mkdirSync(outDir, { recursive: true });
  for (const file of fs.readdirSync(srcDir)) {
    fs.copyFileSync(path.join(srcDir, file), path.join(outDir, file));
  }
}

const copyMediaPlugin = {
  name: "copy-static-media",
  setup(build) {
    build.onEnd(() => copyStaticMedia());
  },
};

const watchLogPlugin = {
  name: "watch-log",
  setup(build) {
    build.onStart(() => console.log("[watch] build started"));
    build.onEnd(() => console.log("[watch] build finished"));
  },
};

async function main() {
  const extensionCtx = await esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "node",
    outfile: "dist/extension.js",
    external: ["vscode"],
    logLevel: "info",
    plugins: [copyMediaPlugin, watchLogPlugin],
  });

  const webviewCtx = await esbuild.context({
    entryPoints: ["src/webview/panelScript.ts"],
    bundle: true,
    format: "iife",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "browser",
    outfile: "dist/media/panel.js",
    logLevel: "info",
  });

  if (watch) {
    await Promise.all([extensionCtx.watch(), webviewCtx.watch()]);
  } else {
    await Promise.all([extensionCtx.rebuild(), webviewCtx.rebuild()]);
    await Promise.all([extensionCtx.dispose(), webviewCtx.dispose()]);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
