import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  computePatch,
  isJsFile,
  isPythonFile,
  main,
  parseAddedLines,
  parseArgs,
  parseCobertura,
  parseIstanbul,
  parseLcov,
  runCli,
  toRel,
} from "#script/check/patch-coverage.mjs";

// Local patch-coverage mirror — replicate codecov's `patch` check before the
// push, so a branch never lands on CI with uncovered added lines (root cause
// of #1181 / #1193). The pure parsers/computers are unit-tested with synthetic
// inputs; the CLI entry is exercised against a real throwaway git repo.

// A fake repo root that round-trips through toRel on every platform. A
// hard-coded Windows path ("C:/repo") would make path.resolve treat it as a
// relative path on POSIX, so toRel would stop stripping the prefix and the
// coverage keys would stop matching the diff's repo-relative paths — a
// CI-only failure (Windows local, POSIX CI).
const REPO = resolve("/repo");

type StatementRange = {
  start: { line: number; column: number };
  end: { line: number; column: number };
};
type CoverageEntry = {
  statementMap: Record<string, StatementRange>;
  s: Record<string, number>;
  branchMap: Record<string, { line: number; locations: unknown[] }>;
  b: Record<string, number[]>;
};
type PatchFile = {
  file: string;
  status?: "no-coverage";
  covered: number;
  uncovered: number;
  missing: number[];
  partials: { line: number; untaken: number; total: number }[];
};
type PatchResult = {
  files: PatchFile[];
  covered: number;
  uncovered: number;
  total: number;
  pct: number;
  missing: { file: string; lines: number[] }[];
};
const stmt = (startLine: number, endLine = startLine) => ({
  start: { line: startLine, column: 0 },
  end: { line: endLine, column: 0 },
});
const entry = (
  statements: CoverageEntry["statementMap"],
  s: Record<string, number>,
  branchMap: CoverageEntry["branchMap"] = {},
  b: Record<string, number[]> = {},
): CoverageEntry => ({ statementMap: statements, s, branchMap, b });

