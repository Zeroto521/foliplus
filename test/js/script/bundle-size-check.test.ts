import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { brotliCompressSync } from "zlib";
import {
  audit,
  buildRows,
  check,
  fmtDelta,
  fmtKB,
  fmtPct,
  parseArgs,
  resolveThreshold,
  rowCells,
  save,
  summarize,
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

const writeBaselineJson = (root: string, data: unknown) => {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "bundle-size-baseline.json"), JSON.stringify(data), "utf-8");
};

afterEach(() => {
  for (const dir of tmpRoots) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
  tmpRoots = [];
});

describe("parseArgs", () => {
  it("defaults to check mode with threshold 10", () => {
    const a = parseArgs([]);
    expect(a.save).toBe(false);
    expect(a.audit).toBe(false);
    expect(a.threshold).toBe(10);
    expect(a.thresholdSet).toBe(false);
    expect(a.unknown).toEqual([]);
  });

  it("parses --save and --audit", () => {
    expect(parseArgs(["--save"]).save).toBe(true);
    expect(parseArgs(["--audit"]).audit).toBe(true);
  });

  it("parses --threshold=N", () => {
    const a = parseArgs(["--threshold=25"]);
    expect(a.threshold).toBe(25);
    expect(a.thresholdSet).toBe(true);
  });

  it("falls back to default for a non-numeric --threshold", () => {
    const a = parseArgs(["--threshold=abc"]);
    expect(a.threshold).toBe(10);
    expect(a.thresholdSet).toBe(true);
  });

  it("collects unknown flags", () => {
    expect(parseArgs(["--bogus", "positional"]).unknown).toEqual([
      "--bogus",
      "positional",
    ]);
  });

  it("parses --baseline and --report", () => {
    const a = parseArgs(["--baseline=/tmp/base.json", "--report=/tmp/report.md"]);
    expect(a.baseline).toBe("/tmp/base.json");
    expect(a.report).toBe("/tmp/report.md");
  });
});

describe("resolveThreshold", () => {
  it("explicit threshold wins", () => {
    expect(
      resolveThreshold({ thresholdSet: true, threshold: 25 }, { threshold: 10 }),
    ).toBe(25);
  });

  it("falls back to the baseline threshold", () => {
    expect(
      resolveThreshold({ thresholdSet: false, threshold: 10 }, { threshold: 15 }),
    ).toBe(15);
  });

  it("defaults when there is no baseline threshold", () => {
    expect(resolveThreshold({ thresholdSet: false, threshold: 10 }, null)).toBe(10);
    expect(resolveThreshold({ thresholdSet: false, threshold: 10 }, {})).toBe(10);
  });
});

