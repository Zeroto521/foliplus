// core/layer/role — the role vocabulary and its section projection.
import { describe, expect, it } from "vitest";
import {
  LayerInfoRegistry,
  type LayerRole,
  ROLE,
  sectionOf,
} from "#foliplus/core/layer/index.js";

describe("ROLE", () => {
  it("names the two layer roles", () => {
    expect(ROLE).toEqual({ OVERLAY: "overlay", BASE: "base" });
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

  it("accepts the role spelling", () => {
    const info = fresh().createLayerInfo({ id: "new", role: "base" });
    expect(info.role).toBe("base");
  });

  it("defaults a layer that names no role to overlay", () => {
    const info = fresh().createLayerInfo({ id: "default" });
    expect(info.role).toBe(ROLE.OVERLAY);
  });

  it("keeps the registered role on a re-registration that names none", () => {
    const registry = fresh();
    const first = registry.createLayerInfo({ id: "kept", role: "base" });
    const again = registry.createLayerInfo({ id: "kept" }, first);
    expect(again.role).toBe("base");
  });
});
