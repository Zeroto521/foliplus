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
  save,
} from "../../../script/size-check.mjs";

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
  writeFileSync(join(root, "size-baseline.json"), JSON.stringify(data), "utf-8");
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
    expect(a.check).toBe(true);
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
      process.env.GITHUB_STEP_SUMMARY = prev;
    }
    expect(readFileSync(summary, "utf-8")).toContain("Bundle Size Check");
  });
});

describe("save", () => {
  it("writes a baseline from the current dist and returns 0", () => {
    const root = mkTmp();
    const content = "export const a = 1;".repeat(50);
    mkDist(root, { "a.min.js": content });
    expect(save(parseArgs([]), root)).toBe(0);
    const baseline = JSON.parse(
      readFileSync(join(root, "size-baseline.json"), "utf-8"),
    );
    expect(baseline.files["a.min.js"]).toBe(brotli(content));
    expect(baseline.threshold).toBe(10);
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
});
