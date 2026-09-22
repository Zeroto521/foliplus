import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LayerInfo } from "#core/layer/index.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import { initLayerItem, renderInitialList } from "#foliplus/LayerControl/ui/list.js";
import { displayName } from "#foliplus/LayerControl/ui/rowView.js";
import { initFixture } from "./fixture.js";

const makeUi = () =>
  ({
    renamedNames: {},
    m: { layerRegistry: { get: () => undefined } },
    T: (k: string) => k,
  }) as unknown as LayerUI;

describe("ui/list displayName", () => {
  it("resolves a registered/renamed id through the registry name", () => {
    const ui = {
      renamedNames: { a: "Renamed" },
      m: { layerRegistry: { get: () => ({ name: "Original" }) } },
      T: (k: string) => k,
    } as unknown as LayerUI;
    expect(displayName(ui, "a")).toBe("Renamed");
    expect(displayName(ui, "b")).toBe("Original");
  });

  it("labels the color basemap and falls back to empty for unknown ids", () => {
    const ui = makeUi();
    expect(displayName(ui, CONST.COLOR.MAP_ID)).toContain("color_map_label");
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
    // index-based row lookup reads a neighbour's checkbox.
    const { manager, ui } = initFixture({
      seed: { order: ["B", "A", "H"] },
      data: [
        { id: "A", name: "A", isBase: false },
        { id: "B", name: "B", isBase: false },
      ],
    });

    manager.registerLayer({ id: "H", name: "H", isBase: false });

    const registryIds = manager.layers.map(l => l.id);
    const rowIds = Array.from(
      ui.uiContainer.querySelectorAll<HTMLElement>(
        `${CONST.SEL.LAYER_ITEM}:not(${CONST.SEL.COLOR_ITEM})`,
      ),
    ).map(el => el.dataset.layerId ?? "");

    expect(rowIds).toEqual(registryIds);
    expect(registryIds).toEqual(["B", "A", "H"]);
  });

  it("initLayerItem updates the row it owns, not the one at that DOM index", () => {
    // Register three overlays so the registry order is A-B-C.
    const { manager, ui } = initFixture({
      data: [
        {
          id: "A",
          name: "A",
          isBase: false,
          layer: { options: {}, eachLayer: vi.fn() },
        },
        {
          id: "B",
          name: "B",
          isBase: false,
          layer: { options: {}, eachLayer: vi.fn() },
        },
        {
          id: "C",
          name: "C",
          isBase: false,
          layer: { options: {}, eachLayer: vi.fn() },
        },
      ],
    });

    // Scramble the DOM to C-A-B.
    const rows = Array.from(
      ui.uiContainer.querySelectorAll<HTMLElement>(
        `${CONST.SEL.LAYER_ITEM}[data-layer-type="${CONST.GROUP.OVERLAY}"]`,
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
      data: [{ id: "A", name: "A", isBase: false }],
    });

    // A late callback for a torn-down layer must not write into a row: the id
    // is not registered, so there is nothing to initialize.
    expect(initLayerItem(ui, { id: "ghost" } as LayerInfo)).toBe(false);
  });

  it("brings its own header when the first row of an empty group arrives", () => {
    // Only a base is seeded, so the overlay group owns no row yet. The late
    // overlay must create the group header itself and land above the base
    // group — appending it at the panel's end would leave the header stranded
    // below the layers it controls.
    const { manager, ui } = initFixture({
      data: [{ id: "B1", name: "B1", isBase: true }],
    });
    expect(
      ui.uiContainer.querySelectorAll(
        `${CONST.SEL.LAYER_ITEM}[data-layer-type="${CONST.GROUP.OVERLAY}"]`,
      ).length,
    ).toBe(0);

    manager.registerLayer({ id: "O1", name: "O1", isBase: false });

    const children = Array.from(ui.uiContainer.children);
    const overlayHeader = children.findIndex(
      el => el.getAttribute("data-group") === CONST.GROUP.OVERLAY,
    );
    const firstBaseRow = children.findIndex(
      el => el.getAttribute("data-layer-type") === CONST.GROUP.BASE,
    );
    // Appended to the panel's end instead, the header would land after every
    // base row and control layers it is not adjacent to.
    expect(overlayHeader).toBeGreaterThanOrEqual(0);
    expect(overlayHeader).toBeLessThan(firstBaseRow);
    expect(
      Array.from(
        ui.uiContainer.querySelectorAll<HTMLElement>(
          `${CONST.SEL.LAYER_ITEM}[data-layer-type="${CONST.GROUP.OVERLAY}"]`,
        ),
      ).map(el => el.getAttribute(CONST.DATA.LAYER_ID)),
    ).toEqual(["O1"]);
  });

  it("appends the header when the new group is the last one on the panel", () => {
    // An empty panel has no base row to anchor before, so the first overlay
    // lands at the end of the list, after the color row.
    const { manager, ui } = initFixture({ data: [] });

    manager.registerLayer({ id: "O1", name: "O1", isBase: false });

    const ids = Array.from(
      ui.uiContainer.querySelectorAll<HTMLElement>(CONST.SEL.LAYER_ITEM),
    ).map(el => el.getAttribute(CONST.DATA.LAYER_ID));
    expect(ids).toContain("O1");
    expect(ids.indexOf("O1")).toBeGreaterThan(0);
  });

  it("renders the color row folded when the base group is folded", () => {
    const { ui } = initFixture({
      data: [{ id: "B1", name: "B1", isBase: true }],
    });
    ui.foldedGroups.add(CONST.GROUP.BASE);

    renderInitialList(ui);

    const color = ui.uiContainer.querySelector<HTMLElement>(CONST.SEL.COLOR_ITEM);
    expect(color).not.toBeNull();
    expect(color!.classList.contains(CONST.CLASSES.GROUP_FOLDED)).toBe(true);
  });
});
