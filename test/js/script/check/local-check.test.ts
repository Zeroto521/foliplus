import { execFileSync, spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NPM,
  buildGates,
  chunk,
  collectChangedFiles,
  colorEnabled,
  defaultIo,
  fetchOriginMain,
  findPreCommit,
  findShim,
  formatCmd,
  isCliEntry,
  jsSources,
  main,
  paint,
  parseArgs,
  preCommitExeFor,
  preCommitOnPath,
  preview,
  printGates,
  pyChanged,
  pytestExeFor,
  resolveBase,
  resolveRoot,
  runCmd,
  runGates,
  shimArgs,
  splitNul,
  vitestRelated,
  vitestRun,
} from "#script/check/local-check.mjs";

vi.mock("node:child_process", async importOriginal => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawnSync: vi.fn((_command: string, args: readonly string[]) => ({
      status: args.includes("grep") ? 1 : 0,
      stdout: "",
      stderr: "",
    })),
  };
});

/** The loose result shape a stub runner returns. */
type SpawnLike = {
  status?: number | null;
  stdout?: string;
  stderr?: string;
  error?: unknown;
};

/** A stub runner that records argv and answers by matching the joined argv. */
const makeRunner = (answers: Record<string, SpawnLike> = {}) => {
  const calls: string[][] = [];
  const run = vi.fn((cmd: { argv: string[] }): SpawnLike => {
    const key = cmd.argv.join(" ");
    calls.push(cmd.argv);
    const hit = Object.keys(answers).find(k => key.includes(k));
    return hit ? answers[hit] : { status: 0, stdout: "", stderr: "" };
  });
  return { run, calls };
};

/** A green runner: `git grep` needs status 1 (no hits) to count as passing. */
const greenRunner = () =>
  makeRunner({ "git grep": { status: 1, stdout: "", stderr: "" } });

/** A stub console IO that records everything written. */
const makeIo = () => {
  const logs: string[] = [];
  const errs: string[] = [];
  const writes: string[] = [];
  const io = {
    log: (...a: unknown[]) => logs.push(a.join(" ")),
    err: (...a: unknown[]) => errs.push(a.join(" ")),
    write: (s: string) => writes.push(s),
  };
  return { io, logs, errs, writes };
};

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

describe("paint / colorEnabled", () => {
  it("wraps text in ANSI when enabled", () => {
    expect(paint(true, "red", "x")).toBe("\x1b[31mx\x1b[0m");
  });

  it("returns plain text when disabled", () => {
    expect(paint(false, "red", "x")).toBe("x");
  });

  it("enables color only for a TTY without NO_COLOR", () => {
    expect(colorEnabled({}, true)).toBe(true);
    expect(colorEnabled({ NO_COLOR: "1" }, true)).toBe(false);
    expect(colorEnabled({}, false)).toBe(false);
  });
});

describe("defaultIo", () => {
  it("routes log/err/write to the real console and stdout", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    defaultIo.log("a", "b");
    defaultIo.err("c");
    defaultIo.write("d");
    expect(logSpy).toHaveBeenCalledWith("a", "b");
    expect(errSpy).toHaveBeenCalledWith("c");
    expect(writeSpy).toHaveBeenCalledWith("d");
  });
});

describe("runCmd", () => {
  it("spawns argv directly with no shell by default", () => {
    const spawn = vi.fn(() => ({ status: 0 }));
    runCmd({ argv: ["git", "status"] }, { spawn, cwd: "/repo" });
    expect(spawn).toHaveBeenCalledWith(
      "git",
      ["status"],
      expect.objectContaining({ cwd: "/repo", shell: false }),
    );
  });

  it("opts into a shell for the npm literal and merges env", () => {
    const spawn = vi.fn(() => ({ status: 0 }));
    runCmd({ argv: ["npm run test"], shell: true, env: { A: "1" } }, { spawn });
    const [, , opts] = spawn.mock.calls[0] as unknown as [string, string[], object];
    expect(opts).toMatchObject({
      shell: true,
      env: expect.objectContaining({ A: "1" }),
    });
  });
});

