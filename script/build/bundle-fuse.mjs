#!/usr/bin/env node
// script/build/bundle-fuse — an absolute brotli ceiling per artifact, so bloat a baseline diff would miss still fails
/**
 * Bundle fuse — an absolute size ceiling over each dist artifact's brotli
 * size. Where `bundle-size-check` judges growth against a captured baseline,
 * the fuse judges each bundle against a fixed cap, so it fires on bloat that
 * a baseline diff would miss (a new bundle, a large inline of a shared
 * module, a duplicated copy of logic).
 *
 * Both gates read brotli bytes off the minified build, so the report has
 * one unit and comments never count.
 *
 * The cap per artifact is a fixed number, not `2 * measured` — an absolute
 * ceiling has to move only when a human reviews the change. If the cap
 * were derived from the current measured size, the fuse would never fire
 * on exactly the "accidental inline" cases it exists to catch.
 *
 * The caps below are each `2 * <measured brotli size>`, rounded up to the
 * nearest 5 KB. The CAP VALUES are the reviewed ceilings and only move when a
 * human raises them; the trailing `// measured N` comment on each line is
 * refreshed to the current minified build so a reader can see how much
 * headroom is left. They are the numbers you should be raising — one at a
 * time, with a review note — when they trip.
 *
 * Usage:
 *   node script/build/bundle-fuse.mjs                       # print table, exit 0
 *   node script/build/bundle-fuse.mjs --root=<path> ...     # read <path>/foliplus/dist
 *   node script/build/bundle-fuse.mjs --help                # all flags
 *
 * Exit codes (from script/build/bundle-size-lib.mjs):
 *   0 = all under cap
 *   1 = fuse tripped, or no bundles found
 *   4 = an artifact has no cap (needs review to add one)
 *
 * This reads the MINIFIED artifacts, so run `npm run build` before invoking
 * it. `npm run build:dev` (what `make test` uses, for the vitest-side
 * assertions that expect unminified source tokens) overwrites the same files
 * and would leave this gate measuring a far larger bundle than the one that
 * ships. The gate now detects that state via the `.dev-build` marker
 * (devDistMessage in bundle-size-lib.mjs) and refuses to measure rather than
 * reporting breaches that do not exist in what ships.
 */
import { help } from "../args.mjs";
import {
  EXIT_FUSE,
  EXIT_OK,
  EXIT_UNKNOWN,
  ROOT,
  baseSpec,
  devDistMessage,
  fmtBytes,
  parseArgsWithBase,
  readSizes,
} from "./bundle-size-lib.mjs";
import { FAIL, OK, STATUS, WARN } from "./glyph.mjs";
import { resolve } from "path";
import { pathToFileURL } from "url";

// Absolute brotli-byte ceiling per artifact. Each value is `2 * measured`
// at the commit that set it (50d0723d), rounded up to the nearest 5 KB.
// Raising one here is a review event — the PR should name the change that
// made the current value too tight.
const FUSE_CAPS = {
  "foliplus-LayerControl.min.js": 85_000, // measured 46,996
  "foliplus-common.min.js": 85_000, // measured 54,700
  "foliplus-MeasureControl.min.js": 50_000, // measured 13,992
  "foliplus-ExportControl.min.js": 40_000, // measured 12,272
  "foliplus-HeatmapControl.min.js": 30_000, // measured 10,286
  "foliplus-SearchControl.min.js": 15_000, // measured 5,114
  "foliplus-common.min.css": 10_000, // measured 6,273
  "foliplus-LayerControl.min.css": 10_000, // measured 3,570
  "foliplus-FullscreenControl.min.js": 5_000, // measured 1,312
  "foliplus-LocateControl.min.js": 5_000, // measured 1,039
  "foliplus-ExportControl.min.css": 5_000, // measured 933
  "foliplus-MeasureControl.min.css": 5_000, // measured 709
  "foliplus-HeatmapControl.min.css": 5_000, // measured 303
  "foliplus-ScaleControl.min.js": 5_000, // measured 402
  "foliplus-SearchControl.min.css": 5_000, // measured 460
  "foliplus-FullscreenControl.min.css": 5_000, // measured 230
  "foliplus-ScaleControl.min.css": 5_000, // measured 196
  "foliplus-LocateControl.min.css": 5_000, // measured 105
};

