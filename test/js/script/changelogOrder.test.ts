import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  checkExistence,
  checkOrdering,
  collectLabelUrlWarnings,
  extractLabelNumbers,
  fixFile,
  parseEntries,
  sortLinePairs,
  stableBubbleSortByFirstNum,
} from "#script/changelog-check.mjs";

const REAL_CHANGES = readFileSync("CHANGELOG.md", "utf-8");

// Fixture helpers — minimal CHANGELOG fragments that isolate one rule at
// a time. Blank line between entries keeps parse logic from confusing
// bullet continuations.

function fixture(...lines) {
  return ["# Changelog", "", "## [Unreleased]", "", "### Added", "", ...lines, ""].join(
    "\n",
  );
}

describe("extractLabelNumbers", () => {
  it("returns [] for a line without any labels", () => {
    expect(extractLabelNumbers("- `XControl`: no numbers here")).toEqual([]);
  });

  it("returns labels in document order, not numerically", () => {
    const line =
      "- foo ([#200](x/pull/200), [#100](x/pull/100), [#300](x/pull/300))";
    expect(extractLabelNumbers(line)).toEqual([200, 100, 300]);
  });

  it("ignores URL kind — /tree/ and /issues/ count the same as /pull/", () => {
    const line = "- mixed ([#164](x/tree/164), [#252](x/issues/252), [#425](x/pull/425))";
    expect(extractLabelNumbers(line)).toEqual([164, 252, 425]);
  });
});

describe("checkOrdering — within-line rule", () => {
  it("accepts a strictly-ascending sequence", () => {
    const t = fixture("- a ([#1](x/pull/1), [#2](x/pull/2), [#3](x/pull/3))");
    expect(checkOrdering(parseEntries(t))).toEqual([]);
  });

  it("accepts a repeated number (non-decreasing, not strictly)", () => {
    const t = fixture("- a ([#1](x/pull/1), [#1](x/pull/1), [#2](x/pull/2))");
    expect(checkOrdering(parseEntries(t))).toEqual([]);
  });

  it("flags a descending pair and reports actual vs expected", () => {
    const t = fixture("- a ([#425](x/pull/425), [#423](x/pull/423))");
    const v = checkOrdering(parseEntries(t));
    expect(v).toHaveLength(1);
    expect(v[0].lineNo).toBe(7); // "# Changelog" 1 + blank 2 + "## Unreleased" 3 + blank 4 + "### Added" 5 + blank 6 + bullet 7
    expect(v[0].message).toContain("[425, 423]");
    expect(v[0].message).toContain("non-decreasing");
  });

  it("flags a mid-list inversion, not just the tail", () => {
    const t = fixture("- a ([#1](x/pull/1), [#5](x/pull/5), [#3](x/pull/3), [#9](x/pull/9))");
    const v = checkOrdering(parseEntries(t));
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain("[1, 5, 3, 9]");
  });
});

describe("checkOrdering — between-entry rule", () => {
  it("accepts strictly-ascending first-numbers", () => {
    const t = fixture(
      "- a ([#1](x/pull/1))",
      "- b ([#2](x/pull/2))",
      "- c ([#3](x/pull/3))",
    );
    expect(checkOrdering(parseEntries(t))).toEqual([]);
  });

  it("accepts ties on the first number (mega-PR convention)", () => {
    const t = fixture(
      "- a ([#122](x/pull/122))",
      "- b ([#122](x/pull/122), [#305](x/pull/305))",
      "- c ([#122](x/pull/122), [#131](x/pull/131))",
      "- d ([#124](x/pull/124))",
    );
    expect(checkOrdering(parseEntries(t))).toEqual([]);
  });

  it("flags a first-number regression and names both lines", () => {
    const t = fixture(
      "- a ([#425](x/pull/425))",
      "- b ([#421](x/pull/421))",
    );
    const v = checkOrdering(parseEntries(t));
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain("first-number 421");
    expect(v[0].message).toContain("previous entry's 425");
    expect(v[0].message).toContain("line 7"); // first entry's line
  });

  it("does not compare entries across subsections", () => {
    const t = [
      "# Changelog",
      "",
      "## [Unreleased]",
      "",
      "### Added",
      "",
      "- a ([#200](x/pull/200))",
      "",
      "### Fixed",
      "",
      "- b ([#100](x/pull/100))",
      "",
    ].join("\n");
    expect(checkOrdering(parseEntries(t))).toEqual([]);
  });

  it("does not compare entries across versions", () => {
    const t = [
      "# Changelog",
      "",
      "## [Unreleased]",
      "",
      "### Added",
      "",
      "- a ([#200](x/pull/200))",
      "",
      "## [v0.3.0]",
      "",
      "### Added",
      "",
      "- b ([#100](x/pull/100))",
      "",
    ].join("\n");
    expect(checkOrdering(parseEntries(t))).toEqual([]);
  });

  it("ignores entries with no PR numbers entirely", () => {
    const t = fixture(
      "- a ([#200](x/pull/200))",
      "- `Add plugins`: no numbers here",
      "- b ([#100](x/pull/100))",
    );
    expect(checkOrdering(parseEntries(t))).toEqual([]);
  });

  it("does not count indented sub-bullets as new entries", () => {
    const t = fixture(
      "- a ([#200](x/pull/200))",
      "  - continuation bullet",
      "  - **Why**: because",
      "- b ([#100](x/pull/100))",
    );
    // Only two entries; b's first-number 100 < a's 200 → violation.
    const v = checkOrdering(parseEntries(t));
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain("first-number 100");
  });
});

