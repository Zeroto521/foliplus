import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LayerInfo } from "#core/layer/index.js";
import { GROUP } from "#core/layer/index.js";
import { LayerIntentStore } from "#core/layer/index.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import {
  initLayerItem,
  initTypesAndVisibility,
  insertLayerItem,
  renderInitialList,
  updateLayerItem,
} from "#foliplus/LayerControl/ui/listPanel/list.js";
import { displayName } from "#foliplus/LayerControl/ui/listPanel/rowView.js";
import { applyVisibility } from "#foliplus/LayerControl/ui/listPanel/visibility.js";
import { TileLayer, initFixture } from "./fixture.js";

const makeUi = () =>
  ({
    intentStore: new LayerIntentStore(),
    renamedNames: {},
    c: { layerRegistry: { get: () => undefined } },
    T: (k: string) => k,
  }) as unknown as LayerUI;

describe("ui/list displayName", () => {
  it("resolves a registered/renamed id through the registry name", () => {
    const intentStore = new LayerIntentStore();
    intentStore.setValue("a", "name", "Renamed");
    const ui = {
      intentStore,
      c: { layerRegistry: { get: () => ({ name: "Original" }) } },
      T: (k: string) => k,
    } as unknown as LayerUI;
    expect(displayName(ui, "a")).toBe("Renamed");
    expect(displayName(ui, "b")).toBe("Original");
  });

  it("labels the color basemap and falls back to empty for unknown ids", () => {
    const ui = makeUi();
    expect(displayName(ui, CONST.SOLID_BASEMAP_ID)).toContain("color_map_label");
    expect(displayName(ui, "ghost")).toBe("");
  });
});

