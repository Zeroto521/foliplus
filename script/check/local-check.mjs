#!/usr/bin/env node
/**
 * local-check.mjs — `make check`, the local fast gate.
 *
 * It reuses the tool definitions the repo already has instead of re-deriving
 * them per tool:
 *   - prettier / eslint   changed files, same config CI uses (`npm run
 *                         format:check` / `npm run lint` globs)
 *   - pre-commit          every changed-file hook (ruff, ruff-format, mypy,
 *                         codespell, style, mojibake, changelog order,
 *                         EOF/whitespace)
 *   - vitest `related`    the JS tests that import the changed files
 *   - pytest              the full non-browser suite, when Python changed
 *   - full-tree guards    listener/toolchain suites, and mojibake via
 *                         `git grep -I` (dead-barrel export is a pre-commit
 *                         hook, so it runs on changed files above)
 *
 * The full suite, docs build, bundle gates and browser tests stay in PR CI.
 *
 * Gates run cheapest-first and all of them run: the summary at the end names
 * every failure, so one pass tells you everything to fix (`--fail-fast` stops
 * at the first red).
 *
 * Usage:
 *   node script/check/local-check.mjs [--list] [--fail-fast] [--no-fetch]
 *                                     [--base <ref>]
 *
 * The diff base is merge-base(origin/main, HEAD) after a best-effort
 * `git fetch origin main`. Committed, staged, unstaged and untracked changes
 * are all included. Paths are passed as argv (never through a shell) and read
 * from `git ... -z`, so spaces and non-ASCII names survive intact.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const U_FFFD = "\uFFFD";
/** pre-commit re-spawns each hook with the file list, and cmd.exe caps a
 *  command line at 8191 chars — 60 paths per run stays well under it. */
const PRECOMMIT_CHUNK = 60;
const JS_EXT = /\.(ts|js|mjs|cjs|css)$/;
const SOURCE_PREFIX = ["foliplus/", "script/", "config/", "test/js/"];
/** The globs `npm run format:check` covers — anything outside them is not a
 *  prettier target, so a local run never reds a file CI does not check. */
const PRETTIER_GLOB =
  /^(foliplus\/js\/.*\.(js|ts)|foliplus\/css\/.*\.css|script\/.*\.(js|cjs|mjs|ts)|test\/js\/.*\.(js|ts)|config\/.*\.mjs|eslint\.config\.js)$/;
/** The globs `npm run lint` covers (non-type-aware pass). */
const ESLINT_GLOB =
  /^(foliplus\/js\/.*\.ts|test\/js\/.*\.ts|script\/.*\.mjs|config\/.*\.mjs|eslint\.config\.js)$/;
const PRETTIER_BIN = "node_modules/prettier/bin/prettier.cjs";
const ESLINT_BIN = "node_modules/eslint/bin/eslint.js";
/** A change here means pytest has something new to cover. */
const PY_CHANGED =
  /^(foliplus\/.*\.py|test\/python\/.*\.py|script\/.*\.py|pyproject\.toml)$/;

const COLORS = {
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
};

/** Respect NO_COLOR and non-TTY output (CI logs, redirected files). */
const colorEnabled = (env = process.env, isTTY = process.stdout.isTTY) =>
  Boolean(isTTY) && !env.NO_COLOR;

const useColor = colorEnabled();

/**
 * Wrap `text` in a terminal color when `enabled`.
 * @param {boolean} enabled
 * @param {"red"|"green"|"yellow"|"dim"} name
 * @param {string} text
 * @returns {string}
 */
const paint = (enabled, name, text) =>
  enabled ? `${COLORS[name]}${text}${COLORS.reset}` : text;

const c = (name, text) => paint(useColor, name, text);

/** Default console IO — injectable so tests capture without touching stdout. */
const defaultIo = {
  log: (...args) => console.log(...args),
  err: (...args) => console.error(...args),
  write: s => process.stdout.write(s),
};

/**
 * The subset of spawnSync's result this script reads. Looser than
 * SpawnSyncReturns on purpose: `main`/`runGates` are called with fakes in
 * their tests, so the injectable run signature is this shape.
 *
 * @typedef {{error?: unknown, status?: number | null, stdout?: string,
 *            stderr?: string}} SpawnResult
 * @typedef {{argv: string[], shell?: boolean,
 *            env?: Record<string, string|undefined>}} Command
 * @typedef {{name: string, cmds: Command[], fix: string|null,
 *            ok?: (r: SpawnResult) => boolean, error?: string}} Gate
 */

