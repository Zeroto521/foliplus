#!/usr/bin/env node
/**
 * Bundle coverage check — warn if a dist bundle is not size-tracked.
 *
 * Reads the built artifacts in `foliplus/dist/` and cross-checks them against
 * the `size-baselines.json` manifest. Any bundle missing from the manifest
 * would silently escape threshold checking, so it is reported here.
 *
 * Runs from `build.mjs --sonda` after the esbuild build + combined sonda
 * report. Run standalone with:
 *   node script/bundle-report.mjs
 */
import { existsSync, readFileSync, readdirSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { WARN } from "./glyphs.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

/** Warn if any dist bundle is not listed in `size-baselines.json` (would skip threshold checks). */
export const checkBundleCoverage = (root = projectRoot) => {
  const distDir = resolve(root, "foliplus/dist");
  const distFiles = readdirSync(distDir).filter(f => /\.min\.(js|css)$/.test(f));
  const configPath = resolve(root, "size-baselines.json");
  if (!existsSync(configPath)) return; // no baseline yet — nothing to cross-check

  const monitored = new Set(
    Object.keys(JSON.parse(readFileSync(configPath, "utf-8")).files),
  );
  const unmonitored = distFiles.filter(f => !monitored.has(f));
  if (!unmonitored.length) return;

  console.warn(
    `${WARN}  ${unmonitored.length} bundle(s) not covered by size-baselines.json: ${unmonitored.join(", ")}`,
  );
  console.warn("   Add them to size-baselines.json or they will not be size-checked.");
};

// CLI entry point: `node script/bundle-report.mjs`
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  checkBundleCoverage();
}
