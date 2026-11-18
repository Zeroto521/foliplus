#!/usr/bin/env node
/**
 * script/check/worktree-junction.mjs — worktree `node_modules` junction guard.
 *
 * Every worktree's `node_modules` is a junction to the main checkout's
 * `node_modules` (see AGENTS.md "Worktree deps"). When that junction is
 * dropped, a later `vitest` run in the worktree creates a *local* `node_modules`
 * holding only cache subdirs (`.vite`, `.vite-temp`, `.vitest-cache`) and no
 * packages — every `make test-js` / `make typecheck` in that worktree then
 * fails with an opaque "cannot find module" error. The junction is dropped as
 * a link (the main checkout stays intact), so the failure is silent until a
 * test run trips on it.
 *
 * This guard surfaces that state before the test run: it reports each worktree
 * whose `node_modules` is NOT a valid junction to the main checkout, and prints
 * the exact rebuild command. Run in `--fix` mode it performs the rebuild.
 *
 * Exit status is 0 when every checked worktree has a valid junction; 1 when any
 * is broken. Missing `node_modules` is reported as a warning, not a failure (a
 * freshly created worktree may legitimately not have deps yet). No dependencies.
 *
 * Usage:
 *   node script/check/worktree-junction.mjs             # check current checkout
 *   node script/check/worktree-junction.mjs --all       # check every worktree
 *   node script/check/worktree-junction.mjs --fix       # rebuild broken junctions
 *   node script/check/worktree-junction.mjs --all --fix
 */
import { repoRoot } from "../build-path.mjs";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const isWin = process.platform === "win32";

/** Run a command, return { status, stdout, stderr }. */
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", windowsHide: true });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};

/** List every registered worktree path; the first entry is the main checkout. */
const listWorktrees = root => {
  const r = run("git", ["-C", root, "worktree", "list", "--porcelain"]);
  if (r.status !== 0) {
    throw new Error(`git worktree list failed: ${(r.stderr || r.stdout).trim()}`);
  }
  return r.stdout
    .split(/\r?\n/)
    .filter(line => line.startsWith("worktree "))
    .map(line => line.slice("worktree ".length).trim());
};

/**
 * Diagnose one checkout's `node_modules`.
 * Returns { state: "ok" | "broken" | "dangling" | "missing", mainTarget? }.
 * "broken" = real directory where a junction should be (the recurring loss);
 * "dangling" = junction whose target no longer resolves; "missing" = no dir.
 */
const diagnose = nm => {
  // lstatSync first: it stats the link itself, so a junction whose target
  // no longer resolves still lstat-succeeds (existsSync would report the
  // unresolvable path as missing and lose the dangling classification).
  let st;
  try {
    st = fs.lstatSync(nm);
  } catch {
    return { state: "missing" };
  }
  if (st.isSymbolicLink()) {
    let target;
    try {
      target = fs.readlinkSync(nm);
    } catch {
      return { state: "dangling" };
    }
    const resolved = path.resolve(path.dirname(nm), target);
    if (!fs.existsSync(resolved)) return { state: "dangling", mainTarget: resolved };
    return { state: "ok", mainTarget: resolved };
  }
  return { state: "broken" };
};