describe("collectLabelUrlWarnings", () => {
  it("does not warn when label and URL tail agree (even if URL kind is /tree/)", () => {
    const t = fixture("- a ([#164](x/tree/164), [#206](x/pull/206))");
    const entries = parseEntries(t);
    expect(collectLabelUrlWarnings(entries, t)).toEqual([]);
  });

  it("flags a genuine label/URL number disagreement", () => {
    const t = fixture("- a ([#164](x/tree/999), [#206](x/pull/206))");
    const entries = parseEntries(t);
    const w = collectLabelUrlWarnings(entries, t);
    expect(w).toHaveLength(1);
    expect(w[0].message).toContain("label #164");
    expect(w[0].message).toContain("/999");
  });
});

describe("sortLinePairs — within-line label sort", () => {
  it("reorders a descending pair into ascending", () => {
    const line = "- a ([#425](x/pull/425), [#423](x/pull/423))";
    expect(sortLinePairs(line)).toBe("- a ([#423](x/pull/423), [#425](x/pull/425))");
  });

  it("is a no-op on an already-sorted line", () => {
    const line = "- a ([#1](x/pull/1), [#2](x/pull/2), [#3](x/pull/3))";
    expect(sortLinePairs(line)).toBe(line);
  });

  it("handles ties within a line (non-decreasing, not strictly)", () => {
    // Two identical labels are already non-decreasing; no swap.
    const line = "- a ([#1](x/pull/1), [#1](x/pull/1), [#2](x/pull/2))";
    expect(sortLinePairs(line)).toBe(line);
  });

  it("does not touch a line where labels are not adjacent (safety)", () => {
    // Text between the pairs means the line is malformed for auto-fix.
    const line = "- a ([#200](x/pull/200)) blah ([#100](x/pull/100))";
    expect(sortLinePairs(line)).toBe(line);
  });

  it("preserves surrounding text character-for-character", () => {
    const line =
      "- `Foo`: text ([#200](x/pull/200), [#100](x/pull/100)) trailing";
    const result = sortLinePairs(line);
    expect(result).toBe(
      "- `Foo`: text ([#100](x/pull/100), [#200](x/pull/200)) trailing",
    );
  });
});

describe("stableBubbleSortByFirstNum — between-block sort", () => {
  const mk = (nums) => ({ lines: ["- x"], firstNum: nums[0] ?? null, nums });

  it("keeps ties in their original relative order (stable sort)", () => {
    // Two blocks with the same firstNum: their relative order must not swap.
    const blocks = [
      { ...mk([122, 305]), lines: ["- a"] },
      { ...mk([122, 131]), lines: ["- b"] },
      { ...mk([124]), lines: ["- c"] },
    ];
    stableBubbleSortByFirstNum(blocks);
    expect(blocks.map((b) => b.lines[0])).toEqual(["- a", "- b", "- c"]);
  });

  it("moves a smaller firstNum before a larger one", () => {
    const blocks = [
      { ...mk([200]), lines: ["- a"] },
      { ...mk([100]), lines: ["- b"] },
    ];
    stableBubbleSortByFirstNum(blocks);
    expect(blocks.map((b) => b.lines[0])).toEqual(["- b", "- a"]);
  });

  it("never moves null-firstNum blocks (they have no sort key)", () => {
    const blocks = [
      { ...mk([]), lines: ["- null"] },
      { ...mk([100]), lines: ["- a"] },
      { ...mk([]), lines: ["- null2"] },
    ];
    stableBubbleSortByFirstNum(blocks);
    // null blocks stay in place; the single numbered block doesn't move.
    expect(blocks.map((b) => b.lines[0])).toEqual(["- null", "- a", "- null2"]);
  });
});

