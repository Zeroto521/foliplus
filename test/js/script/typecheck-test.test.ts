// The test-program tsc output is the CI gate for test/js types. parseErrors
// groups the output, filterProduction decides which errors count: production
// lines are dropped (the root tsconfig owns them), everything else is gating.
// A regression here would silently swallow real test errors, so both are
// asserted directly, along with the main() shell that reports on them.
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  PRODUCTION,
  filterProduction,
  main,
  parseErrors,
  runTsc,
} from "#script/typecheck-test.mjs";

const productionError =
  "foliplus/js/core/x.ts(1,1): error TS7006: Parameter 'p' implicitly has an 'any' type.";
const testError =
  "test/js/y.test.ts(1,1): error TS7005: Variable 'x' implicitly has an 'any' type.";

describe("parseErrors", () => {
  it("groups each error with its continuation lines", () => {
    const blocks = parseErrors(
      [
        "test/js/a.test.ts(1,2): error TS7005: Variable 'x' implicitly has an 'any' type.",
        "  Type 'T' is not assignable to type 'number'.",
        "test/js/b.test.ts(9,1): error TS2322: Type 'string' is not assignable to type 'number'.",
      ].join("\n"),
    );
    expect(blocks).toEqual([
      {
        path: "test/js/a.test.ts",
        lines: [
          "test/js/a.test.ts(1,2): error TS7005: Variable 'x' implicitly has an 'any' type.",
          "  Type 'T' is not assignable to type 'number'.",
        ],
      },
      {
        path: "test/js/b.test.ts",
        lines: [
          "test/js/b.test.ts(9,1): error TS2322: Type 'string' is not assignable to type 'number'.",
        ],
      },
    ]);
  });

  it("keeps a path-less config failure in the gate", () => {
    const blocks = parseErrors(
      "error TS5058: The specified path does not exist: 'test/js/tsconfig.json'.",
    );
    expect(blocks).toEqual([
      {
        path: "",
        lines: [
          "error TS5058: The specified path does not exist: 'test/js/tsconfig.json'.",
        ],
      },
    ]);
  });

  it("returns nothing for clean output", () => {
    expect(parseErrors("")).toEqual([]);
    expect(parseErrors("\n\n  \n")).toEqual([]);
  });

  it("accepts CRLF output from a Windows tsc", () => {
    expect(parseErrors(`${testError}\r\n  continuation\r\n`)).toEqual([
      { path: "test/js/y.test.ts", lines: [testError, "  continuation"] },
    ]);
  });
});

describe("filterProduction", () => {
  it("drops production blocks and reports how many", () => {
    const { gated, filtered } = filterProduction(
      parseErrors(`${productionError}\n${testError}`),
    );
    expect(filtered).toBe(1);
    expect(gated).toEqual([{ path: "test/js/y.test.ts", lines: [testError] }]);
    expect(PRODUCTION.test(gated[0].path)).toBe(false);
  });

  it("keeps every non-production path, not just test/js", () => {
    const text = [
      "script/build/x.mjs(2,3): error TS7006: Parameter 'p' implicitly has an 'any' type.",
      "foliplus/js/y.ts(1,1): error TS7006: Parameter 'p' implicitly has an 'any' type.",
    ].join("\n");
    expect(filterProduction(parseErrors(text)).gated).toHaveLength(1);
    expect(filterProduction(parseErrors(text)).gated[0].path).toBe(
      "script/build/x.mjs",
    );
  });

  it("never drops a path-less block", () => {
    const { gated, filtered } = filterProduction(
      parseErrors("error TS5058: The specified path does not exist: 'x'."),
    );
    expect(filtered).toBe(0);
    expect(gated[0].path).toBe("");
  });

  it("returns empty counts for clean output", () => {
    expect(filterProduction(parseErrors(""))).toEqual({ gated: [], filtered: 0 });
  });
});

describe("runTsc", () => {
  it("runs the workspace tsc on the test program", () => {
    const spawn = vi.fn();
    runTsc({ spawn });

    const [bin, args, options] = spawn.mock.calls[0] ?? [];
    expect(bin).toBe(process.execPath);
    expect(args).toEqual([
      expect.stringMatching(/typescript[\\/]bin[\\/]tsc$/),
      "--noEmit",
      "--pretty",
      "false",
      "-p",
      "test/js/tsconfig.json",
    ]);
    expect(options).toEqual({ cwd: expect.any(String), encoding: "utf8" });
  });

  it("honours an injected cwd", () => {
    const spawn = vi.fn();
    runTsc({ spawn, cwd: "/tmp/repo" });

    const [bin, args, options] = spawn.mock.calls[0] ?? [];
    expect(bin).toBe(process.execPath);
    expect(args[0]).toBe(resolve("/tmp/repo", "node_modules/typescript/bin/tsc"));
    expect(options.cwd).toBe("/tmp/repo");
  });
});

describe("main", () => {
  it("reports a clean run and exits 0", () => {
    const log = vi.fn();
    const error = vi.fn();
    const code = main({
      run: () => ({ status: 0, stdout: "", stderr: "" }),
      log,
      error,
    });

    expect(code).toBe(0);
    expect(log).toHaveBeenCalledWith(
      "test/js typecheck: 0 errors (production lines filtered by design: 0)",
    );
    expect(error).not.toHaveBeenCalled();
  });

  it("counts filtered production lines in the summary", () => {
    const log = vi.fn();
    const code = main({
      run: () => ({ status: 2, stdout: productionError, stderr: "" }),
      log,
      error: vi.fn(),
    });

    expect(code).toBe(0);
    expect(log).toHaveBeenCalledWith(
      "test/js typecheck: 0 errors (production lines filtered by design: 1)",
    );
  });

  it("prints gated blocks one error at a time and exits 1", () => {
    const log = vi.fn();
    const error = vi.fn();
    const code = main({
      run: () => ({ status: 2, stdout: "", stderr: testError }),
      log,
      error,
    });

    expect(code).toBe(1);
    expect(log).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(testError);
  });

  it("treats a spawn failure as a hard stop", () => {
    const error = vi.fn();
    const code = main({
      run: () => ({ status: 1, error: new Error("ENOENT") }),
      log: vi.fn(),
      error,
    });

    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith("Error: ENOENT");
  });

  it("treats an unexpected exit status as a hard stop", () => {
    const error = vi.fn();
    const code = main({
      run: () => ({ status: 7, stdout: "", stderr: "" }),
      log: vi.fn(),
      error,
    });

    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith("tsc exited 7");
  });

  it("tolerates a missing stdout and stderr", () => {
    const log = vi.fn();
    expect(main({ run: () => ({ status: 0 }), log, error: vi.fn() })).toBe(0);
    expect(log).toHaveBeenCalledWith(
      "test/js typecheck: 0 errors (production lines filtered by design: 0)",
    );
  });
});