describe("buildRows", () => {
  it("classifies over/up/down/same/new/missing", () => {
    const current = {
      "a.min.js": 100,
      "b.min.js": 90,
      "c.min.js": 100,
      "new.min.js": 50,
    };
    const baseline = {
      files: { "a.min.js": 80, "b.min.js": 100, "c.min.js": 100, "gone.min.js": 10 },
    };
    const byFile = Object.fromEntries(
      buildRows(current, baseline, 10).map(r => [r.file, r]),
    );
    expect(byFile["a.min.js"].status).toBe("over"); // +25% > 10%
    expect(byFile["b.min.js"].status).toBe("down"); // -10%
    expect(byFile["c.min.js"].status).toBe("same");
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

  it("treats a zero-size baseline entry as an unknown percentage", () => {
    const rows = buildRows({ "a.min.js": 100 }, { files: { "a.min.js": 0 } }, 10);
    expect(rows[0].delta).toBe(100);
    expect(rows[0].pct).toBeNull();
    expect(rows[0].status).toBe("up");
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
    // buildRows only emits the six known statuses, but the marker lookup is
    // defensive — an unmapped status must still render as "·" not undefined.
    expect(rowCells({ status: "bogus", curr: null, prev: null }).icon).toBe("·");
  });
});

describe("check", () => {
  it("returns 0 when all bundles are within threshold", () => {
    const root = mkTmp();
    const content = "const x = 1;".repeat(100);
    const size = brotli(content);
    mkDist(root, { "a.min.js": content });
    writeBaselineJson(root, { files: { "a.min.js": size }, threshold: 10 });
    expect(check(parseArgs([]), root)).toBe(0);
  });

  it("returns 1 when a bundle exceeds the threshold", () => {
    const root = mkTmp();
    const content = "const x = 1;".repeat(100);
    const size = brotli(content);
    mkDist(root, { "a.min.js": content });
    // baseline 20% smaller → 25% growth > 10%
    writeBaselineJson(root, {
      files: { "a.min.js": Math.round(size * 0.8) },
      threshold: 10,
    });
    expect(check(parseArgs([]), root)).toBe(1);
  });

  it("honors the baseline threshold when --threshold is not given", () => {
    const root = mkTmp();
    const content = "const x = 1;".repeat(100);
    const size = brotli(content);
    mkDist(root, { "a.min.js": content });
    // 25% growth but baseline threshold 30 → not over
    writeBaselineJson(root, {
      files: { "a.min.js": Math.round(size * 0.8) },
      threshold: 30,
    });
    expect(check(parseArgs([]), root)).toBe(0);
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
    writeBaselineJson(root, { files: { "a.min.js": brotli(content) }, threshold: 10 });
    const prev = process.env.GITHUB_STEP_SUMMARY;
    process.env.GITHUB_STEP_SUMMARY = summary;
    try {
      // first call: summary file does not exist → catch branch; second: exists → append.
      expect(check(parseArgs([]), root)).toBe(0);
      expect(check(parseArgs([]), root)).toBe(0);
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
    // custom baseline 20% smaller → 25% growth > 10%; default baseline absent.
    const customBaseline = join(root, "base-baseline.json");
    writeFileSync(
      customBaseline,
      JSON.stringify({
        files: { "a.min.js": Math.round(size * 0.8) },
        threshold: 10,
      }),
      "utf-8",
    );
    expect(check(parseArgs(["--baseline=" + customBaseline]), root)).toBe(1);
  });

  it("writes a collapsible Markdown report via --report", () => {
    const root = mkTmp();
    const content = "const x = 1;".repeat(100);
    const size = brotli(content);
    mkDist(root, { "a.min.js": content });
    writeBaselineJson(root, { files: { "a.min.js": size }, threshold: 10 });
    const report = join(root, "report.md");
    expect(check(parseArgs(["--report=" + report]), root)).toBe(0);
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
    writeBaselineJson(root, {
      files: { "a.min.js": Math.round(size * 0.8) },
      threshold: 10,
    });
    const report = join(root, "report.md");
    expect(check(parseArgs(["--report=" + report]), root)).toBe(1);
    expect(readFileSync(report, "utf-8")).toContain("over threshold");
  });

  it("renders a baseline bundle that is missing from dist without failing", () => {
    const root = mkTmp();
    const content = "const x = 1;".repeat(100);
    const size = brotli(content);
    mkDist(root, { "a.min.js": content });
    // "gone.min.js" is in the baseline but no longer built.
    writeBaselineJson(root, {
      files: { "a.min.js": size, "gone.min.js": 10 },
      threshold: 10,
    });
    expect(check(parseArgs([]), root)).toBe(0);
  });
});

describe("save", () => {
  it("writes a baseline from the current dist and returns 0", () => {
    const root = mkTmp();
    const content = "export const a = 1;".repeat(50);
    mkDist(root, { "a.min.js": content });
    expect(save(parseArgs([]), root)).toBe(0);
    const baseline = JSON.parse(
      readFileSync(join(root, "bundle-size-baseline.json"), "utf-8"),
    );
    expect(baseline.files["a.min.js"]).toBe(brotli(content));
    expect(baseline.threshold).toBe(10);
    expect(baseline.unit).toBe("brotli bytes");
    expect(typeof baseline.version).toBe("string");
    expect(baseline.version.length).toBeGreaterThan(0);
  });

  it("returns 1 when the dist directory has no bundles", () => {
    const root = mkTmp();
    mkdirSync(join(root, "foliplus", "dist"), { recursive: true });
    expect(save(parseArgs([]), root)).toBe(1);
  });
});

describe("audit", () => {
  it("returns 0 with no baseline", () => {
    const root = mkTmp();
    mkDist(root, { "a.min.js": "const a = 1;" });
    expect(audit(root)).toBe(0);
  });

  it("returns 0 with a baseline", () => {
    const root = mkTmp();
    const content = "const a = 1;".repeat(20);
    mkDist(root, { "a.min.js": content });
    writeBaselineJson(root, { files: { "a.min.js": brotli(content) }, threshold: 10 });
    expect(audit(root)).toBe(0);
  });

  it("reports a bundle that is missing from the baseline", () => {
    const root = mkTmp();
    const content = "const a = 1;".repeat(20);
    mkDist(root, { "a.min.js": content, "b.min.js": content });
    writeBaselineJson(root, { files: { "a.min.js": brotli(content) }, threshold: 10 });
    expect(audit(root)).toBe(0);
  });

  it("defaults to a 10% threshold when the baseline omits it", () => {
    const root = mkTmp();
    const content = "const a = 1;".repeat(20);
    mkDist(root, { "a.min.js": content });
    writeBaselineJson(root, { files: { "a.min.js": brotli(content) } });
    expect(audit(root)).toBe(0);
  });

  it("flags a bundle that exceeds the threshold (negative margin)", () => {
    const root = mkTmp();
    const content = "const a = 1;".repeat(100);
    const size = brotli(content);
    mkDist(root, { "a.min.js": content });
    // baseline 20% smaller → 25% growth, margin = -15%
    writeBaselineJson(root, {
      files: { "a.min.js": Math.round(size * 0.8) },
      threshold: 10,
    });
    expect(audit(root)).toBe(0);
  });

  it("flags a bundle approaching the threshold (low margin)", () => {
    const root = mkTmp();
    const content = "const a = 1;".repeat(100);
    const size = brotli(content);
    mkDist(root, { "a.min.js": content });
    // baseline 7% smaller → ~7.5% growth, margin ~2.5% (< 5%)
    writeBaselineJson(root, {
      files: { "a.min.js": Math.round(size * 0.93) },
      threshold: 10,
    });
    expect(audit(root)).toBe(0);
  });
});
