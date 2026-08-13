#!/usr/bin/env bun
/**
 * Build script for the Peer Cash plugin: cleans dist, bundles the runtime
 * entry with Bun, and emits TypeScript declarations alongside it.
 */

import { existsSync, rmSync } from "node:fs";
import { $ } from "bun";

function cleanBuild(outdir = "dist") {
  if (existsSync(outdir)) {
    rmSync(outdir, { recursive: true, force: true });
    console.log(`Cleaned ${outdir} directory`);
  }
}

async function build() {
  const start = performance.now();
  console.log("Building @zkp2p/plugin-peer-cash...");

  cleanBuild("dist");

  const [bundle] = await Promise.all([
    (async () => {
      const result = await Bun.build({
        entrypoints: ["./src/index.ts"],
        outdir: "./dist",
        target: "node",
        format: "esm",
        sourcemap: true,
        minify: false,
        external: ["node:*", "@elizaos/core", "@zkp2p/cash", "viem", "zod"],
        naming: { entry: "[dir]/[name].[ext]" },
      });
      if (!result.success) {
        console.error("Bundle failed:", result.logs);
        return { success: false };
      }
      const totalSize = result.outputs.reduce((sum, output) => sum + output.size, 0);
      console.log(`Bundled ${result.outputs.length} file(s) - ${(totalSize / 1024).toFixed(1)}KB`);
      return { success: true };
    })(),
    (async () => {
      await $`tsc --emitDeclarationOnly --incremental --noCheck --project ./tsconfig.build.json`.quiet();
      console.log("TypeScript declarations generated");
    })(),
  ]);

  if (!bundle.success) return false;

  const elapsed = ((performance.now() - start) / 1000).toFixed(2);
  console.log(`Build complete (${elapsed}s)`);
  return true;
}

build()
  .then((success) => {
    if (!success) process.exit(1);
  })
  .catch((error) => {
    console.error("Build script error:", error);
    process.exit(1);
  });
