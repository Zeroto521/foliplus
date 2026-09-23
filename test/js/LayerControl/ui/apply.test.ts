import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LayerManager } from "#foliplus/LayerControl/manager.js";
import { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import { installLeafletGlobals } from "./fixture.js";

// ────────────────────────────────────────────────────────────────────────
// §40.5 gate ①: the executor must not let a derived dimension authorise
// display. Only user intent (or the author's declared default) determines
// map membership; effective = intent && policy, so a derived dimension
// (focus, zoom range) can only pull a layer off the map — never push one
// onto it.
//
// This is the quickstart regression from §38: folium ships a `show=False`
// layer off the map, no user override has been recorded, and the first
// projection must leave it alone. Before the fix the executor saw
// effective moving false→true and wrote visible=true, adding the layer to
// the map while the checkbox stayed unchecked.
// ────────────────────────────────────────────────────────────────────────

/** A bare map mock with `hasLayer → false` — the folium `show=False` boot
 *  state: the layer exists in the registry but was never added to the map. */
const makeOffMapFixture = () => {
  installLeafletGlobals();
  const container = document.createElement("div");
  document.body.appendChild(container);

  const layer = { options: {} } as L.Layer;
  const map = {
    on: vi.fn(),
    off: vi.fn(),
    eachLayer: vi.fn(),
    invalidateSize: vi.fn(),
    hasLayer: vi.fn(() => false),
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
    fitBounds: vi.fn(),
    flyTo: vi.fn(),
    getZoom: vi.fn(() => 5),
    getMaxZoom: vi.fn(() => 18),
    getMinZoom: vi.fn(() => 0),
    getBounds: vi.fn(() => ({
      pad: vi.fn(),
      getSouthWest: () => ({ lat: 20, lng: 90 }),
      getNorthWest: () => ({ lat: 50, lng: 90 }),
      getNorthEast: () => ({ lat: 50, lng: 120 }),
      getSouthEast: () => ({ lat: 20, lng: 120 }),
    })),
    getContainer: vi.fn(() => container),
    getPane: vi.fn(() => {
      const p = document.createElement("div");
      p.style.zIndex = "0";
      return p;
    }),
    createPane: vi.fn(() => {
      const p = document.createElement("div");
      p.style.zIndex = "0";
      return p;
    }),
    _container: container,
    _layers: {},
    attributionControl: { _attributions: {}, _update: vi.fn() },
    foliplus: { showHint: vi.fn(), hideHint: vi.fn() },
  } as any;

  return { container, layer, map };
};

describe("executor: §40.5 invariant", () => {
  beforeEach(() => {
    installLeafletGlobals();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("gate 1 — the first projection must not add an author show=False layer", () => {
    const { container, layer, map } = makeOffMapFixture();

    const manager = new LayerManager(map, [
      { id: "authorHidden", name: "Hidden", isBase: false, layer },
    ]);
    manager.ui = new LayerUI(manager);

    vi.useFakeTimers();
    manager.attachUI(container);
    vi.advanceTimersByTime(350);
    vi.useRealTimers();

    // The invariant: author's declared default (off map) is respected.
    // The first projection may add a layer only if the user (or the
    // author's snapshot) authorised it — neither did here.
    expect(map.addLayer).not.toHaveBeenCalled();
  });
});
