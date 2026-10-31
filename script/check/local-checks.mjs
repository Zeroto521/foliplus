#!/usr/bin/env node
/**
 * local-checks.mjs — `make check` implementation.
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
 *   9. repo scripts         — changelog_check --skip-exists, mojibake_check
 *      (full tree, batched), dead_barrel_export
 *
 * The diff base is merge-base(origin/main, HEAD) after a best-effort
 * `git fetch origin main` (a fetch failure only warns — the local
 * origin/main ref is used and the actual base sha is printed). Working-tree
 * unstaged and staged changes are included. The pure mapping helpers are
 * exported so the path-mapping rules are unit-tested
 * (test/js/script/check/local-checks.test.ts).
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

const ROOT = process.cwd();

// On Windows cmd.exe rejects forward slashes in command position, so the venv
// python.exe path must use backslashes (spawnSync with shell:true routes the
// whole command through cmd.exe /c).
const PYTEST_EXE =
  process.platform === "win32" ? ".venv\\Scripts\\python.exe" : ".venv/bin/python";
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

/** Prettier covers these; CHANGELOG.md is deliberately excluded (changelog_check owns it). */
const PRETTIER_EXT = /\.(ts|js|cjs|mjs|css|md|json)$/;
const ESLINT_EXT = /\.(ts|js|mjs|cjs)$/;