const render = rows => {
  const lines = [];
  const fileWidth = Math.max(...rows.map(r => r.file.length), "artifact".length);
  lines.push(
    `${"artifact".padEnd(fileWidth)}   measured    cap       headroom  status`,
  );
  for (const r of rows) {
    const headroom = r.cap - r.measured;
    const headroomStr =
      r.cap == null ? "     —" : `${(headroom / 1024).toFixed(1)} KB`.padStart(8);
    const capStr = r.cap == null ? "   —" : fmtBytes(r.cap).padStart(7);
    lines.push(
      `${r.file.padEnd(fileWidth)}   ${fmtBytes(r.measured).padStart(8)}  ${capStr}  ${headroomStr}  ${STATUS[r.status]}`,
    );
  }
  // The totalCap column excludes uncapped rows (they have no cap to sum),
  // otherwise an uncapped artifact silently contributes 0 and the total
  // undercounts — the reader sees "92 KB cap" when only 14 of 18 bundles
  // actually have caps. `N of M capped` makes the gap explicit.
  const capped = rows.filter(r => r.cap != null);
  const totalMeasured = rows.reduce((a, r) => a + r.measured, 0);
  const totalCap = capped.reduce((a, r) => a + r.cap, 0);
  const totalLabel =
    capped.length === rows.length
      ? `${rows.length} bundles`
      : `${capped.length} of ${rows.length} capped`;
  lines.push("");
  lines.push(
    `${"TOTAL".padEnd(fileWidth)}   ${fmtBytes(totalMeasured).padStart(8)}  ${fmtBytes(totalCap).padStart(7)}  ${totalLabel}`,
  );
  return lines.join("\n");
};

const fuse = (args, root = ROOT, deps = {}) => {
  // A dev (unminified) dist would make every cap verdict misleading; refuse it
  // up front rather than publishing a table nobody can act on.
  const devMsg = devDistMessage(root, deps);
  if (devMsg) {
    console.error(`${FAIL}  ${devMsg}`);
    return EXIT_FUSE;
  }
  const sizes = readSizes(root);
  if (!Object.keys(sizes).length) {
    console.error("No bundles found in foliplus/dist/. Run `npm run build` first.");
    return EXIT_FUSE;
  }
  const rows = Object.entries(sizes).map(([file, measured]) => {
    const cap = FUSE_CAPS[file] ?? null;
    const status = cap == null ? "missing" : measured > cap ? "over" : "same";
    return { file, measured, cap, status };
  });
  // Sort by size descending so the biggest offenders land on top; missing
  // rows bubble up regardless so a new bundle can't hide at the bottom.
  rows.sort((a, b) => {
    const aMissing = a.status === "missing" ? 0 : 1;
    const bMissing = b.status === "missing" ? 0 : 1;
    if (aMissing !== bMissing) return aMissing - bMissing;
    return b.measured - a.measured;
  });
  const trips = rows.filter(r => r.status === "over");
  const unknowns = rows.filter(r => r.status === "missing");

  console.log(render(rows));

  if (trips.length > 0) {
    console.error(
      `\n${STATUS.over} ${trips.length} bundle(s) over fuse cap:\n${trips
        .map(
          r =>
            `  ${r.file}: ${fmtBytes(r.measured)} / cap ${fmtBytes(r.cap)} (+${fmtBytes(r.measured - r.cap)})`,
        )
        .join("\n")}`,
    );
    console.error(
      `${WARN} the fuse is an absolute ceiling — raise the cap only after reviewing whether the growth is deliberate.`,
    );
    return EXIT_FUSE;
  }
  if (unknowns.length > 0) {
    console.error(
      `\n${STATUS.missing} ${unknowns.length} bundle(s) with no fuse cap:\n${unknowns.map(r => `  ${r.file}: ${fmtBytes(r.measured)}`).join("\n")}\n${WARN} add a cap in script/build/bundle-fuse.mjs after review, or rename the bundle so it matches an existing cap.`,
    );
    return EXIT_UNKNOWN;
  }
  console.log(`\n${OK} All ${rows.length} bundles under fuse cap.`);
  return EXIT_OK;
};

export { EXIT_FUSE, EXIT_OK, EXIT_UNKNOWN, FUSE_CAPS, fuse, main, readSizes };

/** CLI entry: parse argv, run the fuse, and exit with its verdict. Exported so
 *  tests can drive the exact CLI flow with an injected argv instead of
 *  spawning a process. */
const main = (argv = process.argv.slice(2), deps = {}) => {
  const args = parseArgsWithBase(argv);
  if (args.help) {
    console.log(help(baseSpec));
    process.exit(EXIT_OK);
  }
  if (args.errors.length) {
    console.error(args.errors.join("\n"));
    console.error(help(baseSpec));
    process.exit(EXIT_FUSE);
  }
  const root = args.root ? resolve(args.root) : ROOT;
  const code = fuse(args, root, deps);
  process.exit(code);
};

// CLI entry point: `node script/build/bundle-fuse.mjs [--root=<path>]`.
// Guarded so importing this module has no side effects.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