describe("NPM", () => {
  it("builds a shell command line from the literal", () => {
    expect(NPM("run typecheck")).toEqual({
      argv: ["npm run typecheck"],
      shell: true,
    });
  });
});

describe("pytestExeFor / preCommitExeFor", () => {
  it("uses Scripts on win32", () => {
    expect(pytestExeFor("win32")).toBe(join(".venv", "Scripts", "python.exe"));
    expect(preCommitExeFor("win32")).toBe(join(".venv", "Scripts", "pre-commit.exe"));
  });

  it("uses bin on POSIX", () => {
    expect(pytestExeFor("linux")).toBe(join(".venv", "bin", "python"));
    expect(preCommitExeFor("linux")).toBe(join(".venv", "bin", "pre-commit"));
  });
});

describe("findPreCommit", () => {
  it("prefers the venv executable", () => {
    const exe = resolve("/proj", preCommitExeFor());
    expect(findPreCommit({ root: "/proj", exists: p => p === exe })).toBe(exe);
  });

  it("falls back to PATH when the venv has none", () => {
    expect(findPreCommit({ root: "/proj", exists: () => false })).toBe("pre-commit");
  });
});

describe("preCommitOnPath", () => {
  it("asks where on Windows and which on POSIX", () => {
    const win = makeRunner({ where: { status: 0 } });
    expect(preCommitOnPath({ run: win.run, platform: "win32" })).toBe(true);
    expect(win.calls[0]).toEqual(["where", "pre-commit"]);

    const posix = makeRunner({ which: { status: 0 } });
    expect(preCommitOnPath({ run: posix.run, platform: "linux" })).toBe(true);
    expect(posix.calls[0]).toEqual(["which", "pre-commit"]);
  });

  it("is false when the lookup misses", () => {
    const { run } = makeRunner({ which: { status: 1 } });
    expect(preCommitOnPath({ run, platform: "linux" })).toBe(false);
  });
});

describe("findShim", () => {
  it("returns the shim when it exists at the given root", () => {
    const p = findShim({
      root: "/proj",
      exists: p => p === resolve("/proj", ".foliplus", "vite-spawn-patch.mjs"),
    });
    expect(p).toBe(resolve("/proj", ".foliplus", "vite-spawn-patch.mjs"));
  });

  it("walks up the tree until it finds the shim", () => {
    const p = findShim({
      root: "/proj/wt/child",
      exists: p => p === resolve("/proj", ".foliplus", "vite-spawn-patch.mjs"),
    });
    expect(p).toBe(resolve("/proj", ".foliplus", "vite-spawn-patch.mjs"));
  });

  it("falls back to root/.foliplus when nothing is found", () => {
    expect(findShim({ root: "/proj", exists: () => false })).toBe(
      resolve("/proj", ".foliplus", "vite-spawn-patch.mjs"),
    );
  });
});

describe("shimArgs", () => {
  it("adds --import only on Windows when the shim exists", () => {
    const shim = resolve("/proj", ".foliplus", "vite-spawn-patch.mjs");
    const args = shimArgs({ shim, exists: () => true, platform: "win32" });
    expect(args[0]).toBe("--import");
    // A file URL of the shim, whatever the host separator is.
    expect(args[1]).toMatch(/^file:\/\/.*vite-spawn-patch\.mjs$/);
    expect(args[1]).toContain(".foliplus");
  });

  it("is empty when the shim is missing", () => {
    expect(shimArgs({ exists: () => false, platform: "win32" })).toEqual([]);
  });

  it("is empty on POSIX (the sandbox workaround does not apply)", () => {
    expect(shimArgs({ exists: () => true, platform: "linux" })).toEqual([]);
  });
});

