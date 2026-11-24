import { afterEach, describe, expect, it, vi } from "vitest";
import { requireFoliplus, requireRuntime } from "#core/lifecycle/index.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requireFoliplus", () => {
  it("throws with a [foliplus]-prefixed message when map.foliplus is undefined", () => {
    const map = { foliplus: undefined } as unknown as L.Map;
    expect(() => requireFoliplus(map)).toThrow(/\[foliplus\] no per-map namespace/);
  });

  it("returns the namespace when it is present", () => {
    const ns = { showHint: () => {} };
    const map = { foliplus: ns } as unknown as L.Map;
    expect(requireFoliplus(map)).toBe(ns);
  });
});

describe("requireRuntime", () => {
  it("throws when foliplus is missing", () => {
    vi.stubGlobal("foliplus", undefined);
    expect(() => requireRuntime("Test")).toThrow("foliplus runtime not found");
  });

  it("passes when foliplus.showHint is available", () => {
    vi.stubGlobal("foliplus", { showHint: () => {} });
    expect(() => requireRuntime("Test")).not.toThrow();
  });
});
