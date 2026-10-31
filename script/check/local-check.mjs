#!/usr/bin/env node
/**
 * local-check.mjs — `make check` implementation.
 *
 * Runs the locally-reproducible subset of the CI gates on just the changed
 * files, plus the two cheap full-tree guards and the three cheap repo scripts
 * that CI would otherwise be the first to catch. The full suite (all JS/Python
 * tests, docs build, bundle build + size gates, browser tests) is deliberately
 * NOT here — that belongs to PR CI.
 *
 * Gates, in order (first failure aborts with a hint):
 *   1. typecheck            — npm run typecheck
 *   2. prettier --check     — changed ts/js/css/md/json files (CHANGELOG.md excluded)
 *   3. eslint               — changed ts/js/mjs/cjs files
 *   4. ruff check           — changed .py files (pinned ruff from pre-commit cache)
 *   5. ruff format --check  — changed .py files
 *   6. listener/toolchain guards — full-tree (cheap, catch "only touched
 *      files" blind spots) — via the vitest spawn shim
 *   7. JS tests             — vitest (via shim) on the test dirs matching changed files
 *   8. Python tests         — pytest (non-browser) on dirs matching changed
 *      files, plus test/python/test_locale.py; build-js-dev runs first when a
 *      .py file changed
 *   9. repo scripts         — changelog_check --skip-exists, mojibake_check --all
 *      (full tree, batched), dead_barrel_export
 *
 * The diff base is merge-base(origin/main, HEAD) after a best-effort
 * `git fetch origin main` (a fetch failure only warns — the local
 * origin/main ref is used and the actual base sha is printed). Working-tree
 * unstaged and staged changes are included.
 *
 * The logic is split so the pure parts are unit-testable
 * (test/js/script/check/local-check.test.ts) without spawning the toolchain:
 * the runner (sh) and the console IO (io) are injectable, so `main` and
 * `runGates` are exercised with stubs and the real subprocess calls never
 * run in a test. The pure helpers (collectChangedFiles, findShim, findRuff,
 * mapJsTests, mapPyTests, vitestCmd, buildGates) take their dependencies as
 * options for the same reason.
 *
 * Windows note: the vitest shim (.foliplus/vite-spawn-patch.mjs) is mandatory
 * for every jsdom test run — without it Playwright/Vitest spawn fails with
 * WinError 5 (the default stdio 'pipe' cannot cross the sandbox). ruff is not
 * a project venv package here, so the pinned pre-commit cache copy is used
 * (ruff v0.17.2, per .pre-commit-config.yaml).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();

/**
 * The subset of spawnSync's result this script reads. Looser than
 * SpawnSyncReturns on purpose: `main`/`runGates` are called with fakes in
 * their tests, so the injectable run signature is this shape, not the full
 * Node type. Mirrors script/typecheck-test.mjs.
 *
 * @typedef {{error?: unknown, status?: number | null, stdout?: string, stderr?: string}} SpawnResult
 */

// On Windows cmd.exe rejects forward slashes in command position, so the venv
// python.exe path must use backslashes (spawnSync with shell:true routes the
// whole command through cmd.exe /c).
const pytestExeFor = platform =>
  platform === "win32" ? ".venv\\Scripts\\python.exe" : ".venv/bin/python";

const PYTEST_EXE = pytestExeFor(process.platform);

/**
 * Run a shell command. Injectable for tests (see main/runGates deps).
 * @param {string} cmd
 * @param {Record<string, string|undefined>} [env]
 * @returns {SpawnResult}
 */
const sh = (cmd, env) =>
  spawnSync(cmd, {
    shell: true,
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    env: { ...process.env, ...env },
  });

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

/** Default console IO — injectable so tests capture without touching stdout. */
const defaultIo = {
  log: (...args) => console.log(...args),
  err: (...args) => console.error(...args),
  write: s => process.stdout.write(s),
};

/** Prettier covers these; CHANGELOG.md is deliberately excluded (changelog_check owns it). */
const PRETTIER_EXT = /\.(ts|js|cjs|mjs|css|md|json)$/;
const ESLINT_EXT = /\.(ts|js|mjs|cjs)$/;