describe("fixFile — end-to-end fix with invariants", () => {
  it("fixes both within-line and between-block inversions", () => {
    const t = [
      "# Changelog",
      "",
      "## [Unreleased]",
      "",
      "### Added",
      "",
      "- a ([#200](x/pull/200), [#100](x/pull/100))",
      "- b ([#50](x/pull/50))",
      "",
    ].join("\n");

    const { newText, changed, error } = fixFile(t);
    expect(error).toBeNull();
    expect(changed).toBe(true);

    // Line 7's labels should be sorted; the blocks should be reordered.
    const lines = newText.split("\n");
    expect(lines[6]).toBe("- b ([#50](x/pull/50))");
    expect(lines[7]).toBe("- a ([#100](x/pull/100), [#200](x/pull/200))");

    // The fix must be idempotent.
    const again = fixFile(newText);
    expect(again.changed).toBe(false);
  });

  it("preserves the character multiset (the words-unchanged invariant)", () => {
    const t = [
      "# Changelog",
      "",
      "## [Unreleased]",
      "",
      "### Added",
      "",
      "- a ([#200](x/pull/200), [#100](x/pull/100))",
      "- b ([#50](x/pull/50))",
      "",
    ].join("\n");

    const { newText, changed, error } = fixFile(t);
    expect(error).toBeNull();
    expect(changed).toBe(true);

    // Character multiset is identical — the fix only reorders, never adds/removes.
    const charCounts = (s) => {
      const c = new Map();
      for (const ch of s) c.set(ch, (c.get(ch) ?? 0) + 1);
      return c;
    };
    const before = charCounts(t);
    const after = charCounts(newText);
    expect(after.size).toBe(before.size);
    for (const [ch, n] of before) expect(after.get(ch)).toBe(n);
  });

  it("preserves the line-set as a multiset (block reordering only)", () => {
    // Each line must appear the same number of times before and after.
    const t = [
      "# Changelog",
      "",
      "## [Unreleased]",
      "",
      "### Added",
      "",
      "- a ([#200](x/pull/200))",
      "- b ([#100](x/pull/100))",
      "",
    ].join("\n");

    const { newText, changed, error } = fixFile(t);
    expect(error).toBeNull();
    expect(changed).toBe(true);

    const lineCounts = (s) => {
      const c = new Map();
      for (const line of s.split("\n")) c.set(line, (c.get(line) ?? 0) + 1);
      return c;
    };
    const before = lineCounts(t);
    const after = lineCounts(newText);
    expect(after.size).toBe(before.size);
    for (const [line, n] of before) expect(after.get(line)).toBe(n);
  });

  it("moves sub-bullets along with their parent block", () => {
    const t = [
      "# Changelog",
      "",
      "## [Unreleased]",
      "",
      "### Changed",
      "",
      "- a ([#200](x/pull/200))",
      "  - **Why**: because",
      "- b ([#100](x/pull/100))",
      "",
    ].join("\n");

    const { newText, changed, error } = fixFile(t);
    expect(error).toBeNull();
    expect(changed).toBe(true);

    const lines = newText.split("\n");
    expect(lines[6]).toBe("- b ([#100](x/pull/100))");
    expect(lines[7]).toBe("- a ([#200](x/pull/200))");
    expect(lines[8]).toBe("  - **Why**: because");
  });

  it("is idempotent — a second run is a no-op", () => {
    const t = [
      "# Changelog",
      "",
      "## [Unreleased]",
      "",
      "### Added",
      "",
      "- a ([#200](x/pull/200), [#100](x/pull/100))",
      "- b ([#50](x/pull/50))",
      "",
    ].join("\n");

    const first = fixFile(t);
    expect(first.changed).toBe(true);
    const second = fixFile(first.newText);
    expect(second.changed).toBe(false);
    expect(second.newText).toBe(first.newText);
  });

  it("does not touch already-sorted input", () => {
    const t = [
      "# Changelog",
      "",
      "## [Unreleased]",
      "",
      "### Added",
      "",
      "- a ([#1](x/pull/1))",
      "- b ([#2](x/pull/2))",
      "- c ([#3](x/pull/3))",
      "",
    ].join("\n");

    const { newText, changed, error } = fixFile(t);
    expect(error).toBeNull();
    expect(changed).toBe(false);
    expect(newText).toBe(t);
  });

  it("tolerates ties on the first number (mega-PR convention)", () => {
    // Four sibling entries sharing #122 — stable sort must not touch them.
    const t = [
      "# Changelog",
      "",
      "## [Unreleased]",
      "",
      "### Changed",
      "",
      "- a ([#122](x/pull/122), [#305](x/pull/305))",
      "- b ([#122](x/pull/122), [#131](x/pull/131))",
      "- c ([#122](x/pull/122), [#200](x/pull/200))",
      "- d ([#122](x/pull/122), [#389](x/pull/389))",
      "- e ([#124](x/pull/124))",
      "",
    ].join("\n");

    const { newText, changed, error } = fixFile(t);
    expect(error).toBeNull();
    expect(changed).toBe(false);
    expect(newText).toBe(t);
  });
});

