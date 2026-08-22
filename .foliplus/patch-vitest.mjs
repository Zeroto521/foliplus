// .foliplus/patch-vitest.mjs
//
// Re-apply the vite-spawn sandbox workaround after `npm install` rebuilds
// node_modules.  Vitest 8 / Vite 8 calls child_process.exec("net use")
// at startup and spawns per-worker processes (forks pool); both hit
// EPERM under the DSH Windows sandbox.  This prepends the shim import
// to the vitest CLI entry so the patch runs in the main process and in
// every worker.
//
//   node .foliplus/patch-vitest.mjs
//
// The actual shim lives in .foliplus/vite-spawn-patch.mjs (no node_modules
// mutation beyond the one-line entry import below).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vitestMjs = resolve(root, "node_modules", "vitest", "vitest.mjs");
const shim      = resolve(root, ".foliplus", "vite-spawn-patch.mjs");

if (!existsSync(shim)) {
  console.error("MISSING", shim);
  process.exit(1);
}
if (!existsSync(vitestMjs)) {
  console.error("MISSING", vitestMjs, "— run `npm install --ignore-scripts` first");
  process.exit(1);
}

const src = readFileSync(vitestMjs, "utf8");
const shebang = src.startsWith("#!") ? src.split(/\r?\n/)[0] : "";
const lines = src.split(/\r?\n/).filter((l) => l !== shebang && !l.startsWith("#!/"));

if (lines.some((l) => l.includes("../../.foliplus/vite-spawn-patch.mjs"))) {
  console.log("already patched");
  process.exit(0);
}

const patched = [
  shebang,
  `import '../../.foliplus/vite-spawn-patch.mjs'`,
  ...lines,
  "",
].join("\n");

writeFileSync(vitestMjs, patched);
console.log("patched", vitestMjs);
