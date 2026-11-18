// core/layer/role — the role vocabulary.
import { describe, expect, it } from "vitest";
import { LayerInfoRegistry, type LayerRole, ROLE } from "#foliplus/core/layer/index.js";

describe("ROLE", () => {
  it("names the two layer roles", () => {
    expect(ROLE).toEqual({ OVERLAY: "overlay", BASE: "base" });
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
