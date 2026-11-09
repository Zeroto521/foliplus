#!/usr/bin/env node
/**
 * Guard: FILTER_SOURCE key drift over the MeasureControl surface.
 *
 * A surface's source name in the shared filterStore is a persistence key:
 * the value is stored in the record and must never be spelled at a call site
 * in a way that can drift from the constant. The well-known names live in
 * FILTER_SOURCE (core/layer/filterStore.ts); a control with a fixed single
 * surface (MeasureControl's type filter) references the constant, and a typo
 * at a call site would silently create a second record entry or read an empty
 * slot.
 *
 * Scope: MeasureControl (production + test) — the only control with a fixed
 * single filter surface. HeatmapControl keys by a dynamic selected-layer id,
 * so it has no fixed literal to pin. A control whose source name is a layer id
 * in an event payload (LayerControl's mock `id: "measure"`) is NOT a
 * filterStore source key and is outside this scope.
 *
 * Usage: `node script/check/filter-source-key.mjs [root]`
 *   Prints each violation as `file:line: text` and exits 1 when any are found.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VALUE = "measure";
const SOURCE_EXT = new Set([".ts", ".tsx"]);
const SKIP_DIR = new Set([
  "node_modules",
  "dist",
  ".venv",
  ".git",
  "coverage",
  ".agents",
]);

/** Walk a directory and return source files (`.ts` / `.tsx`), skipping build dirs. */
const walk = (dir, out = []) => {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR.has(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (SOURCE_EXT.has(path.extname(ent.name))) out.push(p);
  }
  return out;
};

/**
 * Find bare `"measure"` string literals in the MeasureControl source tree.
 * @param root repo root; MeasureControl is scanned under `<root>/foliplus/js`
 *   and `<root>/test/js`.
 * @returns [{file, line, text}] — `file` is repo-relative, `line` is 1-based.
 */
const findBareFilterSourceKeys = (root = process.cwd()) => {
  const targets = [
    ...walk(path.join(root, "foliplus", "js", "control", "MeasureControl")),
    ...walk(path.join(root, "test", "js", "control", "MeasureControl")),
  ];
  const needle = `"${VALUE}"`;
  const hits = [];
  for (const file of targets) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      if (line.includes(needle)) {
        hits.push({
          file: rel,
          line: i + 1,
          text: line.trim(),
        });
      }
    });
  }
  return hits;
};

/** CLI entry — only when executed directly, never when a test imports this. */
const main = (root = process.cwd()) => {
  const hits = findBareFilterSourceKeys(root);
  for (const h of hits) {
    console.log(
      `${h.file}:${h.line}: bare "${VALUE}" literal — use FILTER_SOURCE.MEASURE`,
    );
  }
  return hits.length === 0 ? 0 : 1;
};

const runCli = (argv, entry) => {
  if (entry !== undefined && path.resolve(entry) === fileURLToPath(import.meta.url)) {
    process.exitCode = main(argv[0]);
  }
};
runCli(process.argv.slice(2), process.argv[1]);

export { findBareFilterSourceKeys, main, walk };
