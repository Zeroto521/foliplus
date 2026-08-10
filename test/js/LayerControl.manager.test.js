import { LayerRegistry } from "#foliplus/LayerControl/LayerControl.manager.js";
import { beforeEach, describe, expect, it } from "vitest";

describe("LayerRegistry", () => {
  let registry;

  beforeEach(() => {
    registry = new LayerRegistry([
      { id: "overlay1", name: "Points", isBase: false },
      { id: "overlay2", name: "Lines", isBase: false },
      { id: "base1", name: "OpenStreetMap", isBase: true },
    ]);
  });

  describe("constructor", () => {
    it("builds items and byId index", () => {
      expect(registry.size).toBe(3);
      expect(registry.get("overlay1").name).toBe("Points");
      expect(registry.get("base1").isBase).toBe(true);
    });

    it("resolves firstBaseIdx", () => {
      expect(registry.firstBaseIdx).toBe(2);
    });

    it("returns -1 firstBaseIdx when no bases", () => {
      const r = new LayerRegistry([
        { id: "a", isBase: false },
        { id: "b", isBase: false },
      ]);
      expect(r.firstBaseIdx).toBe(-1);
    });
  });

  describe("createLayerInfo", () => {
    it("fills missing fields with defaults", () => {
      const info = registry.createLayerInfo({ id: "test" });
      expect(info.id).toBe("test");
      expect(info.name).toBe("test");
      expect(info.visible).toBe(true);
      expect(info.isBase).toBe(false);
      expect(info.paneName).toBeNull();
      expect(info.iconSvg).toBeNull();
      expect(info.canvas).toBeNull();
      expect(info.onToggle).toBeNull();
      expect(info.onZIndex).toBeNull();
    });

    it("preserves existing values from existingLi", () => {
      const info = registry.createLayerInfo(
        { id: "test" },
        { name: "Existing", visible: false },
      );
      expect(info.name).toBe("Existing");
      expect(info.visible).toBe(false);
    });
  });

  describe("upsert", () => {
    it("adds a new layer", () => {
      registry.upsert(registry.createLayerInfo({ id: "new", name: "New" }));
      expect(registry.has("new")).toBe(true);
      expect(registry.size).toBe(4);
    });

    it("updates an existing layer in place", () => {
      registry.upsert(registry.createLayerInfo({ id: "overlay1", name: "Updated" }));
      expect(registry.get("overlay1").name).toBe("Updated");
      expect(registry.size).toBe(3);
    });
  });

  describe("prepend", () => {
    it("adds a layer at the front", () => {
      registry.prepend(registry.createLayerInfo({ id: "new", name: "New" }));
      expect(registry.at(0).id).toBe("new");
      expect(registry.size).toBe(4);
    });
  });

  describe("insertAt", () => {
    it("inserts a layer at a specific index", () => {
      registry.insertAt(registry.createLayerInfo({ id: "new", name: "New" }), 1);
      expect(registry.at(1).id).toBe("new");
      expect(registry.size).toBe(4);
    });
  });

  describe("remove", () => {
    it("removes a layer by id", () => {
      registry.remove("overlay1");
      expect(registry.has("overlay1")).toBe(false);
      expect(registry.size).toBe(2);
    });

    it("returns null for unknown id", () => {
      expect(registry.remove("nonexistent")).toBeNull();
    });
  });

  describe("moveToFront (bringLayerToFront)", () => {
    it("moves the layer to index 0", () => {
      registry.moveToFront("base1");
      expect(registry.at(0).id).toBe("base1");
    });

    it("does nothing when layer is already at front", () => {
      registry.moveToFront("overlay1");
      expect(registry.at(0).id).toBe("overlay1");
    });

    it("returns null for unknown id", () => {
      expect(registry.moveToFront("nonexistent")).toBeNull();
    });
  });

  describe("reorder", () => {
    it("moves an element from fromIdx to toIdx", () => {
      // splice(fromIdx,1) removes overlay1; splice(toIdx,0) inserts it at 2
      registry.reorder(0, 2);
      expect(registry.at(0).id).toBe("overlay2");
      expect(registry.at(1).id).toBe("base1");
      expect(registry.at(2).id).toBe("overlay1");
    });
  });

  describe("normalizeGroups", () => {
    it("reorders so overlays come before bases", () => {
      const r = new LayerRegistry([
        { id: "base1", name: "B1", isBase: true },
        { id: "overlay1", name: "O1", isBase: false },
        { id: "base2", name: "B2", isBase: true },
      ]);
      r.normalizeGroups();
      expect(r.at(0).id).toBe("overlay1");
      expect(r.at(1).isBase).toBe(true);
      expect(r.at(2).isBase).toBe(true);
    });
  });

  describe("clear", () => {
    it("removes all layers", () => {
      registry.clear();
      expect(registry.size).toBe(0);
      expect(registry.firstBaseIdx).toBe(-1);
    });
  });

  describe("canReorderBetween", () => {
    it("allows same-group reorder", () => {
      expect(registry.canReorderBetween(0, 1)).toBe(true);
      // base1 is the only base at idx 2; same-index is always allowed
      expect(registry.canReorderBetween(2, 2)).toBe(true);
    });

    it("blocks cross-group reorder", () => {
      expect(registry.canReorderBetween(0, 2)).toBe(false);
    });

    it("returns false for out-of-range indices", () => {
      expect(registry.canReorderBetween(0, 99)).toBe(false);
      expect(registry.canReorderBetween(-1, 0)).toBe(false);
    });
  });

  describe("readonly view", () => {
    it("throws on mutation via list", () => {
      expect(() => {
        registry.list.push({ id: "x" });
      }).toThrow();
    });

    it("blocks mutating methods on view", () => {
      expect(() => {
        registry.list.splice(0, 1);
      }).toThrow();
    });
  });
});