/** The rebuild command that restores a worktree's junction to the main checkout. */
const rebuildCommand = (wtNodeModules, mainNodeModules) => {
  const link = isWin ? wtNodeModules.replace(/\//g, "\\") : wtNodeModules;
  const mainPath = isWin ? mainNodeModules.replace(/\//g, "\\") : mainNodeModules;
  if (isWin) {
    return `cmd /c rmdir /s /q "${link}" && cmd /c mklink /J "${link}" "${mainPath}"`;
  }
  return `rm -rf "${link}" && ln -s "${mainPath}" "${link}"`;
};

/** Perform the rebuild: remove the broken/dangling dir (link-only on Windows) and re-link. */
const rebuild = (wtNodeModules, mainNodeModules) => {
  const link = wtNodeModules.replace(/\//g, "\\");
  const mainPath = mainNodeModules.replace(/\//g, "\\");
  if (isWin) {
    // `rmdir /s /q` is link-only on a junction and removes a real dir normally;
    // never use Node fs.rmSync here (it pierces a junction and wipes the target).
    const rm = run("cmd", ["/c", "rmdir", "/s", "/q", link]);
    if (rm.status !== 0) return rm;
    return run("cmd", ["/c", "mklink", "/J", link, mainPath]);
  }
  run("rm", ["-rf", wtNodeModules]);
  return run("ln", ["-s", mainNodeModules, wtNodeModules]);
};

const main = (argv = process.argv.slice(2), deps = {}) => {
  const args = argv;
  const all = args.includes("--all");
  const fix = args.includes("--fix");
  const currentRoot = deps.root ?? repoRoot(import.meta.url);

  const worktrees = deps.worktrees ?? listWorktrees(currentRoot);
  if (worktrees.length === 0) {
    console.log("worktree-junction: no registered worktrees; nothing to check.");
    return 0;
  }
  const mainRoot = worktrees[0];

  let targets;
  if (all) {
    targets = worktrees;
  } else {
    targets = [currentRoot];
  }

  const problems = [];

  for (const target of targets) {
    const isMain = path.resolve(target) === path.resolve(mainRoot);
    const nm = path.join(target, "node_modules");
    const name = path.basename(target);
    const d = diagnose(nm);

    if (isMain) {
      // Main checkout: node_modules is a real directory (not a junction).
      if (d.state === "broken") {
        console.log("ok        main        node_modules (real dir)");
      } else if (d.state === "ok") {
        console.warn(
          "worktree-junction: main checkout node_modules is a junction (expected a real dir).",
        );
      }
      continue;
    }

    const mainNm = path.join(mainRoot, "node_modules");
    if (d.state === "ok") {
      const tgt = d.mainTarget ? path.resolve(d.mainTarget) : "";
      if (tgt && path.resolve(tgt) === path.resolve(mainNm)) {
        console.log(`ok        ${name}  ->  main node_modules`);
      } else {
        problems.push({
          name,
          nm,
          reason: "junction points at a different node_modules",
          mainNm,
        });
      }
    } else if (d.state === "broken") {
      problems.push({
        name,
        nm,
        reason: "junction dropped (real dir, cache-only)",
        mainNm,
      });
    } else if (d.state === "dangling") {
      problems.push({ name, nm, reason: "junction target does not resolve", mainNm });
    } else if (d.state === "missing") {
      console.warn(`warn      ${name}  node_modules missing (no deps set up?)`);
    }
  }

  if (problems.length) {
    console.error(
      `\nworktree-junction: ${problems.length} worktree(s) have a broken node_modules junction:`,
    );
    for (const p of problems) {
      console.error(`  - ${p.name}: ${p.reason}`);
      console.error(`    fix: ${rebuildCommand(p.nm, p.mainNm)}`);
    }
    if (fix) {
      console.error("Rebuilding junctions...");
      let failed = 0;
      for (const p of problems) {
        const r = rebuild(p.nm, p.mainNm);
        const after = diagnose(p.nm);
        const ok = after.state === "ok";
        console.log(`${ok ? "ok" : "FAIL"}  ${p.name}`);
        if (!ok) {
          failed++;
          console.error(`    ${(r.stderr || r.stdout || "").trim()}`);
        }
      }
      if (failed) {
        console.error(`\nworktree-junction: ${failed} rebuild(s) failed.`);
        return 1;
      }
      console.error(
        `\nworktree-junction: ${problems.length} junction(s) rebuilt to the main checkout.`,
      );
      return 0;
    }
    return 1;
  }

  if (fix) console.log("worktree-junction: nothing to fix.");
  return 0;
};

// CLI entry: only when executed directly (`node script/check/worktree-junction.mjs`),
// never when a test imports the helpers. Kept as a function so the entry path is
// covered by calling it with this module's own file URL in the tests.
const runCli = (argv, entry) => {
  if (entry !== undefined && path.resolve(entry) === fileURLToPath(import.meta.url)) {
    process.exitCode = main(argv);
  }
};
runCli(process.argv.slice(2), process.argv[1]);

export { diagnose, listWorktrees, main, rebuild, rebuildCommand, run, runCli };
