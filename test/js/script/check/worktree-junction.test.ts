// Guard test for `script/check/worktree-junction.mjs` — the worktree
// `node_modules` junction guard.
//
// The guard's pure helpers (`diagnose`, `rebuildCommand`) are driven directly
// against synthetic fixtures, and `main` is driven through its `deps` seam
// (injected root + worktree list) so the exit code and diagnostics are
// testable without running `git` against a real repo. Junctions are built with
// `fs.symlinkSync(target, path, "junction")` (no admin needed on Windows) and
// always point INSIDE the fixture, so cleanup is a plain `rm` of the temp dir.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { diagnose, main, rebuildCommand } from "#script/check/worktree-junction.mjs";

const isWin = process.platform === "win32";

/** Fixture: a fake "repo" whose main checkout has a real node_modules dir and
 *  whose worktrees start with none, so each test builds the state it needs. */
const make = () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wj-"));
  const main = path.join(root, "main");
  const wtA = path.join(root, "wt-a");
  const wtB = path.join(root, "wt-b");
  const wtC = path.join(root, "wt-c");
  const wtD = path.join(root, "wt-d");
  const wtE = path.join(root, "wt-e");
  for (const d of [main, wtA, wtB, wtC, wtD, wtE]) mkdirSync(d, { recursive: true });
  mkdirSync(path.join(main, "node_modules")); // main checkout holds a real dir
  const nm = (d: string) => path.join(d, "node_modules");
  return { root, main, wtA, wtB, wtC, wtD, wtE, nm };
};

/** Mock the console sinks so `main` diagnostics do not pollute test output.
 *  Returns a restore callback. */
const silence = () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  return () => {
    log.mockRestore();
    warn.mockRestore();
    err.mockRestore();
  };
};

const expectRebuildCmd = (text: string) => {
  expect(text, "the rebuild command names the link and the main target").toContain(
    path.join("node_modules"),
  );
  if (isWin) {
    expect(text).toContain("mklink /J");
  } else {
    expect(text).toContain("ln -s");
  }
};

describe("worktree-junction guard", () => {
  let fix: ReturnType<typeof make>;
  beforeEach(() => {
    fix = make();
  });
  afterEach(() => {
    // Remove every junction link first (link-only on a junction), then the
    // tree; the junction targets live inside the fixture so a plain rm is safe.
    for (const d of [fix.wtA, fix.wtB, fix.wtC, fix.wtD, fix.wtE]) {
      try {
        rmSync(fix.nm(d));
      } catch {
        /* real dir or missing — the recursive tree rm below handles it */
      }
    }
    rmSync(fix.root, { recursive: true, force: true });
  });

  describe("diagnose", () => {
    it("classifies a real directory as broken (the recurring junction loss)", () => {
      mkdirSync(fix.nm(fix.wtB));
      expect(diagnose(fix.nm(fix.wtB))).toEqual({ state: "broken" });
    });

    it("classifies a valid junction to an existing target as ok", () => {
      symlinkSync(fix.nm(fix.main), fix.nm(fix.wtA), "junction");
      const d = diagnose(fix.nm(fix.wtA));
      expect(d.state).toBe("ok");
      expect(path.resolve(d.mainTarget)).toBe(path.resolve(fix.nm(fix.main)));
    });

    it("classifies a missing node_modules as missing", () => {
      expect(diagnose(fix.nm(fix.wtC))).toEqual({ state: "missing" });
    });

    it("classifies a junction whose target no longer resolves as dangling", () => {
      // Windows cannot create a junction to a non-existent target, so build a
      // real target dir first, then delete it to make the junction dangle.
      const gone = path.join(fix.root, "gone", "node_modules");
      mkdirSync(gone, { recursive: true });
      symlinkSync(gone, fix.nm(fix.wtD), "junction");
      rmSync(path.join(fix.root, "gone"), { recursive: true, force: true });
      const d = diagnose(fix.nm(fix.wtD));
      expect(d.state).toBe("dangling");
      expect(path.resolve(d.mainTarget)).toBe(path.resolve(gone));
    });
  });

  describe("rebuildCommand", () => {
    it("names the link and the main target with the platform rebuild", () => {
      expectRebuildCmd(rebuildCommand(fix.nm(fix.wtA), fix.nm(fix.main)));
    });
  });

  describe("main exit code and diagnostics", () => {
    it("passes when the main checkout holds a real node_modules dir", () => {
      const restore = silence();
      const code = main(["--all"], {
        root: fix.main,
        worktrees: [fix.main, fix.wtC],
      });
      expect(code).toBe(0);
      restore();
    });

    it("passes when every worktree's node_modules is a junction to the main node_modules", () => {
      symlinkSync(fix.nm(fix.main), fix.nm(fix.wtA), "junction");
      const restore = silence();
      const code = main(["--all"], {
        root: fix.main,
        worktrees: [fix.main, fix.wtA],
      });
      expect(code).toBe(0);
      restore();
    });

    it("fails with the rebuild command when a worktree's junction is dropped", () => {
      mkdirSync(fix.nm(fix.wtB)); // real dir where a junction should be
      const restore = silence();
      const err = vi.spyOn(console, "error");
      const code = main(["--all"], {
        root: fix.main,
        worktrees: [fix.main, fix.wtB],
      });
      expect(code).toBe(1);
      const text = err.mock.calls.flat().join("\n");
      expect(text).toContain("junction dropped");
      expect(text).toContain(fix.wtB);
      expectRebuildCmd(text);
      restore();
    });

    it("--all checks every worktree; without it only the current root is checked", () => {
      mkdirSync(fix.nm(fix.wtB)); // broken worktree
      const restore = silence();
      // Without --all the current root is the (healthy) main checkout -> pass.
      expect(main([], { root: fix.main, worktrees: [fix.main, fix.wtB] })).toBe(0);
      // With --all the broken worktree is checked -> fail.
      expect(main(["--all"], { root: fix.main, worktrees: [fix.main, fix.wtB] })).toBe(
        1,
      );
      restore();
    });

    it("only warns (not fails) when a worktree has no node_modules", () => {
      const restore = silence();
      const warn = vi.spyOn(console, "warn");
      const code = main(["--all"], {
        root: fix.main,
        worktrees: [fix.main, fix.wtC],
      });
      expect(code).toBe(0);
      expect(warn.mock.calls.flat().join("\n")).toContain("missing");
      restore();
    });

    it("fails when a worktree's junction points at a different node_modules", () => {
      const other = path.join(fix.root, "other", "node_modules");
      mkdirSync(other, { recursive: true });
      symlinkSync(other, fix.nm(fix.wtE), "junction");
      const restore = silence();
      const err = vi.spyOn(console, "error");
      const code = main(["--all"], {
        root: fix.main,
        worktrees: [fix.main, fix.wtE],
      });
      expect(code).toBe(1);
      expect(err.mock.calls.flat().join("\n")).toContain(
        "points at a different node_modules",
      );
      restore();
    });

    it("--fix rebuilds a dropped junction back to the main node_modules", () => {
      mkdirSync(fix.nm(fix.wtB)); // dropped
      const restore = silence();
      const code = main(["--all", "--fix"], {
        root: fix.main,
        worktrees: [fix.main, fix.wtB],
      });
      expect(code).toBe(0);
      // The rebuilt node_modules is a junction (symlink) again, and its target
      // resolves to the main checkout's node_modules.
      expect(diagnose(fix.nm(fix.wtB)).state).toBe("ok");
      expect(path.resolve(diagnose(fix.nm(fix.wtB)).mainTarget)).toBe(
        path.resolve(fix.nm(fix.main)),
      );
      restore();
    });
  });
});