/**
 * Run one command. File paths live in `argv`, so no shell ever parses them;
 * the two npm invocations are literals and opt into `shell` (npm is a .cmd
 * shim on Windows, which Node cannot spawn without one).
 * @param {Command} cmd
 * @param {{spawn?: Function, cwd?: string}} [deps]
 * @returns {SpawnResult}
 */
const runCmd = (cmd, deps = {}) => {
  const spawn = deps.spawn ?? spawnSync;
  const [exe, ...args] = cmd.argv;
  return spawn(exe, args, {
    cwd: deps.cwd ?? ROOT,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    shell: cmd.shell ?? false,
    env: { ...process.env, ...cmd.env },
  });
};

/** npm's Windows shim cannot be spawned directly; the command line is a
 *  literal here, so `shell: true` adds no injection surface. */
const NPM = script => ({ argv: [`npm ${script}`], shell: true });

/** The venv python, relative to the repo root. */
const pytestExeFor = platform =>
  join(
    ".venv",
    platform === "win32" ? "Scripts" : "bin",
    platform === "win32" ? "python.exe" : "python",
  );

/** The venv pre-commit, relative to the repo root. */
const preCommitExeFor = (platform = process.platform) =>
  join(
    ".venv",
    platform === "win32" ? "Scripts" : "bin",
    platform === "win32" ? "pre-commit.exe" : "pre-commit",
  );

/**
 * Resolve the pre-commit executable: the project venv first, then PATH.
 * @param {{root?: string, exists?: (p: string) => boolean}} [deps]
 * @returns {string}
 */
const findPreCommit = (deps = {}) => {
  const root = deps.root ?? ROOT;
  const exists = deps.exists ?? existsSync;
  const exe = resolve(root, preCommitExeFor());
  return exists(exe) ? exe : "pre-commit";
};

/**
 * Is `pre-commit` runnable from PATH? `make env` does not install it (it is
 * in neither the `test` nor the `dev` group), so a fresh checkout can reach
 * this gate with nothing to spawn — worth a clear message instead of ENOENT.
 * @param {{run?: Function, platform?: string}} [deps]
 * @returns {boolean}
 */
const preCommitOnPath = (deps = {}) => {
  const run = deps.run ?? runCmd;
  const platform = deps.platform ?? process.platform;
  const which = platform === "win32" ? "where" : "which";
  return run({ argv: [which, "pre-commit"] }).status === 0;
};

/**
 * The vitest spawn shim — needed on Windows for jsdom runs.
 *
 * The shim lives in `.foliplus/` of the main checkout; a git worktree has no
 * `.foliplus/` of its own, so walk up the directory chain. Missing is normal
 * (fresh clone, CI, POSIX), so callers add it only when it exists.
 * @param {{root?: string, exists?: (p: string) => boolean}} [deps]
 * @returns {string}
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

/**
 * `node --import` args for the shim, or none. Windows-only: on POSIX the
 * sandbox workaround the shim exists for does not apply.
 * @param {{shim?: string, exists?: (p: string) => boolean,
 *          platform?: string}} [deps]
 * @returns {string[]}
 */
const shimArgs = (deps = {}) => {
  const shim = deps.shim ?? VITEST_SHIM;
  const exists = deps.exists ?? existsSync;
  const platform = deps.platform ?? process.platform;
  if (platform !== "win32" || !exists(shim)) return [];
  return ["--import", pathToFileURL(shim).href];
};

/**
 * `vitest run` for an explicit test list (the full-tree guards).
 * @param {string[]} testPaths
 * @param {object} [deps] forwarded to shimArgs
 * @returns {Command}
 */
const vitestRun = (testPaths, deps = {}) => ({
  argv: [
    "node",
    ...shimArgs(deps),
    "node_modules/vitest/vitest.mjs",
    "run",
    ...testPaths,
    "--pool=threads",
  ],
});