/** The vitest spawn shim — mandatory on Windows for jsdom runs. */
// The vitest spawn shim lives in .foliplus/ of the MAIN checkout. A git worktree
// (e.g. .foliplus/wt-*) has no .foliplus/ of its own, so walk up the directory
// chain until a .foliplus/vite-spawn-patch.mjs is found.
const findShim = () => {
  let dir = ROOT;
  for (;;) {
    const cand = resolve(dir, ".foliplus", "vite-spawn-patch.mjs");
    if (existsSync(cand)) return cand;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(ROOT, ".foliplus", "vite-spawn-patch.mjs");
};
const VITEST_SHIM = findShim();
const vitestCmd = testPaths =>
  [
    "node",
    "--import",
    `file:///${VITEST_SHIM.replace(/\\/g, "/")}`,
    "node_modules/vitest/vitest.mjs",
    "run",
    ...testPaths,
    "--pool=threads",
  ].join(" ");

/** The pinned ruff binary from the pre-commit cache (v0.17.2). */
const findRuff = () => {
  const cacheRoots = [join(process.env.HOME ?? "", ".cache", "pre-commit")];
  const dirs = cacheRoots.flatMap(d => {
    try {
      return readdirSync(d, { withFileTypes: true })
        .filter(e => e.isDirectory() && e.name.startsWith("repo"))
        .map(e => join(d, e.name));
    } catch {
      return [];
    }
  });
  for (const dir of dirs) {
    const exe = join(dir, "py_env-python3", "Scripts", "ruff.exe");
    if (existsSync(exe)) {
      const r = spawnSync(exe, ["--version"], { encoding: "utf8" });
      if (r.status === 0 && /0\.17\.2/.test(r.stdout)) return exe;
    }
  }
  return null;
};

/**
 * Collect the set of changed file paths (branch commits vs merge-base, plus
 * unstaged and staged working-tree changes), excluding .foliplus scratch.
 * @param {{mergeBase?: string, changedFiles?: string[]}} [deps]
 * @returns {string[]}
 */
const collectChangedFiles = (deps = {}) => {
  const run = c => {
    if (deps.changedFiles) return deps.changedFiles.join("\n");
    const r = sh(c);
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

/**
 * Best-effort fetch so merge-base(origin/main, HEAD) is current. A failure
 * only warns; the local origin/main ref is used and the real base printed.
 */
const fetchOriginMain = () => {
  const r = sh("git fetch origin main");
  if (r.status === 0) {
    console.log(`${DIM}fetched origin/main ok${RESET}`);
  } else {
    const msg = (r.stderr || r.stdout || "git fetch failed").trim().split("\n")[0];
    console.log(
      `${YELLOW}! git fetch origin main failed (continuing with local ref): ${
        msg
      }${RESET}`,
    );
  }
};

/**
 * Run the local gates. Exits non-zero on the first failing gate.
 */
const main = () => {
  fetchOriginMain();
  const files = collectChangedFiles();
  const base =
    (sh("git merge-base origin/main HEAD").stdout || "").trim() || "origin/main";
  console.log(
    `${DIM}base: ${base}  changed (${files.length}): ${
      files.length ? files.join(", ") : "none"
    }${RESET}`,
  );

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
  const ruff = findRuff();
  if (ruff) {
    if (pyFiles.length) {
      gate(
        "ruff",
        `"${ruff}" check --config pyproject.toml ${pyFiles.join(" ")}`,
        `"${ruff}" check --fix --config pyproject.toml ${pyFiles.join(
          " ",
        )}  then re-run`,
      );
      gate(
        "ruff-format",
        `"${ruff}" format --check --config pyproject.toml ${pyFiles.join(" ")}`,
        `"${ruff}" format ${pyFiles.join(" ")}  then re-run`,
      );
    } else gate("ruff (no changed .py files)", null, null);
  } else {
    console.log(
      `${YELLOW}! ruff (v0.17.2) not found in pre-commit cache — skipping ruff gates${
        RESET
      }`,
    );
  }

  gate(
    "listener-guard + toolchain-guard",
    vitestCmd(["test/js/listener-guard.test.ts", "test/js/toolchain-guard.test.ts"]),
    "a bare addEventListener / L.DomEvent.on slipped in, or a script-module rule broke — see test/js/listener-guard.test.ts and test/js/toolchain-guard.test.ts",
  );

  const jsTests = mapJsTests(files);
  if (jsTests.length) {
    gate(
      "vitest (changed-file tests)",
      vitestCmd(jsTests),
      "fix the failing vitest test(s)",
    );
  } else gate("vitest (no changed-file tests)", null, null);

  const pyTests = mapPyTests(files);
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
      `${PYTEST_EXE} -m pytest ${pyTests.join(" ")} -m "not browser" -q --no-cov`,
      "fix the failing pytest test(s)",
    );
  } else gate("pytest (no changed-file tests)", null, null);
  gate(
    "pytest test_locale.py",
    `${PYTEST_EXE} -m pytest test/python/test_locale.py -q --no-cov`,
    "an unused locale key / a T() key mismatch — fix the locale table or the key usage",
  );

  gate(
    "changelog_check --skip-exists",
    "python script/check/changelog_check.py --skip-exists",
    "CHANGELOG.md bullet order / PR-number sort — run python script/check/changelog_check.py --fix",
  );
  gate(
    "mojibake_check (full tree)",
    "node script/check/mojibake-all.mjs",
    "a U+FFFD replacement char slipped in (encoding round-trip) — restore the original char",
  );
  gate(
    "dead_barrel_export",
    "python script/check/dead_barrel_export.py",
    "a dead barrel/type.ts export — remove the export or the symbol",
  );

  console.log();
  let failed = false;
  for (const { name, cmd, fix } of gates) {
    if (!cmd) {
      console.log(`${GREEN}✓ ${name} (skip)${RESET}`);
      continue;
    }
    process.stdout.write(`${DIM}→ ${name} ... ${RESET}`);
    const r = sh(cmd);
    if (r.status === 0) {
      console.log(`${GREEN}✓${RESET}`);
    } else {
      console.log(`${RED}✗${RESET}`);
      if (r.stdout) console.log(r.stdout);
      if (r.stderr) console.error(r.stderr);
      console.error(`${RED}✗ GATE FAILED: ${name}${RESET}`);
      if (fix) console.error(`${YELLOW}  fix: ${fix}${RESET}`);
      failed = true;
      break;
    }
  }
  console.log();
  if (failed) {
    console.error(`${RED}❌ make check: one or more local gates failed${RESET}`);
    process.exit(1);
  }
  console.log(`${GREEN}✅ make check: all local gates green${RESET}`);
};

// Only run the gates when invoked as a CLI (not when imported by a test).
if (
  import.meta.url === `file:///${resolve(process.argv[1] ?? "").replace(/\\/g, "/")}`
) {
  main();
}

export {
  collectChangedFiles,
  fetchOriginMain,
  findRuff,
  main,
  mapJsTests,
  mapPyTests,
  vitestCmd,
};
