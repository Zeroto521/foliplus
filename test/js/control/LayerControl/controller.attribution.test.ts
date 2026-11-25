// test/js/control/LayerControl/controller.attribution — the attribution table Leaflet keeps.
import {
  TileLayer,
  createLayerControllerFixture,
  teardownLayerControllerFixture,
} from "./controller.fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type LayerController } from "#control/LayerControl/controller.js";

describe("LayerController", () => {
  let manager: LayerController;
  let map: any;

  beforeEach(() => {
    ({ manager, map } = createLayerControllerFixture());
  });

  afterEach(() => {
    teardownLayerControllerFixture(manager);
  });

  // ── syncAttribution ──

  it("syncAttribution is a silent no-op when the map has no attribution control", () => {
    // A stripped map (Leaflet built without the control) must not throw — the
    // ordering pass calls this on every reorder.
    (manager.map as any).attributionControl = null;
    expect(() => manager.syncAttribution()).not.toThrow();
  });

  // ── initial data normalization ──

  it("syncAttribution picks the topmost visible base tile and stops early", () => {
    const tile1 = new TileLayer(); // attribution: © OpenStreetMap (default)
    const tile2 = new TileLayer();
    manager.map.hasLayer.mockImplementation((l: any) => l === tile1);
    // Re-register base1 with the test instance; base2 registers ahead of it
    // (insertAt firstBaseIdx) but is invisible, so base1 is the topmost
    // visible tile whose attribution wins.
    manager.registerLayer({ id: "base1", name: "Base1", layer: tile1, role: "base" });
    manager.registerLayer({ id: "base2", name: "Base2", layer: tile2, role: "base" });
    manager.enforceOrder();
    expect(map.attributionControl._attributions).toEqual({ "© OpenStreetMap": 1 });
  });

  it("syncAttribution fully rebuilds the table on every call — no stale Leaflet entries linger", () => {
    // Two visible bases: the topmost (registry index 0, which is the
    // later-registered one under insertAt firstBaseIdx) wins. Every sync
    // clears the table first — so a stale entry Leaflet's own layeradd
    // callback may have added cannot survive a subsequent sync. Without the
    // full-clear step, the table would grow with every toggle and the
    // attribution line would stack every base's credit.
    const osm = new TileLayer(); // default attribution
    const custom = new TileLayer();
    custom.options.attribution = "Custom base";
    manager.map.hasLayer.mockImplementation((l: any) => l === osm || l === custom);
    manager.registerLayer({ id: "osm", name: "OSM", layer: osm, role: "base" });
    manager.registerLayer({
      id: "custom",
      name: "Custom",
      layer: custom,
      role: "base",
    });
    // Seed a stale entry as if Leaflet's layeradd for osm had already run.
    const ac = map.attributionControl;
    ac._attributions = { "© OpenStreetMap": 1 };
    manager.syncAttribution();
    expect(ac._attributions).toEqual({ "Custom base": 1 });
  });

  it("syncAttribution leaves the table empty when no base tile is visible", () => {
    manager.map.hasLayer.mockReturnValue(false);
    manager.enforceOrder();
    expect(map.attributionControl._attributions).toEqual({});
  });

  it("syncAttribution skips non-base entries while scanning for the top tile", () => {
    // The scan walks from firstBaseIdx and normal ordering keeps overlays out
    // of the base ladder — but a registry can hold an overlay between bases
    // (e.g. after a raw replace), and the scan must skip it instead of
    // treating it as a candidate attribution.
    const tileA = new TileLayer();
    const tileB = new TileLayer();
    manager.map.hasLayer.mockImplementation((l: any) => l === tileB);
    manager.registerLayer({ id: "baseA", name: "A", layer: tileA, role: "base" });
    manager.registerLayer({ id: "baseB", name: "B", layer: tileB, role: "base" });
    const overlayInfo = manager.layerRegistry.get("overlay1")!;
    // Force the interleaved layout: an invisible base, then the overlay, then
    // a visible base — the visible tile must still win.
    manager.layerRegistry.replace([
      manager.layerRegistry.get("baseA")!,
      overlayInfo,
      manager.layerRegistry.get("baseB")!,
    ]);
    manager.syncAttribution();
    expect(map.attributionControl._attributions).toEqual({ "© OpenStreetMap": 1 });
  });

  it("syncAttribution rebuilds the entry table when the visible base changes", () => {
    // Every sync is a full clear + rebuild of the entry table — the "last
    // value" cache is gone because it could not see a base Leaflet had
    // already added underneath another visible base. A change of visible
    // base therefore replaces the entry rather than diffing against a
    // remembered value.
    const tile = new TileLayer();
    manager.map.hasLayer.mockImplementation((l: any) => l === tile);
    manager.registerLayer({ id: "base1", name: "OSM", layer: tile, role: "base" });

    const attr = map.attributionControl;
    manager.syncAttribution();
    expect(attr._attributions).toEqual({ "© OpenStreetMap": 1 });

    tile.options.attribution = "© Second";
    manager.syncAttribution();
    expect(attr._attributions).toEqual({ "© Second": 1 });
  });

  // ── desiredAttribution (pure, no Leaflet writes) ──

  it("desiredAttribution returns empty string when no base tile is visible", () => {
    manager.map.hasLayer.mockReturnValue(false);
    expect(manager.desiredAttribution()).toBe("");
  });

  it("desiredAttribution picks the topmost visible base in registry order", () => {
    const tileA = new TileLayer();
    tileA.options.attribution = "A attr";
    const tileB = new TileLayer();
    tileB.options.attribution = "B attr";
    manager.map.hasLayer.mockImplementation((l: any) => l === tileA || l === tileB);
    manager.registerLayer({ id: "bA", name: "A", layer: tileA, role: "base" });
    manager.registerLayer({ id: "bB", name: "B", layer: tileB, role: "base" });
    // B registers second → inserted at firstBaseIdx → index 0 → topmost
    expect(manager.desiredAttribution()).toBe("B attr");
  });

  it("desiredAttribution skips non-TileLayer layers", () => {
    const nonTile = { options: {} } as unknown as L.Layer;
    manager.map.hasLayer.mockImplementation((l: any) => l === nonTile);
    manager.registerLayer({ id: "ng", name: "NG", layer: nonTile, role: "base" });
    expect(manager.desiredAttribution()).toBe("");
  });

  it("desiredAttribution skips layers outside their own zoom range", () => {
    const tile = new TileLayer();
    tile.options.attribution = "Hidden";
    tile.options.maxZoom = 5;
    manager.map.getZoom.mockReturnValue(10);
    manager.map.hasLayer.mockImplementation((l: any) => l === tile);
    manager.registerLayer({ id: "hidden", name: "H", layer: tile, role: "base" });
    expect(manager.desiredAttribution()).toBe("");
  });

  // ── syncAttribution settled fast-path ──

  it("syncAttribution skips redraw when the table is already settled", () => {
    const tile = new TileLayer(); // default attribution
    manager.map.hasLayer.mockImplementation((l: any) => l === tile);
    manager.registerLayer({ id: "b1", name: "B1", layer: tile, role: "base" });

    const ac = map.attributionControl;
    const updateSpy = vi.fn();
    ac._update = updateSpy;

    // First call: table starts empty → must rebuild and call _update.
    manager.syncAttribution();
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(ac._attributions).toEqual({ "© OpenStreetMap": 1 });

    // Second call: table already has the expected single entry → skip.
    manager.syncAttribution();
    expect(updateSpy).toHaveBeenCalledTimes(1); // unchanged
  });

  it("syncAttribution rebuilds when Leaflet added a second entry behind our back", () => {
    const tile = new TileLayer(); // default attribution
    manager.map.hasLayer.mockImplementation((l: any) => l === tile);
    manager.registerLayer({ id: "b1", name: "B1", layer: tile, role: "base" });

    const ac = map.attributionControl;
    const updateSpy = vi.fn();
    ac._update = updateSpy;

    // Seed a stale second entry as if Leaflet's layeradd for another base ran.
    ac._attributions = { "© OpenStreetMap": 1, Stale: 1 };

    // Settled check must see the wrong key count and fall through to rebuild.
    manager.syncAttribution();
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(ac._attributions).toEqual({ "© OpenStreetMap": 1 });
  });

  it("syncAttribution clears the table when the visible base leaves", () => {
    const tile = new TileLayer();
    manager.map.hasLayer.mockImplementation((l: any) => l === tile);
    manager.registerLayer({ id: "b1", name: "B1", layer: tile, role: "base" });
    manager.enforceOrder();
    expect(map.attributionControl._attributions).toEqual({ "© OpenStreetMap": 1 });
    // flip visibility off → no base visible → table emptied
    manager.map.hasLayer.mockReturnValue(false);
    manager.enforceOrder();
    expect(map.attributionControl._attributions).toEqual({});
  });
});