/**
 * `vitest related` — the tests that import any of `sources`, including a
 * changed test file itself. Vitest owns the import graph; no path mapping
 * here to drift out of date.
 * @param {string[]} sources
 * @param {object} [deps] forwarded to shimArgs
 * @returns {Command}
 */
const vitestRelated = (sources, deps = {}) => ({
  argv: [
    "node",
    ...shimArgs(deps),
    "node_modules/vitest/vitest.mjs",
    "related",
    "--run",
    ...sources,
    "--pool=threads",
    "--passWithNoTests",
  ],
});

/** Split `git ... -z` output. */
const splitNul = s => (s ? s.split("\0").filter(Boolean) : []);

/**
 * Resolve the diff base from a merge-base result.
 * @param {SpawnResult} r
 * @returns {string} the base sha, or "origin/main" when it could not be read
 */
const resolveBase = r => {
  const sha = (r.stdout || "").trim();
  return r.status === 0 && sha ? sha : "origin/main";
};

/**
 * Collect changed paths (branch commits vs the merge-base, plus staged,
 * unstaged and untracked working-tree files), excluding .foliplus scratch.
 * Untracked files matter: a new source or test file is exactly what a
 * "run the tests I touched" workflow forgets to lint.
 * @param {{run?: Function, io?: {log: Function}, base?: string}} [deps]
 * @returns {string[]}
 */
const collectChangedFiles = (deps = {}) => {
  const run = deps.run ?? runCmd;
  const io = deps.io ?? defaultIo;
  const base =
    deps.base ??
    resolveBase(run({ argv: ["git", "merge-base", "origin/main", "HEAD"] }));
  const changed = new Set();
  const add = r => {
    if (r.status !== 0) return false;
    for (const f of splitNul(r.stdout ?? "")) changed.add(f);
    return true;
  };
  const branch = [
    "git",
    "diff",
    "--name-only",
    "-z",
    "--diff-filter=ACMR",
    `${base}...HEAD`,
  ];
  if (!add(run({ argv: branch }))) {
    io.log(
      c("yellow", `! ${branch.join(" ")} failed — checking working-tree changes only`),
    );
  }
  add(run({ argv: ["git", "diff", "--name-only", "-z", "--diff-filter=ACMR"] }));
  add(
    run({
      argv: ["git", "diff", "--name-only", "-z", "--cached", "--diff-filter=ACMR"],
    }),
  );
  // New files are untracked until someone `git add`s them; they still need
  // prettier/eslint/pre-commit, so they belong in the change set.
  add(run({ argv: ["git", "ls-files", "--others", "--exclude-standard", "-z"] }));
  return [...changed].filter(f => !f.startsWith(".foliplus/"));
};

/**
 * Resolve the repo root so `make check` also works from a subdirectory.
 * @param {Function} [run]
 * @returns {string}
 */
const resolveRoot = (run = runCmd) => {
  const r = run({ argv: ["git", "rev-parse", "--show-toplevel"] });
  const out = (r.stdout || "").trim();
  return r.status === 0 && out ? out : process.cwd();
};

/** Best-effort fetch so merge-base(origin/main, HEAD) is current. A failure
 *  only warns; the local origin/main ref is used. */
const fetchOriginMain = (deps = {}) => {
  const run = deps.run ?? runCmd;
  const io = deps.io ?? defaultIo;
  const r = run({ argv: ["git", "fetch", "--no-tags", "origin", "main"] });
  if (r.status === 0) {
    io.log(c("dim", "fetched origin/main ok"));
    return;
  }
  const msg = (r.stderr || r.stdout || "git fetch failed").trim().split("\n")[0];
  io.log(
    c("yellow", `! git fetch origin main failed (continuing with local ref): ${msg}`),
  );
};

/** Changed files that vitest `related` should look at. */
const jsSources = files =>
  files.filter(
    f => JS_EXT.test(f) && SOURCE_PREFIX.some(prefix => f.startsWith(prefix)),
  );

/** True when the change set touches Python (or its dependency manifest). */
const pyChanged = files => files.some(f => PY_CHANGED.test(f));

