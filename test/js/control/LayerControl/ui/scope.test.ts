// LayerControl ui/scope.ts — teardown as one ordered, failure-isolated list.
import { describe, expect, it, vi } from "vitest";
import { createScope } from "#control/LayerControl/ui/scope.js";

describe("createScope — the panel teardown contract", () => {
  it("runs steps in registration order", () => {
    const ran: string[] = [];
    const scope = createScope();
    scope.step("third", () => ran.push("third"));
    scope.step("first", () => ran.push("first"));
    scope.step("second", () => ran.push("second"));

    expect(scope.names()).toEqual(["third", "first", "second"]);
    scope.dispose();
    expect(ran).toEqual(["third", "first", "second"]);
  });

  it("keeps running after a step throws and reports it by name", () => {
    const ran: string[] = [];
    const reported: string[] = [];
    const scope = createScope();
    scope.step("before", () => ran.push("before"));
    scope.step("broken", () => {
      throw new Error("teardown step failed");
    });
    scope.step("after", () => ran.push("after"));

    const result = scope.dispose(failure => reported.push(failure.name));

    expect(ran).toEqual(["before", "after"]);
    expect(reported).toEqual(["broken"]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.name).toBe("broken");
    expect(() => result.throwIfFailed()).toThrow("teardown step failed");
  });

  it("dispose is idempotent: the second call re-runs nothing and reports nothing", () => {
    const run = vi.fn();
    const scope = createScope();
    scope.step("only", run);

    scope.dispose();
    const second = scope.dispose();

    expect(run).toHaveBeenCalledTimes(1);
    expect(second.failures).toEqual([]);
    expect(scope.disposed).toBe(true);
  });

  it("a step registered after dispose runs at once instead of being dropped", () => {
    const late = vi.fn();
    const scope = createScope();
    scope.dispose();

    scope.step("late", late);

    expect(late).toHaveBeenCalledTimes(1);
  });

  it("add() returns an idempotent off that drops its own step", () => {
    const off = vi.fn();
    const scope = createScope();
    const unsubscribe = scope.add("subscription", off);

    unsubscribe();
    scope.dispose();
    unsubscribe();

    expect(off).toHaveBeenCalledTimes(1);
    expect(scope.names()).toEqual([]);
  });

  it("add() off is a no-op once dispose already ran", () => {
    const off = vi.fn();
    const scope = createScope();
    const unsubscribe = scope.add("subscription", off);

    scope.dispose();
    unsubscribe();

    expect(off).toHaveBeenCalledTimes(1);
  });
});