/** The vitest spawn shim — mandatory on Windows for jsdom runs.
 *
 * The shim lives in .foliplus/ of the MAIN checkout. A git worktree
 * (e.g. .foliplus/wt-*) has no .foliplus/ of its own, so walk up the directory
 * chain until a .foliplus/vite-spawn-patch.mjs is found. The root and the
 * existence probe are injectable for tests.
 */
const findShim = (deps = {}) => {
  const root = deps.root ?? ROOT;
  const exists = deps.exists ?? existsSync;
  let dir = root;
  for (;;) {
    const cand = resolve(dir, ".foliplus", "vite-spawn-patch.mjs");
    if (exists(cand)) return cand;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(root, ".foliplus", "vite-spawn-patch.mjs");
};
const VITEST_SHIM = findShim();

/** Build the vitest invocation for the given test paths (via the shim).
 *  The shim path is injectable so tests can exercise the Windows backslash
 *  normalisation without touching the real checkout. */
const vitestCmd = (testPaths, shim = VITEST_SHIM) =>
  [
    "node",
    "--import",
    `file:///${shim.replace(/\\/g, "/")}`.trim(),
    "node_modules/vitest/vitest.mjs",
    "run",
    ...testPaths,
    "--pool=threads",
  ].join(" ");

/** Locate a ruff binary.
 *
 * Preference order, all verified to run with --config pyproject.toml:
 *   1. .venv/Scripts/ruff.exe if present (project venv, matches CI's pin best)
 *   2. pre-commit cache v0.17.2 ruff.exe (the hook pin; .venv usually has no ruff
 *      because ruff is a pre-commit-only dev dependency)
 *   3. the project venv python running `python -m ruff` (falls back to whatever
 *      ruff version uv resolved, without uv run's sync side-effects)
 *   4. global ruff on PATH
 * Returns the command prefix (array) to use, or null if nothing usable.
 * Dependencies (root/home/spawn/exists/readdir) are injectable for tests.
 */
const findRuff = (deps = {}) => {
  const root = deps.root ?? ROOT;
  const home = deps.home ?? process.env.HOME ?? "";
  const spawn = deps.spawn ?? spawnSync;
  const exists = deps.exists ?? existsSync;
  const readdir = deps.readdir ?? readdirSync;
  // 1. project venv binary
  const venvExe = join(root, ".venv", "Scripts", "ruff.exe");
  if (exists(venvExe)) return [venvExe];
  // 2. pre-commit cache v0.17.2
  const cacheRoots = [join(home, ".cache", "pre-commit")];
  const dirs = cacheRoots.flatMap(d => {
    try {
      return readdir(d, { withFileTypes: true })
        .filter(e => e.isDirectory() && e.name.startsWith("repo"))
        .map(e => join(d, e.name));
    } catch {
      return [];
    }
  });
  for (const dir of dirs) {
    const exe = join(dir, "py_env-python3", "Scripts", "ruff.exe");
    if (exists(exe)) {
      const r = spawn(exe, ["--version"], { encoding: "utf8" });
      if (r.status === 0 && /0\.17\.2/.test(r.stdout)) return [exe];
    }
  }
  // 3. project venv python -m ruff
  const venvPy = join(root, ".venv", "Scripts", "python.exe");
  if (exists(venvPy)) {
    const r = spawn(venvPy, ["-m", "ruff", "--version"], { encoding: "utf8" });
    if (r.status === 0 && r.stdout.trim()) return [venvPy, "-m", "ruff"];
  }
  // 4. global ruff on PATH
  const r = spawn("ruff", ["--version"], { encoding: "utf8" });
  if (r.status === 0 && r.stdout.trim()) return ["ruff"];
  return null;
};

/** Collect the set of changed file paths (branch commits vs merge-base, plus
 * unstaged and staged working-tree changes), excluding .foliplus scratch.
 * @param {{mergeBase?: string, changedFiles?: string[], run?: Function}} [deps]
 * @returns {string[]}
 */
const collectChangedFiles = (deps = {}) => {
  const runCmd = deps.run ?? sh;
  const run = c => {
    if (deps.changedFiles) return deps.changedFiles.join("\n");
    const r = runCmd(c);
    return (r.status === 0 ? r.stdout : "").trim();
  };
  const base =
    (deps.mergeBase ?? run("git merge-base origin/main HEAD")) || "origin/main";
  const changed = new Set();
  for (const c of [
    `git diff --name-only --diff-filter=ACMR ${base}...HEAD`,
    "git diff --name-only --diff-filter=ACMR",
    "git diff --name-only --cached --diff-filter=ACMR",
  ]) {
    const s = run(c);
    if (s) for (const f of s.split(/\r?\n/)) if (f) changed.add(f);
  }
  return [...changed].filter(f => !f.startsWith(".foliplus/"));
};

/**
 * Map changed files to the vitest path(s) that cover them. A changed prod
 * file maps to its sibling test file when one exists, else to its test dir;
 * a top-level foliplus/js file maps to its test file or the whole test/js.
 * @param {string[]} files
 * @param {(p: string) => boolean} [exists] file-existence probe (injectable for tests)
 * @returns {string[]} deduped relative test paths (file or dir), or [] if none
 */
const mapJsTests = (files, exists = p => existsSync(resolve(ROOT, p))) => {
  const out = new Set();
  for (const f of files) {
    if (f.startsWith("foliplus/js/")) {
      const rel = f.slice("foliplus/js/".length);
      if (!rel.includes("/")) {
        const t = `test/js/${rel.replace(/\.ts$/, ".test.ts")}`;
        out.add(exists(t) ? t : "test/js");
      } else {
        const top = rel.split("/")[0];
        const dir = `test/js/${top}`;
        const rest = rel.split("/").slice(1).join("/").replace(/\.ts$/, "");
        const exact = `${dir}/${rest}.test.ts`;
        if (exists(exact)) out.add(exact);
        else if (exists(dir)) out.add(dir);
      }
    } else if (f.startsWith("script/") && /\.(mjs|cjs|js)$/.test(f)) {
      const rel = f.slice("script/".length).replace(/\.(mjs|cjs|js)$/, ".test.ts");
      if (exists(`test/js/script/${rel}`)) out.add(`test/js/script/${rel}`);
    }
  }
  return [...out];
};

/**
 * Map changed files to the pytest path(s) that cover them. A changed
 * foliplus/X.py maps to test/python/X/ (or X.py); a changed test/python
 * file maps to itself.
 * @param {string[]} files
 * @param {(p: string) => boolean} [exists] file-existence probe (injectable for tests)
 * @returns {string[]} deduped relative pytest paths (dir or file), or [] if none
 */
const mapPyTests = (files, exists = p => existsSync(resolve(ROOT, p))) => {
  const out = new Set();
  for (const f of files) {
    if (f.startsWith("test/python/")) {
      if (f.endsWith(".py")) out.add(f);
    } else if (f.startsWith("foliplus/") && f.endsWith(".py")) {
      const base = f.slice("foliplus/".length).replace(/\.py$/, "");
      if (exists(`test/python/${base}`)) out.add(`test/python/${base}`);
      else if (exists(`test/python/${base}.py`)) {
        out.add(`test/python/${base}.py`);
      }
    }
  }
  return [...out];
};

/** Best-effort fetch so merge-base(origin/main, HEAD) is current. A failure
 * only warns; the local origin/main ref is used and the real base printed.
 * run and io are injectable for tests. */
const fetchOriginMain = (deps = {}) => {
  const run = deps.run ?? sh;
  const io = deps.io ?? defaultIo;
  const r = run("git fetch origin main");
  if (r.status === 0) {
    io.log(`${DIM}fetched origin/main ok${RESET}`);
  } else {
    const msg = (r.stderr || r.stdout || "git fetch failed").trim().split("\n")[0];
    io.log(
      `${YELLOW}! git fetch origin main failed (continuing with local ref): ${msg}${RESET}`,
    );
  }
};

/** Resolve the diff base from a merge-base command output.
 * @param {{stdout?: string}} r
 * @returns {string}
 */
const resolveBase = r => (r.stdout || "").trim() || "origin/main";

/**
 * Build the ordered gate list for the given changed files. Pure: it never
 * runs a command. The ruff command prefix, the vitest command builder and the
 * pytest exe are injected so tests can pin the exact commands without the
 * toolchain. `io` is used only for the "no ruff" warning.
 * @param {string[]} files
 * @param {{ruff?: string[]|null, vitestCmdFn?: Function, pytestExe?: string,
 *          io?: {log: Function, err: Function, write: Function},
 *          exists?: (p: string) => boolean}} [opts]
 * @returns {{name: string, cmd: string|null, fix: string|null}[]}
 */
const buildGates = (files, opts = {}) => {
  const {
    ruff,
    vitestCmdFn = vitestCmd,
    pytestExe = PYTEST_EXE,
    io = defaultIo,
    exists,
  } = opts;
  const gates = [];
  const gate = (name, cmd, fix) => gates.push({ name, cmd, fix });

  gate(
    "typecheck",
    "npm run typecheck",
    "npm run typecheck — fix the reported tsc / typecheck-test / eslint-typed errors",
  );

  const prettierFiles = files.filter(
    f => PRETTIER_EXT.test(f) && !f.endsWith("CHANGELOG.md"),
  );
  if (prettierFiles.length) {
    gate(
      "prettier",
      `npx prettier --check ${prettierFiles.join(" ")}`,
      `npx prettier --write ${prettierFiles.join(" ")}  then re-run`,
    );
  } else gate("prettier (no changed formattable files)", null, null);

  const eslintFiles = files.filter(f => ESLINT_EXT.test(f));
  if (eslintFiles.length) {
    gate(
      "eslint",
      `npx eslint -c config/eslint/typed.mjs ${eslintFiles.join(" ")}`,
      `npx eslint --fix -c config/eslint/typed.mjs ${eslintFiles.join(
        " ",
      )}  then re-run`,
    );
  } else gate("eslint (no changed JS/TS files)", null, null);

  const pyFiles = files.filter(f => f.endsWith(".py"));
  if (ruff) {
    const ruffCmd = ruff.map(a => (/[/\\\s]/.test(a) ? `"${a}"` : a)).join(" ");
    if (pyFiles.length) {
      gate(
        "ruff",
        `${ruffCmd} check --config pyproject.toml ${pyFiles.join(" ")}`,
        `${ruffCmd} check --fix --config pyproject.toml ${pyFiles.join(
          " ",
        )}  then re-run`,
      );
      gate(
        "ruff-format",
        `${ruffCmd} format --check --config pyproject.toml ${pyFiles.join(" ")}`,
        `${ruffCmd} format ${pyFiles.join(" ")}  then re-run`,
      );
    } else gate("ruff (no changed .py files)", null, null);
  } else {
    io.log(
      `${YELLOW}! no ruff binary found (.venv/Scripts/ruff.exe, pre-commit cache v0.17.2, or python -m ruff) — skipping ruff gates${RESET}`,
    );
  }

  gate(
    "listener-guard + toolchain-guard",
    vitestCmdFn(["test/js/listener-guard.test.ts", "test/js/toolchain-guard.test.ts"]),
    "a bare addEventListener / L.DomEvent.on slipped in, or a script-module rule broke — see test/js/listener-guard.test.ts and test/js/toolchain-guard.test.ts",
  );

  const jsTests = mapJsTests(files, exists);
  if (jsTests.length) {
    gate(
      "vitest (changed-file tests)",
      vitestCmdFn(jsTests),
      "fix the failing vitest test(s)",
    );
  } else gate("vitest (no changed-file tests)", null, null);

  const pyTests = mapPyTests(files, exists);
  if (pyTests.length) {
    if (pyFiles.length) {
      gate(
        "build-js-dev (before pytest)",
        "npm run build:dev",
        "npm run build:dev failed — the Python layer reads foliplus/dist/",
      );
    }
    gate(
      "pytest (changed-file tests, non-browser)",
      `${pytestExe} -m pytest ${pyTests.join(" ")} -m "not browser" -q --no-cov`,
      "fix the failing pytest test(s)",
    );
  } else gate("pytest (no changed-file tests)", null, null);
  gate(
    "pytest test_locale.py",
    `${pytestExe} -m pytest test/python/test_locale.py -q --no-cov`,
    "an unused locale key / a T() key mismatch — fix the locale table or the key usage",
  );

  gate(
    "changelog_check --skip-exists",
    "python script/check/changelog_check.py --skip-exists",
    "CHANGELOG.md bullet order / PR-number sort — run python script/check/changelog_check.py --fix",
  );
  gate(
    "mojibake_check (full tree)",
    "python script/check/mojibake_check.py --all",
    "a U+FFFD replacement char slipped in (encoding round-trip) — restore the original char",
  );
  gate(
    "dead_barrel_export",
    "python script/check/dead_barrel_export.py",
    "a dead barrel/type.ts export — remove the export or the symbol",
  );

  return gates;
};

/**
 * Run the gate list, aborting on the first failure. Returns true when a
 * gate failed. run and io are injectable for tests (no real subprocess).
 * @param {{name: string, cmd: string|null, fix: string|null}[]} gates
 * @param {(cmd: string, env?: Record<string, string|undefined>) => SpawnResult} [run]
 * @param {{log: Function, err: Function, write: Function}} [io]
 * @returns {boolean}
 */
const runGates = (gates, run = sh, io = defaultIo) => {
  io.log();
  let failed = false;
  for (const { name, cmd, fix } of gates) {
    if (!cmd) {
      io.log(`${GREEN}✓ ${name} (skip)${RESET}`);
      continue;
    }
    io.write(`${DIM}→ ${name} ... ${RESET}`);
    const r = run(cmd);
    if (r.status === 0) {
      io.log(`${GREEN}✓${RESET}`);
    } else {
      io.log(`${RED}✗${RESET}`);
      if (r.stdout) io.log(r.stdout);
      if (r.stderr) io.err(r.stderr);
      io.err(`${RED}✗ GATE FAILED: ${name}${RESET}`);
      if (fix) io.err(`${YELLOW}  fix: ${fix}${RESET}`);
      failed = true;
      break;
    }
  }
  io.log();
  return failed;
};

/**
 * Resolve the injectable dependencies for a make-check run. run/io default to
 * the real runner/console; ruff defaults to findRuff() unless an explicit
 * null/array is passed (null skips the ruff gates).
 * @param {{run?: (cmd: string, env?: Record<string, string|undefined>) => SpawnResult,
 *          io?: {log: Function, err: Function, write: Function},
 *          ruff?: string[]|null, vitestCmdFn?: Function, pytestExe?: string}} [deps]
 * @returns {{run: (cmd: string, env?: Record<string, string|undefined>) => SpawnResult,
 *            io: {log: Function, err: Function, write: Function},
 *            ruff: string[]|null}}
 */
const resolveDeps = (deps = {}) => ({
  run: deps.run ?? sh,
  io: deps.io ?? defaultIo,
  ruff: deps.ruff !== undefined ? deps.ruff : findRuff(),
});

/**
 * Run the local gates. Exits non-zero (via process.exitCode) on the first
 * failing gate. run/io/ruff/vitestCmdFn/pytestExe are injectable for tests;
 * omitted, they default to the real toolchain.
 * @param {{run?: (cmd: string, env?: Record<string, string|undefined>) => SpawnResult,
 *          io?: {log: Function, err: Function, write: Function},
 *          ruff?: string[]|null, vitestCmdFn?: Function, pytestExe?: string}} [deps]
 * @returns {number}
 */
const main = (deps = {}) => {
  const { run, io, ruff } = resolveDeps(deps);
  fetchOriginMain({ run, io });
  const files = collectChangedFiles({ run });
  const base = resolveBase(run("git merge-base origin/main HEAD"));
  io.log(
    `${DIM}base: ${base}  changed (${files.length}): ${
      files.length ? files.join(", ") : "none"
    }${RESET}`,
  );

  const gates = buildGates(files, {
    ruff,
    vitestCmdFn: deps.vitestCmdFn,
    pytestExe: deps.pytestExe,
    io,
  });
  const failed = runGates(gates, run, io);
  if (failed) {
    io.err(`${RED}❌ make check: one or more local gates failed${RESET}`);
    process.exitCode = 1;
    return 1;
  }
  io.log(`${GREEN}✅ make check: all local gates green${RESET}`);
  return 0;
};

export {
  ROOT,
  PYTEST_EXE,
  pytestExeFor,
  resolveDeps,
  sh,
  RED,
  GREEN,
  YELLOW,
  DIM,
  RESET,
  defaultIo,
  PRETTIER_EXT,
  ESLINT_EXT,
  findShim,
  VITEST_SHIM,
  vitestCmd,
  findRuff,
  collectChangedFiles,
  mapJsTests,
  mapPyTests,
  fetchOriginMain,
  resolveBase,
  isCliEntry,
  buildGates,
  runGates,
  main,
};

// Only run the gates when invoked as a CLI (not when imported by a test).
const isCliEntry = entry =>
  import.meta.url === pathToFileURL(resolve(entry ?? "")).href;

if (isCliEntry(process.argv[1])) {
  main();
}