describe("vitestRun / vitestRelated", () => {
  it("runs an explicit test list", () => {
    const cmd = vitestRun(["a.test.ts"], { exists: () => false, platform: "linux" });
    expect(cmd.argv).toContain("run");
    expect(cmd.argv).toContain("a.test.ts");
    expect(cmd.argv).toContain("--pool=threads");
  });

  it("uses related with --run and --passWithNoTests", () => {
    const cmd = vitestRelated(["foliplus/js/x.ts"], {
      exists: () => false,
      platform: "linux",
    });
    expect(cmd.argv).toContain("related");
    expect(cmd.argv).toContain("--run");
    expect(cmd.argv).toContain("--passWithNoTests");
  });
});

describe("splitNul", () => {
  it("splits a NUL-separated list and drops the trailing empty token", () => {
    expect(splitNul("a\0b\0")).toEqual(["a", "b"]);
  });

  it("returns [] for empty output", () => {
    expect(splitNul("")).toEqual([]);
  });
});

describe("resolveBase", () => {
  it("returns the trimmed sha", () => {
    expect(resolveBase({ status: 0, stdout: " abc \n" })).toBe("abc");
  });

  it("falls back to origin/main on failure or empty output", () => {
    expect(resolveBase({ status: 1, stdout: "abc" })).toBe("origin/main");
    expect(resolveBase({ status: 0, stdout: "  " })).toBe("origin/main");
  });
});

describe("collectChangedFiles", () => {
  it("merges branch, staged, unstaged and untracked files and drops .foliplus", () => {
    const { run } = makeRunner({
      "diff --name-only -z --diff-filter=ACMR": {
        status: 0,
        stdout: "a.ts\0.foliplus/x\0",
      },
      "--cached": { status: 0, stdout: "b.py\0" },
      "ls-files --others": { status: 0, stdout: "c.ts\0" },
    });
    expect(collectChangedFiles({ run, base: "abc", io: makeIo().io })).toEqual([
      "a.ts",
      "b.py",
      "c.ts",
    ]);
  });

  it("resolves the base itself when none is given", () => {
    const { run, calls } = makeRunner({
      "merge-base": { status: 0, stdout: "abc\n" },
    });
    collectChangedFiles({ run, io: makeIo().io });
    expect(calls[0]).toEqual(["git", "merge-base", "origin/main", "HEAD"]);
    expect(calls[1]).toContain("abc...HEAD");
  });

  it("warns and keeps working-tree changes when the branch diff fails", () => {
    const { io, logs } = makeIo();
    const { run } = makeRunner({
      "abc...HEAD": { status: 128, stdout: "" },
      "diff --name-only -z --diff-filter=ACMR": { status: 0, stdout: "a.ts\0" },
    });
    expect(collectChangedFiles({ run, base: "abc", io })).toEqual(["a.ts"]);
    expect(logs.join("\n")).toContain("checking working-tree changes only");
  });

  it("ignores a failed working-tree diff", () => {
    const { run } = makeRunner({
      "diff --name-only -z --diff-filter=ACMR": { status: 1 },
    });
    expect(collectChangedFiles({ run, base: "abc", io: makeIo().io })).toEqual([]);
  });
});

describe("resolveRoot", () => {
  it("returns the git toplevel", () => {
    const { run } = makeRunner({ "rev-parse": { status: 0, stdout: "/repo\n" } });
    expect(resolveRoot(run)).toBe("/repo");
  });

  it("falls back to cwd when git fails or prints nothing", () => {
    expect(resolveRoot(makeRunner({ "rev-parse": { status: 1 } }).run)).toBe(
      process.cwd(),
    );
    expect(
      resolveRoot(makeRunner({ "rev-parse": { status: 0, stdout: "" } }).run),
    ).toBe(process.cwd());
  });
});

