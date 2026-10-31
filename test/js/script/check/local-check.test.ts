import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildGates,
  collectChangedFiles,
  defaultIo,
  fetchOriginMain,
  findRuff,
  findShim,
  main,
  mapJsTests,
  mapPyTests,
  resolveBase,
  runGates,
  sh,
  vitestCmd,
} from "#script/check/local-check.mjs";

// The mapping helpers are pure: they take an injected existence probe, so the
// path rules can be asserted without touching the real tree.

const allExist = () => true;
const noneExist = () => false;

/** The loose result shape a stub runner returns (mirrors the real
 *  spawnSync subset the checker reads). */
type SpawnLike = {
  status?: number | null;
  stdout?: string;
  stderr?: string;
  error?: unknown;
};

/** A stub command runner that records the commands it was given and
 *  returns a canned result. The run signature is loose so mockImplementation
 *  callbacks may return only the fields a test needs. */
const makeRunner = (result: SpawnLike = { status: 0, stdout: "", stderr: "" }) => {
  const calls: string[] = [];
  const run = vi.fn(
    (cmd: string, _env?: Record<string, string | undefined>): SpawnLike => {
      calls.push(cmd);
      return { status: 0, stdout: "", stderr: "", ...result };
    },
  );
  return { run, calls };
};

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

describe("sh", () => {
  it("runs a command through the shell and returns its result", () => {
    const r = sh("node --version");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("v");
  });
});

describe("defaultIo", () => {
  it("routes log/err/write to the real console and stdout", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      defaultIo.log("a", "b");
      defaultIo.err("c");
      defaultIo.write("d");
      expect(logSpy).toHaveBeenCalledWith("a", "b");
      expect(errSpy).toHaveBeenCalledWith("c");
      expect(writeSpy).toHaveBeenCalledWith("d");
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      writeSpy.mockRestore();
    }
  });
});

describe("findShim", () => {
  it("returns the shim when it exists at the given root", () => {
    const p = findShim({
      root: "/proj",
      exists: (p: string) =>
        p === resolve("/proj", ".foliplus", "vite-spawn-patch.mjs"),
    });
    expect(p).toBe(resolve("/proj", ".foliplus", "vite-spawn-patch.mjs"));
  });

  it("walks up the tree until it finds the shim", () => {
    const p = findShim({
      root: "/proj/wt/child",
      exists: (p: string) =>
        p === resolve("/proj", ".foliplus", "vite-spawn-patch.mjs"),
    });
    expect(p).toBe(resolve("/proj", ".foliplus", "vite-spawn-patch.mjs"));
  });

  it("falls back to root/.foliplus when nothing is found", () => {
    const p = findShim({ root: "/proj", exists: () => false });
    expect(p).toBe(resolve("/proj", ".foliplus", "vite-spawn-patch.mjs"));
  });
});

describe("vitestCmd", () => {
  it("normalises Windows backslashes in the shim path", () => {
    const cmd = vitestCmd(
      ["test/js/X.test.ts"],
      "C:\\proj\\.foliplus\\vite-spawn-patch.mjs",
    );
    expect(cmd).toContain("file:///C:/proj/.foliplus/vite-spawn-patch.mjs");
    expect(cmd).toContain("--pool=threads");
  });

  it("joins test paths with the vitest invocation", () => {
    const cmd = vitestCmd(["a.test.ts", "b.test.ts"], resolve("/x", "shim.mjs"));
    expect(cmd).toContain(`file:///${resolve("/x", "shim.mjs").replace(/\\/g, "/")}`);
    expect(cmd).toContain("a.test.ts b.test.ts");
  });
});

