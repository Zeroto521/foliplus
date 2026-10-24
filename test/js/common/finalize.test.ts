import { describe, expect, it } from "vitest";
import {
  type FinalizeEachFailure,
  type FinalizeFailure,
  type FinalizeResult,
  type FinalizeStep,
  finalize,
  finalizeEach,
} from "#common/finalize.js";

describe("finalize", () => {
  it("runs every step in order and reports nothing on success", () => {
    const seen: string[] = [];
    const first: FinalizeStep = ["a", () => seen.push("a")];
    const steps: FinalizeStep[] = [
      first,
      ["b", () => seen.push("b")],
      ["c", () => seen.push("c")],
    ];
    const out: FinalizeResult = finalize(steps);
    expect(seen).toEqual(["a", "b", "c"]);
    expect(out.failures).toEqual([]);
    expect(out.throwIfFailed).not.toThrow();
  });

  it("keeps going after a throwing step and names it", () => {
    const seen: string[] = [];
    const boom = new Error("boom");
    const out = finalize([
      ["first", () => seen.push("first")],
      [
        "middle",
        () => {
          throw boom;
        },
      ],
      ["last", () => seen.push("last")],
    ]);
    expect(seen).toEqual(["first", "last"]);
    expect(out.failures).toHaveLength(1);
    expect(out.failures[0].name).toBe("middle");
    expect(out.failures[0].error).toBe(boom);
  });

  it("collects multiple failures in execution order and raises the first", () => {
    const out = finalize([
      [
        "a",
        () => {
          throw new Error("a");
        },
      ],
      ["b", () => undefined],
      [
        "c",
        () => {
          throw new Error("c");
        },
      ],
    ]);
    expect(out.failures.map(f => f.name)).toEqual(["a", "c"]);
    expect(() => out.throwIfFailed()).toThrow("a");
  });

  it("never throws, even when a step throws a non-Error", () => {
    const thrown: unknown = "string";
    const out = finalize([
      [
        "s",
        () => {
          throw thrown;
        },
      ],
    ]);
    expect(out.failures[0].error).toBe(thrown);
    expect(() => out.throwIfFailed()).toThrow();
  });

  it("reports each failure and survives a throwing reporter", () => {
    const reported: Array<FinalizeFailure["name"]> = [];
    const seen: string[] = [];
    expect(() =>
      finalize(
        [
          [
            "a",
            () => {
              throw new Error("a");
            },
          ],
          ["b", () => seen.push("b")],
          [
            "c",
            () => {
              throw new Error("c");
            },
          ],
        ],
        failure => {
          reported.push(failure.name);
          if (failure.name === "a") throw new Error("reporter broke");
        },
      ),
    ).not.toThrow();
    expect(reported).toEqual(["a", "c"]);
    expect(seen).toEqual(["b"]);
  });
});

describe("finalizeEach", () => {
  it("isolates each item and returns the failed ones", () => {
    const done: number[] = [];
    const failures: readonly FinalizeEachFailure<number>[] = finalizeEach(
      [1, 2, 3, 4],
      n => {
        if (n === 2) throw new Error("two");
        done.push(n);
      },
      n => `item-${n}`,
    );
    expect(done).toEqual([1, 3, 4]);
    expect(failures).toHaveLength(1);
    expect(failures[0].name).toBe("item-2");
    expect(failures[0].item).toBe(2);
  });

  it("passes the index and returns an empty array when every item succeeds", () => {
    const seen: Array<[number, number]> = [];
    expect(
      finalizeEach(
        [1, 2],
        (n, i) => {
          seen.push([n, i]);
        },
        String,
      ),
    ).toEqual([]);
    expect(seen).toEqual([
      [1, 0],
      [2, 1],
    ]);
  });

  it("falls back to the index when the namer throws", () => {
    const failures = finalizeEach(
      ["x"],
      () => {
        throw new Error("boom");
      },
      () => {
        throw new Error("namer broke");
      },
    );
    expect(failures).toHaveLength(1);
    expect(failures[0].name).toBe("#0");
  });
});