describe("fetchOriginMain", () => {
  it("logs ok on success", () => {
    const { io, logs } = makeIo();
    fetchOriginMain({ run: makeRunner().run, io });
    expect(logs.join("\n")).toContain("fetched origin/main ok");
  });

  it("warns with the first stderr line on failure", () => {
    const { io, logs } = makeIo();
    const { run } = makeRunner({
      fetch: { status: 1, stderr: "no network\ndetails", stdout: "" },
    });
    fetchOriginMain({ run, io });
    expect(logs.join("\n")).toContain("no network");
    expect(logs.join("\n")).not.toContain("details");
  });

  it("falls back to the default message when stderr and stdout are empty", () => {
    const { io, logs } = makeIo();
    const { run } = makeRunner({ fetch: { status: 1, stderr: "", stdout: "" } });
    fetchOriginMain({ run, io });
    expect(logs.join("\n")).toContain("git fetch failed");
  });

  it("uses the default IO when none is injected", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    fetchOriginMain({ run: makeRunner().run });
    expect(logSpy).toHaveBeenCalled();
  });
});

describe("jsSources / pyChanged", () => {
  it("keeps JS/TS/CSS under the source roots", () => {
    expect(
      jsSources([
        "foliplus/js/a.ts",
        "script/b.mjs",
        "config/c.mjs",
        "test/js/d.test.ts",
        "foliplus/css/e.css",
      ]),
    ).toHaveLength(5);
  });

  it("drops non-source roots and non-JS extensions", () => {
    expect(jsSources(["doc/a.ts", "foliplus/py/a.py", "CHANGELOG.md"])).toEqual([]);
  });

  it("detects every Python change shape", () => {
    for (const f of [
      "foliplus/a.py",
      "test/python/a.py",
      "script/a.py",
      "pyproject.toml",
    ]) {
      expect(pyChanged([f]), f).toBe(true);
    }
    expect(pyChanged(["foliplus/js/a.ts"])).toBe(false);
  });
});

describe("chunk / preview", () => {
  it("splits into fixed-size batches", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });

  it("shortens long path lists", () => {
    expect(preview(["a", "b"])).toBe("a, b");
    expect(preview(Array.from({ length: 10 }, (_, i) => `${i}`))).toContain("… (+2)");
  });
});

