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
 *   node script/check/test_size.mjs [--list]
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
  "control/LayerControl/controller.test.ts": "task-100 step 3 (blocked by #1284)",
  "control/LayerControl/ui/style/fill.test.ts": "task-100 step 3 (blocked by #1284)",
  "control/LayerControl/ui/style/index.test.ts": "task-100 step 3 (blocked by #1284)",
  "control/HeatmapControl/manager.test.ts": "task-100 step 2",
  "control/LayerControl/ui/style/border.test.ts": "task-100 step 3 (blocked by #1284)",
  "control/MeasureControl/manager.test.ts": "task-100 step 2",
  "ui/listbox.test.ts": "task-100 step 2",
  "control/LayerControl/ui/focus/index.test.ts": "task-100 step 3 (blocked by #1284)",
  "control/LayerControl/ui/listPanel/list.test.ts":
    "task-100 step 3 (blocked by #1284)",
  "control/LayerControl/ui/overlayPanel/menu.test.ts":
    "task-100 step 3 (blocked by #1284)",
  "control/LayerControl/ui/overlayPanel/filter.test.ts":
    "task-100 step 3 (blocked by #1284)",
  "control/LayerControl/ui/listPanel/drag.test.ts":
    "task-100 step 3 (blocked by #1284)",
  "control/LayerControl/ui/apply.test.ts": "task-100 step 3 (blocked by #1284)",
  "ui/slider.test.ts": "task-100 step 2",
  "control/ExportControl/renderer/index.test.ts": "task-100 step 2",
  "control/LayerControl/ui/state.test.ts": "task-100 step 3 (blocked by #1284)",
  "control/LayerControl/persistence.test.ts": "task-100 step 3 (blocked by #1284)",
  "core/layer/LayerFactory.test.ts": "task-100 step 2",
  "core/layer/PaneManager.test.ts": "task-100 step 2",
  "core/layer/LayerSurface.test.ts": "task-100 step 2",
  "control/LayerControl/label/index.test.ts": "task-100 step 3 (blocked by #1284)",
  "core/leaflet/panel.test.ts": "task-100 step 2",
  "core/overlay/overlayRegistry.test.ts": "task-100 step 2",
  "control/LayerControl/ui/listPanel/visibility.test.ts":
    "task-100 step 3 (blocked by #1284)",
  "script/build/bundle-size-check.test.ts":
    "task-100 step 2 (build-gate fixture-heavy; split card TBD)",
  "ui/schemePicker.test.ts": "task-100 step 2",
  "control/LayerControl/ui/style/icon.test.ts": "task-100 step 3 (blocked by #1284)",
  "control/SearchControl/logic/history.test.ts": "task-100 step 2",
  "core/leaflet/markerIcon.test.ts": "task-100 step 2",
  "control/SearchControl/logic/search.test.ts": "task-100 step 2",
  "control/HeatmapControl/ui.test.ts": "task-100 step 2",
  "script/check/patch-coverage.test.ts":
    "task-100 step 2 (guard fixture-heavy; split card TBD)",
  "control/LayerControl/ui/listPanel/keyboard.test.ts":
    "task-100 step 3 (blocked by #1284)",
  "ui/dropdown.test.ts": "task-100 step 2",
  "control/LayerControl/ui/style/fillValue.test.ts":
    "task-100 step 3 (blocked by #1284)",
  "control/LayerControl/ui/style/styleBag.test.ts":
    "task-100 step 3 (blocked by #1284)",
  "core/layer/folderLayout.test.ts": "task-100 step 2",
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
 */
const checkSize = (entries, oversized = OVERSIZED) =>
  entries
    .filter(({ file, lines }) => lines > LIMIT && !(relUnderTestJs(file) in oversized))
    .map(({ file, lines }) => ({
      file: relUnderTestJs(file),
      lines,
      reason: oversized[relUnderTestJs(file)] ?? "",
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

/** The allowlist entries still present on disk (the burn-down view). */
const remainingAllowlist = () =>
  Object.keys(OVERSIZED).filter(stem =>
    fs.existsSync(path.join(TEST_ROOT, `${stem}.test.ts`)),
  );

const main = () => {
  if (process.argv.includes("--list")) {
    const remaining = remainingAllowlist();
    console.log(
      `allowlist: ${Object.keys(OVERSIZED).length} entries, ${remaining.length} still on disk`,
    );
    remaining.forEach(stem => console.log(`  ${stem} — ${OVERSIZED[stem]}`));
    return 0;
  }
  const bad = checkSize(listTestFiles());
  for (const { file, lines } of bad) {
    console.log(
      `${file}: ${lines} lines (limit ${LIMIT}); split by aspect or add an allowlist entry naming its split card`,
    );
  }
  return bad.length > 0 ? 1 : 0;
};

if (process.argv[1] && process.argv[1].endsWith("test_size.mjs")) {
  process.exit(main());
}

export { LIMIT, checkSize };
