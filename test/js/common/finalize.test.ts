import { describe, expect, it } from "vitest";
import {
  type FinalizeEachFailure,
  type FinalizeResult,
  type FinalizeStep,
  finalize,
  finalizeEach,
  finalizeFirstError,
} from "#common/finalize.js";

describe("finalize", () => {
  it("runs every step in order and reports nothing on success", () => {
    const seen: string[] = [];
    const first: FinalizeStep = ["a", () => seen.push("a")];
    const out: FinalizeResult = finalize(
      first,
      ["b", () => seen.push("b")],
      ["c", () => seen.push("c")],
    );
    expect(seen).toEqual(["a", "b", "c"]);
    expect(out.firstError).toBeNull();
    expect(out.failures).toEqual([]);
  });

  it("keeps going after a throwing step and names it", () => {
    const seen: string[] = [];
    const boom = new Error("boom");
    const out = finalize(
      ["first", () => seen.push("first")],
      [
        "middle",
        () => {
          throw boom;
        },
      ],
      ["last", () => seen.push("last")],
    );
    expect(seen).toEqual(["first", "last"]);
    expect(out.firstError).toBe(boom);
    expect(out.failures).toHaveLength(1);
    expect(out.failures[0].name).toBe("middle");
  });

  it("collects multiple failures in execution order", () => {
    const out = finalize(
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
    );
    expect(out.failures.map(f => f.name)).toEqual(["a", "c"]);
    expect((out.firstError as Error).message).toBe("a");
  });

  it("never throws, even when a step throws a non-Error", () => {
    const thrownString: unknown = "string";
    expect(() =>
      finalize([
        "s",
        () => {
          throw thrownString;
        },
      ]),
    ).not.toThrow();
    const thrownNull: unknown = null;
    expect(
      finalizeFirstError([
        "s",
        () => {
          throw thrownNull;
        },
      ]),
    ).toBeNull();
  });
});

describe("finalizeEach", () => {
  it("isolates each item and returns the failed ones", () => {
    const done: number[] = [];
    const failures: ReadonlyArray<FinalizeEachFailure<number>> = finalizeEach(
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
});