describe("buildGates", () => {
  const opts = { exists: () => false, platform: "linux", hasPython: true };
  type GateLike = {
    name: string;
    cmds: { argv: string[] }[];
    ok?: (r: { status?: number | null }) => boolean;
    error?: string;
  };
  const byName = (gates: GateLike[], name: string) => gates.find(g => g.name === name);

  it("orders prettier, eslint, pre-commit, guards, vitest, typecheck, pytest", () => {
    const gates = buildGates(["foliplus/js/a.ts", "foliplus/b.py"], opts);
    expect(gates.map(g => g.name)).toEqual([
      "prettier (1 changed file)",
      "eslint (1 changed file)",
      "pre-commit (2 changed files)",
      "mojibake (full tree)",
      "guards (listener + toolchain, full tree)",
      "vitest related (1 source file)",
      "typecheck",
      "build-js-dev (pytest reads foliplus/dist/)",
      "pytest (full non-browser suite)",
    ]);
  });

  it("runs prettier and eslint only on the globs CI covers", () => {
    const gates = buildGates(
      ["foliplus/js/a.ts", "test/js/a.test.ts", "README.md", "doc/a.md"],
      opts,
    );
    expect(byName(gates, "prettier (2 changed files)")?.cmds[0].argv).toEqual([
      "node",
      "node_modules/prettier/bin/prettier.cjs",
      "--check",
      "foliplus/js/a.ts",
      "test/js/a.test.ts",
    ]);
    expect(byName(gates, "eslint (2 changed files)")?.cmds[0].argv).toContain(
      "config/eslint/typed.mjs",
    );
  });

  it("passes every changed file to pre-commit in one batch", () => {
    const gates = buildGates(["a.ts", "b.ts"], opts);
    expect(byName(gates, "pre-commit (2 changed files)")?.cmds[0].argv).toEqual([
      "pre-commit",
      "run",
      "--files",
      "a.ts",
      "b.ts",
      "--show-diff-on-failure",
    ]);
  });

  it("batches more than PRECOMMIT_CHUNK files", () => {
    const files = Array.from({ length: 61 }, (_, i) => `f${i}.ts`);
    const gates = buildGates(files, opts);
    expect(byName(gates, "pre-commit (61 changed files)")?.cmds).toHaveLength(2);
  });

  it("skips the changed-file gates when nothing changed", () => {
    const gates = buildGates([], opts);
    expect(byName(gates, "prettier (no changed formattable files)")?.cmds).toEqual([]);
    expect(byName(gates, "eslint (no changed JS/TS files)")?.cmds).toEqual([]);
    expect(byName(gates, "pre-commit (no changed files)")?.cmds).toEqual([]);
    expect(byName(gates, "vitest related (no changed JS/TS files)")).toBeTruthy();
  });

  it("treats git grep status 1 as clean and 0 as a hit", () => {
    const mojibake = byName(buildGates([], opts), "mojibake (full tree)");
    expect(mojibake?.ok?.({ status: 1 })).toBe(true);
    expect(mojibake?.ok?.({ status: 0 })).toBe(false);
  });

  it("runs the cheap locale check for a JS-only change", () => {
    const gates = buildGates(["foliplus/js/a.ts"], opts);
    expect(gates.map(g => g.name)).toContain(
      "pytest test_locale (cross-language keys)",
    );
  });

  it("fails loudly when Python changed but .venv is missing", () => {
    const gates = buildGates(["foliplus/a.py"], { ...opts, hasPython: false });
    expect(byName(gates, "pytest (no .venv)")?.error).toContain(".venv");
  });

  it("fails loudly with an install hint when pre-commit is missing", () => {
    const gates = buildGates(["a.ts"], { ...opts, hasPreCommit: false });
    const gate = byName(gates, "pre-commit (not installed)");
    expect(gate?.error).toContain("not on PATH");
    expect(gate?.cmds).toEqual([]);
  });

  it("skips Python gates with a warning on a JS-only machine", () => {
    const { io, logs } = makeIo();
    const gates = buildGates(["foliplus/js/a.ts"], {
      ...opts,
      hasPython: false,
      io,
    });
    expect(gates.map(g => g.name)).toContain("pytest test_locale (no .venv)");
    expect(logs.join("\n")).toContain("no .venv");
  });

  it("adds the Windows shim to the vitest commands", () => {
    const gates = buildGates([], {
      ...opts,
      platform: "win32",
      exists: () => true,
      shim: "C:\\p\\.foliplus\\vite-spawn-patch.mjs",
    });
    const guards = gates.find(g => g.name.startsWith("guards"));
    expect(guards?.cmds[0].argv).toContain("--import");
  });

  it("uses the injected pytest exe and pre-commit path", () => {
    const gates = buildGates(["a.py"], {
      ...opts,
      pytestExe: "/venv/python",
      preCommit: "/venv/pre-commit",
    });
    expect(byName(gates, "pre-commit (1 changed file)")?.cmds[0].argv[0]).toBe(
      "/venv/pre-commit",
    );
    expect(gates.at(-1)?.cmds[0].argv[0]).toBe("/venv/python");
  });
});

