// core/layer/role — the role vocabulary and its section projection.
import { describe, expect, it } from "vitest";
import {
  GROUP,
  LayerInfoRegistry,
  type LayerRole,
  ROLE,
  sectionOf,
} from "#foliplus/core/layer/index.js";

describe("ROLE", () => {
  it("names the two layer roles", () => {
    expect(ROLE).toEqual({ OVERLAY: "overlay", BASE: "base" });
  });

  it("keeps GROUP as the deprecated alias of the same vocabulary", () => {
    // UI code still spells it GROUP; the alias must be the same object so the
    // two names cannot drift into different values while the rename is in
    // flight.
    expect(GROUP).toBe(ROLE);
  });
});

describe("sectionOf", () => {
  const EXPECTED: Record<LayerRole, string> = {
    [ROLE.BASE]: "base",
    [ROLE.OVERLAY]: "overlay",
  };

  it("maps every role to its section (table-driven)", () => {
    for (const role of Object.values(ROLE)) {
      expect(sectionOf(role)).toBe(EXPECTED[role]);
    }
  });

  it("is total over the vocabulary: no role falls through", () => {
    // The projection is a table, so a new role without a section is a type
    // error; this guards the runtime side (every declared role resolves).
    const sections = new Set(Object.values(ROLE).map(role => sectionOf(role)));
    expect(sections).toEqual(new Set(["base", "overlay"]));
  });
});

describe("registration role input", () => {
  const fresh = () => new LayerInfoRegistry([]);

  it("accepts the new role spelling", () => {
    const info = fresh().createLayerInfo({ id: "new", role: "base" });
    expect(info.group).toBe("base");
  });

  it("still accepts the legacy group spelling", () => {
    const info = fresh().createLayerInfo({ id: "old", group: "base" });
    expect(info.group).toBe("base");
  });

  it("prefers role over group when a caller sends both", () => {
    const info = fresh().createLayerInfo({
      id: "both",
      role: "base",
      group: "overlay",
    });
    expect(info.group).toBe("base");
  });

  it("keeps the registered role on a re-registration that names neither", () => {
    const registry = fresh();
    const first = registry.createLayerInfo({ id: "kept", role: "base" });
    const again = registry.createLayerInfo({ id: "kept" }, first);
    expect(again.group).toBe("base");
  });
});
