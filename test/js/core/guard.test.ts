import { afterEach, describe, expect, it } from "vitest";
import { requireFoliplus } from "#core/guard.js";

describe("requireFoliplus", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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
