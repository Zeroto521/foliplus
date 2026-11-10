#!/usr/bin/env node
/**
 * Preflight: npm dependency discipline for git worktrees.
 *
 * Background (RCA .foliplus/notes/node-modules-wipe-rca.md): a worktree's
 * node_modules is a JUNCTION to the main checkout's node_modules. Running
 * `npm ci` (or `npm install`/`npm prune` in clean mode) from inside a
 * worktree treats that junction as a directory to replace: it deletes the
 * shared target's CONTENT and creates a fresh local directory in its place,
 * wiping the main checkout's packages and breaking every other worktree that
 * shares the junction. This exact wipe stalled the whole team twice in one
 * night.
 *
 * This script is a preflight guard: it detects when the current working
 * directory is a git worktree and whether its node_modules is still a
 * junction (safe) or has been replaced by a real directory (npm ran a clean
 * install here — the wipe already happened or is about to).
 *
 * Rules enforced:
 *   - In a worktree, node_modules MUST be a junction to the main checkout's
 *     node_modules (or absent — a worktree may not need deps).
 *   - In a worktree, node_modules MUST NOT be a real directory (npm ci /
 *     install / prune was run here — forbidden).
 *   - The junction target MUST resolve into the repo's own node_modules
 *     (never a stray external path).
 *
 * Exit codes:
 *   0  — OK (not a worktree, or a worktree with a junction / no node_modules)
 *   1  — VIOLATION (worktree node_modules is a real dir, or junction target
 *        is not the repo's node_modules)
 *
 * Usage: `node script/check/worktree-deps.mjs [root]`
 *   root defaults to process.cwd(); pass the repo root to check from anywhere.
 *   For pre-commit/CI: `node script/check/worktree-deps.mjs <repo-root>`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Is `dir` inside a git worktree? A linked worktree's .git is a FILE
 * containing `gitdir: ...`; the main checkout's .git is a DIRECTORY.
 */
const isWorktree = dir => {
  const git = path.join(dir, ".git");
  try {
    return fs.statSync(git).isFile();
  } catch {
    return false;
  }
};

/**
 * Is `dir` inside the repo's worktree directory (`.agents/worktrees`)?
 * The main checkout does NOT contain this marker in its path.
 */
const isInWorktreesDir = dir => {
  const normalized = dir.split(path.sep).join("/");
  return /(^|\/).agents\/worktrees(\/|$)/.test(normalized);
};

/**
 * Resolve a junction's real target (Windows reparse point). fs.readlinkSync
 * returns the junction target path for a symbolic link.
 */
const resolveTarget = p => {
  try {
    return path.resolve(fs.readlinkSync(p));
  } catch {
    return null;
  }
};

/**
 * Check one directory's dependency discipline.
 * @returns {{ ok: boolean, messages: string[] }}
 */
const checkWorktree = dir => {
  const messages = [];
  const nm = path.join(dir, "node_modules");

  if (!fs.existsSync(nm)) {
    // No node_modules — a worktree may legitimately not need deps yet.
    return { ok: true, messages: ["node_modules absent (ok)"] };
  }

  const lst = fs.lstatSync(nm);
  if (!lst.isSymbolicLink()) {
    // A REAL directory in a worktree: npm ci/install/prune ran here.
    messages.push(
      "node_modules is a REAL directory in a git worktree — npm ci/install/prune must run in the main checkout only. " +
        "This has already wiped (or is about to wipe) the main checkout's node_modules.",
    );
    return { ok: false, messages };
  }

  // It's a junction — verify it points at the repo's node_modules.
  const target = resolveTarget(nm);
  const repoRoot = path.resolve(dir, "..", "..", "..");
  const expected = path.join(repoRoot, "node_modules");
  if (target === null || !target.toLowerCase().startsWith(expected.toLowerCase())) {
    messages.push(
      `node_modules junction target is not the repo's node_modules: ${target ?? "(unresolvable)"} (expected ${expected})`,
    );
    return { ok: false, messages };
  }
  messages.push(`node_modules is a junction to ${target} (ok)`);
  return { ok: true, messages };
};

/** Main entry. @param {string} root @returns {number} */
const main = (root = process.cwd()) => {
  const dir = path.resolve(root);
  const inWorktree = isWorktree(dir) && isInWorktreesDir(dir);
  if (!inWorktree) {
    console.log(`${dir}: not a git worktree — deps discipline not applicable (ok)`);
    return 0;
  }
  const result = checkWorktree(dir);
  for (const m of result.messages) console.log(`${dir}: ${m}`);
  return result.ok ? 0 : 1;
};

// CLI entry — only when executed directly, never when a test imports this.
const runCli = (argv, entry) => {
  if (entry !== undefined && path.resolve(entry) === fileURLToPath(import.meta.url)) {
    process.exitCode = main(argv[0]);
  }
};
runCli(process.argv.slice(2), process.argv[1]);

export { checkWorktree, isInWorktreesDir, isWorktree, main, resolveTarget, runCli };
