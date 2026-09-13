import { describe, expect, it } from "vitest";
import { ensureMapFoliplus } from "#core/mapApi.js";

// MapFoliplus is seeded by exactly one place in the codebase (mapApi.ts) and
// shared by five factories. These tests pin the two properties that make the
// required-members lie in MapFoliplus safe to keep: the seed is created once
// per map (so the factories add to one object, never fork one), and the
// placeholder LayerAPI value is a load-bearing sentinel that the factories are
// expected to replace rather than read.

type StubMap = { foliplus?: Record<string, unknown> };

describe("ensureMapFoliplus", () => {
  it("creates the namespace when the map has none", () => {
    const map: StubMap = {};
    const api = ensureMapFoliplus(map);
    expect(api).toBeDefined();
    expect(map.foliplus).toBe(api);
  });

  it("returns the same object on repeated calls (single seed per map)", () => {
    const map: StubMap = {};
    const a = ensureMapFoliplus(map);
    const b = ensureMapFoliplus(map);
    expect(b).toBe(a);
  });

  it("does not reseed a map that already carries a namespace", () => {
    const map: StubMap = { foliplus: { events: "kept" } };
    const api = ensureMapFoliplus(map);
    expect(api).toBe(map.foliplus);
    expect(api.events).toBe("kept");
  });

  it("seeds LayerAPI with the placeholder sentinel the factories replace", () => {
    const api = ensureMapFoliplus({} as StubMap);
    expect(api.LayerAPI).toBeNull();
  });

  it("seeds distinct namespaces for distinct maps", () => {
    const a = ensureMapFoliplus({} as StubMap);
    const b = ensureMapFoliplus({} as StubMap);
    expect(b).not.toBe(a);
  });

  it("keeps the seed writable so the factories can assign members", () => {
    const map: StubMap = {};
    const api = ensureMapFoliplus(map);
    api.showHint = () => {};
    api.hideHint = () => {};
    api.events = "bus";
    api.modes = "modes";
    api.interaction = "interaction";
    api.LayerAPI = "real";
    expect(api.LayerAPI).toBe("real");
    expect(api.events).toBe("bus");
  });
});