describe("runGates", () => {
  const gate = (name: string, cmds: object[], fix: string | null = null) =>
    ({ name, cmds, fix }) as never;

  it("prints a checkmark with timing and continues", () => {
    const { io, logs, writes } = makeIo();
    const failed = runGates(
      [gate("a", [{ argv: ["x"] }]), gate("b", [{ argv: ["y"] }])],
      { run: makeRunner().run, io },
    );
    expect(failed).toEqual([]);
    expect(writes[0]).toContain("→ a");
    expect(logs.filter(l => l.includes("✓"))).toHaveLength(2);
  });

  it("marks an empty command list as a skip", () => {
    const { io, logs } = makeIo();
    runGates([gate("skip", [])], { run: makeRunner().run, io });
    expect(logs.join("\n")).toContain("(skip)");
  });

  it("reports stdout, stderr, the spawn error and the fix hint", () => {
    const { io, logs, errs } = makeIo();
    const failed = runGates([gate("red", [{ argv: ["x"] }], "do the thing")], {
      run: makeRunner({
        x: { status: 1, stdout: "out", stderr: "err", error: new Error("boom") },
      }).run,
      io,
    });
    expect(failed).toHaveLength(1);
    expect(logs.join("\n")).toContain("out");
    expect(errs.join("\n")).toContain("err");
    expect(errs.join("\n")).toContain("boom");
    expect(errs.join("\n")).toContain("fix: do the thing");
  });

  it("stops at the first red with failFast", () => {
    const { io } = makeIo();
    const { run, calls } = makeRunner({ a: { status: 1 } });
    const failed = runGates(
      [gate("first", [{ argv: ["a"] }]), gate("second", [{ argv: ["b"] }])],
      { run, io, failFast: true },
    );
    expect(failed.map(g => g.name)).toEqual(["first"]);
    expect(calls).toHaveLength(1);
  });

  it("honours a custom ok predicate", () => {
    const { io } = makeIo();
    const failed = runGates(
      [{ name: "grep", cmds: [{ argv: ["x"] }], fix: null, ok: () => true } as never],
      { run: makeRunner({ x: { status: 1 } }).run, io },
    );
    expect(failed).toEqual([]);
  });

  it("reports an unavailable gate as a failure", () => {
    const { io, errs } = makeIo();
    const failed = runGates(
      [{ name: "no venv", cmds: [], fix: "make env", error: "missing" } as never],
      { run: makeRunner().run, io },
    );
    expect(failed.map(g => g.name)).toEqual(["no venv"]);
    expect(errs.join("\n")).toContain("missing");
    expect(errs.join("\n")).toContain("make env");
  });

  it("continues past an unavailable gate when failFast is off", () => {
    const { io } = makeIo();
    const failed = runGates(
      [
        { name: "no venv", cmds: [], fix: null, error: "missing" } as never,
        gate("later", [{ argv: ["x"] }]),
      ],
      { run: makeRunner().run, io },
    );
    expect(failed.map(g => g.name)).toEqual(["no venv"]);
  });
});

describe("parseArgs", () => {
  it("parses every flag", () => {
    expect(parseArgs(["--list", "--fail-fast", "--no-fetch"])).toMatchObject({
      list: true,
      failFast: true,
      fetch: false,
    });
    expect(parseArgs(["--base", "abc"]).base).toBe("abc");
    expect(parseArgs(["--base=abc"]).base).toBe("abc");
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
    expect(parseArgs(["--dry-run"]).list).toBe(true);
  });

  it("collects unknown flags", () => {
    expect(parseArgs(["--nope", "x"]).unknown).toEqual(["--nope", "x"]);
  });
});

describe("formatCmd / printGates", () => {
  it("prints a shell command as its literal", () => {
    expect(formatCmd(NPM("run test"))).toBe("npm run test");
  });

  it("quotes argv entries with spaces", () => {
    expect(formatCmd({ argv: ["node", "a b.ts"] })).toBe('node "a b.ts"');
  });

  it("escapes the U+FFFD probe so --list stays readable", () => {
    expect(formatCmd({ argv: ["git", "grep", "-e", "\uFFFD"] })).toBe(
      "git grep -e \\uFFFD",
    );
  });

  it("lists gates, skips and unavailable ones", () => {
    const { io, logs } = makeIo();
    printGates(
      [
        { name: "run", cmds: [{ argv: ["x"] }], fix: null } as never,
        { name: "skip", cmds: [], fix: null } as never,
        { name: "down", cmds: [], fix: null, error: "no venv" } as never,
      ],
      io,
    );
    const text = logs.join("\n");
    expect(text).toContain("run:");
    expect(text).toContain("skip — skip");
    expect(text).toContain("down — unavailable: no venv");
  });
});

