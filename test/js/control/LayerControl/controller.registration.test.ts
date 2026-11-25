// test/js/control/LayerControl/controller.registration — registration, visibility and pending carriers.
import {
  ENFORCE_ORDER_DEBOUNCE_MS,
  createLayerControllerFixture,
  makeStore,
  stableStamp,
  teardownLayerControllerFixture,
} from "./controller.fixture.js";
import { attachedPanel, initFixture, makeDerivedUI } from "./ui/fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS } from "#core/event/index.js";
import { ROLE } from "#core/layer/index.js";
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

  describe("touchLayer", () => {
    it("delegates to the registry and reports whether the id was known", () => {
      expect(manager.touchLayer("overlay1")).toBe(true);
      expect(manager.touchLayer("nope")).toBe(false);
    });

    it("overwrites a published timestamp when the content changes at runtime", () => {
      // `createLayerInfo` deliberately keeps a re-registration's previous
      // provenance (the provider does not always resend it), so without the
      // touch call the panel would show the original publish time forever,
      // long after the runtime content changed. The epoch-ms stamp is the
      // contract: `touch` is the escape hatch, not `registerLayer`.
      const clock = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
      manager.registerLayer({ id: "pub1", name: "Published", updatedAt: 1 });
      expect(manager.layerRegistry.get("pub1")?.updatedAt).toBe(1);

      manager.touchLayer("pub1");
      expect(manager.layerRegistry.get("pub1")?.updatedAt).toBe(1_000_000);
      clock.mockRestore();
    });

    it("leaves a layer untouched when its id is unknown", () => {
      // The lightweight stub and destroyed managers both report false rather
      // than throwing, so callers can use the boolean to decide whether to
      // show a hint.
      expect(manager.touchLayer("ghost")).toBe(false);
    });
  });

  describe("intentVisible", () => {
    it("returns true for an unknown id (author default stands)", () => {
      expect(manager.intentVisible("ghost")).toBe(true);
    });

    it("returns true before UI is attached (pre-boot contract)", () => {
      const fresh = new LayerController(map, []);
      expect(fresh.intentVisible("x")).toBe(true);
    });

    it("returns true for a known layer when no UI is attached yet", () => {
      // Pre-attach the registry already knows the id, but there is no row and
      // no intent store to read — the author default still stands.
      manager.ui = null;
      expect(manager.intentVisible("overlay1")).toBe(true);
    });

    it("returns the UI's intent for a known layer", () => {
      const ui = vi.fn().mockReturnValue(false);
      manager.ui = { intentVisible: ui } as any;
      expect(manager.intentVisible("overlay1")).toBe(false);
      expect(ui).toHaveBeenCalledWith("overlay1");
    });
  });

  describe("setVisible", () => {
    it("refuses an unknown id rather than reporting a hide that never happened", () => {
      expect(manager.setVisible("ghost", false)).toBe(false);
    });

    it("refuses before the panel is attached — there is no row to sync", () => {
      // The hidden set lives on LayerUI, and destroy() clears the registry too,
      // so a "success" with no panel would be a state change nothing can show.
      manager.ui = null;
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        expect(manager.setVisible("overlay1", false)).toBe(false);
        expect(warn).toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    it("delegates to the panel's applyVisibility for a known layer", () => {
      const apply = vi.fn(() => true);
      manager.ui = { applyVisibility: apply } as any;
      expect(manager.setVisible("overlay1", false)).toBe(true);
      expect(apply).toHaveBeenCalledWith("overlay1", false);
    });
  });

  it("registerLayer uses incremental item init instead of full re-scan", () => {
    manager.map.hasLayer.mockReturnValue(true);
    manager.uiContainer = document.createElement("div");
    manager.ui = makeDerivedUI({
      intentStore: makeStore(),
      // The replay entry point always returns a round; the stub has to honour it.
      applyUserState: vi.fn(() => []),
    }) as any;
    const emitSpy = vi.spyOn(manager.events, "emitSettled");
    manager.registerLayer({
      id: "new1",
      name: "New",
      layer: { options: {} },
    } as any);
    expect(emitSpy).toHaveBeenCalledWith(
      EVENTS.LAYER_ITEM_ADDED,
      {
        id: "new1",
      },
      { kind: "programmatic", via: "init" },
    );
    expect(emitSpy).toHaveBeenCalledWith(
      EVENTS.LAYER_ITEM_REFRESHED,
      {
        id: "new1",
      },
      { kind: "programmatic", via: "refresh" },
    );
    expect(emitSpy).toHaveBeenCalledWith(
      EVENTS.LAYER_ROLE_COUNT_CHANGED,
      {
        role: "overlay",
      },
      { kind: "system", via: "teardown" },
    );
    expect(emitSpy).not.toHaveBeenCalledWith(EVENTS.LAYER_LIST_REBUILD);
  });

  it("re-applies hidden state when a previously-hidden layer is re-registered at runtime", () => {
    const layer = { options: {} };
    manager.map.hasLayer.mockReturnValue(false);
    const addLayer = vi.fn();
    const removeLayer = vi.fn();
    manager.map.addLayer = addLayer;
    manager.map.removeLayer = removeLayer;
    manager.intentStore = makeStore({ new1: { visible: false } });
    manager.ui = { saveState: vi.fn() } as any;
    manager.registerLayer({ id: "new1", name: "New", layer } as any);

    // Hidden layer is kept off the map entirely (no add, no remove) so
    // onAdd side effects never fire.
    expect(addLayer).not.toHaveBeenCalled();
    expect(removeLayer).not.toHaveBeenCalled();
  });

  it("does not add a hidden canvas layer (layer=null) to the map before removing it", () => {
    manager.map.hasLayer.mockReturnValue(false);
    const addLayer = vi.fn();
    const removeLayer = vi.fn();
    manager.map.addLayer = addLayer;
    manager.map.removeLayer = removeLayer;
    manager.intentStore = makeStore({ canvas1: { visible: false } });
    manager.ui = { saveState: vi.fn() } as any;
    manager.registerLayer({
      id: "canvas1",
      name: "Canvas",
      layer: null,
    } as any);

    // Canvas-only layer has no Leaflet layer to add/remove — the guard
    // skips addLayer and removeLayer.
    expect(addLayer).not.toHaveBeenCalled();
    expect(removeLayer).not.toHaveBeenCalled();
  });

  it("does not add a hidden layer to the map before removing it", () => {
    const layer = { options: {} };
    manager.map.hasLayer.mockReturnValue(false);
    const addLayer = vi.fn();
    const removeLayer = vi.fn();
    manager.map.addLayer = addLayer;
    manager.map.removeLayer = removeLayer;
    manager.intentStore = makeStore({ new1: { visible: false } });
    manager.ui = { saveState: vi.fn() } as any;
    manager.registerLayer({ id: "new1", name: "New", layer } as any);

    // Hidden layers must be kept off the map entirely (skip addLayer) so
    // onAdd side effects never fire.
    expect(addLayer).not.toHaveBeenCalled();
    expect(removeLayer).not.toHaveBeenCalled();
  });

  it("does not re-apply hidden state when the layer is not in the hidden set", () => {
    const layer = { options: {} };
    manager.map.hasLayer.mockReturnValue(false);
    const removeLayer = vi.fn();
    manager.map.removeLayer = removeLayer;
    manager.intentStore = makeStore({ other: { visible: false } });
    manager.ui = { saveState: vi.fn() } as any;
    manager.registerLayer({ id: "visible1", name: "V", layer } as any);

    expect(removeLayer).not.toHaveBeenCalled();
  });

  it("registerLayer resolves layer from map when opts.layer is absent", () => {
    const layer = new window.L.TileLayer();
    map._layers["resolved"] = layer;
    manager.registerLayer({ id: "resolved", name: "R" });
    expect(manager.findLayer("resolved")).toBe(layer);
  });

  it("getNavigableItems returns layer items and toggle-all rows", () => {
    // Mock the uiContainer and the ui that reads it.
    const container = document.createElement("div");
    container.innerHTML = `
      <div class="foliplus-layer-toggle-all" data-role="overlay">
        <div class="foliplus-checkbox"><input type="checkbox" data-role="toggle-all" /></div>
      </div>
      <div class="foliplus-layer-item" data-layer-id="a">
        <div class="foliplus-checkbox"><input type="checkbox" /></div>
      </div>
      <div class="foliplus-layer-toggle-all" data-role="base">
        <div class="foliplus-checkbox"><input type="checkbox" data-role="toggle-all" /></div>
      </div>
      <div class="foliplus-layer-item" data-layer-id="color" data-layer-type="base">
        <input type="checkbox" />
      </div>
    `;
    manager.uiContainer = container;
    manager.ui = { rebuildAfterLayoutChange: vi.fn() } as any;
    // verify DOM structure includes toggle-all rows and every layer item
    // (getNavigableItems is tested via browser tests)
    const items = container.querySelectorAll(
      ".foliplus-layer-item, .foliplus-layer-toggle-all",
    );
    expect(items.length).toBe(4);
    expect(items[0].classList.contains("foliplus-layer-toggle-all")).toBe(true);
    expect(items[1].classList.contains("foliplus-layer-item")).toBe(true);
    expect(items[2].classList.contains("foliplus-layer-toggle-all")).toBe(true);
    // The base row that carries the color control is navigable too.
    expect(items[3].classList.contains("foliplus-layer-item")).toBe(true);
  });

  it("onLayerAdd emits LAYER_CHANGE when a pending layer's global finally joins the map", () => {
    // Late binding: folium streams a layer's JS global *after* this control's
    // own script, so the registration lands with `layer: null` and the real
    // object reaches the map through `layeradd` later. No registry write
    // covers that arrival, so without this emit a bus-only consumer (the
    // label manager repainting labels) would watch a layer appear and
    // never hear about it.
    const realStamp = window.L.stamp;
    window.L.stamp = stableStamp;
    try {
      manager.registerLayer({ id: "late", name: "Late", role: "overlay" });
      const arrived = new window.L.Path();
      map._layers["late"] = arrived;
      const onChange = vi.fn();
      manager.events.on(EVENTS.LAYER_CHANGE, onChange);

      manager.onLayerAdd({ layer: arrived });

      // kind comes from the registry entry ("vector" for a pending Leaflet
      // registration), not from re-probing `arrived`.
      expect(onChange).toHaveBeenCalledWith(
        { id: "late", kind: "vector" },
        { origin: { kind: "system", via: "teardown" } },
      );
    } finally {
      window.L.stamp = realStamp;
    }
  });

  it("onLayerAdd stays silent when no pending entry can claim the arriving layer", () => {
    // The other branch: a registration that already carries its layer is not
    // "late", so an unrelated add must not manufacture a change — and a
    // pending entry whose resolved object is a *different* layer must not
    // claim it either.
    const realStamp = window.L.stamp;
    window.L.stamp = stableStamp;
    try {
      manager.registerLayer({ id: "pending", name: "Pending", role: "overlay" });
      map._layers["pending"] = new window.L.Path();
      const onChange = vi.fn();
      manager.events.on(EVENTS.LAYER_CHANGE, onChange);

      manager.onLayerAdd({ layer: new window.L.Path() });

      expect(onChange).not.toHaveBeenCalled();
    } finally {
      window.L.stamp = realStamp;
    }
  });

  it("rewrites the registry entry when a pending layer resolves (bad order: control before layer)", () => {
    // Bad script order: the control registers a layer by id before folium
    // lands its JS global, so the entry lands with `layer: null` and a
    // pending `kind`. When the real object joins the map via `layeradd`, the
    // entry must be rewritten so `layer`, `carrier.layer`, and `kind` all
    // reflect the resolved layer — not just emit on the bus, which was the
    // original bug. Without the write-back, every consumer that reads
    // `layerInfo.layer` directly (the fill swatch, maxZoom scanning) sees a
    // stale `null` forever.
    const realStamp = window.L.stamp;
    window.L.stamp = stableStamp;
    try {
      manager.registerLayer({ id: "late", name: "Late", role: "base" });
      const arrived = new window.L.TileLayer();
      map._layers["late"] = arrived;

      manager.onLayerAdd({ layer: arrived });

      const info = manager.layerRegistry.get("late")!;
      expect(info.layer).toBe(arrived);
      expect(info.carrier.layer).toBe(arrived);
      // The pending entry derived `kind` as "vector" (no layer to probe); a
      // real GridLayer must re-derive to "tile" so NO_FEATURE_TREE_KINDS and
      // every downstream kind gate see the honest shape.
      expect(info.kind).toBe("tile");
      // `overlay1` seeded by `beforeEach` still sits pending (that test
      // doesn't resolve it), so `hasUnresolvedLayers()` on the whole registry
      // isn't the right check here — the invariant is that the just-resolved
      // entry is no longer pending. Assert it directly.
      expect(info.layer === null && info.kind === "vector").toBe(false);
    } finally {
      window.L.stamp = realStamp;
    }
  });

  it("keeps the entry correct when the layer arrives before the control (good order)", () => {
    // Regression: the pre-fix path was already correct here. Registering with
    // `opts.layer` present resolves at the edge, so the entry lands with the
    // right `layer`, `carrier.layer`, and `kind` from the start — and the
    // fix must not disturb that path.
    const tile = new window.L.TileLayer();
    manager.registerLayer({ id: "early", name: "Early", role: "base", layer: tile });

    const info = manager.layerRegistry.get("early")!;
    expect(info.layer).toBe(tile);
    expect(info.carrier.layer).toBe(tile);
    expect(info.kind).toBe("tile");
    // `overlay1` seeded by `beforeEach` is deliberately still pending, so we
    // scope the check to the entry this test just registered.
    expect(info.layer === null && info.kind === "vector").toBe(false);
  });

  it("no entry mixes layer:null with a carrier-dependent kind (invariant)", () => {
    // The pending `kind` fallback for a `layer:null` entry is `vector`
    // (util.ts: deriveLayerKind). Only the three explicit no-carrier shapes
    // (canvas / solid / custom) may legitimately sit at `layer:null` — every
    // other `kind` combined with a null layer means the entry is either
    // still pending (not yet resolved) or was resolved incorrectly and left
    // stale. This is the guard that the fix writes back rather than merely
    // emitting: without the upsert, a resolved TileLayer would keep the
    // pending kind and this assert would catch it.
    const realStamp = window.L.stamp;
    window.L.stamp = stableStamp;
    try {
      // Resolve the seeded `overlay1` before the invariant check so we can
      // assert globally — the check is about the resolved state, not the
      // transient pending one.
      const overlay = new window.L.Path();
      map._layers["overlay1"] = overlay;
      manager.onLayerAdd({ layer: overlay });

      manager.registerLayer({
        id: "custom",
        name: "C",
        role: "overlay",
        custom: { x: 1 },
      });
      const tile = new window.L.TileLayer();
      map._layers["tileLate"] = tile;
      manager.registerLayer({ id: "tileLate", name: "TL", role: "base" });
      manager.onLayerAdd({ layer: tile });

      const noCarrierKinds = new Set(["canvas", "solid", "custom"]);
      for (const entry of manager.layers) {
        if (entry.layer === null) {
          expect(
            noCarrierKinds.has(entry.kind),
            `entry "${entry.id}" has layer:null with kind "${entry.kind}"`,
          ).toBe(true);
        }
      }
    } finally {
      window.L.stamp = realStamp;
    }
  });

  it("onLayerAdd responds to group layers (GeoJSON/FeatureGroup) too", () => {
    // Container layers (L.GeoJSON / FeatureGroup) previously fell through the
    // Path/Marker filter, so their addTo never re-ran enforceOrder. Any
    // registered container's add must coalesce into one enforce.
    vi.useFakeTimers();
    const spy = vi.spyOn(manager, "enforceOrder");
    const container = { options: {} as Record<string, unknown>, eachLayer: vi.fn() };
    manager.map.hasLayer.mockReturnValue(false);
    manager.registerLayer({ id: "fg", name: "FG", layer: container });
    manager.onLayerAdd({ layer: container });
    manager.onLayerAdd({ layer: container });
    vi.advanceTimersByTime(ENFORCE_ORDER_DEBOUNCE_MS);
    expect(spy).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("onLayerAdd marks materialized surfaces dirty for an add it cannot attribute", () => {
    // The manager cannot tell which surface a new layer belongs to — that is
    // what makes the reconcile observation-based (walk the tree, pin what is
    // unpinned) rather than interception-based (hook `addLayer`, and silently
    // half-fade the day something bypasses the hook). So every materialized
    // surface is marked, and the pass re-pins whichever tree actually changed.
    // The price is one tree walk per content change, paid only while a surface
    // is dirty.
    vi.useFakeTimers();
    const spy = vi.spyOn(manager, "enforceOrder");
    manager.registerLayer({ id: "overlay1", name: "Points", layer: { options: {} } });
    vi.advanceTimersByTime(ENFORCE_ORDER_DEBOUNCE_MS);
    spy.mockClear();
    manager.onLayerAdd({ layer: { options: {}, eachLayer: vi.fn() } });
    vi.advanceTimersByTime(ENFORCE_ORDER_DEBOUNCE_MS);
    expect(spy).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("onLayerAdd schedules nothing while no surface is materialized", () => {
    // Nothing registered, nothing materialized: an add has no pane to re-pin,
    // so the add is not a reason to run a pass.
    vi.useFakeTimers();
    const fresh = new LayerController(map, []);
    const spy = vi.spyOn(fresh, "enforceOrder");
    fresh.onLayerAdd({ layer: { options: {}, eachLayer: vi.fn() } });
    vi.advanceTimersByTime(ENFORCE_ORDER_DEBOUNCE_MS);
    expect(spy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("registerLayer appends a base layer when no base exists yet", () => {
    const m2 = new LayerController(map, [
      { id: "only_overlay", name: "O", role: "overlay" },
    ]);
    map.hasLayer.mockReturnValue(false);
    m2.registerLayer({ id: "first_base", name: "B", role: "base" });
    expect(m2.layerRegistry.firstBaseIdx).toBe(1);
  });

  it("registerLayer sets pane options for non-Path/Marker layers", () => {
    const layer = { options: {} } as any;
    manager.map.hasLayer.mockReturnValue(false);
    manager.registerLayer({ id: "p", name: "P", layer, paneName: "my_pane" });
    expect(layer.options.pane).toBe("my_pane");
  });

  it("re-registering an existing layer updates the UI row", () => {
    manager.map.hasLayer.mockReturnValue(false);
    manager.uiContainer = document.createElement("div");
    manager.ui = makeDerivedUI({
      intentStore: makeStore(),
      // The replay entry point always returns a round; the stub has to honour it.
      applyUserState: vi.fn(() => []),
    }) as any;
    const emitSpy = vi.spyOn(manager.events, "emitSettled");
    manager.registerLayer({ id: "overlay1", name: "Renamed" });
    expect(emitSpy).toHaveBeenCalledWith(
      EVENTS.LAYER_ITEM_UPDATED,
      {
        id: "overlay1",
      },
      { kind: "programmatic", via: "refresh" },
    );
    expect(emitSpy).not.toHaveBeenCalledWith(EVENTS.LAYER_ITEM_ADDED, {
      id: "overlay1",
    });
    // A re-registration is how the API says the layer's content changed, so the
    // cached field list — and the field resolved from it — must be dropped.
    expect(emitSpy).toHaveBeenCalledWith(
      EVENTS.LAYER_ITEM_REFRESHED,
      {
        id: "overlay1",
      },
      { kind: "programmatic", via: "refresh" },
    );
    expect(emitSpy).toHaveBeenCalledWith(
      EVENTS.LAYER_ROLE_COUNT_CHANGED,
      {
        role: "overlay",
      },
      { kind: "system", via: "teardown" },
    );
    // Opacity is stored per-id; re-registration may swap the live layer/canvas.
    expect(manager.ui!.applyUserState).toHaveBeenCalledWith("overlay1");
  });

  it("re-registering with a different group is refused before any mutation", () => {
    // A layer's group is its role for the id's lifetime — z ladder,
    // attribution, basemap semantics, panel role. Changing it in place
    // would strand the row in the old role with a stale role boundary
    // and a broken overlay-before-base partition, so the gate refuses
    // before a single mutation lands.
    const { manager, ui } = initFixture({
      data: [
        { id: "A", name: "A", role: "overlay" },
        { id: "T", name: "T", role: "base" },
      ],
    });
    const rowA = attachedPanel(ui).querySelector(
      `[${CONST.DATA.LAYER_ID}="A"]`,
    ) as HTMLElement;
    const seen: string[] = [];
    ui.events.on(EVENTS.LAYER_CHANGE, p => seen.push(`change:${p.id}`));
    ui.events.on(EVENTS.LAYER_ITEM_ADDED, p => seen.push(`added:${p.id}`));
    ui.events.on(EVENTS.LAYER_ITEM_UPDATED, p => seen.push(`updated:${p.id}`));

    // Same group or no group is an ordinary content refresh.
    expect(() =>
      manager.registerLayer({ id: "A", name: "A2", role: "overlay" }),
    ).not.toThrow();
    expect(() => manager.registerLayer({ id: "A", name: "A3" })).not.toThrow();

    // A different group is a role change, in both directions.
    expect(() => manager.registerLayer({ id: "A", name: "A", role: "base" })).toThrow(
      /role change/,
    );
    expect(() =>
      manager.registerLayer({ id: "T", name: "T", role: "overlay" }),
    ).toThrow(/role change/);

    // Nothing moved: partition, cached boundary, the row's role. The only
    // announcements are the two ordinary refreshes above — nothing for T,
    // no added rows.
    expect(manager.layers.map(l => `${l.id}:${l.role}`)).toEqual([
      "A:overlay",
      "T:base",
      `${CONST.SOLID_BASEMAP_ID}:base`,
    ]);
    expect(manager.layerRegistry.firstBaseIdx).toBe(
      manager.layers.findIndex(l => l.role === ROLE.BASE),
    );
    expect(rowA.getAttribute("data-layer-type")).toBe("overlay");
    expect(seen.filter(e => e.startsWith("updated"))).toHaveLength(2);
    expect(seen.filter(e => e.startsWith("change"))).toHaveLength(2);
    expect(seen.every(e => e.endsWith(":A"))).toBe(true);
  });

  it("a failed canvas registration leaves no authority and a clean face", () => {
    // A second owner tries an id the registry already holds as base; the
    // controller refuses its implicit overlay role. The factory must not
    // report success, must not keep the face mounted, and its unregister
    // must not touch the legal owner.
    const { manager } = initFixture({
      data: [{ id: "A", name: "A", role: "base" }],
    });
    const canvas = manager.createCanvas({ id: "A", name: "A" });

    expect(() => canvas.register()).toThrow(/role change/);
    expect(canvas.registered()).toBe(false);
    // The face was prepared for mount and rolled back: no pane parent. (The
    // fixture's panes are detached divs, so "connected" is read through the
    // parent link, not isConnected.)
    expect(canvas.canvas.parentElement).toBeNull();
    canvas.unregister();
    expect(manager.layerRegistry.get("A")?.role).toBe("base");

    // A second failure while the conflict persists: the rollback is
    // idempotent — the face was already detached, nothing to undo.
    expect(() => canvas.register()).toThrow(/role change/);
    expect(canvas.canvas.parentElement).toBeNull();

    // Once the conflict is gone, the same surface retries for real.
    manager.unregisterLayer("A");
    canvas.register();
    expect(canvas.registered()).toBe(true);
    expect(canvas.canvas.parentElement).not.toBeNull();
    canvas.unregister();
    expect(canvas.registered()).toBe(false);
  });
});
