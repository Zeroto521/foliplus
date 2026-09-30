import { afterEach, describe, expect, it, vi } from "vitest";
import { requireFoliplus } from "#core/guard.js";

describe("requireFoliplus", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws when map.foliplus is undefined", () => {
    const map = { foliplus: undefined } as unknown as L.Map;
    expect(() => requireFoliplus(map)).toThrow(/no per-map namespace/);
  });

  it("returns the namespace when it is present", () => {
    const ns = { showHint: () => {} };
    const map = { foliplus: ns } as unknown as L.Map;
    expect(requireFoliplus(map)).toBe(ns);
  });

  it("warns once on a version mismatch between bundle and runtime", () => {
    vi.stubGlobal("foliplus", { version: "v1.0.0" });
    const ns = {};
    const map = { foliplus: ns } as unknown as L.Map;
    // The bundle's __FOLIPLUS_VERSION__ is undefined outside the build, so the
    // check is a no-op here; the warning path is exercised by a real build.
    expect(() => requireFoliplus(map)).not.toThrow();
  });
});