describe("findRuff", () => {
  it("prefers the project venv ruff.exe", () => {
    const venvExe = join("/proj", ".venv", "Scripts", "ruff.exe");
    const r = findRuff({
      root: "/proj",
      home: "/home",
      exists: (p: string) => p === venvExe,
      spawn: () => ({ status: 0, stdout: "" }),
      readdir: () => [],
    });
    expect(r).toEqual([venvExe]);
  });

  it("uses the pre-commit cache v0.17.2 ruff when present", () => {
    const repo = join("/home", ".cache", "pre-commit", "repoX");
    const exe = join(repo, "py_env-python3", "Scripts", "ruff.exe");
    const r = findRuff({
      root: "/proj",
      home: "/home",
      exists: (p: string) =>
        p === join("/proj", ".venv", "Scripts", "ruff.exe") ? false : p === exe,
      spawn: () => ({ status: 0, stdout: "ruff 0.17.2" }),
      readdir: () => [{ isDirectory: () => true, name: "repoX" }],
    });
    expect(r).toEqual([exe]);
  });

  it("falls back to venv python -m ruff", () => {
    const venvPy = join("/proj", ".venv", "Scripts", "python.exe");
    const r = findRuff({
      root: "/proj",
      home: "/home",
      exists: (p: string) => p === venvPy,
      spawn: () => ({ status: 0, stdout: "ruff 0.10.0" }),
      readdir: () => [],
    });
    expect(r).toEqual([venvPy, "-m", "ruff"]);
  });

  it("falls back to global ruff on PATH", () => {
    const r = findRuff({
      root: "/proj",
      home: "/home",
      exists: () => false,
      spawn: () => ({ status: 0, stdout: "ruff 0.10.0" }),
      readdir: () => [],
    });
    expect(r).toEqual(["ruff"]);
  });

  it("returns null when no ruff is usable", () => {
    const r = findRuff({
      root: "/proj",
      home: "/home",
      exists: () => false,
      spawn: () => ({ status: 1, stdout: "" }),
      readdir: () => [],
    });
    expect(r).toBeNull();
  });

  it("tolerates an unreadable pre-commit cache dir", () => {
    const r = findRuff({
      root: "/proj",
      home: "/home",
      exists: () => false,
      spawn: () => ({ status: 1, stdout: "" }),
      readdir: () => {
        throw new Error("EPERM");
      },
    });
    expect(r).toBeNull();
  });
});

describe("collectChangedFiles", () => {
  it("dedupes and drops .foliplus scratch", () => {
    const files = collectChangedFiles({
      changedFiles: ["foliplus/js/X.ts", "foliplus/js/X.ts", ".foliplus/tmp/a.js"],
    });
    expect(files).toEqual(["foliplus/js/X.ts"]);
  });

  it("merges branch, unstaged and staged changes via the runner", () => {
    const { run } = makeRunner();
    run.mockImplementation((cmd: string) => {
      if (cmd.includes("merge-base")) {
        return { status: 0, stdout: "abc123", stderr: "" };
      }
      if (cmd.includes("...HEAD")) {
        return { status: 0, stdout: "foliplus/js/A.ts\nfoliplus/js/A.ts", stderr: "" };
      }
      if (cmd.includes("--cached")) {
        return { status: 0, stdout: "foliplus/js/B.ts\n.foliplus/x.js", stderr: "" };
      }
      return { status: 0, stdout: "foliplus/js/C.ts", stderr: "" };
    });
    const files = collectChangedFiles({ run });
    expect([...files].sort()).toEqual([
      "foliplus/js/A.ts",
      "foliplus/js/B.ts",
      "foliplus/js/C.ts",
    ]);
    expect(run.mock.calls.length).toBe(4); // merge-base + 3 diffs
  });

  it("uses the explicit mergeBase when given", () => {
    const { run } = makeRunner();
    run.mockImplementation((cmd: string) =>
      cmd.includes("...HEAD")
        ? { status: 0, stdout: "a.ts", stderr: "" }
        : { status: 0, stdout: "", stderr: "" },
    );
    collectChangedFiles({ run, mergeBase: "deadbeef" });
    expect(run.mock.calls[0][0]).toContain("deadbeef...HEAD");
  });

  it("falls back to origin/main when merge-base returns nothing", () => {
    const { run } = makeRunner();
    run.mockImplementation((cmd: string) =>
      cmd.includes("merge-base")
        ? { status: 0, stdout: "", stderr: "" }
        : { status: 0, stdout: "x.ts", stderr: "" },
    );
    collectChangedFiles({ run });
    expect(run.mock.calls[1][0]).toContain("origin/main...HEAD");
  });
});

describe("resolveBase", () => {
  it("returns the trimmed stdout", () => {
    expect(resolveBase({ stdout: "  abc123\n" })).toBe("abc123");
  });
  it("falls back to origin/main when empty", () => {
    expect(resolveBase({ stdout: "" })).toBe("origin/main");
  });
});

describe("fetchOriginMain", () => {
  it("logs ok on success", () => {
    const { run } = makeRunner({ status: 0 });
    const { io, logs } = makeIo();
    fetchOriginMain({ run, io });
    expect(logs.join(" ")).toContain("fetched origin/main ok");
  });

  it("warns on failure but does not throw", () => {
    const { run } = makeRunner({ status: 1, stderr: "fatal: no network\n" });
    const { io, logs } = makeIo();
    expect(() => fetchOriginMain({ run, io })).not.toThrow();
    expect(logs.join(" ")).toContain("git fetch origin main failed");
  });

  it("reports the first stderr line in the warning", () => {
    const { run } = makeRunner({ status: 1, stderr: "line1\nline2" });
    const { io, logs } = makeIo();
    fetchOriginMain({ run, io });
    expect(logs.join(" ")).toContain("line1");
  });
});

