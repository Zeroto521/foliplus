import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkWorktree,
  isInWorktreesDir,
  isWorktree,
  main,
  runCheck,
} from "#script/check/worktree-dependency.mjs";

// A robust per-run scratch root (same as filter-source-key.test.ts).
const TMP_BASE =
  process.env.TEMP && existsSync(process.env.TEMP)
    ? process.env.TEMP
    : resolve(process.cwd(), ".foliplus", "tmp");
mkdirSync(TMP_BASE, { recursive: true });

// Worktree dependency discipline guard: a worktree's node_modules is a
// junction to the main checkout's node_modules; running npm ci/install/prune
// in a worktree deletes the shared target's content (RCA:
// .foliplus/notes/node-modules-wipe-rca.md). This guard detects a worktree
// whose node_modules is a REAL directory (forbidden) or a junction to a
// non-repo target (misconfigured).

describe("isWorktree / isInWorktreesDir", () => {
  it("detects a linked worktree via its .git file", () => {
    const dir = mkdtempSync(join(TMP_BASE, "worktree-deps-iswt-"));
    writeFileSync(join(dir, ".git"), "gitdir: /x\n");
    expect(isWorktree(dir)).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("does not treat a directory without a .git file as a worktree", () => {
    const dir = mkdtempSync(join(TMP_BASE, "worktree-deps-iswt2-"));
    expect(isWorktree(dir)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("recognizes the .agents/worktrees path marker", () => {
    expect(isInWorktreesDir(join("C:\\repo", ".agents", "worktrees", "wt-x"))).toBe(
      true,
    );
    expect(isInWorktreesDir(join("C:\\repo", ".agents"))).toBe(false);
    expect(isInWorktreesDir(join("C:\\repo", "node_modules"))).toBe(false);
  });
});

describe("checkWorktree", () => {
  it("accepts an absent node_modules (a worktree may not need deps)", () => {
    const dir = mkdtempSync(join(TMP_BASE, "worktree-deps-absent-"));
    const result = checkWorktree(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(result.ok).toBe(true);
  });

  it("rejects a real node_modules directory in a worktree", () => {
    const dir = mkdtempSync(join(TMP_BASE, "worktree-deps-real-"));
    mkdirSync(join(dir, "node_modules"), { recursive: true });
    const result = checkWorktree(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(result.ok).toBe(false);
    expect(result.messages[0]).toMatch(/REAL directory/);
  });

  it("rejects a junction pointing outside the repo's node_modules", () => {
    const dir = mkdtempSync(join(TMP_BASE, "worktree-deps-junc-"));
    const outside = mkdtempSync(join(TMP_BASE, "worktree-deps-outside-"));
    let junctionCreated = false;
    try {
      // 'junction' type is Windows-only; on other platforms this throws and
      // the test is skipped (the branch is still covered by the CLI probe).
      symlinkSync(outside, join(dir, "node_modules"), "junction");
      junctionCreated = true;
    } catch {
      // no reparse-point support → branch unreachable here; skip.
    }
    if (junctionCreated) {
      const result = checkWorktree(dir);
      expect(result.ok).toBe(false);
      expect(result.messages[0]).toMatch(/junction target is not the repo/);
    }
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });
});

describe("main()", () => {
  it("returns 0 for a non-worktree directory (main checkout)", () => {
    const dir = mkdtempSync(join(TMP_BASE, "worktree-deps-main-"));
    const code = main(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(code).toBe(0);
  });
});

describe("checkWorktree — junction to the repo node_modules (ok branch)", () => {
  it("accepts a junction pointing at the repo's own node_modules", () => {
    const root = mkdtempSync(join(TMP_BASE, "worktree-deps-goodjunc-"));
    const wtDir = join(root, ".agents", "worktrees", "wt-x");
    mkdirSync(wtDir, { recursive: true });
    const nmTarget = join(root, "node_modules");
    mkdirSync(nmTarget, { recursive: true });
    let created = false;
    try {
      symlinkSync(nmTarget, join(wtDir, "node_modules"), "junction");
      created = true;
    } catch {
      // non-Windows: skip.
    }
    if (created) {
      const result = runCheck(wtDir);
      expect(result.ok).toBe(true);
      expect(result.messages[0]).toMatch(/junction to/);
    }
    rmSync(root, { recursive: true, force: true });
  });
});

describe("main() — worktree judgment", () => {
  it("returns 0 for a worktree with a good junction", () => {
    const root = mkdtempSync(join(TMP_BASE, "worktree-deps-main0-"));
    const wtDir = join(root, ".agents", "worktrees", "wt-x");
    mkdirSync(wtDir, { recursive: true });
    writeFileSync(join(wtDir, ".git"), "gitdir: /x\n");
    const nmTarget = join(root, "node_modules");
    mkdirSync(nmTarget, { recursive: true });
    let created = false;
    try {
      symlinkSync(nmTarget, join(wtDir, "node_modules"), "junction");
      created = true;
    } catch {
      // non-Windows: skip.
    }
    if (created) {
      expect(main(wtDir)).toBe(0);
    }
    rmSync(root, { recursive: true, force: true });
  });

  it("returns 1 for a worktree with a real node_modules directory", () => {
    const root = mkdtempSync(join(TMP_BASE, "worktree-deps-main1-"));
    const wtDir = join(root, ".agents", "worktrees", "wt-x");
    mkdirSync(wtDir, { recursive: true });
    writeFileSync(join(wtDir, ".git"), "gitdir: /x\n");
    mkdirSync(join(wtDir, "node_modules"), { recursive: true });
    expect(main(wtDir)).toBe(1);
    rmSync(root, { recursive: true, force: true });
  });
});
