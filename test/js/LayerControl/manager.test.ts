import * as CONST from "#foliplus/LayerControl/const.js";
import {
  LayerManager,
  LayerRegistry,
} from "#foliplus/LayerControl/manager.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

describe("LayerManager", () => {
  let manager, map;

  beforeEach(() => {
    window.CONF = { ...window.CONF, name: "LayerControl", locale_code: "en" };

    class TileLayer {
      options = { attribution: "© OpenStreetMap" };
    }
    class Renderer {}
    class Path {}
    class Marker {}
    class CircleMarker {}
    const stamp = (() => {
      let id = 0;
      return vi.fn(() => ++id);
    })();

    window.L.TileLayer = TileLayer;
    window.L.Renderer = Renderer;
    window.L.Path = Path;
    window.L.Marker = Marker;
    window.L.CircleMarker = CircleMarker;
    window.L.stamp = stamp;
    window.L.svg = vi.fn(() => ({ addTo: vi.fn() }));

    function makePane() {
      const el = document.createElement("div");
      el.style.zIndex = "0";
      return el;
    }

    map = {
      on: vi.fn(),
      off: vi.fn(),
      hasLayer: vi.fn(() => false),
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
      getPane: vi.fn(() => {
        const p = makePane();
        p.style.zIndex = "0";
        return p;
      }),
      createPane: vi.fn(() => {
        const p = makePane();
        p.classList.add("foliplus-layer-pane");
        return p;
      }),
      _container: document.createElement("div"),
      _layers: {},
      attributionControl: { _attributions: {}, _update: vi.fn() },
    };

    manager = new LayerManager(map, [
      { id: "overlay1", name: "Points", isBase: false },
      {
        id: "base1",
        name: "OSM",
        isBase: true,
        layer: new TileLayer(),
        paneName: "tilePane",
      },
    ]);
  });

  it("constructor creates registry from data", () => {
    expect(manager.layerRegistry.size).toBe(2);
  });

  it("computeZIndex returns expected values", () => {
    // 2 layers, index 0, layer count = 2
    // z = CONST.Z_INDEX.BASE + (2 - 0) * 10 = 600 + 20 = 620
    const base = CONST.Z_INDEX.BASE;
    const step = CONST.Z_INDEX.STEP;
    expect(manager.computeZIndex(0, false)).toBe(base + 2 * step);
    expect(manager.computeZIndex(1, false)).toBe(base + 1 * step);
    // Tile layers use TILE_BASE
    expect(manager.computeZIndex(0, true)).toBe(CONST.Z_INDEX.TILE_BASE + 2 * step);
  });

  it("getLayerType returns null for unknown id", () => {
    expect(manager.getLayerType("nonexistent")).toBeNull();
  });

  it("getLayerType returns 'base' for base layers", () => {
    expect(manager.getLayerType("base1")).toBe("base");
  });

  it("getLayersByType filters by type", () => {
    const bases = manager.getLayersByType("base");
    expect(bases).toHaveLength(1);
    expect(bases[0].id).toBe("base1");
  });

  it("extractPoints returns empty array for non-existent layer", () => {
    expect(manager.extractPoints("nonexistent")).toEqual([]);
  });

  it("destroy clears registry and unbinds events", () => {
    manager.destroy();
    expect(manager.layerRegistry.size).toBe(0);
    expect(map.off).toHaveBeenCalled();
  });

  it("unregisterLayer returns false for unknown id", () => {
    expect(manager.unregisterLayer("nonexistent")).toBe(false);
  });

  it("unregisterLayer returns true when layer is found and removed", () => {
    manager.registerLayer({ id: "test_layer", name: "Test" });
    const result = manager.unregisterLayer("test_layer");
    expect(result).toBe(true);
  });

  it("clearAllLayers is safe for null", () => {
    expect(() => manager.clearAllLayers(null)).not.toThrow();
  });

  it("clearAllLayers handles eachLayer recursively", () => {
    const child = { clearLayers: vi.fn() };
    const parent = { eachLayer: vi.fn(cb => cb(child)) };
    manager.clearAllLayers(parent);
    expect(child.clearLayers).toHaveBeenCalled();
  });
});
