// Bundles the TypeScript content script + service worker into extension/dist/.
// Content scripts must be self-contained IIFEs (no ESM imports at runtime),
// which esbuild's bundle handles.

import { build, context } from "esbuild";

const options = {
  entryPoints: {
    content: "extension/content.ts",
    background: "extension/background.ts",
  },
  outdir: "extension/dist",
  bundle: true,
  format: "iife",
  target: "chrome110",
  platform: "browser",
  sourcemap: true,
  logLevel: "info",
};

const watch = process.argv.includes("--watch");

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log("watching… (Ctrl-C to stop)");
} else {
  await build(options);
  console.log("built extension/dist/{content,background}.js");
}
