// Repro: LayerAPI path — register → setVisible(false) → unregister → register
import { describe, expect, it, vi } from "vitest";
import { LayerManager } from "#foliplus/LayerControl/manager.js";
import { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import { installLeafletGlobals } from "./LayerControl/ui/fixture.js";

describe("reentry visible repro", () => {
  it("LayerAPI setVisible(false) survives unregister → re-register", () => {
    installLeafletGlobals();
    window.localStorage.clear();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const map: any = {
      on: vi.fn(),
      off: vi.fn(),
      eachLayer: vi.fn(),
      invalidateSize: vi.fn(),
      hasLayer: vi.fn(() => true),
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
      fitBounds: vi.fn(),
      flyTo: vi.fn(),
      getZoom: vi.fn(() => 5),
      getMaxZoom: vi.fn(() => 18),
      getMinZoom: vi.fn(() => 0),
      options: { maxZoom: 18 },
      getBounds: vi.fn(() => ({ getSouthWest: () => ({ lat: 20, lng: 90 }), getNorthEast: () => ({ lat: 50, lng: 120 }) })),
      getContainer: vi.fn(() => container),
      getPane: vi.fn(() => document.createElement("div")),
      getPanes: vi.fn(() => ({ mapPane: document.createElement("div") })),
      createPane: vi.fn(() => document.createElement("div")),
      foliplus: { showHint: vi.fn(), hideHint: vi.fn() },
    };
    const manager = new LayerManager(map, []);
    manager.ui = new LayerUI(manager);
    manager.attachUI(container);
    const api: any = manager;

    const fg: any = { options: {} };
    api.registerLayer({ id: "__test_vis__", layer: fg });
    const defaultVisible = api.intentVisible ? api.intentVisible("__test_vis__") : null;
    api.setVisible("__test_vis__", false);
    api.unregisterLayer("__test_vis__");
    api.registerLayer({ id: "__test_vis__", layer: { options: {} } });
    const newVisible = api.intentVisible ? api.intentVisible("__test_vis__") : null;

    console.log(JSON.stringify({ defaultVisible, newVisible, visibleMap: api.ui.visibleMap, prov: api.ui.intentProvenance, authorVisible: [...api.ui.authorVisible.entries()] }));
    expect(defaultVisible).toBe(true);
    expect(newVisible).toBe(false);
    api.unregisterLayer("__test_vis__");
  });
});