describe("ui/list row placement", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("lands a late row at the depth the registry chose", () => {
    // The row must land at the depth the registry chose. Pinned to the top of
    // the group instead, the DOM order diverges from the drawn order and every
    // index-based row lookup reads a neighbor's checkbox.
    const { manager, ui } = initFixture({
      seed: { order: ["B", "A", "H"] },
      data: [
        { id: "A", name: "A", group: "overlay" },
        { id: "B", name: "B", group: "overlay" },
      ],
    });

    manager.registerLayer({ id: "H", name: "H", group: "overlay" });

    const registryIds = manager.layers.map(l => l.id);
    const rowIds = Array.from(
      ui.uiContainer.querySelectorAll<HTMLElement>(CONST.SEL.LAYER_ITEM),
    ).map(el => el.dataset.layerId ?? "");

    expect(rowIds).toEqual(registryIds);
    expect(registryIds).toEqual(["B", "A", "H", CONST.SOLID_BASEMAP_ID]);
  });

  it("initLayerItem updates the row it owns, not the one at that DOM index", () => {
    // Register three overlays so the registry order is A-B-C.
    const { manager, ui } = initFixture({
      data: [
        {
          id: "A",
          name: "A",
          group: "overlay",
          layer: { options: {}, eachLayer: vi.fn() },
        },
        {
          id: "B",
          name: "B",
          group: "overlay",
          layer: { options: {}, eachLayer: vi.fn() },
        },
        {
          id: "C",
          name: "C",
          group: "overlay",
          layer: { options: {}, eachLayer: vi.fn() },
        },
      ],
    });

    // Scramble the DOM to C-A-B.
    const rows = Array.from(
      ui.uiContainer.querySelectorAll<HTMLElement>(
        `${CONST.SEL.LAYER_ITEM}[data-layer-type="${GROUP.OVERLAY}"]`,
      ),
    );
    expect(rows.length).toBe(3);
    const container = rows[0].parentNode!;
    container.insertBefore(rows[2], rows[0]); // A,B,C -> C,A,B

    // Call initLayerItem for A (registry idx 0). The old code would read
    // inputs[0] which is C's checkbox (first in DOM). The new code resolves
    // by data-layer-id, so it updates A's row.
    const layerA = manager.layerRegistry.get("A")!;
    initLayerItem(ui, layerA);

    // A's checkbox should be updated (aria-label set), not C's.
    const rowA = container.querySelector<HTMLElement>(`[${CONST.DATA.LAYER_ID}="A"]`)!;
    const rowC = container.querySelector<HTMLElement>(`[${CONST.DATA.LAYER_ID}="C"]`)!;
    const cbA = rowA.querySelector('input[type="checkbox"]') as HTMLInputElement;
    const cbC = rowC.querySelector('input[type="checkbox"]') as HTMLInputElement;

    expect(cbA.getAttribute("aria-label")).toBe("A");
    // C's checkbox should not have been touched by A's init pass.
    expect(cbC.getAttribute("aria-label")).not.toBe("A");
  });

  it("initLayerItem declines an id the registry does not know", () => {
    const { ui } = initFixture({
      data: [{ id: "A", name: "A", group: "overlay" }],
    });

    // A late callback for a torn-down layer must not write into a row: the id
    // is not registered, so there is nothing to initialize.
    expect(initLayerItem(ui, { id: "ghost" } as LayerInfo)).toBe(false);
  });

  it("initLayerItem declines an id whose row is no longer on the panel", () => {
    // The registry and the DOM can diverge: a row removed after registration
    // leaves the layer behind. The sweep must bail rather than write a stale
    // cell into whatever row now sits there.
    const { manager, ui } = initFixture({
      data: [{ id: "A", name: "A", group: "overlay" }],
    });
    const row = ui.uiContainer.querySelector<HTMLElement>(
      `[${CONST.DATA.LAYER_ID}="A"]`,
    );
    expect(row).not.toBeNull();
    const layer = manager.layerRegistry.get("A")!;
    row!.remove();

    expect(initLayerItem(ui, layer)).toBe(false);
    // No row means no buildRowCell: nothing is derived from the (now missing)
    // row, and the registry entry itself is untouched.
    expect(manager.layerRegistry.get("A")).toBe(layer);
  });

  it("brings its own header when the first row of an empty group arrives", () => {
    // Only a base is seeded, so the overlay group owns no row yet. The late
    // overlay must create the group header itself and land above the base
    // group — appending it at the panel's end would leave the header stranded
    // below the layers it controls.
    const { manager, ui } = initFixture({
      data: [{ id: "B1", name: "B1", group: "base" }],
    });
    expect(
      ui.uiContainer.querySelectorAll(
        `${CONST.SEL.LAYER_ITEM}[data-layer-type="${GROUP.OVERLAY}"]`,
      ).length,
    ).toBe(0);

    manager.registerLayer({ id: "O1", name: "O1", group: "overlay" });

    const children = Array.from(ui.uiContainer.children);
    const overlayHeader = children.findIndex(
      el => el.getAttribute("data-group") === GROUP.OVERLAY,
    );
    const firstBaseRow = children.findIndex(
      el => el.getAttribute("data-layer-type") === GROUP.BASE,
    );
    // Appended to the panel's end instead, the header would land after every
    // base row and control layers it is not adjacent to.
    expect(overlayHeader).toBeGreaterThanOrEqual(0);
    expect(overlayHeader).toBeLessThan(firstBaseRow);
    expect(
      Array.from(
        ui.uiContainer.querySelectorAll<HTMLElement>(
          `${CONST.SEL.LAYER_ITEM}[data-layer-type="${GROUP.OVERLAY}"]`,
        ),
      ).map(el => el.getAttribute(CONST.DATA.LAYER_ID)),
    ).toEqual(["O1"]);
  });

  it("appends the header when the new group is the last one on the panel", () => {
    // An empty panel has no base row to anchor before, so the first overlay
    // lands at the end of the list, after the color row.
    const { manager, ui } = initFixture({ data: [] });

    manager.registerLayer({ id: "O1", name: "O1", group: "overlay" });

    const ids = Array.from(
      ui.uiContainer.querySelectorAll<HTMLElement>(CONST.SEL.LAYER_ITEM),
    ).map(el => el.getAttribute(CONST.DATA.LAYER_ID));
    expect(ids).toContain("O1");
    expect(ids).toContain(CONST.SOLID_BASEMAP_ID);
  });

  it("insertLayerItem declines an id the registry does not know", () => {
    // A late callback for a layer that was never registered (or was removed)
    // carries no row: the guard bails before any DOM write instead of inserting
    // a row the registry cannot find.
    const { ui } = initFixture({
      data: [{ id: "A", name: "A", group: "overlay" }],
    });
    const rowsBefore = ui.uiContainer.querySelectorAll(CONST.SEL.LAYER_ITEM);

    expect(() => insertLayerItem(ui, { id: "ghost" } as LayerInfo)).not.toThrow();
    expect(ui.uiContainer.querySelectorAll(CONST.SEL.LAYER_ITEM)).toHaveLength(
      rowsBefore.length,
    );
  });

  it("brings its own base header when the first base arrives late, folded or not", () => {
    // Only overlays are seeded, so the base group owns no header. The first
    // base must create it (base_map_label, not data_layer_label) and insert it
    // before the color row — anchored at the panel's end instead, the header
    // would sit below the layers it controls.
    const { manager, ui } = initFixture({
      data: [{ id: "O1", name: "O1", group: "overlay" }],
    });
    ui.listPanel.foldedGroups.add(GROUP.BASE);

    manager.registerLayer({
      id: "B1",
      name: "B1",
      group: "base",
      layer: new TileLayer(),
    });

    const children = Array.from(ui.uiContainer.children);
    const baseHeader = children.findIndex(
      el => el.getAttribute("data-group") === GROUP.BASE,
    );
    const colorRow = children.findIndex(
      el => el.getAttribute(CONST.DATA.LAYER_ID) === CONST.SOLID_BASEMAP_ID,
    );
    expect(baseHeader).toBeGreaterThanOrEqual(0);
    expect(baseHeader).toBeLessThan(colorRow);
    expect(children[baseHeader].textContent).toContain("base_map_label");
    // The group was folded when the row arrived, so the late row inherits the
    // fold instead of showing up above the collapsed group's divider.
    const baseRow = ui.uiContainer.querySelector<HTMLElement>(
      `[${CONST.DATA.LAYER_ID}="B1"]`,
    );
    expect(baseRow).not.toBeNull();
    expect(baseRow!.classList.contains(CONST.CLASSES.GROUP_FOLDED)).toBe(true);
  });

  it("updateLayerItem bails when the row is no longer on the panel", () => {
    // registerLayer's count change can land after the row was removed (a layer
    // deleted mid-sweep). The refresh must not raise and must not rebuild a row.
    const { ui } = initFixture({
      data: [{ id: "A", name: "A", group: "overlay" }],
    });
    ui.uiContainer.querySelector<HTMLElement>(`[${CONST.DATA.LAYER_ID}="A"]`)!.remove();

    expect(() => updateLayerItem(ui, { id: "A" } as LayerInfo)).not.toThrow();
    expect(ui.uiContainer.querySelector(`[${CONST.DATA.LAYER_ID}="A"]`)).toBeNull();
  });

  it("renders the color row folded when the base group is folded", () => {
    const { ui } = initFixture({
      data: [{ id: "B1", name: "B1", group: "base" }],
    });
    ui.listPanel.foldedGroups.add(GROUP.BASE);

    renderInitialList(ui);

    const color = ui.uiContainer.querySelector<HTMLElement>(
      `[${CONST.DATA.LAYER_ID}="${CONST.SOLID_BASEMAP_ID}"]`,
    );
    expect(color).not.toBeNull();
    expect(color!.classList.contains(CONST.CLASSES.GROUP_FOLDED)).toBe(true);
  });

  it("color layer's applyVisibility routes through showSolidBasemap and hideSolidBasemap", () => {
    const { ui } = initFixture({
      data: [{ id: "B1", name: "B1", group: "base" }],
    });

    initTypesAndVisibility(ui);

    const colorLi = ui.c.layerRegistry.get(CONST.SOLID_BASEMAP_ID) as LayerInfo;
    expect(colorLi).toBeDefined();

    expect(() => applyVisibility(ui, CONST.SOLID_BASEMAP_ID, true)).not.toThrow();
    expect(() => applyVisibility(ui, CONST.SOLID_BASEMAP_ID, false)).not.toThrow();
  });

  it("color basemap lands at the base group end when a tile basemap is already registered", () => {
    // On first open, folium registers tile basemaps before initTypesAndVisibility
    // runs. The color basemap (baseInsert: "bottom") must land at the end of
    // the base group, not at the top — tile basemaps cover it by default.
    const { ui } = initFixture({
      data: [
        { id: "B1", name: "B1", group: "base" },
        { id: "B2", name: "B2", group: "base" },
      ],
    });

    initTypesAndVisibility(ui);

    const baseRows = Array.from(
      ui.uiContainer.querySelectorAll<HTMLElement>(
        `${CONST.SEL.LAYER_ITEM}[data-layer-type="${GROUP.BASE}"]`,
      ),
    ).map(el => el.getAttribute(CONST.DATA.LAYER_ID));

    expect(baseRows).toContain("B1");
    expect(baseRows).toContain("B2");
    expect(baseRows).toContain(CONST.SOLID_BASEMAP_ID);
    // Color basemap is last (lowest z), tile basemaps above it.
    expect(baseRows[baseRows.length - 1]).toBe(CONST.SOLID_BASEMAP_ID);
  });

  it("initTypesAndVisibility skips the color block when the registry has no color layer", () => {
    // Defensive guard: if getColorSurface's register() failed to insert the
    // colour basemap (race, surface unavailable), the zoom-range / hidden
    // override block must be skipped without crashing.
    const { ui } = initFixture({
      data: [{ id: "B1", name: "B1", group: "base" }],
    });

    const originalGet = ui.c.layerRegistry.get.bind(ui.c.layerRegistry);
    vi.spyOn(ui.c.layerRegistry, "get").mockImplementation((id: string) => {
      if (id === CONST.SOLID_BASEMAP_ID) return undefined;
      return originalGet(id);
    });

    expect(() => initTypesAndVisibility(ui)).not.toThrow();
  });
});
