// test/js/script/check/test-size — the JS test-file size guard.
//
// The rule: every test/js/**/*.test.ts stays at or under the 1200-line
// threshold. Oversized files must be on the guard's burn-down allowlist, each
// entry naming the split card that removes it. checkSize() is pure over an
// injected (file, lines) tree, so these feed a synthetic tree without touching
// disk and pin the three verdicts: an unlisted oversized file is red, an
// allowlisted oversized file is quiet, and the guard's path normalisation maps
// an absolute path back to its test/js/ key.
import { describe, expect, it, vi } from "vitest";
import {
  LIMIT,
  checkSize,
  listTestFiles,
  main,
  remainingAllowlist,
  staleAllowlist,
} from "#script/check/test-size.mjs";

describe("checkSize", () => {
  it("reports an unlisted oversized file as red", () => {
    const bad = checkSize(
      [{ file: "test/js/ui/listbox.test.ts", lines: LIMIT + 1 }],
      {},
    );
    expect(bad).toHaveLength(1);
    expect(bad[0].file).toBe("ui/listbox.test.ts");
    expect(bad[0].lines).toBe(LIMIT + 1);
  });

  it("keeps an allowlisted oversized file quiet", () => {
    // The file is over the cap, but the allowlist carries its split card, so
    // the guard stays green until the split lands and the entry is deleted.
    const bad = checkSize(
      [{ file: "test/js/ui/listbox.test.ts", lines: LIMIT + 500 }],
      { "ui/listbox.test.ts": "split pending" },
    );
    expect(bad).toEqual([]);
  });

  it("keeps a file at or under the cap quiet", () => {
    expect(
      checkSize([{ file: "test/js/ui/listbox.test.ts", lines: LIMIT }], {}),
    ).toEqual([]);
  });

  it("normalises an absolute path back to its test/js/ key", () => {
    // A real caller walks the tree and yields absolute paths; the guard keys
    // its allowlist on the repo-relative test/js/ form, so an absolute path
    // must not escape the allowlist and trip a false red.
    const bad = checkSize(
      [
        {
          file: "/abs/repo/test/js/core/layer/folderLayout.test.ts",
          lines: LIMIT + 1,
        },
      ],
      { "core/layer/folderLayout.test.ts": "split pending" },
    );
    expect(bad).toEqual([]);
  });

  it("keeps a path with no test/js/ marker as-is", () => {
    // Defensive: a caller may hand a path outside the mirror root; the key then
    // stays the slash-normalised path instead of collapsing to an empty suffix.
    const bad = checkSize([{ file: "/abs/elsewhere.test.ts", lines: LIMIT + 1 }], {});
    expect(bad.map(b => b.file)).toEqual(["/abs/elsewhere.test.ts"]);
  });

  it("splits several oversized files, listing each unlisted one", () => {
    const bad = checkSize(
      [
        { file: "test/js/a.test.ts", lines: LIMIT + 1 },
        { file: "test/js/b.test.ts", lines: LIMIT },
        { file: "test/js/c.test.ts", lines: LIMIT + 99 },
      ],
      {},
    );
    expect(bad.map(b => b.file)).toEqual(["a.test.ts", "c.test.ts"]);
  });
});

describe("staleAllowlist", () => {
  it("flags an entry whose file fell to or under the cap", () => {
    // The split landed but the entry stayed: the burn-down list owes nothing
    // here, so the gate must say "delete this entry" instead of staying quiet.
    const stale = staleAllowlist(
      [{ file: "test/js/ui/listbox.test.ts", lines: LIMIT }],
      { "ui/listbox.test.ts": "split pending" },
    );
    expect(stale.map(entry => entry.stem)).toEqual(["ui/listbox.test.ts"]);
    expect(stale[0].lines).toBe(LIMIT);
    expect(stale[0].reason).toContain("delete");
  });

  it("flags an entry whose file is gone", () => {
    const stale = staleAllowlist([], { "ui/gone.test.ts": "split pending" });
    expect(stale.map(entry => entry.stem)).toEqual(["ui/gone.test.ts"]);
    expect(stale[0].lines).toBeNull();
    expect(stale[0].reason).toContain("delete");
  });

  it("keeps an entry for a file still over the cap", () => {
    expect(
      staleAllowlist([{ file: "test/js/ui/listbox.test.ts", lines: LIMIT + 1 }], {
        "ui/listbox.test.ts": "split pending",
      }),
    ).toEqual([]);
  });

  it("normalises an absolute path before matching the entry", () => {
    // The caller walks with absolute paths; a stale check keyed on the raw path
    // would call every real entry missing.
    expect(
      staleAllowlist(
        [
          {
            file: "/abs/repo/test/js/core/layer/folderLayout.test.ts",
            lines: LIMIT + 1,
          },
        ],
        { "core/layer/folderLayout.test.ts": "split pending" },
      ),
    ).toEqual([]);
  });
});

describe("the real tree", () => {
  it("walks every test/js file with its raw line count", () => {
    const files = listTestFiles();
    expect(files.length).toBeGreaterThan(200);
    expect(files.every(f => f.file.endsWith(".test.ts"))).toBe(true);
    expect(files.every(f => f.lines > 0)).toBe(true);
  });

  it("reports only allowlist entries that still exist on disk", () => {
    // The burn-down view: an entry whose split landed must be deleted, so the
    // list is the set of entries still owed a split.
    const remaining = remainingAllowlist();
    expect(remaining.length).toBeGreaterThan(0);
    expect(remaining.every(stem => stem.endsWith(".test.ts"))).toBe(true);
  });

  it("carries no stale allowlist entry", () => {
    // A shrunk file must delete its entry in the same PR that shrank it: the
    // allowlist is a burn-down list, and a stale row is a lie about the work
    // that is left.
    expect(staleAllowlist()).toEqual([]);
  });

  it("exits 0 on the current tree", () => {
    // The guard must be green on the tree it ships with; a red here means an
    // oversized file landed without an allowlist entry.
    expect(main()).toBe(0);
  });

  it("reports an oversized file and exits 1", () => {
    // The reporting branch: one line per offending file, non-zero exit.
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = main([
      { file: "test/js/ui/not-allowlisted.test.ts", lines: LIMIT + 1 },
    ]);
    expect(code).toBe(1);
    expect(log.mock.calls.flat().join(" ")).toContain("ui/not-allowlisted.test.ts");
    log.mockRestore();
  });

  it("prints the burn-down view under --list", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    // The real tree, so the view reports the entries still owed a split.
    expect(main(listTestFiles(), ["node", "test-size.mjs", "--list"])).toBe(0);
    expect(log.mock.calls.flat().join(" ")).toContain("allowlist:");
    log.mockRestore();
  });

  it("fails --list too when an entry is stale", () => {
    // --list is a report, not a loophole: a stale row still fails it, and the
    // row is named so the reader deletes that line.
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = main(
      [{ file: "test/js/ui/listbox.test.ts", lines: LIMIT }],
      ["node", "test-size.mjs", "--list"],
    );
    expect(code).toBe(1);
    expect(log.mock.calls.flat().join(" ")).toContain("STALE ui/listbox.test.ts");
    log.mockRestore();
  });
});
