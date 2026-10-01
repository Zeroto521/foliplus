import { afterEach, describe, expect, it, vi } from "vitest";
import { requireFoliplus } from "#core/guard.js";

describe("requireFoliplus", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws with a [runtime]-prefixed message when map.foliplus is undefined", () => {
    const map = { foliplus: undefined } as unknown as L.Map;
    expect(() => requireFoliplus(map)).toThrow(/\[runtime\] no per-map namespace/);
  });

  it("returns the namespace when it is present", () => {
    const ns = { showHint: () => {} };
    const map = { foliplus: ns } as unknown as L.Map;
    expect(requireFoliplus(map)).toBe(ns);
  });

  it("warns exactly once on a version mismatch between bundle and runtime", async () => {
    // versionChecked is module-level; reset so this test starts clean.
    vi.resetModules();
    vi.stubGlobal("__FOLIPLUS_VERSION__", "v9.9.9");
    vi.stubGlobal("foliplus", { version: "v1.0.0" });
    const warnSpy = vi.spyOn(console, "warn");
    const { requireFoliplus: rf } = await import("#core/guard.js");
    const ns = { showHint: () => {} };
    const map = { foliplus: ns } as unknown as L.Map;
    expect(rf(map)).toBe(ns);
    expect(rf(map)).toBe(ns);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/version mismatch/);
    warnSpy.mockRestore();
  });
});