describe("checkExistence — mocked fetch", () => {
  const setupFetch = (statuses) => {
    const calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        calls.push(url);
        const status = statuses[String(url).slice(-4)] ?? 200;
        return { status };
      }),
    );
    return calls;
  };

  it("flags a 404 as a missing-number violation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 404 })));
    const entries = parseEntries(fixture("- a ([#99999](x/pull/99999))"));
    const { violations, error } = await checkExistence(entries, {
      owner: "Zeroto521",
      repo: "foliplus",
      token: "tok",
    });
    expect(error).toBeNull();
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain("#99999");
    expect(violations[0].message).toContain("Zeroto521/foliplus");
  });

  it("passes a 200 for every number", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 200 })));
    const entries = parseEntries(
      fixture("- a ([#1](x/pull/1), [#2](x/pull/2), [#3](x/pull/3))"),
    );
    const { violations, error } = await checkExistence(entries, {
      owner: "Zeroto521",
      repo: "foliplus",
      token: "tok",
    });
    expect(error).toBeNull();
    expect(violations).toEqual([]);
  });

  it("sends the repo-scoped issues URL", async () => {
    const calls = setupFetch({});
    const entries = parseEntries(fixture("- a ([#425](x/pull/425))"));
    await checkExistence(entries, {
      owner: "Zeroto521",
      repo: "foliplus",
      token: "tok",
    });
    expect(calls).toEqual([
      "https://api.github.com/repos/Zeroto521/foliplus/issues/425",
    ]);
  });

  it("deduplicates repeated numbers across entries", async () => {
    const calls = setupFetch({});
    const entries = parseEntries(
      fixture(
        "- a ([#122](x/pull/122), [#125](x/pull/125))",
        "- b ([#122](x/pull/122), [#130](x/pull/130))",
      ),
    );
    await checkExistence(entries, {
      owner: "Z",
      repo: "f",
      token: "t",
    });
    // #122, #125, #130 — three unique calls, not four.
    expect(calls).toHaveLength(3);
  });

  it("reports a rate-limit (403) as a soft error, not a violation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 403 })));
    const entries = parseEntries(fixture("- a ([#1](x/pull/1))"));
    const { violations, error } = await checkExistence(entries, {
      owner: "Z",
      repo: "f",
      token: "t",
    });
    expect(error).toMatch(/rate-limit/);
    expect(violations).toEqual([]);
  });

  it("surfaces a fetch exception as a soft error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const entries = parseEntries(fixture("- a ([#1](x/pull/1))"));
    const { violations, error } = await checkExistence(entries, {
      owner: "Z",
      repo: "f",
      token: "t",
    });
    expect(error).toMatch(/ECONNREFUSED/);
    expect(violations).toEqual([]);
  });
});

describe("real CHANGELOG.md snapshot", () => {
  const entries = parseEntries(REAL_CHANGES);

  it("parses a non-empty entry list", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it("has zero ordering violations today (rule (A): non-decreasing, ties legal)", () => {
    expect(checkOrdering(entries)).toEqual([]);
  });

  it("the /tree/164 wart produces a warning but not a violation", () => {
    // line 15: `[#164](.../tree/164)` — the label and URL tail agree on 164,
    // so this is *not* a mismatch. Only `[#NNN](.../<different number>)` warns.
    const warnings = collectLabelUrlWarnings(entries, REAL_CHANGES);
    expect(warnings).toEqual([]);
  });

  it("records the mega-PR first-number ties the gate is designed to tolerate", () => {
    // Each row: (version, section, firstNum, how many adjacent entries start
    // with that number). These are the ties the gate must NOT flag.
    const expectedTies = [
      ["Unreleased", "Changed", 122, 4],
      ["Unreleased", "Changed", 147, 4],
      ["v0.3.0", "Changed", 37, 2],
      ["v0.3.0", "Fixed", 48, 3],
    ];
    for (const [version, section, firstNum, expected] of expectedTies) {
      const actual = entries.filter(
        (e) =>
          e.version === version && e.section === section && e.firstNum === firstNum,
      ).length;
      expect(actual, `${version}/${section} first #${firstNum}`).toBe(expected);
    }
  });
});