describe("mapJsTests", () => {
  it("maps a component source file to its sibling test file", () => {
    const paths = mapJsTests(["foliplus/js/HeatmapControl/manager.ts"], allExist);
    expect(paths).toEqual(["test/js/HeatmapControl/manager.test.ts"]);
  });

  it("falls back to the component test dir when no sibling test exists", () => {
    const paths = mapJsTests(
      ["foliplus/js/HeatmapControl/ui.ts"],
      p => p === "test/js/HeatmapControl", // dir exists, sibling file does not
    );
    expect(paths).toEqual(["test/js/HeatmapControl"]);
  });

  it("maps a top-level foliplus/js file to its test file", () => {
    const paths = mapJsTests(["foliplus/js/BaseControl.ts"], allExist);
    expect(paths).toEqual(["test/js/BaseControl.test.ts"]);
  });

  it("maps a shared common file to its sibling test", () => {
    const paths = mapJsTests(["foliplus/js/common/dom.ts"], allExist);
    expect(paths).toEqual(["test/js/common/dom.test.ts"]);
  });

  it("maps a script module to its test file", () => {
    const paths = mapJsTests(["script/build/build.mjs"], allExist);
    expect(paths).toEqual(["test/js/script/build/build.test.ts"]);
  });

  it("returns [] when no changed file maps to a test", () => {
    expect(mapJsTests([], noneExist)).toEqual([]);
    expect(mapJsTests(["foliplus/css/HeatmapControl.css"], noneExist)).toEqual([]);
  });
});

describe("mapPyTests", () => {
  it("maps a control module to its test/python subdir", () => {
    const paths = mapPyTests(
      ["foliplus/HeatmapControl.py"],
      p => p === "test/python/HeatmapControl",
    );
    expect(paths).toEqual(["test/python/HeatmapControl"]);
  });

  it("maps a control module to its test file when no subdir exists", () => {
    const paths = mapPyTests(
      ["foliplus/ScaleControl.py"],
      p => p === "test/python/ScaleControl.py",
    );
    expect(paths).toEqual(["test/python/ScaleControl.py"]);
  });

  it("maps a changed test/python file to itself", () => {
    const paths = mapPyTests(["test/python/test_locale.py"], allExist);
    expect(paths).toEqual(["test/python/test_locale.py"]);
  });

  it("returns [] when no changed file maps to a test", () => {
    expect(mapPyTests([], noneExist)).toEqual([]);
  });
});

describe("buildGates", () => {
  it("builds the full gate list with ruff and changed py/js files", () => {
    const gates = buildGates(["foliplus/js/X.ts", "foliplus/Y.py", "CHANGELOG.md"], {
      ruff: ["/x/ruff.exe"],
      exists: allExist,
    });
    const names = gates.map(g => g.name);
    expect(names).toContain("typecheck");
    expect(names).toContain("prettier");
    expect(names).toContain("eslint");
    expect(names).toContain("ruff");
    expect(names).toContain("ruff-format");
    expect(names).toContain("listener-guard + toolchain-guard");
    expect(names).toContain("vitest (changed-file tests)");
    expect(names).toContain("build-js-dev (before pytest)");
    expect(names).toContain("pytest (changed-file tests, non-browser)");
    expect(names).toContain("pytest test_locale.py");
    expect(names).toContain("changelog_check --skip-exists");
    expect(names).toContain("mojibake_check (full tree)");
    expect(names).toContain("dead_barrel_export");
    // CHANGELOG.md must not reach prettier.
    const prettier = gates.find(g => g.name === "prettier");
    expect(prettier!.cmd).not.toContain("CHANGELOG.md");
    expect(prettier!.cmd).toContain("foliplus/js/X.ts");
  });

  it("skips prettier/eslint/ruff/vitest/pytest when no matching files", () => {
    const gates = buildGates(["docs/x.rst"], { ruff: ["/x/ruff.exe"] });
    const skip = gates.filter(g => g.cmd === null).map(g => g.name);
    expect(skip).toContain("prettier (no changed formattable files)");
    expect(skip).toContain("eslint (no changed JS/TS files)");
    expect(skip).toContain("ruff (no changed .py files)");
    expect(skip).toContain("vitest (no changed-file tests)");
    expect(skip).toContain("pytest (no changed-file tests)");
  });

  it("warns and skips ruff gates when no ruff binary is found", () => {
    const { io, logs } = makeIo();
    const gates = buildGates(["foliplus/Y.py"], { ruff: null, io });
    expect(gates.some(g => g.name === "ruff")).toBe(false);
    expect(logs.join(" ")).toContain("no ruff binary found");
  });

  it("uses the injected pytest exe and vitest command builder", () => {
    const gates = buildGates(["foliplus/Y.py", "foliplus/js/X.ts"], {
      ruff: ["ruff"],
      pytestExe: ".venv\\Scripts\\python.exe",
      vitestCmdFn: (paths: string[]) => `VITEST ${paths.join(" ")}`,
      exists: allExist,
    });
    const py = gates.find(g => g.name === "pytest (changed-file tests, non-browser)");
    expect(py!.cmd).toContain(".venv\\Scripts\\python.exe");
    const v = gates.find(g => g.name === "vitest (changed-file tests)");
    expect(v!.cmd).toBe(`VITEST ${v!.cmd!.slice(7)}`);
  });

  it("quotes the ruff exe path when it contains a slash", () => {
    const gates = buildGates(["foliplus/Y.py"], {
      ruff: ["/x/ruff.exe"],
      exists: allExist,
    });
    const ruff = gates.find(g => g.name === "ruff");
    expect(ruff!.cmd).toContain('"/x/ruff.exe" check');
  });
});

