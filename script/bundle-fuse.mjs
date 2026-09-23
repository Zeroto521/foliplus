#!/usr/bin/env node
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
 * The caps below are each `2 * <last measured brotli size>`, rounded up to
 * the nearest 5 KB. They were set at commit 50d0723d (main) and are the
 * numbers you should be raising — one at a time, with a review note —
 * when they trip.
 *
 * Usage:
 *   node script/bundle-fuse.mjs                       # print table, exit 0
 *   node script/bundle-fuse.mjs --root=<path> ...     # read <path>/foliplus/dist
 *   node script/bundle-fuse.mjs --help                # all flags
 *
 * Exit codes: 0 = all under cap, 1 = fuse tripped or a build error.
 */
import { readFileSync, readdirSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { brotliCompressSync } from "zlib";
import { help, parseArgs as parseArgsCore } from "./args.mjs";
import { OK, STATUS, WARN } from "./glyph.mjs";

const EXIT_FUSE = 1;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// Absolute brotli-byte ceiling per artifact. Each value is `2 * measured`
// at the commit that set it (50d0723d), rounded up to the nearest 5 KB.
// Raising one here is a review event — the PR should name the change that
// made the current value too tight.
const FUSE_CAPS = {
  "foliplus-LayerControl.min.js": 85_000, // measured 40,793
  "foliplus-common.min.js": 85_000, // measured 39,197
  "foliplus-MeasureControl.min.js": 50_000, // measured 22,952
  "foliplus-ExportControl.min.js": 40_000, // measured 18,105
  "foliplus-HeatmapControl.min.js": 30_000, // measured 13,062
  "foliplus-SearchControl.min.js": 15_000, // measured 7,228
  "foliplus-common.min.css": 10_000, // measured 4,436
  "foliplus-LayerControl.min.css": 10_000, // measured 2,864
  "foliplus-FullscreenControl.min.js": 5_000, // measured 1,708
  "foliplus-LocateControl.min.js": 5_000, // measured 1,629
  "foliplus-ExportControl.min.css": 5_000, // measured 1,034
  "foliplus-MeasureControl.min.css": 5_000, // measured 897
  "foliplus-HeatmapControl.min.css": 5_000, // measured 770
  "foliplus-ScaleControl.min.js": 5_000, // measured 737
  "foliplus-SearchControl.min.css": 5_000, // measured 551
  "foliplus-FullscreenControl.min.css": 5_000, // measured 327
  "foliplus-ScaleControl.min.css": 5_000, // measured 260
  "foliplus-LocateControl.min.css": 5_000, // measured 162
};

// A bundle not listed above has no cap: it is either brand-new (needs a
// review before it gets a number) or a rename. Rather than silently
// passing, the fuse reports it as "unknown" so the caller can either
// add a cap or explain the drop.
const EXIT_UNKNOWN = 2;

const distDir = root => resolve(root, "foliplus/dist");

const SPEC = {
  root: { type: "string", desc: "Project root (reads <root>/foliplus/dist)" },
};

const parseArgs = argv => parseArgsCore(argv, SPEC);

const readSizes = (root = ROOT) => {
  const dir = distDir(root);
  const files = readdirSync(dir)
    .filter(f => /\.min\.(js|css)$/.test(f))
    .sort();
  const sizes = {};
  for (const f of files) {
    sizes[f] = brotliCompressSync(readFileSync(resolve(dir, f))).length;
  }
  return sizes;
};

const fmtBytes = n => (n / 1024).toFixed(2) + " KB";

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
      `${r.file.padEnd(fileWidth)}   ` +
        `${fmtBytes(r.measured).padStart(8)}  ` +
        `${capStr}  ` +
        `${headroomStr}  ` +
        `${STATUS[r.status]}`,
    );
  }
  const totalMeasured = rows.reduce((a, r) => a + r.measured, 0);
  const totalCap = rows.reduce((a, r) => a + (r.cap ?? 0), 0);
  lines.push("");
  lines.push(
    `${"TOTAL".padEnd(fileWidth)}   ` +
      `${fmtBytes(totalMeasured).padStart(8)}  ` +
      `${fmtBytes(totalCap).padStart(7)}  ` +
      `${rows.length} bundles`,
  );
  return lines.join("\n");
};

const fuse = (args, root = ROOT) => {
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
    if (a.status === "missing" && b.status !== "missing") return -1;
    if (b.status === "missing" && a.status !== "missing") return 1;
    return b.measured - a.measured;
  });
  const trips = rows.filter(r => r.status === "over");
  const unknowns = rows.filter(r => r.status === "missing");

  console.log(render(rows));

  if (trips.length > 0) {
    console.error(
      `\n${STATUS.over} ${trips.length} bundle(s) over fuse cap:` +
        "\n" +
        trips
          .map(
            r =>
              `  ${r.file}: ${fmtBytes(r.measured)} / cap ${fmtBytes(r.cap)} (+${fmtBytes(r.measured - r.cap)})`,
          )
          .join("\n"),
    );
    console.error(
      `${WARN} the fuse is an absolute ceiling — raise the cap only after ` +
        "reviewing whether the growth is deliberate.",
    );
    return EXIT_FUSE;
  }
  if (unknowns.length > 0) {
    console.error(
      `\n${STATUS.unknown} ${unknowns.length} bundle(s) with no fuse cap:` +
        "\n" +
        unknowns.map(r => `  ${r.file}: ${fmtBytes(r.measured)}`).join("\n") +
        "\n" +
        `${WARN} add a cap in script/bundle-fuse.mjs after review, or rename ` +
        "the bundle so it matches an existing cap.",
    );
    return EXIT_UNKNOWN;
  }
  console.log(`\n${OK} All ${rows.length} bundles under fuse cap.`);
  return 0;
};

export { EXIT_FUSE, EXIT_UNKNOWN, FUSE_CAPS, fuse, readSizes };

// CLI entry point: `node script/bundle-fuse.mjs [--root=<path>]`.
// Guarded so importing this module has no side effects.
/* v8 ignore start -- CLI-only entry point, not exercised by unit tests */
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(help(SPEC));
    process.exit(0);
  }
  if (args.errors.length) {
    console.error(args.errors.join("\n"));
    console.error(help(SPEC));
    process.exit(1);
  }
  const root = args.root ? resolve(args.root) : ROOT;
  const code = fuse(args, root);
  process.exit(code ?? 0);
}
/* v8 ignore stop */
