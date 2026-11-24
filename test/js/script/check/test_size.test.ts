// test/js/script/check/test_size — the JS test-file size guard.
//
// The rule: every test/js/**/*.test.ts stays at or under the 1200-line
// threshold. Oversized files must be on the guard's burn-down allowlist, each
// entry naming the split card that removes it. checkSize() is pure over an
// injected (file, lines) tree, so these feed a synthetic tree without touching
// disk and pin the three verdicts: an unlisted oversized file is red, an
// allowlisted oversized file is quiet, and the guard's path normalisation maps
// an absolute path back to its test/js/ key.
import { LIMIT, checkSize } from "../../../../script/check/test_size.mjs";
import { describe, expect, it } from "vitest";

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
      { "ui/listbox.test.ts": "task-100 step 2" },
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
      { "core/layer/folderLayout.test.ts": "task-100 step 2" },
    );
    expect(bad).toEqual([]);
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
