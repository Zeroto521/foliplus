#!/usr/bin/env node
/**
 * Gate: every JS test file stays at or under the 1200-line threshold.
 *
 * A mirror file is not a dumping ground. Measured when this landed, 37 files
 * exceeded 1200 lines and 5 exceeded 3000 (`control/LayerControl/controller.test.ts`
 * at 9.6k, `ui/style/fill.test.ts` at 8.5k for a 526-code-line module — a 16×
 * ratio). A test file several times its module is not covering more, it is
 * hiding fixtures and repeating setup.
 *
 * The cap is a burn-down list, not a permanent exemption: OVERSIZED below lists
 * today's offenders, each entry naming the split card that removes it. A split
 * deletes its entry in the same PR.
 *
 * Usage:
 *   node script/check/test-size.mjs [--list]
 *
 * With --list it prints the remaining allowlist entries (the burn-down view).
 * Exit 1 lists every unlisted offender with its count; exit 0 otherwise.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TEST_ROOT = path.join(REPO_ROOT, "test", "js");

/** The documented threshold. It does not move to fit the code. */
const LIMIT = 1200;

/** Today's oversized files, keyed repo-relative under test/js/. Each entry names
 *  the split card that removes it. A split deletes its entry in the same PR. */
const OVERSIZED = {
  "control/LayerControl/controller.test.ts": "split pending — blocked by #1284",
  "control/LayerControl/ui/style/fill.test.ts": "split pending — blocked by #1284",
  "control/LayerControl/ui/style/index.test.ts": "split pending — blocked by #1284",
  "control/HeatmapControl/manager.test.ts": "split pending",
  "control/LayerControl/ui/style/border.test.ts": "split pending — blocked by #1284",
  "control/MeasureControl/manager.test.ts": "split pending",
  "ui/listbox.test.ts": "split pending",
  "control/LayerControl/ui/focus/index.test.ts": "split pending — blocked by #1284",
  "control/LayerControl/ui/listPanel/list.test.ts": "split pending — blocked by #1284",
  "control/LayerControl/ui/overlayPanel/menu.test.ts":
    "split pending — blocked by #1284",
  "control/LayerControl/ui/overlayPanel/filter.test.ts":
    "split pending — blocked by #1284",
  "control/LayerControl/ui/listPanel/drag.test.ts": "split pending — blocked by #1284",
  "control/LayerControl/ui/apply.test.ts": "split pending — blocked by #1284",
  "ui/slider.test.ts": "split pending",
  "control/ExportControl/renderer/index.test.ts": "split pending",
  "control/ExportControl/renderer/marker.test.ts":
    "split pending — the marker export cases were folded into the canonical file",
  "control/LayerControl/ui/state.test.ts": "split pending — blocked by #1284",
  "control/LayerControl/persistence.test.ts": "split pending — blocked by #1284",
  "core/layer/LayerFactory.test.ts": "split pending",
  "core/layer/PaneManager.test.ts": "split pending",
  "core/layer/LayerSurface.test.ts": "split pending",
  "control/LayerControl/label/index.test.ts": "split pending — blocked by #1284",
  "core/leaflet/panel.test.ts": "split pending",
  "core/overlay/overlayRegistry.test.ts": "split pending",
  "control/LayerControl/ui/listPanel/visibility.test.ts":
    "split pending — blocked by #1284",
  "script/build/bundle-size-check.test.ts":
    "split pending (build-gate fixture-heavy; split card TBD)",
  "ui/schemePicker.test.ts": "split pending",
  "control/LayerControl/ui/style/icon.test.ts": "split pending — blocked by #1284",
  "control/SearchControl/logic/history.test.ts": "split pending",
  "core/leaflet/markerIcon.test.ts": "split pending",
  "control/SearchControl/logic/search.test.ts": "split pending",
  "control/HeatmapControl/ui.test.ts": "split pending",
  "script/check/patch-coverage.test.ts":
    "split pending (guard fixture-heavy; split card TBD)",
  "control/LayerControl/ui/listPanel/keyboard.test.ts":
    "split pending — blocked by #1284",
  "ui/dropdown.test.ts": "split pending",
  "control/LayerControl/ui/style/fillValue.test.ts": "split pending — blocked by #1284",
  "control/LayerControl/ui/style/styleBag.test.ts": "split pending — blocked by #1284",
  "core/layer/folderLayout.test.ts": "split pending",
};

/** Line count of a file (raw lines, matching how the cap is measured). */
const lineCount = file => fs.readFileSync(file, "utf8").split(/\r?\n/).length;

/** The repo-relative test/js/ path of a file, for allowlist lookup. */
const relUnderTestJs = file => {
  const slashed = file.split(path.sep).join("/");
  const marker = "test/js/";
  const at = slashed.lastIndexOf(marker);
  return at >= 0 ? slashed.slice(at + marker.length) : slashed;
};

/**
 * The files over LIMIT that the allowlist does not already cover, in path order.
 * Pure over the injected (file, lineCount) pairs so the teeth test can feed a
 * synthetic tree.
 *
 * @param {{ file: string, lines: number }[]} entries
 * @param {Record<string, string>} [oversized] repo-relative path -> split reason
 */
const checkSize = (entries, oversized = OVERSIZED) =>
  entries
    .filter(({ file, lines }) => lines > LIMIT && !(relUnderTestJs(file) in oversized))
    .map(({ file, lines }) => ({
      file: relUnderTestJs(file),
      lines,
    }));

/** Walk test/js for every .test.ts file with its line count. */
const listTestFiles = () => {
  const out = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".test.ts")) {
        out.push({ file: full, lines: lineCount(full) });
      }
    }
  };
  walk(TEST_ROOT);
  return out;
};

/** The allowlist entries still present on disk (the burn-down view). The keys
 *  already carry the `.test.ts` suffix, so they are joined as-is. */
const remainingAllowlist = () =>
  Object.keys(OVERSIZED).filter(stem => fs.existsSync(path.join(TEST_ROOT, stem)));

/**
 * The CLI body. `entries` is injectable so the reporting branches can be
 * exercised without an oversized file on disk.
 *
 * @param {{ file: string, lines: number }[]} [entries]
 * @param {string[]} [argv]
 */
const main = (entries = listTestFiles(), argv = process.argv) => {
  if (argv.includes("--list")) {
    const remaining = remainingAllowlist();
    console.log(
      `allowlist: ${Object.keys(OVERSIZED).length} entries, ${remaining.length} still on disk`,
    );
    remaining.forEach(stem => console.log(`  ${stem} — ${OVERSIZED[stem]}`));
    return 0;
  }
  const bad = checkSize(entries);
  for (const { file, lines } of bad) {
    console.log(
      `${file}: ${lines} lines (limit ${LIMIT}); split by aspect or add an allowlist entry naming its split card`,
    );
  }
  return bad.length > 0 ? 1 : 0;
};

// unreachable: the CLI entry runs only when Node executes this file directly;
// every branch inside main() is already driven through its injectable args.
/* v8 ignore next 2 */
if (process.argv[1] && process.argv[1].endsWith("test-size.mjs")) {
  process.exit(main());
}

export { LIMIT, checkSize, listTestFiles, main, remainingAllowlist };
