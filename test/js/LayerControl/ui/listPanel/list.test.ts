import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS } from "#core/event/index.js";
import { GROUP, type LayerInfo } from "#core/layer/index.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import { type LayerController } from "#foliplus/LayerControl/controller.js";
import { LayerIntentStore } from "#foliplus/LayerControl/domain/index.js";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import {
  applyVisibility,
  displayName,
  getNavigableItems,
  initLayerItem,
  initTypesAndVisibility,
  insertLayerItem,
  rebuildList,
  reconcileCursorByIdentity,
  renderInitialList,
  syncRowOrder,
  updateLayerItemLabel,
} from "#foliplus/LayerControl/ui/listPanel/index.js";
import { TileLayer, attachedPanel, initFixture } from "../fixture.js";

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
      attachedPanel(ui).querySelectorAll<HTMLElement>(CONST.SEL.LAYER_ITEM),
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
      attachedPanel(ui).querySelectorAll<HTMLElement>(
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
    const row = attachedPanel(ui).querySelector<HTMLElement>(
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

  it("paints nothing once the panel is gone", () => {
    // A teardown that nulls the container without clearing the registry — the
    // mid-notify destroy, though any subset of the panel removal works — must
    // no-op for every paint helper instead of dereferencing a dead panel. This
    // is the shape of the R5-1 crash, now typed and guarded.
    const { manager, ui } = initFixture({
      data: [{ id: "A", name: "A", group: "overlay" }],
    });
    const layer = manager.layerRegistry.get("A")!;
    ui.c.uiContainer = null;

    expect(() => renderInitialList(ui)).not.toThrow();
    expect(() => rebuildList(ui)).not.toThrow();
    expect(insertLayerItem(ui, layer)).toBeUndefined();
    expect(initLayerItem(ui, layer)).toBe(false);
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
      attachedPanel(ui).querySelectorAll(
        `${CONST.SEL.LAYER_ITEM}[data-layer-type="${GROUP.OVERLAY}"]`,
      ).length,
    ).toBe(0);

    manager.registerLayer({ id: "O1", name: "O1", group: "overlay" });

    const children = Array.from(attachedPanel(ui).children);
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
        attachedPanel(ui).querySelectorAll<HTMLElement>(
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
      attachedPanel(ui).querySelectorAll<HTMLElement>(CONST.SEL.LAYER_ITEM),
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
    const rowsBefore = attachedPanel(ui).querySelectorAll(CONST.SEL.LAYER_ITEM);

    expect(() => insertLayerItem(ui, { id: "ghost" } as LayerInfo)).not.toThrow();
    expect(attachedPanel(ui).querySelectorAll(CONST.SEL.LAYER_ITEM)).toHaveLength(
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

    const children = Array.from(attachedPanel(ui).children);
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
    const baseRow = attachedPanel(ui).querySelector<HTMLElement>(
      `[${CONST.DATA.LAYER_ID}="B1"]`,
    );
    expect(baseRow).not.toBeNull();
    expect(baseRow!.classList.contains(CONST.CLASSES.GROUP_FOLDED)).toBe(true);
  });

  it("updateLayerItemLabel bails when the row is no longer on the panel", () => {
    // registerLayer's count change can land after the row was removed (a layer
    // deleted mid-sweep). The refresh must not raise and must not rebuild a row.
    const { ui } = initFixture({
      data: [{ id: "A", name: "A", group: "overlay" }],
    });
    attachedPanel(ui)
      .querySelector<HTMLElement>(`[${CONST.DATA.LAYER_ID}="A"]`)!
      .remove();

    expect(() => updateLayerItemLabel(ui, { id: "A" } as LayerInfo)).not.toThrow();
    expect(attachedPanel(ui).querySelector(`[${CONST.DATA.LAYER_ID}="A"]`)).toBeNull();
  });

  it("renders the color row folded when the base group is folded", () => {
    const { ui } = initFixture({
      data: [{ id: "B1", name: "B1", group: "base" }],
    });
    ui.listPanel.foldedGroups.add(GROUP.BASE);

    renderInitialList(ui);

    const color = attachedPanel(ui).querySelector<HTMLElement>(
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
      attachedPanel(ui).querySelectorAll<HTMLElement>(
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
    // color basemap (race, surface unavailable), the zoom-range / hidden
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

/** Layer rows for n overlays + m base maps. */
const benchData = (overlays: number, bases: number) => [
  ...Array.from({ length: overlays }, (_, i) => ({
    id: `overlay_${i}`,
    name: `Overlay ${i}`,
    group: "overlay" as const,
  })),
  ...Array.from({ length: bases }, (_, i) => ({
    id: `base_${i}`,
    name: `Base ${i}`,
    group: "base" as const,
  })),
];

const rowOf = (ui: LayerUI, id: string): HTMLElement =>
  attachedPanel(ui).querySelector(`[${CONST.DATA.LAYER_ID}="${id}"]`) as HTMLElement;

/** Child sequence signature: layer rows by id, anchors by group. */
const childKeys = (ui: LayerUI) =>
  Array.from(attachedPanel(ui).children).map(
    el =>
      el.getAttribute(CONST.DATA.LAYER_ID) ?? `group:${el.getAttribute("data-group")}`,
  );

/** The panel sequence renderInitialList would emit for this registry: each
 *  group's anchor before its first row, rows in registry order. */
const registryKeys = (manager: LayerController): string[] => {
  const keys: string[] = [];
  let seenOverlay = false;
  let seenBase = false;
  for (const layerInfo of manager.layers) {
    if (layerInfo.group !== GROUP.BASE && !seenOverlay) {
      seenOverlay = true;
      keys.push(`group:${GROUP.OVERLAY}`);
    }
    if (layerInfo.group === GROUP.BASE && !seenBase) {
      seenBase = true;
      keys.push(`group:${GROUP.BASE}`);
    }
    keys.push(layerInfo.id);
  }
  return keys;
};

// Suite-level timeout: every case here builds a panel fixture, and jsdom
// attach sweeps stretch past the default 5s when the whole suite's workers
// compete for the machine.
describe("ui/list syncRowOrder — incremental reorder", { timeout: 30_000 }, () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("moves exactly one DOM node for a single-step reorder", () => {
    const { manager, ui } = initFixture({ data: benchData(8, 2) });
    const container = attachedPanel(ui);
    const insertBefore = vi.spyOn(container, "insertBefore");
    const childrenBefore = new Set(Array.from(container.children));

    expect(manager.moveLayerUp("overlay_4")).toBe(true);

    // One row relocated, everything else untouched: no node was created or
    // destroyed (rebuild would replace the whole child set).
    expect(insertBefore).toHaveBeenCalledTimes(1);
    expect(new Set(Array.from(container.children))).toEqual(childrenBefore);
    // overlay_4 swapped with its predecessor overlay_3 only.
    expect(childKeys(ui).slice(3, 6)).toEqual(["overlay_2", "overlay_4", "overlay_3"]);
    expect(childKeys(ui)).toEqual(registryKeys(manager));
  });

  it("relocates rows without rebuilding or re-projecting them", () => {
    const { manager, ui } = initFixture({ data: benchData(4, 2) });
    const row = attachedPanel(ui).querySelector(
      `[${CONST.DATA.LAYER_ID}="overlay_2"]`,
    ) as HTMLElement;
    const countCol = row.querySelector(CONST.SEL.COUNT_COL) as HTMLElement;
    countCol.textContent = "stale";
    const applyUserState = vi.spyOn(ui, "applyUserState");

    expect(manager.moveLayerUp("overlay_2")).toBe(true);

    // The same element survives with its content: no renderInitialList pass,
    // no projection sweep, no count repaint.
    expect(
      attachedPanel(ui).querySelector(`[${CONST.DATA.LAYER_ID}="overlay_2"]`),
    ).toBe(row);
    expect((row.querySelector(CONST.SEL.COUNT_COL) as HTMLElement).textContent).toBe(
      "stale",
    );
    expect(applyUserState).not.toHaveBeenCalled();
  });

  it("writes nothing when the panel already matches the registry", () => {
    const { ui } = initFixture({ data: benchData(5, 2) });
    const insertBefore = vi.spyOn(attachedPanel(ui), "insertBefore");

    // The signal is the only entry that runs the reconcile directly; an
    // in-order panel must cost zero DOM writes, twice over.
    ui.events.emit(EVENTS.LAYER_LIST_REBUILD);
    ui.events.emit(EVENTS.LAYER_LIST_REBUILD);

    expect(insertBefore).not.toHaveBeenCalled();
  });

  it("keeps group boundaries: a blocked move writes nothing and stays quiet", () => {
    const { manager, ui } = initFixture({ data: benchData(3, 2) });
    const insertBefore = vi.spyOn(attachedPanel(ui), "insertBefore");
    const rebuilds: number[] = [];
    ui.events.on(EVENTS.LAYER_LIST_REBUILD, () => rebuilds.push(1));
    const before = childKeys(ui);

    // Bottom overlay cannot sink into the base section; top overlay cannot
    // rise past the panel head; unknown ids are refused outright.
    expect(manager.moveLayerDown("overlay_2")).toBe(false);
    expect(manager.moveLayerUp("overlay_0")).toBe(false);
    expect(manager.moveLayerUp("nope")).toBe(false);

    expect(insertBefore).not.toHaveBeenCalled();
    expect(rebuilds).toHaveLength(0);
    expect(childKeys(ui)).toEqual(before);
  });

  it("keeps the keyboard cursor on the row that moved", () => {
    const { manager, ui } = initFixture({ data: benchData(4, 2) });
    const row = attachedPanel(ui).querySelector(
      `[${CONST.DATA.LAYER_ID}="overlay_2"]`,
    ) as HTMLElement;
    // Establish the cursor the way the panel does: DOM focus on the row and
    // the active index pointing at it.
    row.focus();
    ui.listPanel.activeIdx = getNavigableItems(ui).indexOf(row);
    row.classList.add(CONST.CLASSES.FOCUSED);

    expect(manager.moveLayerUp("overlay_2")).toBe(true);

    const items = getNavigableItems(ui);
    expect(items[ui.listPanel.activeIdx ?? -1]).toBe(row);
    expect(row.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);
    expect(document.activeElement).toBe(row);
    // The roving tab stop travels with the cursor row.
    expect(items.findIndex(el => el.tabIndex === 0)).toBe(items.indexOf(row));
  });

  it("never takes the panel out of its data-ready state", async () => {
    const { manager, ui } = initFixture({ data: benchData(4, 2) });
    const container = attachedPanel(ui);
    expect(container.getAttribute("data-ready")).toBe("true");

    const records: MutationRecord[] = [];
    const observer = new MutationObserver(rs => records.push(...rs));
    observer.observe(container, {
      attributes: true,
      attributeFilter: ["data-ready"],
      attributeOldValue: true,
    });

    manager.moveLayerUp("overlay_3");
    manager.moveLayerDown("overlay_3");
    await new Promise(resolve => setTimeout(resolve, 0));

    // The flag never came down mid-move: no record shows a removal. The
    // current value is read off the target — MutationRecord.newValue is not
    // in the DOM typings the test typecheck builds against.
    expect(
      records.filter(
        record =>
          record.attributeName === "data-ready" &&
          record.oldValue === "true" &&
          (record.target as Element).getAttribute("data-ready") === null,
      ),
    ).toEqual([]);
    expect(container.getAttribute("data-ready")).toBe("true");
    observer.disconnect();
  });

  it("survives a subscriber that unregisters the moved layer mid-CHANGE", () => {
    const { manager, ui } = initFixture({ data: benchData(3, 2) });
    const changes: string[] = [];
    ui.events.on(EVENTS.LAYER_CHANGE, payload => {
      changes.push(payload.id);
      if (payload.id === "overlay_1") manager.unregisterLayer("overlay_1");
    });

    expect(() => manager.moveLayerUp("overlay_1")).not.toThrow();

    // The move's own CHANGE, then the retirement's — and no third: the
    // second unregister inside that fan-out found nothing left to retire.
    expect(changes).toEqual(["overlay_1", "overlay_1"]);
    expect(
      attachedPanel(ui).querySelector(`[${CONST.DATA.LAYER_ID}="overlay_1"]`),
    ).toBeNull();
    expect(childKeys(ui)).toEqual(registryKeys(manager));
  });

  it("survives a subscriber that re-registers the same id mid-CHANGE", () => {
    const { manager, ui } = initFixture({ data: benchData(3, 2) });
    let replaced = false;
    ui.events.on(EVENTS.LAYER_CHANGE, payload => {
      if (payload.id === "overlay_1" && !replaced) {
        replaced = true;
        manager.unregisterLayer("overlay_1");
        manager.registerLayer({ id: "overlay_1", name: "Overlay 1 again" });
      }
    });

    expect(() => manager.moveLayerUp("overlay_1")).not.toThrow();

    // The replacement owns the row: present, and the panel order still
    // tracks the registry.
    expect(
      attachedPanel(ui).querySelector(`[${CONST.DATA.LAYER_ID}="overlay_1"]`),
    ).not.toBeNull();
    expect(childKeys(ui)).toEqual(registryKeys(manager));
  });

  it("an up-then-down round restores the order and the persisted record", () => {
    const { manager, ui } = initFixture({ data: benchData(5, 2) });
    const orderBefore = childKeys(ui);
    const registryBefore = manager.layers.map(l => l.id);

    manager.moveLayerUp("overlay_3");
    manager.moveLayerDown("overlay_3");

    expect(childKeys(ui)).toEqual(orderBefore);
    // saveOrder snapshots on every user reorder — flush the debounced write
    // and compare the record with the live registry.
    (
      manager as unknown as { persistence: { flushAll(): void } }
    ).persistence.flushAll();
    const record = JSON.parse(
      window.localStorage.getItem(CONST.STORAGE.KEY) ?? "{}",
    ) as { order?: string[] };
    expect(record.order).toEqual(manager.layers.map(l => l.id));
    expect(record.order).toEqual(registryBefore);
  });

  it("brings an overlay to the panel head without rebuilding the rows", () => {
    const { manager, ui } = initFixture({ data: benchData(4, 2) });
    const childrenBefore = new Set(Array.from(attachedPanel(ui).children));
    const insertBefore = vi.spyOn(attachedPanel(ui), "insertBefore");

    manager.bringLayerToFront("overlay_3");

    // Longest overlay move: the row lands right under the overlay anchor.
    expect(insertBefore).toHaveBeenCalledTimes(1);
    expect(new Set(Array.from(attachedPanel(ui).children))).toEqual(childrenBefore);
    expect(childKeys(ui)[0]).toBe("group:overlay");
    expect(childKeys(ui)[1]).toBe("overlay_3");
  });

  it("agrees with the full rebuild on every shuffled order it produced", () => {
    // Deterministic shuffle: 40 seeded single-step moves over 10 overlays +
    // 2 bases, checking DOM == registry after each move, then one full
    // rebuild (the fold path's) must land on exactly the same arrangement.
    // The 41 assertion rounds stretch past the default 5s test budget when
    // the whole suite's workers compete for the machine.
    const { manager, ui } = initFixture({ data: benchData(10, 2) });
    let seed = 0x2f6e2b1;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x1_0000_0000;
    };
    const overlays = () => manager.layers.filter(l => l.group === GROUP.OVERLAY);
    const bases = () => manager.layers.filter(l => l.group === GROUP.BASE);

    for (let step = 0; step < 40; step++) {
      const pool = rand() < 0.7 ? overlays() : bases();
      const pick = pool[Math.floor(rand() * pool.length)];
      expect(childKeys(ui)).toEqual(registryKeys(manager));
      if (rand() < 0.5) manager.moveLayerUp(pick.id);
      else manager.moveLayerDown(pick.id);
    }
    expect(childKeys(ui)).toEqual(registryKeys(manager));

    const incremental = childKeys(ui);
    const elements = new Set(Array.from(attachedPanel(ui).children));
    rebuildList(ui);
    expect(childKeys(ui)).toEqual(incremental);
    // The rebuild re-created the rows; the incremental pass had preserved
    // them — both hold the same arrangement either way.
    expect(new Set(Array.from(attachedPanel(ui).children))).not.toEqual(elements);
  }, 60_000);

  it("tolerates a missing panel, anchor-less rows, stray children and no layers", () => {
    // The reconcile's defensive branches, driven through a bare mock: a
    // torn-down panel no-ops; rows order without their toggle-all anchors; a
    // child that is neither a row nor an anchor is ignored — including a
    // toggle-all shell that lost its data-group; a registry entry without a
    // row is skipped, and the write-path drift that produced any of this is
    // named, not silently absorbed; an empty registry writes nothing.
    // A torn-down control must no-op.
    const bare = {
      uiContainer: null,
      c: { layers: [] },
      listPanel: { activeIdx: null },
    } as unknown as LayerUI;
    expect(() => syncRowOrder(bare)).not.toThrow();

    const rowEl = (id: string) => {
      const el = document.createElement("div");
      el.setAttribute(CONST.DATA.LAYER_ID, id);
      return el;
    };
    // Deliberately detached: the cursor reconcile must skip a disconnected
    // root.
    const container = document.createElement("div");
    const stray = document.createElement("div");
    // Carries the toggle-all class but no data-group: an anchor that cannot
    // be keyed, ignored like any other non-row child.
    const headlessAnchor = document.createElement("div");
    headlessAnchor.classList.add(CONST.CLASSES.TOGGLE_ALL);
    // Two anchors for a group no layer references — the duplicate is named,
    // and neither becomes a target.
    const anchorEl = () => {
      const el = document.createElement("div");
      el.classList.add(CONST.CLASSES.TOGGLE_ALL);
      el.setAttribute("data-group", "phantom");
      return el;
    };
    container.append(
      stray,
      rowEl("B"),
      rowEl("A"),
      rowEl("base1"),
      headlessAnchor,
      // A second row for the same id and a row the registry never heard of:
      // both are write-path bugs the diagnostics exist to name.
      rowEl("A"),
      rowEl("orphan"),
      anchorEl(),
      anchorEl(),
    );
    const registry = { layers: [] as LayerInfo[] };
    const warn = vi.fn();
    const ui = {
      uiContainer: container,
      c: registry,
      listPanel: { activeIdx: null },
      log: { warn },
    } as unknown as LayerUI;
    registry.layers = [
      { id: "A", group: GROUP.OVERLAY } as LayerInfo,
      { id: "B", group: GROUP.OVERLAY } as LayerInfo,
      { id: "ghost", group: GROUP.OVERLAY } as LayerInfo,
      { id: "base1", group: GROUP.BASE } as LayerInfo,
    ];

    syncRowOrder(ui);

    // Rows follow the registry with no anchors to carry (both anchor-missing
    // diagnostics fire); the ghost has no row to place; the duplicate, the
    // orphan and the stray children land behind the targets.
    expect(
      Array.from(container.children).map(
        el => el.getAttribute(CONST.DATA.LAYER_ID) ?? "stray",
      ),
    ).toEqual(["A", "B", "base1", "stray", "A", "stray", "orphan", "stray", "stray"]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('duplicate row for layer "A"'),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('duplicate toggle-all anchor for "phantom"'),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "panel/registry drift — rows without entries [orphan], " +
          "entries without rows [ghost]",
      ),
    );

    registry.layers = [];
    expect(() => syncRowOrder(ui)).not.toThrow();
    expect(container.children.length).toBe(9);
  });

  it("reorderLayer refuses unknown ids, self-drops and cross-group pairs", () => {
    // The drag commit entry's own guards — the drop path pre-checks for the
    // hint, but the entry must hold on its own.
    const { manager, ui } = initFixture({ data: benchData(3, 2) });
    const changes: string[] = [];
    ui.events.on(EVENTS.LAYER_CHANGE, payload => changes.push(payload.id));
    const before = manager.layers.map(l => l.id);

    expect(manager.reorderLayer("nope", "overlay_0")).toBe(false);
    expect(manager.reorderLayer("overlay_0", "nope")).toBe(false);
    expect(manager.reorderLayer("overlay_1", "overlay_1")).toBe(false);
    expect(manager.reorderLayer("overlay_0", "base_0")).toBe(false);

    expect(changes).toEqual([]);
    expect(manager.layers.map(l => l.id)).toEqual(before);
  });

  it("reconcileCursorByIdentity clears the cursor when its row left the panel", () => {
    const { ui } = initFixture({ data: benchData(3, 1) });
    const row = rowOf(ui, "overlay_1");
    row.focus();
    ui.listPanel.activeIdx = getNavigableItems(ui).indexOf(row);

    // A row removed mid-flow (a subscriber retired it inside the signal)
    // leaves the cursor nothing to re-home onto.
    row.remove();
    reconcileCursorByIdentity(ui, "overlay_1");

    expect(ui.listPanel.activeIdx).toBeNull();
  });

  it("every reorder entrance publishes the same event pair and settles the same way", () => {
    // The four entrances — moveLayerUp, moveLayerDown, bringLayerToFront and
    // the drag drop's reorderLayer — all commit through one funnel, so an
    // outside observer cannot tell which one moved the layer: one
    // panel-order signal after the registry move, one CHANGE for the moved
    // layer, DOM and persisted order agreeing with the registry.
    const cases = [
      {
        via: "moveLayerUp",
        act: (m: LayerController) => m.moveLayerUp("L2"),
        moved: "L2",
        order: ["L0", "L2", "L1", "L3"],
      },
      {
        via: "moveLayerDown",
        act: (m: LayerController) => m.moveLayerDown("L0"),
        moved: "L0",
        order: ["L1", "L0", "L2", "L3"],
      },
      {
        via: "bringLayerToFront",
        act: (m: LayerController) => m.bringLayerToFront("L2"),
        moved: "L2",
        order: ["L2", "L0", "L1", "L3"],
      },
      {
        via: "reorderLayer (drag)",
        act: (m: LayerController) => m.reorderLayer("L3", "L0"),
        moved: "L3",
        order: ["L3", "L0", "L1", "L2"],
      },
    ];

    for (const { via, act, moved, order } of cases) {
      window.localStorage.clear();
      const { manager, ui } = initFixture({
        data: Array.from({ length: 4 }, (_, i) => ({
          id: `L${i}`,
          name: `L${i}`,
          group: "overlay" as const,
        })),
      });
      const rebuilds: string[] = [];
      const changes: string[] = [];
      // The color basemap joins the registry at attach as a base-group tail;
      // the arrangement under test is the overlay block.
      const overlayOrder = (m: LayerController) =>
        m.layers.filter(l => l.group === GROUP.OVERLAY).map(l => l.id);
      ui.events.on(EVENTS.LAYER_LIST_REBUILD, () =>
        rebuilds.push(overlayOrder(manager).join(",")),
      );
      ui.events.on(EVENTS.LAYER_CHANGE, payload => changes.push(payload.id));

      act(manager);

      // The signal fires once, already carrying the finished arrangement;
      // the move announces through the same CHANGE every entrance uses.
      expect(rebuilds, via).toEqual([order.join(",")]);
      expect(changes, via).toEqual([moved]);
      expect(overlayOrder(manager), via).toEqual(order);
      const domOrder = Array.from(
        attachedPanel(ui).querySelectorAll(
          `${CONST.SEL.LAYER_ITEM}[data-layer-type="${GROUP.OVERLAY}"]`,
        ),
      ).map(el => el.getAttribute(CONST.DATA.LAYER_ID));
      expect(domOrder, via).toEqual(order);
      (
        manager as unknown as { persistence: { flushAll(): void } }
      ).persistence.flushAll();
      const record = JSON.parse(
        window.localStorage.getItem(CONST.STORAGE.KEY) ?? "{}",
      ) as { order?: string[] };
      // The persisted snapshot is the full registry, color basemap included.
      expect(record.order, via).toEqual(manager.layers.map(l => l.id));
    }
  });

  it("a reorder never steals focus from the control the user is operating", () => {
    // The incremental move carries DOM focus with the node; the reconcile
    // re-homes only cursor metadata. A focused ⋮ button (or checkbox, or
    // panel control) keeps focus whether its own row moved or another one
    // did — the rebuild path had to re-aim focus because it destroyed the
    // nodes; this path must not.
    const { manager, ui } = initFixture({ data: benchData(4, 2) });
    const moreBtn = rowOf(ui, "overlay_2").querySelector(
      `.${CONST.CLASSES.MORE_BTN}`,
    ) as HTMLElement;
    moreBtn.focus();

    manager.moveLayerUp("overlay_3");
    expect(document.activeElement).toBe(moreBtn);

    // Moving the focus host's own row travels with it.
    manager.moveLayerUp("overlay_2");
    expect(document.activeElement).toBe(moreBtn);
    expect(moreBtn.closest(CONST.SEL.LAYER_ITEM)).toBe(rowOf(ui, "overlay_2"));

    // One roving tab stop survives the moves.
    const stops = getNavigableItems(ui).filter(el => el.tabIndex === 0);
    expect(stops.length).toBe(1);
  });

  it("keeps checkbox focus while its hosting row moves", () => {
    const { manager, ui } = initFixture({ data: benchData(4, 2) });
    const box = rowOf(ui, "overlay_1").querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    box.focus();

    manager.moveLayerUp("overlay_1");

    expect(document.activeElement).toBe(box);
    expect(box.closest(CONST.SEL.LAYER_ITEM)).toBe(rowOf(ui, "overlay_1"));
  });
});
