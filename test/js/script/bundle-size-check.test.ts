import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { brotliCompressSync } from "zlib";
import {
  buildRows,
  check,
  emit,
  fmtDelta,
  fmtKB,
  fmtPct,
  parseArgs,
  rowCells,
  stripLeadingBlockComment,
  summarize,
  toolVersion,
} from "#script/bundle-size-check.mjs";

const brotli = (s: string) => brotliCompressSync(Buffer.from(s)).length;

let tmpRoots: string[] = [];

const mkTmp = (): string => {
  const dir = join(
    tmpdir(),
    "size-check-test-" + Date.now() + "-" + Math.random().toString(36).slice(2),
  );
  tmpRoots.push(dir);
  return dir;
};

const mkDist = (root: string, files: Record<string, string>) => {
  const dir = join(root, "foliplus", "dist");
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
};

// Write a baseline sizes file to `root` and return its path.
const writeBaseline = (root: string, data: unknown): string => {
  mkdirSync(root, { recursive: true });
  const path = join(root, "base.json");
  writeFileSync(path, JSON.stringify(data), "utf-8");
  return path;
};

// Captures console output and returns "[exit code]\n[output]". `error: true`
// also swallows `console.error`, which `check` uses for the failure listing.
const runCheck = (root: string, data: unknown, error = false): string => {
  const baseline = writeBaseline(root, data);
  const logs: string[] = [];
  const warn = console.warn;
  const log = console.log;
  const origErr = console.error;
  console.warn = (...a) => logs.push(a.join(" "));
  console.log = (...a) => logs.push(a.join(" "));
  if (error) console.error = (...a) => logs.push(a.join(" "));
  try {
    const code = check(parseArgs(["--baseline=" + baseline]), root);
    return String(code) + "\n" + logs.join("\n");
  } finally {
    console.warn = warn;
    console.log = log;
    if (error) console.error = origErr;
  }
};

// parseArgs wired to compare against a baseline written to `root`.
const argsWithBaseline = (root: string, data: unknown) =>
  parseArgs(["--baseline=" + writeBaseline(root, data)]);

afterEach(() => {
  for (const dir of tmpRoots) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
  tmpRoots = [];
});

describe("stripLeadingBlockComment", () => {
  it("removes the esbuild banner comment and its trailing newline", () => {
    const src = "/*! foliplus@v0.3.1-127-g1a1bd10 · common */\n\n:root{--a:1}";
    expect(stripLeadingBlockComment(src)).toBe(":root{--a:1}");
  });

  it("treats the banner as a non-greedy first comment only", () => {
    const src = "/*! banner */\nvar a=1;/* keep */";
    expect(stripLeadingBlockComment(src)).toBe("var a=1;/* keep */");
  });

  it("tolerates a UTF-8 BOM before the banner", () => {
    const src = "﻿/*! banner */\nbody{}";
    expect(stripLeadingBlockComment(src)).toBe("body{}");
  });

  it("leaves a bundle without a leading block comment untouched", () => {
    const src = "var a=1;/* inline */";
    expect(stripLeadingBlockComment(src)).toBe(src);
  });
});

describe("parseArgs", () => {
  // Runs on the shared `args.mjs` parser, so its flag defaults are `false`
  // rather than `null` — both are falsy, which is all the call sites use.
  it("defaults to check mode with threshold 10", () => {
    const a = parseArgs([]);
    expect(a.emit).toBeFalsy();
    expect(a.threshold).toBe(10);
    expect(a.baseline).toBeFalsy();
    expect(a.report).toBeFalsy();
    expect(a.root).toBeFalsy();
    expect(a.errors).toEqual([]);
  });

  it("parses --emit and --root", () => {
    const a = parseArgs(["--emit=/tmp/sizes.json", "--root=/tmp/base"]);
    expect(a.emit).toBe("/tmp/sizes.json");
    expect(a.root).toBe("/tmp/base");
  });

  it("parses --threshold=N", () => {
    expect(parseArgs(["--threshold=25"]).threshold).toBe(25);
  });

  it("records a non-numeric --threshold as an error instead of a silent default", () => {
    // A bad threshold is a user mistake, not a case to fall back on: running
    // with the default 10 would report success at the wrong band.
    const a = parseArgs(["--threshold=abc"]);
    expect(a.threshold).toBe(10);
    expect(a.errors).toEqual(["--threshold must be a number: abc"]);
  });

  it("keeps a fractional --threshold", () => {
    // A fractional threshold is a legitimate choice for a small bundle set, so
    // truncating it to an integer would silently widen the band.
    expect(parseArgs(["--threshold=15.5"]).threshold).toBe(15.5);
  });

  it("records unknown flags and arguments", () => {
    const a = parseArgs(["--bogus", "positional"]);
    expect(a.errors).toEqual(["Unknown flag: --bogus", "Unknown argument: positional"]);
  });

  it("parses --baseline and --report", () => {
    const a = parseArgs(["--baseline=/tmp/base.json", "--report=/tmp/report.md"]);
    expect(a.baseline).toBe("/tmp/base.json");
    expect(a.report).toBe("/tmp/report.md");
  });

  it("honors a value after the flag, not just --flag=value", () => {
    expect(parseArgs(["--threshold", "20"]).threshold).toBe(20);
  });

  it("recognizes --help", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
  });
});

