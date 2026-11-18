import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  computePatch,
  main,
  parseAddedLines,
  parseArgs,
  parseIstanbul,
  parseLcov,
} from "#script/check/patch-coverage.mjs";

// Local patch-coverage mirror — replicate codecov's `patch` check before the
// push, so a branch never lands on CI with uncovered added lines (root cause
// of #1181 / #1193). The pure parsers/computers are unit-tested with synthetic
// inputs; the CLI entry is exercised against a real throwaway git repo.

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
});

describe("parseIstanbul", () => {
  it("marks statement lines covered or not by execution count", () => {
    const covByRel = parseIstanbul(
      {
        "C:/repo/foliplus/js/x.ts": entry(
          { "0": stmt(1), "1": stmt(2, 3) },
          { "0": 1, "1": 0 },
        ),
      },
      "C:/repo",
    );
    const lc = covByRel.get("foliplus/js/x.ts").lines;
    expect(lc.get(1)).toBe("covered");
    expect(lc.get(2)).toBe("uncovered");
    expect(lc.get(3)).toBe("uncovered");
    expect(lc.get(4)).toBeUndefined();
  });

  it("lets a covered statement win over an uncovered one on the same line", () => {
    const covByRel = parseIstanbul(
      {
        "C:/repo/foliplus/js/x.ts": entry(
          { "0": stmt(1), "1": stmt(1) },
          { "0": 1, "1": 0 },
        ),
      },
      "C:/repo",
    );
    expect(covByRel.get("foliplus/js/x.ts").lines.get(1)).toBe("covered");
  });

  it("reports an untaken branch at its line", () => {
    const covByRel = parseIstanbul(
      {
        "C:/repo/foliplus/js/x.ts": entry(
          { "0": stmt(5) },
          { "0": 1 },
          { "0": { line: 5, locations: [{}, {}] } },
          { "0": [1, 0] },
        ),
      },
      "C:/repo",
    );
    expect(covByRel.get("foliplus/js/x.ts").partials).toEqual([
      { line: 5, untaken: 1, total: 2 },
    ]);
  });
});

describe("parseLcov", () => {
  it("reads line hit counts and branch partials", () => {
    const lcov = [
      "SF:C:/repo/foliplus/js/x.ts",
      "DA:1,1",
      "DA:2,0",
      "BRDA:2,0,0,0",
      "BRDA:2,0,1,1",
      "end_of_record",
    ].join("\n");
    const covByRel = parseLcov(lcov, "C:/repo");
    const fc = covByRel.get("foliplus/js/x.ts");
    expect(fc.lines.get(1)).toBe("covered");
    expect(fc.lines.get(2)).toBe("uncovered");
    expect(fc.partials).toEqual([{ line: 2, untaken: 1, total: 2 }]);
  });

  it("treats a '-' branch count as untaken-agnostic (no partial)", () => {
    const lcov = [
      "SF:C:/repo/foliplus/js/x.ts",
      "DA:1,1",
      "BRDA:1,0,0,-",
      "BRDA:1,0,1,1",
      "end_of_record",
    ].join("\n");
    const covByRel = parseLcov(lcov, "C:/repo");
    // '-' (no info) is not an untaken target, so there is no partial.
    expect(covByRel.get("foliplus/js/x.ts").partials).toEqual([]);
  });
});

describe("computePatch", () => {
  const coverage = {
    "C:/repo/foliplus/js/x.ts": entry(
      {
        "0": stmt(1),
        "1": stmt(2),
        "2": stmt(3),
        "3": stmt(4, 5),
      },
      { "0": 1, "1": 0, "2": 1, "3": 0 },
    ),
  };
  const covByRel = parseIstanbul(coverage, "C:/repo");
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
        "C:/repo/foliplus/js/x.ts": entry(
          { "0": stmt(5) },
          { "0": 1 },
          {
            "0": { line: 5, locations: [{}, {}] },
            "1": { line: 9, locations: [{}, {}] },
          },
          { "0": [1, 0], "1": [1, 0] },
        ),
      },
      "C:/repo",
    );
    const res = computePatch(
      new Map([["foliplus/js/x.ts", new Set([5])]]),
      withBranch,
    ) as unknown as PatchResult;
    expect(res.files[0].partials).toEqual([{ line: 5, untaken: 1, total: 2 }]);
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
