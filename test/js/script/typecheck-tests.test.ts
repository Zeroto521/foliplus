// The test-program tsc output is the CI gate for test/js types. parseErrors is
// the filter that decides which errors count: production lines are dropped
// (the root tsconfig owns them), everything else is gating. A regression here
// would silently swallow real test errors, so the split is asserted directly.
import { describe, expect, it } from "vitest";
import { PRODUCTION, parseErrors } from "#script/typecheck-tests.mjs";

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

  it("splits production lines from gated ones", () => {
    const blocks = parseErrors(
      [
        "foliplus/js/core/x.ts(1,1): error TS7006: Parameter 'p' implicitly has an 'any' type.",
        "test/js/y.test.ts(1,1): error TS7005: Variable 'x' implicitly has an 'any' type.",
      ].join("\n"),
    );
    expect(blocks.filter(b => PRODUCTION.test(b.path))).toEqual([
      {
        path: "foliplus/js/core/x.ts",
        lines: [
          "foliplus/js/core/x.ts(1,1): error TS7006: Parameter 'p' implicitly has an 'any' type.",
        ],
      },
    ]);
    expect(blocks.filter(b => !PRODUCTION.test(b.path))).toEqual([
      {
        path: "test/js/y.test.ts",
        lines: [
          "test/js/y.test.ts(1,1): error TS7005: Variable 'x' implicitly has an 'any' type.",
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
});
