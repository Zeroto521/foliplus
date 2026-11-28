#!/usr/bin/env node
// script/check/test-size — test files stay under the size cap, so a module's suite cannot become a dumping ground
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
 * deletes its entry in the same PR, and the guard enforces that instead of
 * trusting it: a stale entry — the file is gone, or it has fallen to or under
 * the cap — fails the gate and asks for the line to be deleted. That is the
 * same semantics script/check/python_test_layout.py already ships, and the
 * opposite of "an allowlist that only ever grows".
 *
 * Usage:
 *   node script/check/test-size.mjs [--list]
 *
 * With --list it prints the burn-down view: entries still owed a split, then
 * the stale rows. --list is report-only for a clean tree, but it still exits 1
 * when a stale entry exists, so a copy of the view in CI cannot hide one.
 * Without --list, exit 1 lists every stale entry and every unlisted offender;
 * exit 0 otherwise.
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
  "control/MeasureControl/manager.test.ts": "split pending",
  "ui/listbox.test.ts": "split pending",
  "ui/slider.test.ts": "split pending",
  "control/ExportControl/renderer/index.test.ts": "split pending",
  "control/ExportControl/renderer/marker.test.ts":
    "split pending — the marker export cases were folded into the canonical file",
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
  "core/layer/folderView.test.ts": "split pending",
};

/** Line count of a file (raw lines, matching how the cap is measured). */
const lineCount = file => fs.readFileSync(file, "utf8").split(/\r?\n/).length;

/** The repo-relative test/js/ path of a file, for allowlist lookup.
 *
 *  Resolved first, the way python_test_layout.py uses
 *  `Path.resolve().relative_to()`: the walk hands absolute paths, a synthetic
 *  test hands a repo-relative one, and either may carry `.`/`..` segments
 *  (nothing in the walk is a symlink — readdirSync does not descend into one).
 *  A path outside test/js/ falls back to the marker: one that merely CONTAINS
 *  `test/js/` is still cut at it (historical behaviour, pinned by a test),
 *  while one without the marker keeps its own key. */
const relUnderTestJs = file => {
  const resolved = path.resolve(REPO_ROOT, file);
  const fromRoot = path.relative(TEST_ROOT, resolved);
  if (fromRoot && !fromRoot.startsWith("..") && !path.isAbsolute(fromRoot)) {
    return fromRoot.split(path.sep).join("/");
  }
  const slashed = file.split(path.sep).join("/");
  const marker = "test/js/";
  const at = slashed.lastIndexOf(marker);
  // The suffix may still carry `..` segments; collapse them the way the
  // resolve above would have, so both spellings reach the same allowlist key.
  return at >= 0 ? path.posix.normalize(slashed.slice(at + marker.length)) : slashed;
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
 * The allowlist entries that no longer owe a split: the file is gone, or it has
 * fallen to or under LIMIT. Each row says why and what to do, so the message is
 * the fix rather than a number.
 *
 * Pure over the injected tree (the same (file, lines) pairs checkSize takes),
 * so a shrunk file can be simulated without writing one — but the CLI always
 * passes the real walk, where a file missing from it is missing from disk.
 *
 * @param {{ file: string, lines: number }[]} [entries]
 * @param {Record<string, string>} [oversized]
 * @returns {{ stem: string, lines: number | null, reason: string }[]}
 */
const staleAllowlist = (entries = listTestFiles(), oversized = OVERSIZED) => {
  const counted = new Map(
    entries.map(entry => [relUnderTestJs(entry.file), entry.lines]),
  );
  const stale = [];
  for (const stem of Object.keys(oversized)) {
    const lines = counted.get(stem);
    if (lines === undefined) {
      stale.push({
        stem,
        lines: null,
        reason: "file is gone — delete this allowlist entry",
      });
    } else if (lines <= LIMIT) {
      stale.push({
        stem,
        lines,
        reason: `now ${lines} lines, at or under the ${LIMIT}-line cap — delete this allowlist entry`,
      });
    }
  }
  return stale;
};

/**
 * The CLI body. `entries` is injectable so the reporting branches can be
 * exercised without an oversized file on disk.
 *
 * @param {{ file: string, lines: number }[]} [entries]
 * @param {string[]} [argv]
 */
const main = (entries = listTestFiles(), argv = process.argv) => {
  const stale = staleAllowlist(entries);
  if (argv.includes("--list")) {
    // One bucket per entry: a file that is on disk but stale is NOT still owed
    // a split, so the two counts never overlap (entries = owed + stale).
    const staleStems = new Set(stale.map(({ stem }) => stem));
    const owed = remainingAllowlist().filter(stem => !staleStems.has(stem));
    console.log(
      `allowlist: ${Object.keys(OVERSIZED).length} entries, ${owed.length} still owe a split, ${stale.length} stale`,
    );
    owed.forEach(stem => console.log(`  ${stem} — ${OVERSIZED[stem]}`));
    stale.forEach(({ stem, reason }) => console.log(`  STALE ${stem} — ${reason}`));
    return stale.length > 0 ? 1 : 0;
  }
  for (const { stem, reason } of stale) {
    console.log(`${stem}: stale allowlist entry — ${reason}`);
  }
  const bad = checkSize(entries);
  for (const { file, lines } of bad) {
    console.log(
      `${file}: ${lines} lines (limit ${LIMIT}); split by aspect or add an allowlist entry naming its split card`,
    );
  }
  return stale.length > 0 || bad.length > 0 ? 1 : 0;
};

// unreachable: the CLI entry runs only when Node executes this file directly;
// every branch inside main() is already driven through its injectable args.
/* v8 ignore next 2 */
if (process.argv[1] && process.argv[1].endsWith("test-size.mjs")) {
  process.exit(main());
}

export { LIMIT, checkSize, listTestFiles, main, remainingAllowlist, staleAllowlist };