/** Split a list into fixed-size batches. */
const chunk = (items, size) => {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/** One-line preview of a long path list. */
const preview = (items, limit = 8) =>
  items.length > limit
    ? `${items.slice(0, limit).join(", ")}, … (+${items.length - limit})`
    : items.join(", ");

/** "1 changed file" / "3 changed files". */
const filesWord = n => `${n} changed file${n === 1 ? "" : "s"}`;

/**
 * Build the ordered gate list. Pure: it never runs a command, so tests pin
 * the exact argv without the toolchain.
 * @param {string[]} files
 * @param {{io?: object, preCommit?: string, hasPreCommit?: boolean,
 *          pytestExe?: string, hasPython?: boolean, shim?: string,
 *          exists?: (p: string) => boolean, platform?: string}} [opts]
 * @returns {Gate[]}
 */
const buildGates = (files, opts = {}) => {
  const {
    io = defaultIo,
    preCommit = "pre-commit",
    hasPreCommit = true,
    pytestExe = resolve(ROOT, pytestExeFor(process.platform)),
    hasPython = true,
    shim = VITEST_SHIM,
    exists = existsSync,
    platform = process.platform,
  } = opts;
  const vOpts = { shim, exists, platform };
  const gates = [];
  const gate = (name, cmds, fix, extra = {}) =>
    gates.push({ name, cmds, fix, ...extra });

  const prettierFiles = files.filter(f => PRETTIER_GLOB.test(f));
  if (prettierFiles.length) {
    gate(
      `prettier (${filesWord(prettierFiles.length)})`,
      [{ argv: ["node", PRETTIER_BIN, "--check", ...prettierFiles] }],
      `npx prettier --write ${preview(prettierFiles, 4)}  then re-run`,
    );
  } else {
    gate("prettier (no changed formattable files)", [], null);
  }

  const eslintFiles = files.filter(f => ESLINT_GLOB.test(f));
  if (eslintFiles.length) {
    gate(
      `eslint (${filesWord(eslintFiles.length)})`,
      [
        {
          argv: ["node", ESLINT_BIN, "-c", "config/eslint/typed.mjs", ...eslintFiles],
        },
      ],
      `npx eslint --fix -c config/eslint/typed.mjs ${preview(eslintFiles, 4)}  then re-run`,
    );
  } else {
    gate("eslint (no changed JS/TS files)", [], null);
  }

  if (files.length && hasPreCommit) {
    const batches = chunk(files, PRECOMMIT_CHUNK).map(batch => ({
      argv: [preCommit, "run", "--files", ...batch, "--show-diff-on-failure"],
    }));
    gate(
      `pre-commit (${filesWord(files.length)})`,
      batches,
      "a hook rewrote or rejected a file — review the diff above, then re-run make check",
    );
  } else if (files.length) {
    gate(
      "pre-commit (not installed)",
      [],
      "install it: `uv pip install pre-commit` (or `pipx install pre-commit`)",
      {
        error: "pre-commit is not on PATH and not in .venv",
      },
    );
  } else {
    gate("pre-commit (no changed files)", [], null);
  }

  // git grep -I is git's own text filter: it skips binaries (and .gitattributes
  // `-text` paths) and scans 1277 files in ~0.3s, in one process.
  gate(
    "mojibake (full tree)",
    [{ argv: ["git", "grep", "-I", "-n", "--no-color", "-e", U_FFFD] }],
    "a U+FFFD replacement char slipped in — restore the original character",
    { ok: r => r.status === 1 },
  );

  gate(
    "guards (listener + toolchain, full tree)",
    [
      vitestRun(
        ["test/js/listener-guard.test.ts", "test/js/toolchain-guard.test.ts"],
        vOpts,
      ),
    ],
    "a bare addEventListener / L.DomEvent.on slipped in, or a script-module rule broke",
  );

  const sources = jsSources(files);
  if (sources.length) {
    gate(
      `vitest related (${sources.length} source file${sources.length === 1 ? "" : "s"})`,
      [vitestRelated(sources, vOpts)],
      "fix the failing vitest test(s)",
    );
  } else {
    gate("vitest related (no changed JS/TS files)", [], null);
  }

  gate(
    "typecheck",
    [NPM("run typecheck")],
    "npm run typecheck — fix the reported tsc / typecheck-test errors",
  );

  if (pyChanged(files)) {
    if (!hasPython) {
      gate(
        "pytest (no .venv)",
        [],
        "run `make env` to create .venv, then re-run make check",
        {
          error: "Python changed but .venv is missing",
        },
      );
    } else {
      gate(
        "build-js-dev (pytest reads foliplus/dist/)",
        [NPM("run build:dev")],
        "npm run build:dev failed — the Python layer reads foliplus/dist/",
      );
      gate(
        "pytest (full non-browser suite)",
        [
          {
            argv: [
              pytestExe,
              "-m",
              "pytest",
              "-m",
              "not browser",
              "-n",
              "auto",
              "-q",
              "--no-cov",
              "test/python",
            ],
          },
        ],
        "fix the failing pytest test(s)",
      );
    }
  } else if (!hasPython) {
    io.log(
      c(
        "yellow",
        "! no .venv — skipping the Python locale check (run `make env` to enable it)",
      ),
    );
    gate("pytest test_locale (no .venv)", [], null);
  } else {
    // JS-only change: locale keys cross the JS/Python boundary, so the cheap
    // cross-language check still runs.
    gate(
      "pytest test_locale (cross-language keys)",
      [
        {
          argv: [
            pytestExe,
            "-m",
            "pytest",
            "test/python/test_locale.py",
            "-q",
            "--no-cov",
          ],
        },
      ],
      "an unused locale key / a T() key mismatch — fix the locale table or the key usage",
    );
  }

  return gates;
};

/**
 * Run the gate list. Returns the failing gates (empty = green).
 * @param {Gate[]} gates
 * @param {{run?: Function, io?: object, failFast?: boolean}} [deps]
 * @returns {Gate[]}
 */
const runGates = (gates, deps = {}) => {
  const run = deps.run ?? runCmd;
  const io = deps.io ?? defaultIo;
  const failFast = deps.failFast ?? false;
  const failed = [];
  io.log();
  for (const g of gates) {
    if (g.error) {
      io.err(`${c("red", "✗")} ${g.name} — ${g.error}`);
      if (g.fix) io.err(c("yellow", `  fix: ${g.fix}`));
      failed.push(g);
      if (failFast) break;
      continue;
    }
    if (!g.cmds.length) {
      io.log(`${c("green", "✓")} ${g.name} (skip)`);
      continue;
    }
    io.write(`${c("dim", `→ ${g.name} ... `)}`);
    const started = Date.now();
    let bad = null;
    for (const cmd of g.cmds) {
      const r = run(cmd);
      if (!(g.ok ? g.ok(r) : r.status === 0)) {
        bad = r;
        break;
      }
    }
    if (!bad) {
      io.log(
        `${c("green", "✓")} ${c("dim", `${((Date.now() - started) / 1000).toFixed(1)}s`)}`,
      );
      continue;
    }
    io.log(c("red", "✗"));
    if (bad.stdout) io.log(bad.stdout);
    if (bad.stderr) io.err(bad.stderr);
    if (bad.error) io.err(String(bad.error.message ?? bad.error));
    if (g.fix) io.err(c("yellow", `  fix: ${g.fix}`));
    failed.push(g);
    if (failFast) break;
  }
  io.log();
  return failed;
};

/**
 * Parse CLI flags.
 * @param {string[]} argv
 * @returns {{list: boolean, failFast: boolean, fetch: boolean,
 *            help: boolean, base?: string, unknown: string[]}}
 */
const parseArgs = argv => {
  const out = {
    list: false,
    failFast: false,
    fetch: true,
    help: false,
    base: undefined,
    unknown: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--list" || a === "--dry-run") out.list = true;
    else if (a === "--fail-fast") out.failFast = true;
    else if (a === "--no-fetch") out.fetch = false;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--base") out.base = argv[(i += 1)];
    else if (a.startsWith("--base=")) out.base = a.slice("--base=".length);
    else out.unknown.push(a);
  }
  return out;
};

/** Render a command for display only (never for execution). The U+FFFD probe
 *  is escaped so `--list` does not print a replacement char that looks like
 *  mojibake of its own. */
const formatCmd = cmd =>
  cmd.shell
    ? cmd.argv[0]
    : cmd.argv
        .map(a => (/[\s"'$`]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a))
        .join(" ")
        .replaceAll(U_FFFD, "\\uFFFD");

const printHelp = io => {
  io.log("usage: node script/check/local-check.mjs [options]");
  io.log("");
  io.log("  --list        print the gates and commands without running them");
  io.log("  --fail-fast   stop at the first failing gate");
  io.log("  --no-fetch    do not `git fetch origin main` (use the local ref)");
  io.log("  --base <ref>  diff base (default: merge-base(origin/main, HEAD))");
  io.log("  -h, --help    show this help");
};

const printGates = (gates, io) => {
  io.log();
  for (const g of gates) {
    if (g.error) io.log(`${g.name} — unavailable: ${g.error}`);
    else if (!g.cmds.length) io.log(`${g.name} — skip`);
    else for (const cmd of g.cmds) io.log(`${g.name}:\n  ${formatCmd(cmd)}`);
  }
};

/**
 * Run the local gates. Exits non-zero (via process.exitCode) when any gate
 * fails. run/io/argv are injectable for tests; omitted, they default to the
 * real toolchain.
 * @param {object} [deps]
 * @returns {number}
 */
const main = (deps = {}) => {
  const io = deps.io ?? defaultIo;
  const rawRun = deps.run ?? runCmd;
  const argv = deps.argv ?? process.argv.slice(2);
  const opts = parseArgs(argv);

  if (opts.unknown.length) {
    io.err(c("red", `unknown argument(s): ${opts.unknown.join(" ")} — see --help`));
    process.exitCode = 2;
    return 2;
  }
  if (opts.help) {
    printHelp(io);
    return 0;
  }

  const root = deps.root ?? resolveRoot(rawRun);
  const run = deps.run ? rawRun : cmd => runCmd(cmd, { cwd: root });

  if (opts.fetch && !opts.base) fetchOriginMain({ run, io });
  else if (opts.base) io.log(c("dim", `base pinned to ${opts.base} (no fetch)`));
  else io.log(c("dim", "using the local origin/main ref (no fetch)"));

  const base =
    opts.base ??
    resolveBase(run({ argv: ["git", "merge-base", "origin/main", "HEAD"] }));
  const files = collectChangedFiles({ run, io, base });
  const pytestExe = resolve(root, pytestExeFor(process.platform));
  const preCommit = deps.preCommit ?? findPreCommit({ root });
  const hasPreCommit =
    deps.hasPreCommit ??
    (preCommit !== "pre-commit" || preCommitOnPath({ run, platform: deps.platform }));
  const gates = buildGates(files, {
    io,
    preCommit,
    hasPreCommit,
    pytestExe,
    hasPython: deps.hasPython ?? existsSync(pytestExe),
    shim: deps.shim,
    exists: deps.exists,
    platform: deps.platform,
  });

  io.log(
    c(
      "dim",
      `base: ${base}  changed (${files.length}): ${files.length ? preview(files) : "none"}`,
    ),
  );

  if (opts.list) {
    printGates(gates, io);
    return 0;
  }

  const failed = runGates(gates, { run, io, failFast: opts.failFast });
  const active = gates.filter(g => g.cmds.length || g.error).length;
  if (failed.length) {
    io.err(c("red", `❌ make check: ${failed.length}/${active} gate(s) failed`));
    for (const g of failed) io.err(c("red", `   - ${g.name}`));
    process.exitCode = 1;
    return 1;
  }
  io.log(c("green", "✅ make check: all local gates green"));
  return 0;
};

// Only run the gates when invoked as a CLI (not when imported by a test).
const isCliEntry = entry =>
  Boolean(entry) && import.meta.url === pathToFileURL(resolve(entry)).href;

export {
  ROOT,
  U_FFFD,
  PRECOMMIT_CHUNK,
  COLORS,
  colorEnabled,
  paint,
  defaultIo,
  runCmd,
  NPM,
  pytestExeFor,
  preCommitExeFor,
  findPreCommit,
  preCommitOnPath,
  findShim,
  VITEST_SHIM,
  shimArgs,
  vitestRun,
  vitestRelated,
  splitNul,
  resolveBase,
  collectChangedFiles,
  resolveRoot,
  fetchOriginMain,
  jsSources,
  pyChanged,
  chunk,
  preview,
  buildGates,
  runGates,
  parseArgs,
  formatCmd,
  printGates,
  main,
  isCliEntry,
};

if (isCliEntry(process.argv[1])) {
  main();
}