describe("parseAddedLines", () => {
  it("records added line numbers from a modified-file hunk", () => {
    const diff = [
      "diff --git a/foliplus/js/x.ts b/foliplus/js/x.ts",
      "--- a/foliplus/js/x.ts",
      "+++ b/foliplus/js/x.ts",
      "@@ -1,1 +1,2 @@",
      "-line2",
      "+line2b",
      "+line2c",
    ].join("\n");
    const got = parseAddedLines(diff);
    expect([...got.keys()]).toEqual(["foliplus/js/x.ts"]);
    expect([...got.get("foliplus/js/x.ts")].sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it("records added lines for a brand-new file", () => {
    const diff = [
      "diff --git a/foliplus/js/new.ts b/foliplus/js/new.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/foliplus/js/new.ts",
      "@@ -0,0 +1,3 @@",
      "+a",
      "+b",
      "+c",
    ].join("\n");
    const got = parseAddedLines(diff);
    expect([...got.get("foliplus/js/new.ts")].sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it("keeps a per-file set when a second hunk re-opens the same file", () => {
    // The `perFile.has(file)` true side: two hunks for one file share a set.
    const diff = [
      "diff --git a/foliplus/js/x.ts b/foliplus/js/x.ts",
      "--- a/foliplus/js/x.ts",
      "+++ b/foliplus/js/x.ts",
      "@@ -1,1 +1,2 @@",
      "+a",
      "+b",
      "@@ -10,1 +10,2 @@",
      "+c",
    ].join("\n");
    const got = parseAddedLines(diff);
    expect([...got.get("foliplus/js/x.ts")].sort((a, b) => a - b)).toEqual([1, 2, 10]);
  });

  it("reuses the set when a file header repeats for the same file", () => {
    // The `perFile.has(file)` true side (line 66): a second `+++ b/` header for
    // the same file reuses the existing set instead of resetting it.
    const diff = [
      "diff --git a/foliplus/js/x.ts b/foliplus/js/x.ts",
      "--- a/foliplus/js/x.ts",
      "+++ b/foliplus/js/x.ts",
      "@@ -1,1 +1,2 @@",
      "+a",
      "diff --git a/foliplus/js/x.ts b/foliplus/js/x.ts",
      "--- a/foliplus/js/x.ts",
      "+++ b/foliplus/js/x.ts",
      "@@ -5,1 +5,2 @@",
      "+b",
    ].join("\n");
    const got = parseAddedLines(diff);
    expect([...got.get("foliplus/js/x.ts")].sort((a, b) => a - b)).toEqual([1, 5]);
  });

  it("drops a file whose only change is a deletion", () => {
    const diff = [
      "diff --git a/foliplus/js/x.ts b/foliplus/js/x.ts",
      "--- a/foliplus/js/x.ts",
      "+++ b/foliplus/js/x.ts",
      "@@ -1,2 +1,0 @@",
      "-a",
      "-b",
    ].join("\n");
    expect(parseAddedLines(diff).size).toBe(0);
  });

  it("deletes a file whose added set is emptied", () => {
    // A file that gains no `+` lines (pure deletion hunk) leaves an empty set,
    // which the size===0 cleanup removes entirely.
    const diff = [
      "diff --git a/foliplus/js/x.ts b/foliplus/js/x.ts",
      "--- a/foliplus/js/x.ts",
      "+++ b/foliplus/js/x.ts",
      "@@ -1,1 +1,0 @@",
      "-old",
    ].join("\n");
    const got = parseAddedLines(diff);
    expect(got.size).toBe(0);
  });

  it("advances the cursor across context lines", () => {
    const diff = [
      "diff --git a/foliplus/js/x.ts b/foliplus/js/x.ts",
      "--- a/foliplus/js/x.ts",
      "+++ b/foliplus/js/x.ts",
      "@@ -2,3 +2,3 @@",
      " context",
      "+added",
      " context2",
    ].join("\n");
    const got = parseAddedLines(diff);
    // context(2) then added(3): cursor starts at +2, context advances to 3, + is 3.
    expect([...got.get("foliplus/js/x.ts")]).toEqual([3]);
  });

  it("ignores a hunk without a valid new-line start", () => {
    // A @@ header with no `+N` new-file offset must not advance the cursor, so
    // a following + line is not recorded against a line number.
    const diff = [
      "diff --git a/foliplus/js/x.ts b/foliplus/js/x.ts",
      "--- a/foliplus/js/x.ts",
      "+++ b/foliplus/js/x.ts",
      "@@ malformed header without offset",
      "+orphan",
    ].join("\n");
    expect([...(parseAddedLines(diff).get("foliplus/js/x.ts") ?? [])]).toEqual([]);
  });

  it("does not record an added line before a file header", () => {
    // A + line before any +++ b/ header is not tied to a file and is dropped.
    const diff = ["+orphan", "diff --git a/foliplus/js/x.ts b/foliplus/js/x.ts"].join(
      "\n",
    );
    expect(parseAddedLines(diff).size).toBe(0);
  });
});

describe("toRel", () => {
  it("returns the path unchanged when it is outside the cwd", () => {
    // The other toRel side: a path not under cwd passes through untouched.
    expect(toRel("other/rel.ts", REPO)).toBe("other/rel.ts");
  });

  it("normalizes backslashes and strips the cwd prefix", () => {
    const r = toRel(join(REPO, "foliplus/js/x.ts"), REPO);
    expect(r).toBe("foliplus/js/x.ts");
    expect(r.includes("\\")).toBe(false);
  });

  it("returns an absolute path outside the cwd unchanged", () => {
    // A path outside cwd takes the `p.startsWith(normCwd + "/")` false side
    // and passes through untouched on every host.
    const r = toRel("/outside/repo/other.ts", REPO);
    expect(r.startsWith("outside/repo/other.ts")).toBe(false);
    expect(r.endsWith("other.ts")).toBe(true);
  });
});

describe("scope classification (Python vs JS vs other)", () => {
  it("classifies a foliplus .py source as Python (excluded)", () => {
    expect(isPythonFile("foliplus/control/LayerControl.py")).toBe(true);
    expect(isJsFile("foliplus/control/LayerControl.py")).toBe(false);
  });

  it("classifies a test/python file as Python (excluded)", () => {
    expect(isPythonFile("test/python/test_layer_control.py")).toBe(true);
    expect(isJsFile("test/python/test_layer_control.py")).toBe(false);
  });

  it("classifies a script .py as Python (excluded)", () => {
    expect(isPythonFile("script/check/foo.py")).toBe(true);
    expect(isJsFile("script/check/foo.py")).toBe(false);
  });

  it("classifies a .ts source as JS (counted)", () => {
    expect(isJsFile("foliplus/js/core/layer/role.ts")).toBe(true);
    expect(isPythonFile("foliplus/js/core/layer/role.ts")).toBe(false);
  });

  it("classifies a test .ts as JS (counted)", () => {
    expect(isJsFile("test/js/script/check/patch-coverage.test.ts")).toBe(true);
    expect(isPythonFile("test/js/script/check/patch-coverage.test.ts")).toBe(false);
  });

  it("classifies a non-JS non-Python file as neither (excluded)", () => {
    const rel = "CHANGELOG.md";
    expect(isJsFile(rel)).toBe(false);
    expect(isPythonFile(rel)).toBe(false);
  });

  it("classifies a .mjs build script as JS (counted)", () => {
    expect(isJsFile("script/build/build.mjs")).toBe(true);
    expect(isPythonFile("script/build/build.mjs")).toBe(false);
  });
});

describe("parseIstanbul", () => {
  it("marks statement lines covered or not by execution count", () => {
    const covByRel = parseIstanbul(
      {
        [join(REPO, "foliplus/js/x.ts")]: entry(
          { "0": stmt(1), "1": stmt(2, 3) },
          { "0": 1, "1": 0 },
        ),
      },
      REPO,
    );
    const lc = covByRel.get("foliplus/js/x.ts").lines;
    expect(lc.get(1)).toBe("covered");
    expect(lc.get(2)).toBe("uncovered");
    expect(lc.get(3)).toBe("uncovered");
    expect(lc.get(4)).toBeUndefined();
  });

  it("keeps a covered statement on an already-uncovered line (covered wins)", () => {
    // The `lines.set(l, "covered")` override: a later covered statement on a
    // line already marked uncovered flips it to covered.
    const covByRel = parseIstanbul(
      {
        [join(REPO, "foliplus/js/x.ts")]: entry(
          { "0": stmt(6), "1": stmt(6) },
          { "0": 0, "1": 1 },
        ),
      },
      REPO,
    );
    expect(covByRel.get("foliplus/js/x.ts").lines.get(6)).toBe("covered");
  });

  it("falls back to 0 when a statement has no count entry", () => {
    // `entry.s[id] ?? 0` nullish side: a statement missing from s is treated
    // as uncovered, not thrown on.
    const covByRel = parseIstanbul(
      {
        [join(REPO, "foliplus/js/x.ts")]: entry({ "0": stmt(7) }, {}),
      },
      REPO,
    );
    expect(covByRel.get("foliplus/js/x.ts").lines.get(7)).toBe("uncovered");
  });

  it("falls back to an empty count array when a branch has no b entry", () => {
    // `entry.b[id] ?? []` nullish side: a branchMap id with no b entry is not
    // a partial (no untaken targets), it is simply skipped.
    const covByRel = parseIstanbul(
      {
        [join(REPO, "foliplus/js/x.ts")]: {
          statementMap: { "0": stmt(8) },
          s: { "0": 1 },
          branchMap: {
            "0": { line: 8, locations: [{}, {}] },
          },
          b: {},
        },
      },
      REPO,
    );
    expect(covByRel.get("foliplus/js/x.ts").partials).toEqual([]);
  });

  it("lets a covered statement win over an uncovered one on the same line", () => {
    const covByRel = parseIstanbul(
      {
        [join(REPO, "foliplus/js/x.ts")]: entry(
          { "0": stmt(1), "1": stmt(1) },
          { "0": 1, "1": 0 },
        ),
      },
      REPO,
    );
    expect(covByRel.get("foliplus/js/x.ts").lines.get(1)).toBe("covered");
  });

  it("leaves an uncovered statement as uncovered when covered is false", () => {
    // The `else if (!lines.has(l))` true side: the first statement at a line is
    // uncovered and nothing later covers it.
    const covByRel = parseIstanbul(
      {
        [join(REPO, "foliplus/js/x.ts")]: entry({ "0": stmt(4) }, { "0": 0 }),
      },
      REPO,
    );
    expect(covByRel.get("foliplus/js/x.ts").lines.get(4)).toBe("uncovered");
  });

  it("reports an untaken branch at its line", () => {
    const covByRel = parseIstanbul(
      {
        [join(REPO, "foliplus/js/x.ts")]: entry(
          { "0": stmt(5) },
          { "0": 1 },
          { "0": { line: 5, locations: [{}, {}] } },
          { "0": [1, 0] },
        ),
      },
      REPO,
    );
    expect(covByRel.get("foliplus/js/x.ts").partials).toEqual([
      { line: 5, untaken: 1, total: 2 },
    ]);
  });

  it("reads a branch line from br.loc when br.line is absent", () => {
    const covByRel = parseIstanbul(
      {
        [join(REPO, "foliplus/js/x.ts")]: {
          statementMap: { "0": stmt(7) },
          s: { "0": 1 },
          branchMap: {
            "0": { line: undefined, locations: [{}, {}], loc: { start: { line: 7 } } },
          },
          b: { "0": [0, 1] },
        },
      },
      REPO,
    );
    expect(covByRel.get("foliplus/js/x.ts").partials).toEqual([
      { line: 7, untaken: 1, total: 2 },
    ]);
  });

  it("ignores a branch whose counts are all taken", () => {
    const covByRel = parseIstanbul(
      {
        [join(REPO, "foliplus/js/x.ts")]: entry(
          { "0": stmt(8) },
          { "0": 1 },
          { "0": { line: 8, locations: [{}, {}] } },
          { "0": [1, 1] },
        ),
      },
      REPO,
    );
    expect(covByRel.get("foliplus/js/x.ts").partials).toEqual([]);
  });
});

describe("parseIstanbul", () => {
  it("drops a branch with no line reference entirely", () => {
    // Neither br.line nor br.loc.start.line is present -> no partial recorded
    // (the `line != null` false side).
    const covByRel = parseIstanbul(
      {
        [join(REPO, "foliplus/js/x.ts")]: {
          statementMap: { "0": stmt(9) },
          s: { "0": 1 },
          branchMap: {
            "0": {
              line: undefined,
              locations: [{}, {}],
              loc: { start: { line: undefined } },
            },
          },
          b: { "0": [0, 1] },
        },
      },
      REPO,
    );
    expect(covByRel.get("foliplus/js/x.ts").partials).toEqual([]);
  });
});

describe("parseLcov", () => {
  it("reads line hit counts and branch partials", () => {
    const lcov = [
      `SF:${join(REPO, "foliplus/js/x.ts")}`,
      "DA:1,1",
      "DA:2,0",
      "BRDA:2,0,0,0",
      "BRDA:2,0,1,1",
      "end_of_record",
    ].join("\n");
    const covByRel = parseLcov(lcov, REPO);
    const fc = covByRel.get("foliplus/js/x.ts");
    expect(fc.lines.get(1)).toBe("covered");
    expect(fc.lines.get(2)).toBe("uncovered");
    expect(fc.partials).toEqual([{ line: 2, untaken: 1, total: 2 }]);
  });

  it("leaves a later DA on the same line uncovered when it is already covered", () => {
    // The `else if (!lines.has(ln))` false side: a second DA for a line that
    // is already covered does not flip it to uncovered.
    const lcov = [
      `SF:${join(REPO, "foliplus/js/x.ts")}`,
      "DA:1,1",
      "DA:1,0",
      "end_of_record",
    ].join("\n");
    const covByRel = parseLcov(lcov, REPO);
    expect(covByRel.get("foliplus/js/x.ts").lines.get(1)).toBe("covered");
  });

  it("treats a '-' branch count as untaken-agnostic (no partial)", () => {
    const lcov = [
      `SF:${join(REPO, "foliplus/js/x.ts")}`,
      "DA:1,1",
      "BRDA:1,0,0,-",
      "BRDA:1,0,1,1",
      "end_of_record",
    ].join("\n");
    const covByRel = parseLcov(lcov, REPO);
    // '-' (no info) is not an untaken target, so there is no partial.
    expect(covByRel.get("foliplus/js/x.ts").partials).toEqual([]);
  });
});

describe("parseLcov", () => {
  it("aggregates multiple branch targets on the same line", () => {
    // Two BRDA records on line 2, one untaken each -> a single partial with
    // untaken 2 of total 2 (the `agg` accumulation side).
    const lcov = [
      `SF:${join(REPO, "foliplus/js/x.ts")}`,
      "DA:1,1",
      "BRDA:2,0,0,0",
      "BRDA:2,0,1,0",
      "end_of_record",
    ].join("\n");
    const covByRel = parseLcov(lcov, REPO);
    expect(covByRel.get("foliplus/js/x.ts").partials).toEqual([
      { line: 2, untaken: 2, total: 2 },
    ]);
  });

  it("skips a DA record whose line number is not finite", () => {
    // A malformed DA:xx line must not throw or record a line.
    const lcov = [
      `SF:${join(REPO, "foliplus/js/x.ts")}`,
      "DA:xx,1",
      "DA:1,1",
      "end_of_record",
    ].join("\n");
    const covByRel = parseLcov(lcov, REPO);
    expect(covByRel.get("foliplus/js/x.ts").lines.get(1)).toBe("covered");
  });

  it("skips a BRDA record whose line number is not finite", () => {
    const lcov = [
      `SF:${join(REPO, "foliplus/js/x.ts")}`,
      "DA:1,1",
      "BRDA:yy,0,0,0",
      "end_of_record",
    ].join("\n");
    const covByRel = parseLcov(lcov, REPO);
    expect(covByRel.get("foliplus/js/x.ts").partials).toEqual([]);
  });
});

describe("parseLcov", () => {
  it("flushes a trailing file record without end_of_record", () => {
    // lcov may omit the final end_of_record; parseLcov must flush on EOF.
    const lcov = [
      `SF:${join(REPO, "foliplus/js/x.ts")}`,
      "DA:1,1",
      "DA:2,0",
      "BRDA:2,0,0,0",
      "BRDA:2,0,1,1",
    ].join("\n");
    const covByRel = parseLcov(lcov, REPO);
    const fc = covByRel.get("foliplus/js/x.ts");
    expect(fc.lines.get(1)).toBe("covered");
    expect(fc.lines.get(2)).toBe("uncovered");
    expect(fc.partials).toEqual([{ line: 2, untaken: 1, total: 2 }]);
  });

  it("ignores a record line that is neither SF, DA, BRDA nor end_of_record", () => {
    // The `else if (line === "end_of_record")` false side (line 181): a
    // record such as TN: or a blank line is not treated as a terminator.
    const lcov = [
      `SF:${join(REPO, "foliplus/js/x.ts")}`,
      "TN:test-name",
      "DA:1,1",
      "end_of_record",
    ].join("\n");
    const covByRel = parseLcov(lcov, REPO);
    const fc = covByRel.get("foliplus/js/x.ts");
    expect(fc.lines.get(1)).toBe("covered");
    expect(fc.partials).toEqual([]);
  });

  it("does not record a partial at EOF when every branch is taken", () => {
    // The `if (agg.untaken > 0)` false side in the EOF flush (line 192): a
    // trailing record whose branches are all taken yields no partial.
    const lcov = [
      `SF:${join(REPO, "foliplus/js/x.ts")}`,
      "DA:1,1",
      "BRDA:1,0,0,1",
      "BRDA:1,0,1,1",
    ].join("\n");
    const covByRel = parseLcov(lcov, REPO);
    const fc = covByRel.get("foliplus/js/x.ts");
    expect(fc.partials).toEqual([]);
  });
});

describe("parseCobertura", () => {
  const xmlFor = (root: string, filename: string, lineHits: Record<string, number>) => {
    const lines = Object.entries(lineHits)
      .map(([n, h]) => `      <line number="${n}" hits="${h}"/>`)
      .join("\n");
    return [
      `<?xml version="1.0" ?>`,
      "<coverage>",
      "<sources>",
      `<source>${root.replace(/\\/g, "/")}</source>`,
      "</sources>",
      '<package name=".">',
      "<classes>",
      `<class name="${filename}" filename="${filename}">`,
      "<lines>",
      lines,
      "</lines>",
      "</class>",
      "</classes>",
      "</package>",
      "</coverage>",
    ].join("\n");
  };

  it("maps a Cobertura class to a repo-relative path and records line hits", () => {
    const xml = xmlFor(REPO, "foliplus/control/LayerControl/_folder.py", {
      "1": 1,
      "2": 0,
    });
    const covByRel = parseCobertura(xml, REPO);
    const fc = covByRel.get("foliplus/control/LayerControl/_folder.py");
    expect(fc).toBeDefined();
    expect(fc.lines.get(1)).toBe("covered");
    expect(fc.lines.get(2)).toBe("uncovered");
  });

  it("resolves a relative filename against the first source that exists on disk", () => {
    const xml = [
      '<?xml version="1.0" ?>',
      "<coverage>",
      "<sources>",
      `<source>${REPO}/foliplus</source>`,
      `<source>${REPO}/script</source>`,
      "</sources>",
      '<package name=".">',
      "<classes>",
      '<class name="changelog_check.py" filename="check/changelog_check.py">',
      "<lines>",
      '<line number="1" hits="1"/>',
      "</lines>",
      "</class>",
      "</classes>",
      "</package>",
      "</coverage>",
    ].join("\n");
    const covByRel = parseCobertura(xml, REPO, p => p.includes("script"));
    const fc = covByRel.get("script/check/changelog_check.py");
    expect(fc).toBeDefined();
    expect(fc.lines.get(1)).toBe("covered");
  });

  it("falls back to the first source join when no source resolves on disk", () => {
    const xml = xmlFor(REPO, "src.py", { "1": 1 });
    const covByRel = parseCobertura(xml, REPO, () => false);
    const fc = covByRel.get("src.py");
    expect(fc).toBeDefined();
    expect(fc.lines.get(1)).toBe("covered");
  });

  it("reports a branch partial from condition-coverage", () => {
    const xml = [
      '<?xml version="1.0" ?>',
      "<coverage>",
      "<sources>",
      `<source>${REPO}</source>`,
      "</sources>",
      '<package name=".">',
      "<classes>",
      '<class name="src.py" filename="src.py">',
      "<lines>",
      '<line number="3" hits="1" branch="true" condition-coverage="50% (1/2)"/>',
      "</lines>",
      "</class>",
      "</classes>",
      "</package>",
      "</coverage>",
    ].join("\n");
    const covByRel = parseCobertura(xml, REPO, () => true);
    const fc = covByRel.get("src.py");
    expect(fc.partials).toEqual([{ line: 3, untaken: 1, total: 2 }]);
  });

  it("does not report a partial when the branch is fully taken", () => {
    const xml = [
      '<?xml version="1.0" ?>',
      "<coverage>",
      "<sources>",
      `<source>${REPO}</source>`,
      "</sources>",
      '<package name=".">',
      "<classes>",
      '<class name="src.py" filename="src.py">',
      "<lines>",
      '<line number="4" hits="1" branch="true" condition-coverage="100% (2/2)"/>',
      "</lines>",
      "</class>",
      "</classes>",
      "</package>",
      "</coverage>",
    ].join("\n");
    const covByRel = parseCobertura(xml, REPO, () => true);
    expect(covByRel.get("src.py").partials).toEqual([]);
  });

  it("resolves a relative filename against the first source that exists on disk", () => {
    const xml = [
      '<?xml version="1.0" ?>',
      "<coverage>",
      "<sources>",
      `<source>${REPO}/foliplus</source>`,
      `<source>${REPO}/script</source>`,
      "</sources>",
      '<package name=".">',
      "<classes>",
      '<class name="changelog_check.py" filename="check/changelog_check.py">',
      "<lines>",
      '<line number="1" hits="1"/>',
      "</lines>",
      "</class>",
      "</classes>",
      "</package>",
      "</coverage>",
    ].join("\n");
    const covByRel = parseCobertura(xml, REPO, p => p.includes("script"));
    const fc = covByRel.get("script/check/changelog_check.py");
    expect(fc).toBeDefined();
    expect(fc.lines.get(1)).toBe("covered");
  });

  it("falls back to the first source join when no source resolves on disk", () => {
    const xml = xmlFor(REPO, "src.py", { "1": 1 });
    const covByRel = parseCobertura(xml, REPO, () => false);
    const fc = covByRel.get("src.py");
    expect(fc).toBeDefined();
    expect(fc.lines.get(1)).toBe("covered");
  });

  it("reports a branch partial from condition-coverage", () => {
    const xml = [
      '<?xml version="1.0" ?>',
      "<coverage>",
      "<sources>",
      `<source>${REPO}</source>`,
      "</sources>",
      '<package name=".">',
      "<classes>",
      '<class name="src.py" filename="src.py">',
      "<lines>",
      '<line number="3" hits="1" branch="true" condition-coverage="50% (1/2)"/>',
      "</lines>",
      "</class>",
      "</classes>",
      "</package>",
      "</coverage>",
    ].join("\n");
    const covByRel = parseCobertura(xml, REPO, () => true);
    const fc = covByRel.get("src.py");
    expect(fc.partials).toEqual([{ line: 3, untaken: 1, total: 2 }]);
  });

  it("does not report a partial when the branch is fully taken", () => {
    const xml = [
      '<?xml version="1.0" ?>',
      "<coverage>",
      "<sources>",
      `<source>${REPO}</source>`,
      "</sources>",
      '<package name=".">',
      "<classes>",
      '<class name="src.py" filename="src.py">',
      "<lines>",
      '<line number="4" hits="1" branch="true" condition-coverage="100% (2/2)"/>',
      "</lines>",
      "</class>",
      "</classes>",
      "</package>",
      "</coverage>",
    ].join("\n");
    const covByRel = parseCobertura(xml, REPO, () => true);
    expect(covByRel.get("src.py").partials).toEqual([]);
  });
  it("ignores a line without a branch attribute (no partial)", () => {
    const xml = [
      '<?xml version="1.0" ?>',
      "<coverage>",
      "<sources>",
      `<source>${REPO}</source>`,
      "</sources>",
      '<package name=".">',
      "<classes>",
      '<class name="src.py" filename="src.py">',
      "<lines>",
      '<line number="5" hits="1"/>',
      "</lines>",
      "</class>",
      "</classes>",
      "</package>",
      "</coverage>",
    ].join("\n");
    const covByRel = parseCobertura(xml, REPO, () => true);
    const fc = covByRel.get("src.py");
    expect(fc.lines.get(5)).toBe("covered");
    expect(fc.partials).toEqual([]);
  });

  it("falls back to the raw filename when there are no sources", () => {
    const xml = [
      '<?xml version="1.0" ?>',
      "<coverage>",
      '<package name=".">',
      "<classes>",
      '<class name="src.py" filename="src.py">',
      "<lines>",
      '<line number="1" hits="1"/>',
      "</lines>",
      "</class>",
      "</classes>",
      "</package>",
      "</coverage>",
    ].join("\n");
    const covByRel = parseCobertura(xml, REPO, () => true);
    // No <sources> block: the defensive fallback keeps the raw filename.
    const fc = covByRel.get("src.py");
    expect(fc).toBeDefined();
    expect(fc.lines.get(1)).toBe("covered");
  });

  it("treats a multi-hit line as covered and a zero-hit line as uncovered", () => {
    const xml = [
      '<?xml version="1.0" ?>',
      "<coverage>",
      "<sources>",
      `<source>${REPO}</source>`,
      "</sources>",
      '<package name=".">',
      "<classes>",
      '<class name="src.py" filename="src.py">',
      "<lines>",
      '<line number="1" hits="3"/>',
      '<line number="2" hits="0"/>',
      "</lines>",
      "</class>",
      "</classes>",
      "</package>",
      "</coverage>",
    ].join("\n");
    const covByRel = parseCobertura(xml, REPO, () => true);
    const fc = covByRel.get("src.py");
    expect(fc.lines.get(1)).toBe("covered");
    expect(fc.lines.get(2)).toBe("uncovered");
  });
});

describe("computePatch", () => {
  const coverage = {
    [join(REPO, "foliplus/js/x.ts")]: entry(
      {
        "0": stmt(1),
        "1": stmt(2),
        "2": stmt(3),
        "3": stmt(4, 5),
      },
      { "0": 1, "1": 0, "2": 1, "3": 0 },
    ),
  };
  const covByRel = parseIstanbul(coverage, REPO);
  it("counts covered/uncovered added executable lines", () => {
    const diffAdded = new Map([["foliplus/js/x.ts", new Set([1, 2, 3])]]);
    const res = computePatch(diffAdded, covByRel) as unknown as PatchResult;
    expect(res.covered).toBe(2);
    expect(res.uncovered).toBe(1);
    expect(res.total).toBe(3);
    expect(res.pct).toBeCloseTo(2 / 3, 5);
    expect(res.missing).toEqual([{ file: "foliplus/js/x.ts", lines: [2] }]);
  });

  it("skips non-executable added lines (no statement)", () => {
    const diffAdded = new Map([["foliplus/js/x.ts", new Set([1, 2, 99])]]);
    const res = computePatch(diffAdded, covByRel) as unknown as PatchResult;
    expect(res.total).toBe(2); // line 99 is not a statement
    expect(res.covered).toBe(1);
  });

  it("reports a changed file missing from the coverage report and skips it", () => {
    const diffAdded = new Map([
      ["foliplus/js/x.ts", new Set([1])],
      ["script/check/other.mjs", new Set([1])],
    ]);
    const res = computePatch(diffAdded, covByRel) as unknown as PatchResult;
    const other = res.files.find(f => f.file === "script/check/other.mjs");
    expect(other?.status).toBe("no-coverage");
    // only the covered file's lines count
    expect(res.total).toBe(1);
  });

  it("filters branch partials to the added lines", () => {
    const withBranch = parseIstanbul(
      {
        [join(REPO, "foliplus/js/x.ts")]: entry(
          { "0": stmt(5) },
          { "0": 1 },
          {
            "0": { line: 5, locations: [{}, {}] },
            "1": { line: 9, locations: [{}, {}] },
          },
          { "0": [1, 0], "1": [1, 0] },
        ),
      },
      REPO,
    );
    const res = computePatch(
      new Map([["foliplus/js/x.ts", new Set([5])]]),
      withBranch,
    ) as unknown as PatchResult;
    expect(res.files[0].partials).toEqual([{ line: 5, untaken: 1, total: 2 }]);
  });
});

describe("computePatch", () => {
  it("reports 100% (pct 1) when there are no added executable lines", () => {
    const res = computePatch(new Map(), new Map()) as unknown as PatchResult;
    expect(res.total).toBe(0);
    expect(res.pct).toBe(1);
    expect(res.files).toEqual([]);
  });
});

describe("parseArgs", () => {
  it("sets help for --help and -h", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
  });

  it("parses the value options", () => {
    const opts = parseArgs([
      "--base=origin/dev",
      "--threshold=0.9",
      "--coverage=coverage/x.json",
      "--cwd=/tmp/repo",
    ]);
    expect(opts.base).toBe("origin/dev");
    expect(opts.threshold).toBe(0.9);
    expect(opts.coverage).toBe("coverage/x.json");
    expect(opts.cwd).toBe("/tmp/repo");
    expect(opts.help).toBe(false);
  });

  it("warns on an unknown arg but keeps going", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const opts = parseArgs(["--base=origin/main", "--bogus"]);
      expect(opts.base).toBe("origin/main");
      expect(err).toHaveBeenCalled();
    } finally {
      err.mockRestore();
    }
  });

  it("uses the default threshold when the parsed value is not finite", () => {
    // `Number.isFinite(opts.threshold)` false side in main: a NaN threshold
    // (e.g. --threshold=abc) falls back to the default.
    const opts = parseArgs(["--threshold=abc"]);
    expect(Number.isFinite(opts.threshold)).toBe(false);
  });
});

describe("printHelp / help path", () => {
  it("main returns 0 and prints help when opts.help is set", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const code = main(parseArgs(["--help"]));
      expect(code).toBe(0);
      expect(log).toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});

describe("main (CLI, real throwaway git repo)", () => {
  const repo = mkdtempSync(join(tmpdir(), "patch-cov-"));
  const git = (args: string[], cwd = repo) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" });
  let baseRef;
  try {
    git(["init", "-q"]);
    git(["config", "user.email", "t@t"]);
    git(["config", "user.name", "t"]);
    writeFileSync(join(repo, "x.ts"), "const a = 1;\n");
    git(["add", "x.ts"]);
    git(["commit", "-q", "-m", "base"]);
    baseRef = git(["rev-parse", "HEAD"]).trim();
    writeFileSync(join(repo, "x.ts"), "const a = 1;\nconst b = 2;\n");
    git(["add", "x.ts"]);
    git(["commit", "-q", "-m", "change"]);
    // coverage: the added line 2 is uncovered
    mkdirSync(join(repo, "coverage"));
    const cov = {
      [join(repo, "x.ts").replace(/\\/g, "/")]: {
        statementMap: {
          "0": { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
          "1": { start: { line: 2, column: 0 }, end: { line: 2, column: 0 } },
        },
        s: { "0": 1, "1": 0 },
        branchMap: {},
        b: {},
      },
    };
    writeFileSync(join(repo, "coverage", "coverage-final.json"), JSON.stringify(cov));
  } catch {
    // git may be unavailable in a bare test env; let the tests skip below.
    baseRef = "";
  }

  it("exits 1 when the patch is below threshold, listing missing lines", () => {
    if (!baseRef) return;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const code = main(
        parseArgs([
          `--cwd=${repo}`,
          `--base=${baseRef}`,
          "--threshold=0.95",
          "--coverage=coverage/coverage-final.json",
        ]),
      );
      expect(code).toBe(1);
      const out = log.mock.calls.map(a => a.join(" ")).join("\n");
      expect(out).toContain("0.0% patch");
      expect(out).toContain("x.ts: uncovered added lines 2");
      expect(out).toContain("FAIL");
    } finally {
      log.mockRestore();
    }
  }, 30000);

  it("exits 0 when the patch meets the threshold", () => {
    if (!baseRef) return;
    const covPath = join(repo, "coverage", "coverage-final.json");
    const cov = JSON.parse(readFileSync(covPath, "utf8"));
    cov[Object.keys(cov)[0]].s["1"] = 1; // cover line 2
    writeFileSync(covPath, JSON.stringify(cov));
    const code = main(
      parseArgs([
        `--cwd=${repo}`,
        `--base=${baseRef}`,
        "--threshold=0.95",
        "--coverage=coverage/coverage-final.json",
      ]),
    );
    expect(code).toBe(0);
  }, 30000);

  it("exits 2 when the coverage report is missing", () => {
    if (!baseRef) return;
    const code = main(
      parseArgs([
        `--cwd=${repo}`,
        `--base=${baseRef}`,
        "--coverage=coverage/nope.json",
      ]),
    );
    expect(code).toBe(2);
  }, 30000);

  it("exits 0 on an empty patch (no diff against base)", () => {
    if (!baseRef) return;
    // HEAD already has the change; diffing HEAD against itself is empty.
    const code = main(
      parseArgs([
        `--cwd=${repo}`,
        "--base=HEAD",
        "--coverage=coverage/coverage-final.json",
      ]),
    );
    expect(code).toBe(0);
  }, 30000);

  it("falls back to lcov.info when coverage-final.json is absent", () => {
    if (!baseRef) return;
    // reset line 2 uncovered, drop the json, write lcov.info instead
    const covPath = join(repo, "coverage", "coverage-final.json");
    const cov = JSON.parse(readFileSync(covPath, "utf8"));
    cov[Object.keys(cov)[0]].s["1"] = 0;
    writeFileSync(covPath, JSON.stringify(cov));
    rmSync(covPath, { force: true });
    const lcov = [
      `SF:${join(repo, "x.ts").replace(/\\/g, "/")}`,
      "DA:1,1",
      "DA:2,0",
      "end_of_record",
    ].join("\n");
    writeFileSync(join(repo, "coverage", "lcov.info"), lcov);
    const code = main(
      parseArgs([
        `--cwd=${repo}`,
        `--base=${baseRef}`,
        "--threshold=0.95",
        "--coverage=coverage/coverage-final.json", // absent -> lcov fallback
      ]),
    );
    expect(code).toBe(1);
  }, 30000);

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });
});

describe("main CLI error paths", () => {
  const repo = mkdtempSync(join(tmpdir(), "patch-cov-err-"));
  const git = (args: string[], cwd = repo) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" });
  let baseRef = "";
  try {
    git(["init", "-q"]);
    git(["config", "user.email", "t@t"]);
    git(["config", "user.name", "t"]);
    writeFileSync(join(repo, "x.ts"), "const a = 1;\n");
    git(["add", "x.ts"]);
    git(["commit", "-q", "-m", "base"]);
    baseRef = git(["rev-parse", "HEAD"]).trim();
  } catch {
    baseRef = "";
  }

  it("prints a no-coverage line and still counts covered files", () => {
    if (!baseRef) return;
    // x.ts is covered; a second changed file has no coverage entry.
    writeFileSync(join(repo, "x.ts"), "const a = 1;\nconst b = 2;\n");
    writeFileSync(join(repo, "other.ts"), "const c = 3;\n");
    git(["add", "-A"]);
    git(["commit", "-q", "-m", "change"]);
    mkdirSync(join(repo, "coverage"));
    const cov = {
      [join(repo, "x.ts").replace(/\\/g, "/")]: {
        statementMap: {
          "0": { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
          "1": { start: { line: 2, column: 0 }, end: { line: 2, column: 0 } },
        },
        s: { "0": 1, "1": 1 },
        branchMap: {},
        b: {},
      },
    };
    writeFileSync(join(repo, "coverage", "coverage-final.json"), JSON.stringify(cov));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const code = main(
        parseArgs([
          `--cwd=${repo}`,
          `--base=${baseRef}`,
          "--threshold=0.95",
          "--coverage=coverage/coverage-final.json",
        ]),
      );
      expect(code).toBe(0);
      const out = log.mock.calls.map(a => a.join(" ")).join("\n");
      expect(out).toContain("other.ts: not in the coverage report");
    } finally {
      log.mockRestore();
    }
  }, 30000);

  it("returns 2 when git diff fails (bad base)", () => {
    if (!baseRef) return;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const code = main(
        parseArgs([
          `--cwd=${repo}`,
          "--base=no-such-ref",
          "--coverage=coverage/coverage-final.json",
        ]),
      );
      expect(code).toBe(2);
      expect(err).toHaveBeenCalled();
    } finally {
      err.mockRestore();
    }
  }, 30000);

  it("defaults to the 95% threshold when the parsed value is not finite", () => {
    if (!baseRef) return;
    // Reset x.ts line 2 uncovered (the no-coverage test above set it covered).
    const covPath = join(repo, "coverage", "coverage-final.json");
    const cov = JSON.parse(readFileSync(covPath, "utf8"));
    const key = Object.keys(cov)[0];
    cov[key].s["1"] = 0;
    writeFileSync(covPath, JSON.stringify(cov));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      // --threshold=abc parses to NaN -> main falls back to DEFAULT_THRESHOLD
      // (0.95), and the still-uncovered added line 2 fails the check.
      const code = main(
        parseArgs([
          `--cwd=${repo}`,
          `--base=${baseRef}`,
          "--threshold=abc",
          "--coverage=coverage/coverage-final.json",
        ]),
      );
      expect(code).toBe(1);
      const out = log.mock.calls.map(a => a.join(" ")).join("\n");
      expect(out).toContain("below 95.0%");
    } finally {
      log.mockRestore();
    }
  }, 30000);

  it("pluralizes the FAIL line when more than one added line is uncovered", () => {
    if (!baseRef) return;
    // Grow x.ts to three lines and commit, so the diff against baseRef adds
    // lines 2 and 3; both are left uncovered -> "2 added lines not covered".
    writeFileSync(join(repo, "x.ts"), "const a = 1;\nconst b = 2;\nconst c = 3;\n");
    git(["add", "-A"]);
    git(["commit", "-q", "-m", "grow to 3 lines"]);
    const covPath = join(repo, "coverage", "coverage-final.json");
    const cov = JSON.parse(readFileSync(covPath, "utf8"));
    const key = Object.keys(cov)[0];
    cov[key].s["1"] = 0; // line 2 uncovered
    cov[key].statementMap["2"] = {
      start: { line: 3, column: 0 },
      end: { line: 3, column: 0 },
    };
    cov[key].s["2"] = 0; // line 3 uncovered
    writeFileSync(covPath, JSON.stringify(cov));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const code = main(
        parseArgs([
          `--cwd=${repo}`,
          `--base=${baseRef}`,
          "--threshold=0.95",
          "--coverage=coverage/coverage-final.json",
        ]),
      );
      expect(code).toBe(1);
      const out = log.mock.calls.map(a => a.join(" ")).join("\n");
      expect(out).toContain("2 added lines not covered");
    } finally {
      log.mockRestore();
    }
    // Restore x.ts to 2 lines (line 2 covered) so later tests in this describe
    // see the original diff (only line 2 added) and pass.
    writeFileSync(join(repo, "x.ts"), "const a = 1;\nconst b = 2;\n");
    git(["add", "-A"]);
    git(["commit", "-q", "-m", "restore to 2 lines"]);
    const covPath2 = join(repo, "coverage", "coverage-final.json");
    const cov2 = JSON.parse(readFileSync(covPath2, "utf8"));
    const key2 = Object.keys(cov2)[0];
    delete cov2[key2].statementMap["2"];
    delete cov2[key2].s["2"];
    cov2[key2].s["1"] = 1;
    writeFileSync(covPath2, JSON.stringify(cov2));
  }, 30000);

  it("prints a branch-partial line when an added line has an untaken target", () => {
    if (!baseRef) return;
    const covPath = join(repo, "coverage", "coverage-final.json");
    const cov = JSON.parse(readFileSync(covPath, "utf8"));
    const key = Object.keys(cov)[0];
    cov[key].branchMap = {
      "0": { line: 2, locations: [{}, {}] },
    };
    cov[key].b = { "0": [1, 0] };
    writeFileSync(covPath, JSON.stringify(cov));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const code = main(
        parseArgs([
          `--cwd=${repo}`,
          `--base=${baseRef}`,
          "--threshold=0.95",
          "--coverage=coverage/coverage-final.json",
        ]),
      );
      expect(code).toBe(0);
      const out = log.mock.calls.map(a => a.join(" ")).join("\n");
      expect(out).toContain("branch partial");
    } finally {
      log.mockRestore();
    }
  }, 30000);

  it("runCli runs main only when entry matches the module URL", () => {
    if (!baseRef) return;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      runCli(
        [`--cwd=${repo}`, "--base=HEAD", "--coverage=coverage/coverage-final.json"],
        resolve("script/check/patch-coverage.mjs"),
        resolve("script/check/patch-coverage.mjs"),
      );
      runCli(
        [`--cwd=${repo}`, "--base=HEAD"],
        "/some/other/entry.mjs",
        resolve("script/check/patch-coverage.mjs"),
      );
      expect(log).toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  }, 30000);

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });
});
describe("scope CLI tests (Python scored, JS counted, mixed)", () => {
  const repo = mkdtempSync(join(tmpdir(), "patch-cov-scope-"));
  const git = (args: string[], cwd = repo) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" });
  let baseRef = "";
  try {
    git(["init", "-q"]);
    git(["config", "user.email", "t@t"]);
    git(["config", "user.name", "t"]);
    writeFileSync(join(repo, "src.ts"), "const a = 1;\n");
    writeFileSync(join(repo, "src.py"), "def f():\n    pass\n");
    git(["add", "-A"]);
    git(["commit", "-q", "-m", "base"]);
    baseRef = git(["rev-parse", "HEAD"]).trim();
  } catch {
    baseRef = "";
  }

  const writeJsCov = (covPath: string, line2Covered: boolean) => {
    const cov = {
      [join(repo, "src.ts").replace(/\\/g, "/")]: {
        statementMap: {
          "0": { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
          "1": { start: { line: 2, column: 0 }, end: { line: 2, column: 0 } },
        },
        s: { "0": 1, "1": line2Covered ? 1 : 0 },
        branchMap: {},
        b: {},
      },
    };
    writeFileSync(covPath, JSON.stringify(cov));
  };

  // A minimal Cobertura XML that reports src.py: line 1 covered, line 2
  // covered/uncovered per the flag (the "return" body line).
  const writePyCov = (covPath: string, line2Covered: boolean) => {
    const xml = [
      '<?xml version="1.0" ?>',
      "<coverage>",
      "<sources>",
      `<source>${join(repo).replace(/\\/g, "/")}</source>`,
      "</sources>",
      '<package name=".">',
      "<classes>",
      '<class name="src.py" filename="src.py">',
      "<lines>",
      '<line number="1" hits="1"/>',
      `<line number="2" hits="${line2Covered ? 1 : 0}"/>`,
      "</lines>",
      "</class>",
      "</classes>",
      "</package>",
      "</coverage>",
    ].join("\n");
    writeFileSync(covPath, xml);
  };

  it("scores a pure Python change against the Cobertura report", () => {
    if (!baseRef) return;
    writeFileSync(join(repo, "src.py"), "def f():\n    return 1\n");
    git(["add", "-A"]);
    git(["commit", "-q", "-m", "python-only-covered"]);
    mkdirSync(join(repo, "coverage"));
    writeFileSync(join(repo, "coverage", "coverage-final.json"), "{}");
    writePyCov(join(repo, "coverage.xml"), true);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const code = main(
        parseArgs([
          `--cwd=${repo}`,
          `--base=${baseRef}`,
          "--threshold=0.95",
          "--coverage=coverage/coverage-final.json",
          "--py-coverage=coverage.xml",
        ]),
      );
      expect(code).toBe(0);
      const out = log.mock.calls.map(a => a.join(" ")).join("\n");
      expect(out).toContain("Python: 100.0% patch");
    } finally {
      log.mockRestore();
    }
  }, 30000);

  it("fails a pure Python change with an uncovered added line", () => {
    if (!baseRef) return;
    writeFileSync(join(repo, "src.py"), "def f():\n    return 2\n");
    git(["add", "-A"]);
    git(["commit", "-q", "-m", "python-only-uncovered"]);
    writePyCov(join(repo, "coverage.xml"), false);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const code = main(
        parseArgs([
          `--cwd=${repo}`,
          `--base=${baseRef}`,
          "--threshold=0.95",
          "--coverage=coverage/coverage-final.json",
          "--py-coverage=coverage.xml",
        ]),
      );
      expect(code).toBe(1);
      const out = log.mock.calls.map(a => a.join(" ")).join("\n");
      expect(out).toContain("Python FAIL");
    } finally {
      log.mockRestore();
    }
  }, 30000);

  it("fails on a mixed change when the JS side is uncovered, listing JS lines", () => {
    if (!baseRef) return;
    writeFileSync(join(repo, "src.py"), "def f():\n    return 2\n");
    writeFileSync(join(repo, "src.ts"), "const a = 1;\nconst b = 2;\n");
    git(["add", "-A"]);
    git(["commit", "-q", "-m", "mixed"]);
    const covPath = join(repo, "coverage", "coverage-final.json");
    writeJsCov(covPath, false);
    writePyCov(join(repo, "coverage.xml"), true);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const code = main(
        parseArgs([
          `--cwd=${repo}`,
          `--base=${baseRef}`,
          "--threshold=0.95",
          "--coverage=coverage/coverage-final.json",
          "--py-coverage=coverage.xml",
        ]),
      );
      expect(code).toBe(1);
      const out = log.mock.calls.map(a => a.join(" ")).join("\n");
      expect(out).toContain("src.ts: uncovered added lines 2");
      expect(out).toContain("JS FAIL");
    } finally {
      log.mockRestore();
    }
  }, 30000);

  it("skips a non-JS non-Python file with the generic message", () => {
    if (!baseRef) return;
    const prevHead = git(["rev-parse", "HEAD"]).trim();
    writeFileSync(join(repo, "README.md"), "# readme\n");
    git(["add", "-A"]);
    git(["commit", "-q", "-m", "readme-only"]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const code = main(
        parseArgs([
          `--cwd=${repo}`,
          `--base=${prevHead}`,
          "--threshold=0.95",
          "--coverage=coverage/coverage-final.json",
        ]),
      );
      expect(code).toBe(0);
      const out = log.mock.calls.map(a => a.join(" ")).join("\n");
      expect(out).toContain(
        "README.md: skipped: not in a coverage report (excluded or non-code)",
      );
    } finally {
      log.mockRestore();
    }
  }, 30000);

  it("returns 2 when the Python coverage report is missing on a Python patch", () => {
    if (!baseRef) return;
    writeFileSync(join(repo, "src.py"), "def f():\n    return 1\n");
    git(["add", "-A"]);
    git(["commit", "-q", "-m", "py-no-report"]);
    rmSync(join(repo, "coverage.xml"), { force: true });
    const code = main(
      parseArgs([
        `--cwd=${repo}`,
        `--base=${baseRef}`,
        "--threshold=0.95",
        "--coverage=coverage/coverage-final.json",
        "--py-coverage=coverage.xml",
      ]),
    );
    expect(code).toBe(2);
  }, 30000);

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });
});