describe("main", () => {
  const base = {
    preCommit: "/venv/pre-commit",
    hasPython: true,
    exists: () => false,
    platform: "linux",
  };

  it("prints help and returns 0", () => {
    const { io, logs } = makeIo();
    expect(main({ argv: ["--help"], io, run: makeRunner().run })).toBe(0);
    expect(logs.join("\n")).toContain("--fail-fast");
  });

  it("rejects unknown flags with exit code 2", () => {
    const { io, errs } = makeIo();
    expect(main({ argv: ["--nope"], io, run: makeRunner().run })).toBe(2);
    expect(process.exitCode).toBe(2);
    expect(errs.join("\n")).toContain("unknown argument");
  });

  it("runs every gate and returns 0 when green", () => {
    const { run, calls } = greenRunner();
    const { io, logs } = makeIo();
    expect(main({ argv: ["--no-fetch"], io, run, ...base })).toBe(0);
    expect(logs.join("\n")).toContain("all local gates green");
    expect(calls.some(c => c.includes("merge-base"))).toBe(true);
    expect(calls.some(c => c.includes("fetch"))).toBe(false);
  });

  it("lists the gates without running them", () => {
    const { run } = greenRunner();
    const { io, logs } = makeIo();
    expect(main({ argv: ["--list", "--base", "abc"], io, run, ...base })).toBe(0);
    expect(logs.join("\n")).toContain("pre-commit");
    expect(logs.join("\n")).toContain("base: abc");
  });

  it("returns 1 and names the failing gate", () => {
    const { run } = makeRunner({
      "git grep": { status: 1 },
      "npm run typecheck": { status: 2, stderr: "tsc boom" },
    });
    const { io, errs } = makeIo();
    expect(main({ argv: ["--no-fetch"], io, run, ...base })).toBe(1);
    expect(process.exitCode).toBe(1);
    expect(errs.join("\n")).toContain("typecheck");
    expect(errs.join("\n")).toContain("tsc boom");
  });

  it("fetches by default and skips the fetch when a base is pinned", () => {
    const { run, calls } = greenRunner();
    main({ argv: [], io: makeIo().io, run, ...base });
    expect(calls.some(c => c.includes("fetch"))).toBe(true);
    const pinned = greenRunner();
    const pinnedIo = makeIo();
    main({ argv: ["--base", "abc"], io: pinnedIo.io, run: pinned.run, ...base });
    expect(pinned.calls.some(c => c.includes("fetch"))).toBe(false);
    expect(pinnedIo.logs.join("\n")).toContain("base pinned to abc");
  });

  it("resolves the repo root and passes hasPython through", () => {
    const { run, calls } = makeRunner({
      "git grep": { status: 1 },
      "rev-parse": { status: 0, stdout: "/repo\n" },
    });
    const { io } = makeIo();
    main({ argv: ["--no-fetch"], io, run, ...base, hasPython: false });
    expect(calls[0]).toEqual(["git", "rev-parse", "--show-toplevel"]);
  });

  it("checks PATH for pre-commit only when the venv copy is absent", () => {
    const found = makeRunner({ "git grep": { status: 1 }, which: { status: 0 } });
    main({
      argv: ["--no-fetch"],
      io: makeIo().io,
      run: found.run,
      ...base,
      preCommit: "pre-commit",
    });
    expect(found.calls.some(c => c[0] === "which")).toBe(true);

    const venv = makeRunner({ "git grep": { status: 1 } });
    main({
      argv: ["--no-fetch"],
      io: makeIo().io,
      run: venv.run,
      ...base,
      preCommit: "/venv/pre-commit",
    });
    expect(venv.calls.some(c => c[0] === "which")).toBe(false);
  });
});

