// test/js/control/LayerControl/controller.surface — surfaces, panes and label wiring.
import {
  TileLayer,
  createLayerControllerFixture,
  stableStamp,
  teardownLayerControllerFixture,
} from "./controller.fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS } from "#core/event/index.js";
import { FALLBACK_PANE_PREFIX, GEOM_TYPE } from "#core/layer/index.js";
import * as CONST from "#control/LayerControl/const.js";
import { LayerController } from "#control/LayerControl/controller.js";

describe("LayerController", () => {
  let manager: LayerController;
  let map: any;

  beforeEach(() => {
    ({ manager, map } = createLayerControllerFixture());
  });

  afterEach(() => {
    teardownLayerControllerFixture(manager);
  });

  it("unregisterLayer sweeps child panes no longer referenced", () => {
    manager.map.hasLayer.mockReturnValue(false);
    const api = manager.createLayers({
      id: "g1",
      name: "Group",
      panes: [{ name: "g1_base" }, { name: "g1_label", isLabel: true }],
    });
    api.register();
    expect(manager.panes.childPaneSpecs.has("g1_label")).toBe(true);
    expect(manager.unregisterLayer("g1")).toBe(true);
    expect(manager.panes.childPaneSpecs.has("g1_label")).toBe(false);
  });

  it("unregisterLayer returns true when layer is found and removed", () => {
    manager.registerLayer({ id: "test_layer", name: "Test" });
    const result = manager.unregisterLayer("test_layer");
    expect(result).toBe(true);
  });

  it("unregisterLayer reclaims only the unregistered layer's synthesized pane", () => {
    // A full sweep on every unregister would also delete another registered
    // layer's pane. The map fixture needs the Leaflet pane registry for the
    // teardown to run, and an identity-stable stamp: the surface derives its
    // pane name from one, and the shared stamp mock is a counter.
    window.L.stamp = stableStamp;
    const paneRegistry: Record<string, HTMLElement> = {};
    map._panes = paneRegistry;
    map.getPane = vi.fn((name: string) => paneRegistry[name] ?? null);
    map.createPane = vi.fn((name: string) => {
      const pane = document.createElement("div");
      pane.classList.add("foliplus-layer-pane");
      return (paneRegistry[name] = pane);
    });
    const layerA = { options: {} };
    const layerB = { options: {} };
    (window as any)["fb_a"] = layerA;
    (window as any)["fb_b"] = layerB;
    manager.registerLayer({ id: "fb_a", name: "A", layer: layerA });
    manager.registerLayer({ id: "fb_b", name: "B", layer: layerB });

    const paneA = `${FALLBACK_PANE_PREFIX}${window.L.stamp(layerA)}`;
    const paneB = `${FALLBACK_PANE_PREFIX}${window.L.stamp(layerB)}`;
    // Both surfaces synthesized their own pane at registration.
    expect(paneRegistry[paneA]).toBeDefined();
    expect(paneRegistry[paneB]).toBeDefined();

    expect(manager.unregisterLayer("fb_a")).toBe(true);
    // A is gone from both the records and the map DOM.
    expect(manager.surfaces.has("fb_a")).toBe(false);
    expect(map._panes[paneA]).toBeUndefined();
    // B is still registered, so its pane survives.
    expect(map._panes[paneB]).toBeDefined();
    expect(manager.getLayerPanes(layerB)).toEqual([paneB]);

    delete (window as any)["fb_a"];
    delete (window as any)["fb_b"];
  });

  it("routes LabelManager's pane wiring through the surface", () => {
    // The label pane is the surface's (declared `role: "label"` spec
    // from the registration edge, materialized and class-stamped by
    // PaneManager); LabelManager only mounts canvases into it. This
    // test drives the real chain end-to-end: surfaceFor declares the pane,
    // renderLabels mounts the canvas, unregisterLayer unmounts the canvas
    // while the declared pane survives for a re-registration of the id.
    window.L.stamp = stableStamp;
    const paneRegistry: Record<string, HTMLElement> = {};
    map._panes = paneRegistry;
    map.getPane = vi.fn((name: string) => paneRegistry[name] ?? null);
    // Do NOT stamp the base class here — that would make the assertion
    // below self-proving. The base `foliplus-layer-pane` comes from
    // PaneManager.ensurePane; leaving it out of the mock means the
    // assertion has teeth: if ensurePane ever stops stamping it, this
    // goes red.
    map.createPane = vi.fn((name: string) => {
      const pane = document.createElement("div");
      return (paneRegistry[name] = pane);
    });
    map.getPanes = vi.fn(() => ({}));
    const leaf = {
      options: {},
      getLatLng: () => ({ lat: 0, lng: 0 }),
      feature: { properties: { name: "hello" } },
    } as unknown as L.Layer;
    const m = new LayerController(map, [
      { id: "lbl", name: "Lbl", role: "overlay", layer: leaf },
    ]);
    m.map.hasLayer.mockReturnValue(true);
    // The panel gate is what resolves the surface in production (the menu /
    // panel call surfaceFor before a label can render); drive it explicitly
    // here so the declaration is on the record before renderLabels.
    m.surfaceFor(m.layerRegistry.get("lbl")!);
    m.label.setConfig("lbl", {
      show: true,
      field: "name",
      color: "",
      size: 12,
      format: "default" as any,
      collide: false,
    });
    // renderLabels ends in refreshLayer (the per-layer repaint) — stubbed
    // here because this fixture's map has no projection; the pane wiring
    // under test happens before it.
    vi.spyOn(m.label as any, "refreshLayer").mockImplementation(() => {});
    m.label.renderLabels("lbl");

    const paneName = `${CONST.LABEL_PANE_PREFIX}lbl`;
    const pane = paneRegistry[paneName];
    expect(pane).toBeDefined();
    expect(pane!.classList.contains("foliplus-layer-pane")).toBe(true);
    expect(pane!.classList.contains("foliplus-label-pane")).toBe(true);

    m.unregisterLayer("lbl");
    // The pane is declared, so it survives like every other declared pane
    // (the same id can register again without rebuilding its face); what
    // unregister takes down is our canvas.
    expect(paneRegistry[paneName]).toBeDefined();
    expect(pane!.querySelector("canvas")).toBeNull();
  });

  it("unregisterLayer emits EVENTS.LAYER_REMOVED event with the layer id", () => {
    manager.registerLayer({ id: "test_layer", name: "Test" });
    const bus = map.foliplus!.events;
    const handler = vi.fn();
    bus.on(EVENTS.LAYER_REMOVED, handler);

    manager.unregisterLayer("test_layer");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      { id: "test_layer" },
      { origin: { kind: "system", via: "teardown" }, revision: expect.any(Number) },
    );
  });

  it("unregisterLayer does NOT emit EVENTS.LAYER_REMOVED for unknown id", () => {
    const bus = map.foliplus!.events;
    const handler = vi.fn();
    bus.on(EVENTS.LAYER_REMOVED, handler);

    manager.unregisterLayer("nonexistent");

    expect(handler).not.toHaveBeenCalled();
  });

  // ── SurfaceIndex: the two directions are one write ──

  it("books a surface in both directions and drops them together", () => {
    window.L.stamp = stableStamp;
    const layer = new window.L.Polygon();
    manager.registerLayer({ id: "idx1", name: "Idx", layer });
    const surface = manager.surfaces.get("idx1")!;
    expect(manager.surfaceIndex.get("idx1")).toBe(surface);
    expect(manager.surfaceIndex.getByLayer(layer)).toBe(surface);
    expect(manager.surfaceIndex.getByStamp(window.L.stamp(layer))).toBe(surface);

    expect(manager.unregisterLayer("idx1")).toBe(true);
    expect(manager.surfaces.has("idx1")).toBe(false);
    expect(manager.surfaceIndex.getByLayer(layer)).toBeUndefined();
  });

  it("drops the superseded layer's reverse edge on a same-id re-registration", () => {
    window.L.stamp = stableStamp;
    const first = new window.L.Polygon();
    manager.registerLayer({ id: "idx2", name: "Idx", layer: first });
    const surfaceA = manager.surfaces.get("idx2")!;

    const second = new window.L.Polygon();
    manager.registerLayer({ id: "idx2", name: "Idx 2", layer: second });
    const surfaceB = manager.surfaces.get("idx2")!;

    expect(surfaceB).not.toBe(surfaceA);
    expect(manager.surfaceIndex.getByLayer(first)).toBeUndefined();
    expect(manager.surfaceIndex.getByLayer(second)).toBe(surfaceB);
    manager.surfaceIndex.assertConsistent(new Set(manager.layers.map(l => l.id)));

    expect(manager.unregisterLayer("idx2")).toBe(true);
    expect(manager.surfaces.has("idx2")).toBe(false);
    manager.surfaceIndex.assertConsistent(new Set(manager.layers.map(l => l.id)));
  });

  it("keeps both directions consistent across register, delete and unregister", () => {
    window.L.stamp = stableStamp;
    const registryIds = () => new Set(manager.layers.map(l => l.id));
    manager.registerLayer({ id: "no-layer", name: "No layer" });
    manager.registerLayer({
      id: "with-layer",
      name: "With",
      layer: new window.L.Polygon(),
    });
    manager.surfaceIndex.assertConsistent(registryIds());

    manager.deleteLayer("no-layer");
    manager.surfaceIndex.assertConsistent(registryIds());

    manager.unregisterLayer("with-layer");
    manager.surfaceIndex.assertConsistent(registryIds());
    expect(manager.surfaces.has("no-layer")).toBe(false);
    expect(manager.surfaces.has("with-layer")).toBe(false);
  });

  it("getLayerType caches the resolved type on the layer info", () => {
    manager.registerLayer({
      id: "poly2",
      name: "Poly",
      layer: new window.L.Polygon(),
    });
    expect(manager.getLayerType("poly2")).toBe(GEOM_TYPE.POLYGON);
    expect(manager.getLayerType("poly2")).toBe(GEOM_TYPE.POLYGON);
    expect(manager.layerRegistry.get("poly2")!.type).toBe(GEOM_TYPE.POLYGON);
  });

  // ── surface container guard ──

  it("a surface pins a group's content, never the group itself", () => {
    // Leaflet ignores a group's own `options.pane` for its children, so the pin
    // walks the tree instead of writing a pane onto the container.
    const container = { options: {} as Record<string, unknown>, eachLayer: vi.fn() };
    manager.registerLayer({ id: "c", name: "C", layer: container });
    expect(container.options.pane).toBeUndefined();
  });

  it("registerLayer with a canvas skips the SVG renderer for its pane", () => {
    window.L.svg = vi.fn(() => ({
      addTo: vi.fn(),
      // Real renderers carry a root element: `pinLateContent` needs it to move
      // path nodes, and its absence would silently take the "mark handled"
      // branch instead.
      _container: document.createElement("div"),
    }));
    const paneName = "foliplus-canvas-heat_no_svg";
    manager.registerLayer({
      id: "heat_no_svg",
      name: "Heat",
      canvas: document.createElement("canvas"),
      paneName,
    });
    expect(window.L.svg).not.toHaveBeenCalled();
  });

  it("re-registering an id under a new layer releases the old surface's panes", () => {
    // Same id, new layer object: the old surface's synthesized base pane and
    // marker-shadow pane are the OLD layer's carrier — a replacement that
    // leaves them claimed would grow one orphan pane per re-register.
    manager.map.hasLayer.mockReturnValue(true);
    const first = Object.assign(new window.L.Marker(), { options: {} });
    manager.registerLayer({ id: "replace-me", name: "R", layer: first });
    const oldSurface = manager.surfaceFor(manager.layerRegistry.get("replace-me")!);
    expect(oldSurface.paneNames.length).toBeGreaterThan(0);
    const destroySpy = vi.spyOn(oldSurface, "destroy");

    const second = Object.assign(new window.L.Marker(), { options: {} });
    manager.registerLayer({ id: "replace-me", name: "R", layer: second });
    const newSurface = manager.surfaceFor(manager.layerRegistry.get("replace-me")!);
    // The replacement released the old face (its synthesized base pane and
    // marker-shadow pane) before claiming the id for the new one, AND the old
    // layer left the map — otherwise it would keep painting as an
    // unmanageable ghost next to the new layer.
    expect(newSurface).not.toBe(oldSurface);
    expect(destroySpy).toHaveBeenCalledTimes(1);
    expect(manager.map.removeLayer).toHaveBeenCalledWith(first);
  });

  it("a layeradd marks only the owning surface dirty", () => {
    // One group gaining a leaf must not rescan every registered tree: the
    // handler attributes the arrival by stamp, then by group membership.
    manager.map.hasLayer.mockReturnValue(true);
    const groupA = { options: {}, eachLayer: vi.fn() };
    const groupB = { options: {}, eachLayer: vi.fn() };
    manager.registerLayer({ id: "ga", name: "A", layer: groupA as never });
    manager.registerLayer({ id: "gb", name: "B", layer: groupB as never });
    const surfaceA = manager.surfaces.get("ga")!;
    const surfaceB = manager.surfaces.get("gb")!;
    const spyA = vi.spyOn(surfaceA, "markContentDirty");
    const spyB = vi.spyOn(surfaceB, "markContentDirty");

    // A leaf joining group A: attributed to A (membership scan), not to B,
    // and not to the global sweep.
    const leaf = { options: {} } as never;
    groupA.eachLayer = vi.fn();
    (groupA as unknown as { hasLayer: (l: unknown) => boolean }).hasLayer = vi.fn(
      () => true,
    );
    manager.onLayerAdd({ layer: leaf } as never);

    expect(spyA).toHaveBeenCalledTimes(1);
    expect(spyB).not.toHaveBeenCalled();
  });

  it("a leaf recorded at the write point attributes to its surface in O(1)", () => {
    // createLayers' addLayer records the child -> group stamp (write-point
    // index); the handler reads the surface off the group's stamp without
    // running a membership scan at all.
    manager.map.hasLayer.mockReturnValue(true);
    const group = Object.assign({}, { options: {} });
    manager.registerLayer({ id: "gm", name: "M", layer: group as never });
    const surface = manager.surfaces.get("gm")!;
    const spy = vi.spyOn(surface, "markContentDirty");
    const leaf = { options: {} } as never;
    manager.panes.rememberChildOwnership(leaf as never, group as never);

    manager.onLayerAdd({ layer: leaf } as never);
    expect(spy).toHaveBeenCalledTimes(1);
    // A second leaf of the SAME group, also indexed, is O(1) as well.
    const leaf2 = { options: {} } as never;
    manager.panes.rememberChildOwnership(leaf2 as never, group as never);
    manager.onLayerAdd({ layer: leaf2 } as never);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("a leaf indexed to a registered surface marks that surface and no other", () => {
    // The O(1) path this index exists for: the leaf itself is not a
    // registered layer, so `directSurface` misses, and the child-ownership
    // record is the only claim. Because it claims, the fallback branch (a
    // membership scan, then the global sweep) must not run — if it did, one
    // add would still rescan every registered tree.
    //
    // The stamp has to be identity-stable for any of this to hold: the shared
    // mock is a per-call counter, so every lookup below would miss and the
    // handler would quietly take the sweep instead.
    // Fake timers so the debounced enforce this schedules cannot fire after
    // the test ends — a pending timer on a torn-down fixture is how a
    // green file turns into a flaky one on a loaded runner.
    vi.useFakeTimers();
    const realStamp = window.L.stamp;
    window.L.stamp = stableStamp;
    try {
      manager.map.hasLayer.mockReturnValue(true);
      const owned = new window.L.TileLayer();
      manager.registerLayer({ id: "gi", name: "Indexed", layer: owned });
      manager.registerLayer({
        id: "gother",
        name: "Other",
        layer: new window.L.TileLayer(),
      });
      const indexed = manager.surfaces.get("gi")!;
      const other = manager.surfaces.get("gother")!;
      const indexedSpy = vi.spyOn(indexed, "markContentDirty");
      const otherSpy = vi.spyOn(other, "markContentDirty");

      const leaf = { options: {} } as never;
      manager.panes.rememberChildOwnership(leaf as never, owned as never);
      manager.onLayerAdd({ layer: leaf } as never);

      expect(indexedSpy).toHaveBeenCalledTimes(1);
      expect(otherSpy).not.toHaveBeenCalled();
    } finally {
      window.L.stamp = realStamp;
      vi.useRealTimers();
    }
  });

  it("treats a recorded owner with no live surface as no claim at all", () => {
    // The write-point index can outlive the surface that wrote it (an
    // unregister between the record and the add). The lookup answers null,
    // and "recorded but gone" must not read as a claim — the handler falls
    // through to the global sweep instead, which is the conservative answer
    // for an arrival nothing provably owns.
    vi.useFakeTimers();
    const realStamp = window.L.stamp;
    window.L.stamp = stableStamp;
    try {
      manager.map.hasLayer.mockReturnValue(true);
      manager.registerLayer({ id: "gi", name: "I", layer: new window.L.TileLayer() });
      const indexed = manager.surfaces.get("gi")!;
      const spy = vi.spyOn(indexed, "markContentDirty");
      const leaf = { options: {} } as never;
      // A parent stamp no registered surface owns.
      manager.panes.rememberChildOwnership(leaf as never, { options: {} } as never);
      manager.onLayerAdd({ layer: leaf } as never);

      // The sweep marked it — once, and for the reason above, not because the
      // index claimed it.
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      window.L.stamp = realStamp;
      vi.useRealTimers();
    }
  });

  it("registerLayer pins the pane on a layer with a group of its own", () => {
    // A non-Path/Marker layer with children (L.GeoJSON-style) must get its
    // pane written so enforceOrder does not fall back to a generated pane.
    const child = { options: {} as Record<string, unknown> };
    const parent = {
      options: {} as Record<string, unknown>,
      eachLayer: vi.fn(cb => cb(child)),
    };
    manager.map.hasLayer.mockReturnValue(false);
    manager.registerLayer({
      id: "layered",
      name: "Layered",
      layer: parent,
      paneName: "layer_graph",
    });
    expect(parent.options.pane).toBe("layer_graph");
  });

  it("TileLayer z is written to its synthesized pane, not through setZIndex", () => {
    // First-class basemaps: setZIndex on the layer element only orders it
    // inside the shared tilePane — enough when a layer has no pane of its
    // own, but every TileLayer now owns a synthesized pane and the ordering
    // ladder writes there instead.
    const tile = new TileLayer();
    manager.map.hasLayer.mockReturnValue(true);
    manager.registerLayer({ id: "t1", name: "T", layer: tile, role: "base" });
    manager.enforceOrder();
    expect(tile.setZIndex).not.toHaveBeenCalled();
  });

  it("enforceOrder z-orders a canvas layer's dedicated pane (no Leaflet layer)", () => {
    const paneName = "foliplus-canvas-heat1";
    const canvasPane = document.createElement("div");
    canvasPane.classList.add("foliplus-layer-pane");
    const realGetPane = map.getPane;
    const realCreatePane = map.createPane;
    map.getPane = vi.fn((name: string) =>
      name === paneName ? canvasPane : realGetPane(name),
    );
    map.createPane = vi.fn((name: string) =>
      name === paneName ? canvasPane : realCreatePane(name),
    );

    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      paneName,
    });
    manager.enforceOrder();

    // Overlays are prepended, so heat1 lands at index 0 of
    // [heat1, overlay1, base1].
    const expected = manager.computeZIndex(0, "overlay");
    expect(canvasPane.style.zIndex).toBe(String(expected));
    map.getPane = realGetPane;
    map.createPane = realCreatePane;
  });
});