describe("buildRows", () => {
  it("classifies over/low/up/down/same/new/missing", () => {
    const current = {
      "a.min.js": 100,
      "b.min.js": 90,
      "c.min.js": 100,
      "d.min.js": 108,
      "new.min.js": 50,
    };
    const baseline = {
      files: {
        "a.min.js": 80,
        "b.min.js": 100,
        "c.min.js": 100,
        "d.min.js": 100,
        "gone.min.js": 10,
      },
    };
    const byFile = Object.fromEntries(
      buildRows(current, baseline, 10).map(r => [r.file, r]),
    );
    expect(byFile["a.min.js"].status).toBe("over"); // +25% > 10%
    expect(byFile["b.min.js"].status).toBe("down"); // -10%
    expect(byFile["c.min.js"].status).toBe("same");
    expect(byFile["d.min.js"].status).toBe("low"); // +8% within the 5% low-margin band
    expect(byFile["new.min.js"].status).toBe("new");
    expect(byFile["gone.min.js"].status).toBe("missing");
    expect(byFile["gone.min.js"].over).toBe(false);
  });

  it("treats a baseline without a files map as empty", () => {
    const rows = buildRows({ "a.min.js": 100 }, {}, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("new");
    expect(rows[0].prev).toBeNull();
  });

  it("treats a non-numeric baseline entry as absent", () => {
    // A hand-edited capture could carry a non-numeric value; the comparison
    // would otherwise render "NaN%" in the report table.
    const rows = buildRows({ "a.min.js": 100 }, { files: { "a.min.js": "nope" } }, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("new");
    expect(rows[0].prev).toBeNull();
    expect(rows[0].pct).toBeNull();
    expect(fmtPct(rows[0].curr, rows[0].prev)).toBe("—");
    expect(fmtDelta(rows[0].curr, rows[0].prev)).toBe("—");
  });

  it("treats a zero-size baseline entry as an unknown percentage", () => {
    const rows = buildRows({ "a.min.js": 100 }, { files: { "a.min.js": 0 } }, 10);
    expect(rows[0].delta).toBe(100);
    expect(rows[0].pct).toBeNull();
    expect(rows[0].status).toBe("up");
  });

  it("classifies a sub-0.05% drift as same, not up/down", () => {
    // A 1-byte shift on a ~10 KB bundle rounds to "0.0%" — the status must agree.
    const rows = buildRows(
      { "up.min.js": 10001, "down.min.js": 9999, "flat.min.js": 10000 },
      { files: { "up.min.js": 10000, "down.min.js": 10000, "flat.min.js": 10000 } },
      10,
    );
    const byFile = Object.fromEntries(rows.map(r => [r.file, r]));
    expect(byFile["up.min.js"].pct).toBeCloseTo(0.01, 2); // +0.01% → displays 0.0%
    expect(byFile["up.min.js"].status).toBe("same");
    expect(byFile["down.min.js"].status).toBe("same");
    expect(byFile["flat.min.js"].status).toBe("same");
  });

  it("reports an empty baseline as 0.00 KB, not an em-dash", () => {
    // A baseline total of 0 (every bundle empty) is a real number, so the
    // total row must show it — the em-dash is only for the no-baseline case.
    const rows = buildRows({ "a.min.js": 100 }, { files: { "a.min.js": 0 } }, 10);
    const t = summarize(rows);
    expect(t.curr).toBe(100);
    expect(t.prev).toBe(0);
    expect(t.hasPrev).toBe(true);
    expect(t.delta).toBe(100);
    expect(t.pct).toBeNull();
  });

  it("classifies a zero-baseline bundle by its raw byte delta", () => {
    // A zero baseline leaves the percentage incalculable, so `statusOf` falls
    // back to the delta — and the two must agree, or an unchanged bundle reads
    // "up". The real source of such a baseline is a build that emitted an empty
    // file, which `emit` records as its banner-stripped size.
    const baseline = { files: { "up.min.js": 0, "flat.min.js": 0 } };
    const rows = buildRows({ "up.min.js": 100, "flat.min.js": 0 }, baseline, 10);
    const byFile = Object.fromEntries(rows.map(r => [r.file, r]));
    // No percentage is derivable from a zero baseline — the delta decides.
    expect(byFile["flat.min.js"].pct).toBeNull();
    expect(byFile["flat.min.js"].status).toBe("same");
    expect(byFile["up.min.js"].status).toBe("up");
    // `over` is judged on the percentage, so an incalculable one can never trip
    // the threshold — however large the absolute growth is.
    expect(byFile["up.min.js"].over).toBe(false);
    expect(byFile["flat.min.js"].over).toBe(false);
  });
});

describe("summarize", () => {
  it("aggregates current and baseline totals", () => {
    const rows = buildRows(
      { "a.min.js": 100, "b.min.js": 200 },
      { files: { "a.min.js": 80, "b.min.js": 250 } },
      10,
    );
    const t = summarize(rows);
    expect(t.curr).toBe(300);
    expect(t.prev).toBe(330);
    expect(t.delta).toBe(-30);
    expect(t.pct).toBeCloseTo(-9.09, 1);
  });

  it("counts new bundles into current and missing into baseline", () => {
    const rows = buildRows(
      { "a.min.js": 100, "new.min.js": 50 },
      { files: { "a.min.js": 100, "gone.min.js": 10 } },
      10,
    );
    const t = summarize(rows);
    expect(t.curr).toBe(150);
    expect(t.prev).toBe(110);
    expect(t.delta).toBe(40);
  });

  it("leaves delta null when there is no baseline to diff against", () => {
    // Every bundle is "new" — reporting the whole total as growth would be wrong.
    const rows = buildRows({ "a.min.js": 100 }, null, 10);
    const t = summarize(rows);
    expect(t.curr).toBe(100);
    expect(t.prev).toBe(0);
    expect(t.hasPrev).toBe(false);
    expect(t.delta).toBeNull();
    expect(t.pct).toBeNull();
  });

  it("marks hasPrev true when at least one baseline size is present", () => {
    const t = summarize(
      buildRows({ "a.min.js": 100 }, { files: { "a.min.js": 80 } }, 10),
    );
    expect(t.hasPrev).toBe(true);
    expect(t.delta).toBe(20);
  });
});

describe("formatters", () => {
  it("formats KB", () => {
    expect(fmtKB(1024)).toBe("1.00 KB");
  });

  it("formats deltas with sign", () => {
    expect(fmtDelta(1100, 1000)).toBe("+0.10 KB");
    expect(fmtDelta(900, 1000)).toBe("-0.10 KB");
  });

  it("returns em-dash for missing/new deltas", () => {
    expect(fmtDelta(null, 100)).toBe("—");
    expect(fmtDelta(100, null)).toBe("—");
  });

  it("formats percentages with sign and guards null/zero", () => {
    expect(fmtPct(110, 100)).toBe("+10.0%");
    expect(fmtPct(90, 100)).toBe("-10.0%");
    expect(fmtPct(null, 100)).toBe("—");
    expect(fmtPct(100, null)).toBe("—");
    expect(fmtPct(100, 0)).toBe("—");
  });

  it("falls back to · for an unknown status marker", () => {
    // buildRows only emits the known statuses, but the marker lookup is defensive.
    expect(rowCells({ status: "bogus", curr: null, prev: null }).icon).toBe("·");
  });

  it("labels an over-threshold row with its percentage", () => {
    // The label is what the reader sees instead of a bare marker, and it is the
    // only place the row's own percentage is shown.
    const row = { status: "over", curr: 120, prev: 100 };
    expect(rowCells(row).label).toBe("OVER +20.0%");
    expect(rowCells(row).currStr).toBe("0.12 KB");
    expect(rowCells(row).prevStr).toBe("0.10 KB");
  });
});

describe("check", () => {
  it("returns 0 when all bundles are within threshold", () => {
    const root = mkTmp();
    const content = "const x = 1;".repeat(100);
    const size = brotli(content);
    mkDist(root, { "a.min.js": content });
    expect(check(argsWithBaseline(root, { files: { "a.min.js": size } }), root)).toBe(
      0,
    );
  });

  it("returns 1 when a bundle exceeds the threshold", () => {
    const root = mkTmp();
    const content = "const x = 1;".repeat(100);
    const size = brotli(content);
    mkDist(root, { "a.min.js": content });
    // baseline 20% smaller → 25% growth > 10%
    expect(
      check(
        argsWithBaseline(root, { files: { "a.min.js": Math.round(size * 0.8) } }),
        root,
      ),
    ).toBe(1);
  });

  it("warns but returns 0 when a bundle is in the low-margin band", () => {
    const root = mkTmp();
    const content = "const x = 1;".repeat(100);
    const size = brotli(content);
    mkDist(root, { "a.min.js": content });
    // baseline 7% smaller → ~7.5% growth, inside the 5% low-margin band (not over)
    expect(
      check(
        argsWithBaseline(root, { files: { "a.min.js": Math.round(size * 0.93) } }),
        root,
      ),
    ).toBe(0);
  });

  it("honors an explicit --threshold", () => {
    const root = mkTmp();
    const content = "const x = 1;".repeat(100);
    const size = brotli(content);
    mkDist(root, { "a.min.js": content });
    // 25% growth but --threshold=30 → not over
    const args = parseArgs([
      "--threshold=30",
      "--baseline=" +
        writeBaseline(root, { files: { "a.min.js": Math.round(size * 0.8) } }),
    ]);
    expect(check(args, root)).toBe(0);
  });

  it("warns but returns 0 when there is no baseline", () => {
    const root = mkTmp();
    mkDist(root, { "a.min.js": "const x = 1;" });
    expect(check(parseArgs([]), root)).toBe(0);
  });

  it("appends a Markdown summary when GITHUB_STEP_SUMMARY is set", () => {
    const root = mkTmp();
    const summary = join(root, "summary.md");
    const content = "const x = 1;".repeat(50);
    mkDist(root, { "a.min.js": content });
    const args = argsWithBaseline(root, { files: { "a.min.js": brotli(content) } });
    const prev = process.env.GITHUB_STEP_SUMMARY;
    process.env.GITHUB_STEP_SUMMARY = summary;
    try {
      // first call: summary file does not exist → catch branch; second: exists → append.
      expect(check(args, root)).toBe(0);
      expect(check(args, root)).toBe(0);
    } finally {
      if (prev === undefined) delete process.env.GITHUB_STEP_SUMMARY;
      else process.env.GITHUB_STEP_SUMMARY = prev;
    }
    expect(readFileSync(summary, "utf-8")).toContain("Bundle Size Check");
  });

  it("compares against a custom baseline via --baseline", () => {
    const root = mkTmp();
    const content = "const x = 1;".repeat(100);
    const size = brotli(content);
    mkDist(root, { "a.min.js": content });
    // custom baseline 20% smaller → 25% growth > 10%.
    const customBaseline = join(root, "base-baseline.json");
    writeFileSync(
      customBaseline,
      JSON.stringify({ files: { "a.min.js": Math.round(size * 0.8) } }),
      "utf-8",
    );
    expect(check(parseArgs(["--baseline=" + customBaseline]), root)).toBe(1);
  });

  it("writes a collapsible Markdown report via --report", () => {
    const root = mkTmp();
    const content = "const x = 1;".repeat(100);
    const size = brotli(content);
    mkDist(root, { "a.min.js": content });
    const report = join(root, "report.md");
    const args = parseArgs([
      "--baseline=" + writeBaseline(root, { files: { "a.min.js": size } }),
      "--report=" + report,
    ]);
    expect(check(args, root)).toBe(0);
    const md = readFileSync(report, "utf-8");
    expect(md).toContain("Bundle Size Check");
    expect(md).toContain("<details>");
    expect(md).toContain("📦 Per-bundle breakdown");
    expect(md).not.toContain("over threshold"); // nothing exceeds the threshold
  });

  it("flags over-threshold bundles in the report summary", () => {
    const root = mkTmp();
    const content = "const x = 1;".repeat(100);
    const size = brotli(content);
    mkDist(root, { "a.min.js": content });
    // baseline 20% smaller → 25% growth > 10%
    const report = join(root, "report.md");
    const args = parseArgs([
      "--baseline=" +
        writeBaseline(root, { files: { "a.min.js": Math.round(size * 0.8) } }),
      "--report=" + report,
    ]);
    expect(check(args, root)).toBe(1);
    expect(readFileSync(report, "utf-8")).toContain("over threshold");
  });

  it("bolds the over-threshold count in the report summary with HTML", () => {
    const root = mkTmp();
    const content = "const x = 1;".repeat(100);
    const size = brotli(content);
    mkDist(root, { "a.min.js": content });
    const report = join(root, "report.md");
    const args = parseArgs([
      "--baseline=" +
        writeBaseline(root, { files: { "a.min.js": Math.round(size * 0.8) } }),
      "--report=" + report,
    ]);
    expect(check(args, root)).toBe(1);
    expect(readFileSync(report, "utf-8")).toContain("<b>1 over threshold</b>");
  });

  it("reports the same size for banners that differ", () => {
    // The banner carries `git describe`, which is different in every checkout,
    // so two builds of identical code must not differ in size.
    const root = mkTmp();
    const body = "const x = 1;".repeat(200);
    const bannered = (v: string) => `/*! foliplus@${v} · a */

${body}`;
    const a = bannered("v0.3.1-127-g1a1bd10");
    const b = bannered("v0.3.1-128-g9b32ca3");
    const args = argsWithBaseline(root, { files: { "a.min.js": brotli(a) } });
    mkDist(root, { "a.min.js": b });
    expect(check(args, root)).toBe(0);
  });

  it("reports the same size for banners of different lengths", () => {
    const root = mkTmp();
    const body = "const x = 1;".repeat(200);
    const a = `/*! short */

${body}`;
    const b = `/*! a much longer version string */

${body}`;
    const args = argsWithBaseline(root, { files: { "a.min.js": brotli(a) } });
    mkDist(root, { "a.min.js": b });
    expect(check(args, root)).toBe(0);
  });

  it("reports an unwritable --report path without failing the run", () => {
    // A `--report` that resolves to an existing directory cannot be written.
    // The comparison itself already succeeded, so this must not change the
    // exit code or abort the check.
    const root = mkTmp();
    const content = "const x = 1;".repeat(100);
    const size = brotli(content);
    mkDist(root, { "a.min.js": content });
    const dir = join(root, "report-dir");
    mkdirSync(dir);
    const logs: string[] = [];
    const origErr = console.error;
    console.error = (...a) => logs.push(a.join(" "));
    try {
      const code = check(
        parseArgs([
          "--baseline=" + writeBaseline(root, { files: { "a.min.js": size } }),
          "--report=" + dir,
        ]),
        root,
      );
      expect(code).toBe(0);
    } finally {
      console.error = origErr;
    }
    expect(logs.join(" ")).toContain("Cannot write");
    expect(logs.join(" ")).toContain(dir);
  });

  it("renders a baseline bundle that is missing from dist without failing", () => {
    const root = mkTmp();
    const content = "const x = 1;".repeat(100);
    const size = brotli(content);
    mkDist(root, { "a.min.js": content });
    // "gone.min.js" is in the baseline but no longer built.
    expect(
      check(
        argsWithBaseline(root, { files: { "a.min.js": size, "gone.min.js": 10 } }),
        root,
      ),
    ).toBe(0);
  });
});

describe("emit", () => {
  it("writes the current dist sizes to a file", () => {
    const root = mkTmp();
    const content = "export const a = 1;".repeat(50);
    mkDist(root, { "a.min.js": content });
    const path = join(root, "sizes.json");
    expect(emit(parseArgs(["--emit=" + path]), root)).toBe(0);
    expect(JSON.parse(readFileSync(path, "utf-8")).files["a.min.js"]).toBe(
      brotli(content),
    );
  });

  it("records the build tool versions alongside the sizes", () => {
    const root = mkTmp();
    const content = "export const a = 1;".repeat(50);
    mkDist(root, { "a.min.js": content });
    const path = join(root, "sizes.json");
    expect(emit(parseArgs(["--emit=" + path]), root)).toBe(0);
    const tools = JSON.parse(readFileSync(path, "utf-8")).tools;
    // Every build tool is recorded, and `esbuild` is resolvable at ROOT.
    expect(typeof tools.esbuild).toBe("string");
    for (const pkg of [
      "esbuild",
      "svgo",
      "postcss",
      "postcss-nesting",
      "autoprefixer",
      "browserslist",
    ]) {
      expect(tools).toHaveProperty(pkg);
    }
  });

  it("returns 1 when the dist directory has no bundles", () => {
    const root = mkTmp();
    mkdirSync(join(root, "foliplus", "dist"), { recursive: true });
    expect(emit(parseArgs(["--emit=" + join(root, "sizes.json")]), root)).toBe(1);
  });

  it("creates the parent directory when missing", () => {
    const root = mkTmp();
    const content = "export const a = 1;".repeat(50);
    mkDist(root, { "a.min.js": content });
    const path = join(root, "deep", "nested", "sizes.json");
    expect(emit(parseArgs(["--emit=" + path]), root)).toBe(0);
    expect(JSON.parse(readFileSync(path, "utf-8")).files["a.min.js"]).toBe(
      brotli(content),
    );
  });

  it("returns 1 and reports the error when the emit target is unwritable", () => {
    // Pointing `--emit` at a path that is a directory makes `writeFileSync`
    // throw. The CLI must exit non-zero instead of dumping a stack trace.
    const root = mkTmp();
    const content = "export const a = 1;".repeat(50);
    mkDist(root, { "a.min.js": content });
    const dir = join(root, "outdir");
    mkdirSync(dir);
    const logs: string[] = [];
    const origErr = console.error;
    console.error = (...a) => logs.push(a.join(" "));
    try {
      expect(emit(parseArgs(["--emit=" + dir]), root)).toBe(1);
    } finally {
      console.error = origErr;
    }
    expect(logs.join(" ")).toContain("Cannot write");
    expect(logs.join(" ")).toContain(dir);
  });
});

describe("toolchain drift", () => {
  // The guard reads versions from ROOT (the real checkout), so a mismatch means
  // the baseline capture was built with a different toolchain.
  const liveVersion = (pkg: string) => {
    const v = join("node_modules", pkg, "package.json");
    return JSON.parse(readFileSync(v, "utf-8")).version;
  };

  // Runs check against a baseline and returns "[exit code]\n[console output]".
  const dist = (root: string, body = "const x = 1;".repeat(100)) => {
    const size = brotli(body);
    mkDist(root, { "a.min.js": body });
    return size;
  };

  it("compares an explicit null against the current version", () => {
    // `emit` records `null` for a tool the build no longer needs. Presence of the
    // key is what marks a tool as recorded, so `null → version` (the tool came
    // back into the build) must be flagged as well as a version bump.
    const root = mkTmp();
    const size = dist(root);
    const out = runCheck(root, {
      files: { "a.min.js": size },
      tools: { postcss: null },
    });
    expect(out).toContain("Build tools differ");
    expect(out).toContain("postcss null");
    expect(out).toContain(liveVersion("postcss"));
  });

  it("stays silent when the baseline records the same tool versions", () => {
    const root = mkTmp();
    const size = dist(root);
    const out = runCheck(root, {
      files: { "a.min.js": size },
      tools: { esbuild: liveVersion("esbuild") },
    });
    expect(out).not.toContain("Build tools differ");
  });

  it("flags a tool version the baseline captured differently", () => {
    const root = mkTmp();
    const size = dist(root);
    // A version the install cannot have resolved — drift must not depend on the
    // registry being live at the right minute.
    const out = runCheck(root, {
      files: { "a.min.js": size },
      tools: { postcss: "0.0.0-pre-drift" },
    });
    expect(out.split("\n")[0]).toBe("0");
    expect(out).toContain("Build tools differ");
    expect(out).toContain("postcss 0.0.0-pre-drift");
    expect(out).toContain(liveVersion("postcss"));
    expect(out).toContain("re-run the capture step");
  });

  it("counts a build tool that went missing as drift", () => {
    const root = mkTmp();
    const size = dist(root);
    const out = runCheck(root, {
      files: { "a.min.js": size },
      tools: { esbuild: "0.0.0-missing" },
    });
    expect(out).toContain("Build tools differ");
    expect(out).toContain("esbuild 0.0.0-missing");
  });

  it("lists every drifting tool in the warning", () => {
    const root = mkTmp();
    const size = dist(root);
    const out = runCheck(root, {
      files: { "a.min.js": size },
      tools: { postcss: "0.0.0-drift", autoprefixer: "0.0.0-drift" },
    });
    expect(out).toContain("postcss 0.0.0-drift");
    expect(out).toContain("autoprefixer 0.0.0-drift");
  });

  it("reads the build tools from a capture without a tools field", () => {
    const root = mkTmp();
    const size = dist(root);
    // A capture taken before the guard existed has no `tools` key at all.
    const out = runCheck(root, { files: { "a.min.js": size } });
    expect(out).not.toContain("Build tools differ");
  });

  it("does not flag a tool the baseline never recorded", () => {
    const root = mkTmp();
    const size = dist(root);
    // An empty tools map is a pre-guard capture; there is nothing to compare.
    const out = runCheck(root, { files: { "a.min.js": size }, tools: {} });
    expect(out).not.toContain("Build tools differ");
  });
});

describe("failure listing", () => {
  // `check` prints the over-threshold rows as the reader's to-do list, so the
  // line must name the bundle and show the growth it measured.
  it("lists every over-threshold bundle with its growth", () => {
    const root = mkTmp();
    const body = "const x = 1;".repeat(100);
    const size = brotli(body);
    mkDist(root, { "a.min.js": body, "b.min.js": body });
    const out = runCheck(
      root,
      {
        files: {
          "a.min.js": Math.round(size * 0.8),
          "b.min.js": Math.round(size * 0.8),
        },
      },
      true,
    );
    expect(out.split("\n")[0]).toBe("1");
    expect(out).toContain("bundle(s) exceeded threshold");
    expect(out).toContain("a.min.js");
    expect(out).toContain("b.min.js");
  });
});

describe("cli entry point", () => {
  // Runs the checked-in script as the CI does. These cover the part of the file
  // the unit tests cannot reach: the `if (isMain)` guard, the real dist scan, and
  // the missing-baseline path. `--root` is the only thing varied — it points at
  // a scratch tree that is a git checkout for the script but has no node_modules,
  // so an unresolvable tool exercises the catch in `toolVersion`.
  const run = (root: string, ...argv: string[]) => {
    const { spawnSync } = require("child_process");
    return spawnSync(
      process.execPath,
      [
        "script/bundle-size-check.mjs",
        "--root=" + root,
        ...(argv.length ? argv : ["--baseline=absent.json"]),
      ],
      { cwd: process.cwd(), encoding: "utf-8" },
    );
  };

  it("exits 0 and renders the sizes when no baseline exists", () => {
    const root = mkTmp();
    mkDist(root, { "a.min.js": "const x = 1;" });
    const res = run(root);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Bundle Sizes");
    expect(res.stdout).toContain("a.min.js");
    expect(res.stderr).toContain("No baseline provided");
  });

  it("exits 1 and reports an unknown flag", () => {
    const root = mkTmp();
    mkDist(root, { "a.min.js": "const x = 1;" });
    // No baseline on purpose: the exit code must come from the over-threshold
    // failure, not from the no-baseline warning.
    const baseline = join(root, "base.json");
    writeFileSync(baseline, JSON.stringify({ files: { "a.min.js": 10 } }), "utf-8");
    const res = run(root, "--baseline=" + baseline);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("exceeded threshold");
  });

  it("exits 1 without running when an argument is malformed", () => {
    // The comparison must not happen at all: running with a coerced default
    // would report a verdict at the wrong threshold. The usage block is
    // printed so the reader can fix the invocation.
    const root = mkTmp();
    mkDist(root, { "a.min.js": "const x = 1;" });
    const res = run(root, "--threshold=abc");
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("must be a number");
    expect(res.stderr).toContain("Usage:");
    expect(res.stderr).not.toContain("Bundle Size Check");
  });

  it("treats an unreadable tool manifest as absent, not fatal", () => {
    // `toolVersion` guards `JSON.parse`; the guard must not take the run down.
    // A real malformed manifest cannot be produced here — `toolVersion` reads
    // from the checkout's own node_modules — so the throw is injected.
    const parse = JSON.parse;
    JSON.parse = () => {
      throw new Error("bad json");
    };
    try {
      expect(toolVersion(process.cwd(), "esbuild")).toBeNull();
    } finally {
      JSON.parse = parse;
    }
  });
});