describe("default dependency-injection sides", () => {
  it("runCmd falls back to the real spawnSync when none is injected", () => {
    const r = runCmd({ argv: ["git", "status"] });
    expect(spawnSync).toHaveBeenCalled();
    expect(r.status).toBe(0);
  });

  it("findPreCommit uses the real root and existsSync when none are injected", () => {
    expect(findPreCommit()).toBe("pre-commit");
  });

  it("preCommitOnPath uses the real runCmd and platform when none are injected", () => {
    expect(preCommitOnPath()).toBe(true);
  });

  it("shimArgs uses the real existsSync and platform when none are injected", () => {
    expect(Array.isArray(shimArgs())).toBe(true);
    expect(Array.isArray(shimArgs({ platform: "win32" }))).toBe(true);
  });

  it("collectChangedFiles uses the real runCmd and io when none are injected", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(collectChangedFiles()).toEqual([]);
  });

  it("collectChangedFiles tolerates a diff result with no stdout", () => {
    expect(collectChangedFiles({ run: () => ({ status: 0 }) })).toEqual([]);
  });

  it("fetchOriginMain uses the real runCmd when none is injected", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    fetchOriginMain();
    expect(logSpy).toHaveBeenCalled();
  });

  it("runGates uses the real runCmd and io when none are injected", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const failed = runGates([{ name: "x", cmds: [{ argv: ["echo", "hi"] }] }]);
    expect(failed).toEqual([]);
  });

  it("runGates stops at the first unavailable gate with failFast", () => {
    const { io } = makeIo();
    const failed = runGates(
      [
        { name: "a", error: "boom", cmds: [] },
        { name: "b", cmds: [{ argv: ["x"] }] },
      ],
      { failFast: true, run: makeRunner().run, io },
    );
    expect(failed.map(g => g.name)).toEqual(["a"]);
  });

  it("runGates reports a string spawn error", () => {
    const { io, errs } = makeIo();
    runGates([{ name: "x", cmds: [{ argv: ["x"] }] }], {
      run: () => ({ status: 1, error: "boom" }),
      io,
    });
    expect(errs.join("\n")).toContain("boom");
  });

  it("main falls back to the real io, run, argv, preCommit and hasPython", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const savedArgv = process.argv;
    process.argv = ["node", "script/check/local-check.mjs", "--no-fetch"];
    try {
      expect(main({})).toBe(0);
    } finally {
      process.argv = savedArgv;
    }
  });

  it("main previews the changed files when there are any", () => {
    const { run } = makeRunner({
      "git grep": { status: 1, stdout: "", stderr: "" },
      "git diff": { status: 0, stdout: "foliplus/js/x.ts\u0000", stderr: "" },
    });
    const { io, logs } = makeIo();
    main({
      argv: ["--no-fetch"],
      io,
      run,
      preCommit: "/venv/pre-commit",
      hasPython: true,
      exists: () => false,
      platform: "linux",
    });
    expect(logs.join("\n")).toContain("foliplus/js/x.ts");
  });

  it("runs main when the module is invoked as the CLI entry", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const savedArgv = process.argv;
    process.argv = ["node", "script/check/local-check.mjs", "--no-fetch"];
    vi.resetModules();
    try {
      await import("#script/check/local-check.mjs");
    } finally {
      process.argv = savedArgv;
      vi.resetModules();
    }
  });

  it("runs the CLI entry when invoked directly", () => {
    const out = execFileSync(
      process.execPath,
      [resolve(process.cwd(), "script/check/local-check.mjs"), "--help"],
      { encoding: "utf8" },
    );
    expect(out).toContain("--fail-fast");
  });
});

describe("isCliEntry", () => {
  it("matches this module's URL", () => {
    const modulePath = resolve(process.cwd(), "script/check/local-check.mjs");
    expect(isCliEntry(modulePath)).toBe(true);
  });

  it("rejects another path and an undefined entry", () => {
    expect(isCliEntry(resolve("other.mjs"))).toBe(false);
    expect(isCliEntry(undefined)).toBe(false);
  });
});
