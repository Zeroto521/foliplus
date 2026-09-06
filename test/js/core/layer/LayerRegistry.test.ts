import { beforeEach, describe, expect, it } from "vitest";
import { LayerRegistry } from "#foliplus/core/layer/LayerRegistry.js";

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

    it("keeps the current name when a layer is re-registered", () => {
      // A third-party provider re-adding its layer re-advertises its own name.
      // Taking the caller's value would reset the display name on every
      // re-registration, so an existing id keeps the name the user last saw.
      const info = registry.createLayerInfo(
        { id: "overlay1", name: "Provider Name" },
        registry.get("overlay1"),
      );
      expect(info.name).toBe("Points");
    });

    it("accepts opts.name for a fresh id", () => {
      const info = registry.createLayerInfo({ id: "new1", name: "Fresh" });
      expect(info.name).toBe("Fresh");
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
        registry.layers.push({ id: "x" });
      }).toThrow();
    });

    it("blocks mutating methods on view", () => {
      expect(() => {
        registry.layers.splice(0, 1);
      }).toThrow();
    });

    it("blocks defineProperty mutation on the view", () => {
      // Regression: the old Proxy without a defineProperty trap forwarded
      // Object.defineProperty to the internal mutable array, bypassing the
      // read-only guarantee. A frozen snapshot must throw instead.
      expect(() => {
        Object.defineProperty(registry.layers, "0", { value: { id: "x" } });
      }).toThrow();
    });

    it("blocks index assignment via the set trap", () => {
      // Index assignment bypasses the MUTATING_METHODS list — the set trap is
      // the backstop that must throw.
      expect(() => {
        registry.layers[0] = { id: "x" };
      }).toThrow();
    });

    it("blocks property deletion via the deleteProperty trap", () => {
      expect(() => {
        delete registry.layers[0];
      }).toThrow();
    });

    it("view reflects the latest items after an internal mutation", () => {
      registry.prepend(
        registry.createLayerInfo({ id: "new1", name: "New", isBase: false }),
      );

      expect(registry.layers[0].id).toBe("new1");

      expect(registry.layers.length).toBe(4);
    });
  });

  describe("replace", () => {
    it("rebuilds list and identifies from a new ordered array", () => {
      const newList = [
        registry.createLayerInfo({ id: "a", name: "A", isBase: false }),
        registry.createLayerInfo({ id: "b", name: "B", isBase: true }),
      ];

      registry.replace(newList);

      expect(registry.size).toBe(2);

      expect(registry.at(0).id).toBe("a");

      expect(registry.get("b").isBase).toBe(true);

      expect(registry.firstBaseIdx).toBe(1);
    });
  });

  describe("indexOf", () => {
    it("returns the index of a layer info", () => {
      const li = registry.get("overlay1");

      expect(registry.indexOf(li)).toBe(0);
    });

    it("returns -1 for an unknown layer info", () => {
      expect(registry.indexOf({ id: "nope" })).toBe(-1);
    });
  });
});