describe("runGates", () => {
  it("prints a checkmark and continues when a gate passes", () => {
    const gates = [{ name: "typecheck", cmd: "npm run typecheck", fix: null }];
    const { run } = makeRunner({ status: 0 });
    const { io, logs, writes } = makeIo();
    const failed = runGates(gates, run, io);
    expect(failed).toBe(false);
    expect(writes.join("")).toContain("→ typecheck");
    expect(logs.join("")).toContain("✓");
  });

  it("prints a skip marker and does not run when cmd is null", () => {
    const gates = [{ name: "x (skip)", cmd: null, fix: null }];
    const { run } = makeRunner();
    const { io, logs } = makeIo();
    runGates(gates, run, io);
    expect(run).not.toHaveBeenCalled();
    expect(logs.join("")).toContain("(skip)");
  });

  it("reports stdout, stderr and the fix hint and aborts on failure", () => {
    const gates = [
      { name: "prettier", cmd: "npx prettier", fix: "npx prettier --write" },
    ];
    const { run } = makeRunner({
      status: 1,
      stdout: "stdout line",
      stderr: "stderr line",
    });
    const { io, logs, errs } = makeIo();
    const failed = runGates(gates, run, io);
    expect(failed).toBe(true);
    expect(logs.join("")).toContain("stdout line");
    expect(errs.join("")).toContain("stderr line");
    expect(errs.join("")).toContain("GATE FAILED: prettier");
    expect(errs.join("")).toContain("fix: npx prettier --write");
  });

  it("does not print a fix hint when fix is null", () => {
    const gates = [{ name: "typecheck", cmd: "tsc", fix: null }];
    const { run } = makeRunner({ status: 1 });
    const { io, errs } = makeIo();
    runGates(gates, run, io);
    expect(errs.join("")).not.toContain("fix:");
  });
});

describe("main", () => {
  it("runs the full flow and returns 0 when every gate passes", () => {
    const { run } = makeRunner({ status: 0 });
    run.mockImplementation((cmd: string) => {
      if (cmd.includes("fetch")) return { status: 0, stdout: "", stderr: "" };
      if (cmd.includes("merge-base")) {
        return { status: 0, stdout: "abc123", stderr: "" };
      }
      if (cmd.includes("diff")) return { status: 0, stdout: "", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    });
    const { io, logs } = makeIo();
    const code = main({ run, io, ruff: ["ruff"], pytestExe: "python" });
    expect(code).toBe(0);
    expect(logs.join("")).toContain("base: abc123");
    expect(logs.join("")).toContain("all local gates green");
  });

  it("returns 1 and sets exitCode when a gate fails", () => {
    const { run } = makeRunner({ status: 0 });
    let n = 0;
    run.mockImplementation((cmd: string) => {
      if (cmd.includes("fetch")) return { status: 0, stdout: "", stderr: "" };
      if (cmd.includes("merge-base")) {
        return { status: 0, stdout: "abc123", stderr: "" };
      }
      if (cmd.includes("diff")) return { status: 0, stdout: "", stderr: "" };
      n++;
      // First real gate (typecheck) fails.
      return n === 1
        ? { status: 1, stdout: "typecheck error", stderr: "" }
        : { status: 0, stdout: "", stderr: "" };
    });
    const { io, errs } = makeIo();
    const prev = process.exitCode;
    const code = main({ run, io, ruff: ["ruff"], pytestExe: "python" });
    expect(code).toBe(1);
    expect(errs.join("")).toContain("one or more local gates failed");
    expect(process.exitCode).toBe(1);
    process.exitCode = prev;
  });
});
