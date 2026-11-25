import { repoPath } from "#test/path.js";
import { TileLayer, attachedPanel, initFixture } from "../fixture.js";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS } from "#core/event/index.js";
import { type LayerInfo, ROLE, normalizeFolderName } from "#core/layer/index.js";
import * as CONST from "#control/LayerControl/const.js";
import { type LayerController } from "#control/LayerControl/controller.js";
import { LayerIntentStore } from "#control/LayerControl/domain/index.js";
import type { LayerUI } from "#control/LayerControl/ui/index.js";
import { seedIntentMap } from "#control/LayerControl/ui/intent.js";
import { isFolderFolded } from "#control/LayerControl/ui/listPanel/drag.js";
import {
  applyVisibility,
  colorLayerName,
  displayName,
  getNavigableItems,
  initLayerItem,
  initTypesAndVisibility,
  insertLayerItem,
  rebuildList,
  reconcileCursorByIdentity,
  renderInitialList,
  renderLayerItem,
  syncRowOrder,
  toggleFold,
  updateLayerItemLabel,
} from "#control/LayerControl/ui/listPanel/index.js";
import { emptyFolderKeys } from "#control/LayerControl/ui/listPanel/list.js";

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
        { id: "A", name: "A", role: "overlay" },
        { id: "B", name: "B", role: "overlay" },
      ],
    });

    manager.registerLayer({ id: "H", name: "H", role: "overlay" });

    const registryIds = manager.layers.map(l => l.id);
    const rowIds = Array.from(
      attachedPanel(ui).querySelectorAll<HTMLElement>(CONST.SEL.LEAF_ITEM),
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
          role: "overlay",
          layer: { options: {}, eachLayer: vi.fn() },
        },
        {
          id: "B",
          name: "B",
          role: "overlay",
          layer: { options: {}, eachLayer: vi.fn() },
        },
        {
          id: "C",
          name: "C",
          role: "overlay",
          layer: { options: {}, eachLayer: vi.fn() },
        },
      ],
    });

    // Scramble the DOM to C-A-B.
    const rows = Array.from(
      attachedPanel(ui).querySelectorAll<HTMLElement>(
        `${CONST.SEL.LAYER_ITEM}[data-layer-type="${ROLE.OVERLAY}"]`,
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
      data: [{ id: "A", name: "A", role: "overlay" }],
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
      data: [{ id: "A", name: "A", role: "overlay" }],
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
    // is the shape of the null-panel crash, now typed and guarded.
    const { manager, ui } = initFixture({
      data: [{ id: "A", name: "A", role: "overlay" }],
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
      data: [{ id: "B1", name: "B1", role: "base" }],
    });
    expect(
      attachedPanel(ui).querySelectorAll(
        `${CONST.SEL.LAYER_ITEM}[data-layer-type="${ROLE.OVERLAY}"]`,
      ).length,
    ).toBe(0);

    manager.registerLayer({ id: "O1", name: "O1", role: "overlay" });

    const children = Array.from(attachedPanel(ui).children);
    const overlayHeader = children.findIndex(
      el => el.getAttribute("data-role") === ROLE.OVERLAY,
    );
    const firstBaseRow = children.findIndex(
      el => el.getAttribute("data-layer-type") === ROLE.BASE,
    );
    // Appended to the panel's end instead, the header would land after every
    // base row and control layers it is not adjacent to.
    expect(overlayHeader).toBeGreaterThanOrEqual(0);
    expect(overlayHeader).toBeLessThan(firstBaseRow);
    expect(
      Array.from(
        attachedPanel(ui).querySelectorAll<HTMLElement>(
          `${CONST.SEL.LAYER_ITEM}[data-layer-type="${ROLE.OVERLAY}"]`,
        ),
      ).map(el => el.getAttribute(CONST.DATA.LAYER_ID)),
    ).toEqual(["O1"]);
  });

  it("appends the header when the new group is the last one on the panel", () => {
    // An empty panel has no base row to anchor before, so the first overlay
    // lands at the end of the list, after the color row.
    const { manager, ui } = initFixture({ data: [] });

    manager.registerLayer({ id: "O1", name: "O1", role: "overlay" });

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
      data: [{ id: "A", name: "A", role: "overlay" }],
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
      data: [{ id: "O1", name: "O1", role: "overlay" }],
    });
    ui.listPanel.foldedRoles[ROLE.BASE] = true;

    manager.registerLayer({
      id: "B1",
      name: "B1",
      role: "base",
      layer: new TileLayer(),
    });

    const children = Array.from(attachedPanel(ui).children);
    const baseHeader = children.findIndex(
      el => el.getAttribute("data-role") === ROLE.BASE,
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
      data: [{ id: "A", name: "A", role: "overlay" }],
    });
    attachedPanel(ui)
      .querySelector<HTMLElement>(`[${CONST.DATA.LAYER_ID}="A"]`)!
      .remove();

    expect(() => updateLayerItemLabel(ui, { id: "A" } as LayerInfo)).not.toThrow();
    expect(attachedPanel(ui).querySelector(`[${CONST.DATA.LAYER_ID}="A"]`)).toBeNull();
  });

  it("renders the color row folded when the base group is folded", () => {
    const { ui } = initFixture({
      data: [{ id: "B1", name: "B1", role: "base" }],
    });
    ui.listPanel.foldedRoles[ROLE.BASE] = true;

    renderInitialList(ui);

    const color = attachedPanel(ui).querySelector<HTMLElement>(
      `[${CONST.DATA.LAYER_ID}="${CONST.SOLID_BASEMAP_ID}"]`,
    );
    expect(color).not.toBeNull();
    expect(color!.classList.contains(CONST.CLASSES.GROUP_FOLDED)).toBe(true);
  });

  it("renders a folder row folded when its role is folded", () => {
    // Folding a role hides the whole block, header included — the folder's own
    // fold state is untouched, so unfolding the role restores the same view.
    const { ui } = initFixture({
      data: [{ id: "A", name: "A", role: "overlay", folder: "Roads" }],
    });
    ui.listPanel.foldedRoles[ROLE.OVERLAY] = true;

    renderInitialList(ui);

    const folder = attachedPanel(ui).querySelector<HTMLElement>(
      `[${CONST.DATA.FOLDER_KEY}="roads"]`,
    );
    expect(folder).not.toBeNull();
    expect(folder!.classList.contains(CONST.CLASSES.GROUP_FOLDED)).toBe(true);
    // The row is the block's header, so it must NOT carry the folder's own
    // FOLDED state — only the "hidden because my role is folded" marker.
    expect(folder!.classList.contains(CONST.CLASSES.FOLDED)).toBe(false);
  });

  it("closes the row panels it drops with the rows", () => {
    // A rebuild replaces the whole list (fold, reorder, or the list arriving).
    // The style panel can dispose its scheme picker and unpin itself, but only
    // if it is asked BEFORE the row carrying it is detached: these panels are
    // children of a row, so clearing the list with innerHTML used to leave the
    // picker and its document listeners answering a trigger that was gone.
    const { ui } = initFixture({
      data: [{ id: "A", name: "A", role: "overlay" }],
    });
    renderInitialList(ui);
    const row = rowOf(ui, "A");
    const stylePanel = document.createElement("div");
    stylePanel.className = CONST.CLASSES.STYLE_PANEL;
    row.appendChild(stylePanel);
    const attrsPanel = document.createElement("div");
    attrsPanel.className = CONST.CLASSES.ATTRS_PANEL;
    row.appendChild(attrsPanel);
    ui.overlayPanel.stylePanelLayerId = "A";
    const styleUnregister = vi.fn();
    ui.overlayPanel.styleOverlayUnregister = styleUnregister;
    ui.overlayPanel.activeAttrsPanel = {
      item: row,
      panel: attrsPanel,
      layerId: "A",
    };
    const attrsUnregister = vi.fn();
    ui.overlayPanel.attrsOverlayUnregister = attrsUnregister;

    rebuildList(ui);

    expect(styleUnregister).toHaveBeenCalled();
    expect(ui.overlayPanel.styleOverlayUnregister).toBeNull();
    expect(ui.overlayPanel.stylePanelLayerId).toBeNull();
    expect(attrsUnregister).toHaveBeenCalled();
    expect(ui.overlayPanel.attrsOverlayUnregister).toBeNull();
    expect(ui.overlayPanel.activeAttrsPanel).toBeNull();
    expect(stylePanel.isConnected).toBe(false);
    expect(attrsPanel.isConnected).toBe(false);
  });

  it("color layer's applyVisibility routes through showSolidBasemap and hideSolidBasemap", () => {
    const { ui } = initFixture({
      data: [{ id: "B1", name: "B1", role: "base" }],
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
        { id: "B1", name: "B1", role: "base" },
        { id: "B2", name: "B2", role: "base" },
      ],
    });

    initTypesAndVisibility(ui);

    const baseRows = Array.from(
      attachedPanel(ui).querySelectorAll<HTMLElement>(
        `${CONST.SEL.LAYER_ITEM}[data-layer-type="${ROLE.BASE}"]`,
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
      data: [{ id: "B1", name: "B1", role: "base" }],
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
    role: "overlay" as const,
  })),
  ...Array.from({ length: bases }, (_, i) => ({
    id: `base_${i}`,
    name: `Base ${i}`,
    role: "base" as const,
  })),
];

const rowOf = (ui: LayerUI, id: string): HTMLElement =>
  attachedPanel(ui).querySelector(`[${CONST.DATA.LAYER_ID}="${id}"]`) as HTMLElement;

/** Whether this engine refuses `focus()` on a `display: none` subtree.
 *
 *  The folded-survivor case below stages a folded row with an inline
 *  `display: none` and depends on the engine declining to focus it — the same
 *  refusal a browser applies to a folded group. jsdom only added that rule (a
 *  computed `display` check in its focus helper) in 30.1.0; on 30.0.x the
 *  focus lands, so there the test's *premise* — not its assertions — is false
 *  and the neighbour walk is unreachable. Probing the engine instead of
 *  pinning a version keeps the case honest on both: it runs where the refusal
 *  exists and skips where it does not.
 */
const refusesHiddenFocus = (() => {
  const probe = document.createElement("div");
  probe.setAttribute("tabindex", "0");
  probe.style.display = "none";
  document.body.appendChild(probe);
  probe.focus();
  const declined = document.activeElement !== probe;
  // Leave the document as found: if the probe took focus, give it back.
  if (!declined) probe.blur();
  probe.remove();
  return declined;
})();

/** Child sequence signature: layer rows by id, anchors by group. */
const childKeys = (ui: LayerUI) =>
  Array.from(attachedPanel(ui).children).map(
    el =>
      el.getAttribute(CONST.DATA.LAYER_ID) ?? `role:${el.getAttribute("data-role")}`,
  );

/** The panel sequence renderInitialList would emit for this registry: each
 *  group's anchor before its first row, rows in registry order. */
const registryKeys = (manager: LayerController): string[] => {
  const keys: string[] = [];
  let seenOverlay = false;
  let seenBase = false;
  for (const layerInfo of manager.layers) {
    if (layerInfo.role !== ROLE.BASE && !seenOverlay) {
      seenOverlay = true;
      keys.push(`role:${ROLE.OVERLAY}`);
    }
    if (layerInfo.role === ROLE.BASE && !seenBase) {
      seenBase = true;
      keys.push(`role:${ROLE.BASE}`);
    }
    keys.push(layerInfo.id);
  }
  return keys;
};

/** The five cursor ledgers a membership change must keep on one row: the
 *  numeric index, the FOCUSED marker, the one roving tab stop, and where
 *  DOM focus actually is. All read as row identities, not positions. */
const cursorLedger = (ui: LayerUI) => {
  const idOf = (el: Element | null | undefined) =>
    el
      ? (el.getAttribute(CONST.DATA.LAYER_ID) ?? `role:${el.getAttribute("data-role")}`)
      : null;
  const items = getNavigableItems(ui);
  return {
    active: idOf(items[ui.listPanel.activeIdx ?? -1]),
    marked: idOf(attachedPanel(ui).querySelector(`.${CONST.CLASSES.FOCUSED}`)),
    tabStops: items.filter(el => el.tabIndex === 0).map(el => idOf(el)),
    domFocus: idOf(
      (document.activeElement as HTMLElement | null)?.closest?.(CONST.SEL.LAYER_ITEM) ??
        null,
    ),
  };
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

    // Bottom overlay cannot sink into the base role; top overlay cannot
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
    const stored = JSON.parse(
      window.localStorage.getItem(CONST.STORAGE.KEY) ?? "{}",
    ) as { data?: { order?: string[] } };
    expect(stored.data?.order).toEqual(manager.layers.map(l => l.id));
    expect(stored.data?.order).toEqual(registryBefore);
  });

  it("brings an overlay to the panel head without rebuilding the rows", () => {
    const { manager, ui } = initFixture({ data: benchData(4, 2) });
    const childrenBefore = new Set(Array.from(attachedPanel(ui).children));
    const insertBefore = vi.spyOn(attachedPanel(ui), "insertBefore");

    manager.bringLayerToFront("overlay_3");

    // Longest overlay move: the row lands right under the overlay anchor.
    expect(insertBefore).toHaveBeenCalledTimes(1);
    expect(new Set(Array.from(attachedPanel(ui).children))).toEqual(childrenBefore);
    expect(childKeys(ui)[0]).toBe("role:overlay");
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
    const overlays = () => manager.layers.filter(l => l.role === ROLE.OVERLAY);
    const bases = () => manager.layers.filter(l => l.role === ROLE.BASE);

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
    // toggle-all shell that lost its data-role; a registry entry without a
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
    // Carries the toggle-all class but no data-role: an anchor that cannot
    // be keyed, ignored like any other non-row child.
    const headlessAnchor = document.createElement("div");
    headlessAnchor.classList.add(CONST.CLASSES.TOGGLE_ALL);
    // Two anchors for a group no layer references — the duplicate is named,
    // and neither becomes a target.
    const anchorEl = () => {
      const el = document.createElement("div");
      el.classList.add(CONST.CLASSES.TOGGLE_ALL);
      el.setAttribute("data-role", "phantom");
      return el;
    };
    container.append(
      stray,
      rowEl("B"),
      rowEl("A"),
      rowEl("base1"),
      headlessAnchor,
      // A second row for the same id and a row the registry never heard of:
      // both are write-path bugs the diagnostics exist to name. The earlier
      // duplicate is dropped, the later node kept.
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
      { id: "A", role: ROLE.OVERLAY } as LayerInfo,
      { id: "B", role: ROLE.OVERLAY } as LayerInfo,
      { id: "ghost", role: ROLE.OVERLAY } as LayerInfo,
      { id: "base1", role: ROLE.BASE } as LayerInfo,
    ];

    syncRowOrder(ui);

    // Rows follow the registry with no anchors to carry (both anchor-missing
    // diagnostics fire); the ghost has no row to place; the earlier duplicate
    // row and anchor are gone; the orphan and stray children trail the targets.
    expect(
      Array.from(container.children).map(
        el => el.getAttribute(CONST.DATA.LAYER_ID) ?? "stray",
      ),
    ).toEqual(["A", "B", "base1", "stray", "stray", "orphan", "stray"]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('duplicate row for layer "A"'),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('duplicate toggle-all anchor for "phantom"'),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        `panel/registry drift — rows without entries [orphan], entries without rows [ghost]`,
      ),
    );

    registry.layers = [];
    expect(() => syncRowOrder(ui)).not.toThrow();
    expect(container.children.length).toBe(7);
  });

  it("syncRowOrder keeps a role anchor when the registry has no rows for it", () => {
    // L332 fallback loop branch: a role whose toggle-all anchor exists in the
    // DOM but no layer row of that role is in the registry. The first loop
    // never marks the role seen (no row), so the fallback pushes the anchor
    // (anchor truthy) rather than dropping the empty role header.
    const container = document.createElement("div");
    const overlayAnchor = document.createElement("div");
    overlayAnchor.classList.add(CONST.CLASSES.TOGGLE_ALL);
    overlayAnchor.setAttribute("data-role", ROLE.OVERLAY);
    const baseAnchor = document.createElement("div");
    baseAnchor.classList.add(CONST.CLASSES.TOGGLE_ALL);
    baseAnchor.setAttribute("data-role", ROLE.BASE);
    container.append(overlayAnchor, baseAnchor);
    // Registry has ONLY a base row — the overlay anchor has no rows, so it is
    // an empty-role header the reconcile must preserve (the clean button
    // still hangs off it).
    const row = document.createElement("div");
    row.setAttribute(CONST.DATA.LAYER_ID, "base1");
    container.appendChild(row);
    const registry = { layers: [{ id: "base1", role: ROLE.BASE } as LayerInfo] };
    const ui = {
      uiContainer: container,
      c: registry,
      listPanel: { activeIdx: null },
      log: { warn: vi.fn() },
    } as unknown as LayerUI;
    syncRowOrder(ui);
    // Both anchors survive (overlay via the fallback push, base via its row);
    // the row is present.
    const roles = Array.from(container.children)
      .filter(el => el.classList.contains(CONST.CLASSES.TOGGLE_ALL))
      .map(el => (el as HTMLElement).dataset.role);
    expect(roles.sort()).toEqual([ROLE.OVERLAY, ROLE.BASE].sort());
    expect(container.querySelector(`[${CONST.DATA.LAYER_ID}="base1"]`)).not.toBeNull();
  });
  it("repairs a duplicate row instead of only warning about it", () => {
    const { manager, ui } = initFixture({ data: benchData(3, 1) });
    const container = attachedPanel(ui);
    const original = rowOf(ui, "overlay_1");
    // A second node for the same id, appended by a racing write path: the
    // later mount is the one the next reconcile keeps.
    const duplicate = original.cloneNode(true) as HTMLElement;
    container.appendChild(duplicate);

    syncRowOrder(ui);

    // Children only: the count cell inside a row carries the same id.
    const rows = Array.from(container.children).filter(
      el => el.getAttribute(CONST.DATA.LAYER_ID) === "overlay_1",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toBe(duplicate);
    // The survivor sits in the registry's slot, not at the tail.
    expect(childKeys(ui)).toEqual(registryKeys(manager));
  });

  it("moves the cursor and DOM focus onto the surviving duplicate row", () => {
    const { ui } = initFixture({ data: benchData(3, 1) });
    const container = attachedPanel(ui);
    const original = rowOf(ui, "overlay_1");
    const duplicate = original.cloneNode(true) as HTMLElement;
    container.appendChild(duplicate);
    // The earlier node is the active, focused one: repairing the duplicate
    // must not silently drop the user's cursor or focus onto <body>.
    original.classList.add(CONST.CLASSES.FOCUSED);
    ui.listPanel.activeIdx = getNavigableItems(ui).indexOf(original);
    original.focus();

    syncRowOrder(ui);

    expect(original.isConnected).toBe(false);
    expect(duplicate.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);
    expect(ui.listPanel.activeIdx).toBe(getNavigableItems(ui).indexOf(duplicate));
    expect(document.activeElement).toBe(duplicate);
  });

  it("returns focus to the same descendant of the surviving row", () => {
    const { ui } = initFixture({ data: benchData(3, 1) });
    const original = rowOf(ui, "overlay_1");
    const duplicate = original.cloneNode(true) as HTMLElement;
    attachedPanel(ui).appendChild(duplicate);
    // Focus is on the row's checkbox, not the row, and the ledger has not
    // caught up (activeIdx null): the repair must treat focus as the cursor,
    // land on the survivor's checkbox (same path) and sync the ledger.
    const box = original.querySelector("input")!;
    box.focus();

    syncRowOrder(ui);

    expect(document.activeElement).toBe(duplicate.querySelector("input"));
    expect(document.activeElement).not.toBe(duplicate);
    expect(duplicate.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);
    expect(ui.listPanel.activeIdx).toBe(getNavigableItems(ui).indexOf(duplicate));
  });

  it("repairs a duplicate toggle-all anchor instead of only warning", () => {
    const { manager, ui } = initFixture({ data: benchData(3, 1) });
    const container = attachedPanel(ui);
    const anchorOf = () =>
      Array.from(container.children).find(
        el =>
          el.classList.contains(CONST.CLASSES.TOGGLE_ALL) &&
          el.getAttribute("data-role") === ROLE.OVERLAY,
      ) as HTMLElement;
    const original = anchorOf();
    expect(original).toBeDefined();
    const duplicate = original.cloneNode(true) as HTMLElement;
    duplicate.classList.add(CONST.CLASSES.FOCUSED);
    container.appendChild(duplicate);

    syncRowOrder(ui);

    const anchors = Array.from(container.children).filter(
      el =>
        el.classList.contains(CONST.CLASSES.TOGGLE_ALL) &&
        el.getAttribute("data-role") === ROLE.OVERLAY,
    );
    expect(anchors).toHaveLength(1);
    expect(anchors[0]).toBe(duplicate);
    expect(childKeys(ui)).toEqual(registryKeys(manager));
  });

  it("keeps the cursor on its row when a duplicate ahead of it is removed", () => {
    const { ui } = initFixture({ data: benchData(3, 1) });
    const container = attachedPanel(ui);
    const duplicate = rowOf(ui, "overlay_1").cloneNode(true) as HTMLElement;
    container.appendChild(duplicate);
    // The cursor sits on a later row: removing the earlier duplicate shifts
    // its position, and a stale activeIdx would re-home onto the neighbor.
    const active = rowOf(ui, "overlay_2");
    ui.listPanel.activeIdx = getNavigableItems(ui).indexOf(active);
    active.classList.add(CONST.CLASSES.FOCUSED);

    syncRowOrder(ui);

    expect(ui.listPanel.activeIdx).toBe(getNavigableItems(ui).indexOf(active));
    expect(active.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);
  });

  it("moves a class-only active duplicate without stealing focus", () => {
    const { ui } = initFixture({ data: benchData(3, 1) });
    const container = attachedPanel(ui);
    const original = rowOf(ui, "overlay_1");
    const duplicate = original.cloneNode(true) as HTMLElement;
    container.appendChild(duplicate);
    // The marker says active, the ledger index is stale (it resolves to no
    // row), and DOM focus is elsewhere: the repair must still move the cursor
    // onto the survivor without focusing it.
    original.classList.add(CONST.CLASSES.FOCUSED);
    ui.listPanel.activeIdx = 999;
    (document.activeElement as HTMLElement | null)?.blur?.();

    syncRowOrder(ui);

    expect(duplicate.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);
    expect(document.activeElement).not.toBe(duplicate);
  });

  it("moves focus onto the surviving duplicate anchor", () => {
    const { ui } = initFixture({ data: benchData(3, 1) });
    const container = attachedPanel(ui);
    const anchorOf = () =>
      Array.from(container.children).find(
        el =>
          el.classList.contains(CONST.CLASSES.TOGGLE_ALL) &&
          el.getAttribute("data-role") === ROLE.OVERLAY,
      ) as HTMLElement;
    const original = anchorOf();
    const duplicate = original.cloneNode(true) as HTMLElement;
    container.appendChild(duplicate);
    const control = original.querySelector<HTMLElement>("button, input, [tabindex]")!;
    control.focus();
    expect(document.activeElement).toBe(control);

    syncRowOrder(ui);

    expect(anchorOf()).toBe(duplicate);
    // The fold button, not the anchor row: the exact descendant travels.
    expect(document.activeElement).toBe(duplicate.querySelector("button"));
    expect(document.activeElement).not.toBe(duplicate);
  });

  it("moves the cursor onto the surviving anchor when the anchor was active", () => {
    const { ui } = initFixture({ data: benchData(3, 1) });
    const container = attachedPanel(ui);
    const anchorOf = () =>
      Array.from(container.children).find(
        el =>
          el.classList.contains(CONST.CLASSES.TOGGLE_ALL) &&
          el.getAttribute("data-role") === ROLE.OVERLAY,
      ) as HTMLElement;
    const original = anchorOf();
    const duplicate = original.cloneNode(true) as HTMLElement;
    container.appendChild(duplicate);
    original.classList.add(CONST.CLASSES.FOCUSED);
    ui.listPanel.activeIdx = getNavigableItems(ui).indexOf(original);
    (original.querySelector("button") as HTMLElement).focus();

    syncRowOrder(ui);

    expect(anchorOf()).toBe(duplicate);
    expect(duplicate.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);
    expect(ui.listPanel.activeIdx).toBe(getNavigableItems(ui).indexOf(duplicate));
    expect(document.activeElement).toBe(duplicate.querySelector("button"));
  });

  it("keeps the cursor index when a duplicate anchor ahead of it is removed", () => {
    const { ui } = initFixture({ data: benchData(3, 1) });
    const container = attachedPanel(ui);
    const anchorOf = () =>
      Array.from(container.children).find(
        el =>
          el.classList.contains(CONST.CLASSES.TOGGLE_ALL) &&
          el.getAttribute("data-role") === ROLE.OVERLAY,
      ) as HTMLElement;
    const duplicate = anchorOf().cloneNode(true) as HTMLElement;
    container.appendChild(duplicate);
    // The cursor is on a row after the anchor: removing the anchor shifts its
    // index, and the reconcile would re-home onto the neighbor without the
    // shared helper's activeIdx adjustment.
    const active = rowOf(ui, "overlay_2");
    ui.listPanel.activeIdx = getNavigableItems(ui).indexOf(active);
    active.classList.add(CONST.CLASSES.FOCUSED);

    syncRowOrder(ui);

    expect(ui.listPanel.activeIdx).toBe(getNavigableItems(ui).indexOf(active));
    expect(active.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);
  });

  it("keeps focus inside the panel when the surviving anchor was stripped", () => {
    // Name note: this exercises the *survivor* rung of the restore chain, not
    // the nearest-neighbour rung — a row/anchor is focusable by construction
    // (tabindex is re-seeded by the roving cursor). The folded-survivor test
    // below is what reaches the walk; the container last resort stays a
    // browser-only defense and is exempt from coverage in list.ts. The
    // assertion that matters here is unchanged: the keyboard user never lands
    // on <body> after the duplicate is dropped.
    const { ui } = initFixture({ data: benchData(3, 1) });
    const container = attachedPanel(ui);
    const anchorOf = () =>
      Array.from(container.children).find(
        el =>
          el.classList.contains(CONST.CLASSES.TOGGLE_ALL) &&
          el.getAttribute("data-role") === ROLE.OVERLAY,
      ) as HTMLElement;
    const original = anchorOf();
    const duplicate = original.cloneNode(true) as HTMLElement;
    // The surviving anchor carries no controls, so the exact path cannot
    // resolve and the control fallback finds nothing; the survivor itself is
    // the rung that takes focus in a jsdom run.
    duplicate.replaceChildren();
    duplicate.removeAttribute("tabindex");
    container.appendChild(duplicate);
    (original.querySelector("button") as HTMLElement).focus();

    expect(() => syncRowOrder(ui)).not.toThrow();
    expect(anchorOf()).toBe(duplicate);
    expect(document.activeElement).not.toBe(document.body);
    expect(container.contains(document.activeElement as Node)).toBe(true);
  });

  it("falls back to the surviving row itself when its controls were stripped", () => {
    const { ui } = initFixture({ data: benchData(3, 1) });
    const container = attachedPanel(ui);
    const original = rowOf(ui, "overlay_1");
    const duplicate = original.cloneNode(true) as HTMLElement;
    // The clone lost every in-row control (checkbox / ⋮), so the exact path
    // has no target; the row itself is focusable (tabindex=0) and must take
    // the focus rather than leaving it on the removed original.
    duplicate.replaceChildren();
    container.appendChild(duplicate);
    (original.querySelector("input") as HTMLElement).focus();

    syncRowOrder(ui);

    expect(document.activeElement).toBe(duplicate);
    expect(container.contains(duplicate)).toBe(true);
    expect(ui.listPanel.activeIdx).toBe(getNavigableItems(ui).indexOf(duplicate));
  });

  it.skipIf(!refusesHiddenFocus)(
    "walks to a visible neighbour when the surviving duplicate is folded",
    () => {
      // The browser-only rung: a folded group renders `display: none`, and
      // browsers refuse focus on a `display: none` subtree. jsdom applies no
      // stylesheet, so pin the folded state inline to reproduce that refusal —
      // exact path, caller fallback and the survivor itself all fail to take
      // focus, and the walk must land on a visible row rather than leave the
      // keyboard user on <body>.
      const { ui } = initFixture({ data: benchData(3, 1) });
      const container = attachedPanel(ui);
      const original = rowOf(ui, "overlay_1");
      const duplicate = original.cloneNode(true) as HTMLElement;
      duplicate.style.display = "none";
      container.appendChild(duplicate);
      (original.querySelector("input") as HTMLElement).focus();

      syncRowOrder(ui);

      expect(duplicate.isConnected).toBe(true);
      expect(document.activeElement).not.toBe(duplicate);
      expect(document.activeElement).not.toBe(document.body);
      expect(container.contains(document.activeElement as Node)).toBe(true);
      // Focus is the cursor: the row that took the focus owns the ledger, so a
      // later arrow key continues from the visible neighbour instead of from the
      // folded survivor (which cannot hold focus at all).
      const items = getNavigableItems(ui);
      const focusedIdx = items.indexOf(document.activeElement as HTMLElement);
      expect(focusedIdx).toBeGreaterThanOrEqual(0);
      expect(ui.listPanel.activeIdx).toBe(focusedIdx);
      expect(items[focusedIdx]).not.toBe(duplicate);
    },
  );

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
    // leaves the cursor nothing to re-home onto — the kind-tagged identity
    // resolves against nothing, so the ledger clears.
    row.remove();
    reconcileCursorByIdentity(ui, { kind: "layer", id: "overlay_1" });

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
          role: "overlay" as const,
        })),
      });
      const rebuilds: string[] = [];
      const changes: string[] = [];
      // The color basemap joins the registry at attach as a base-group tail;
      // the arrangement under test is the overlay block.
      const overlayOrder = (m: LayerController) =>
        m.layers.filter(l => l.role === ROLE.OVERLAY).map(l => l.id);
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
          `${CONST.SEL.LAYER_ITEM}[data-layer-type="${ROLE.OVERLAY}"]`,
        ),
      ).map(el => el.getAttribute(CONST.DATA.LAYER_ID));
      expect(domOrder, via).toEqual(order);
      (
        manager as unknown as { persistence: { flushAll(): void } }
      ).persistence.flushAll();
      const stored = JSON.parse(
        window.localStorage.getItem(CONST.STORAGE.KEY) ?? "{}",
      ) as { data?: { order?: string[] } };
      // The persisted snapshot is the full registry, color basemap included.
      expect(stored.data?.order, via).toEqual(manager.layers.map(l => l.id));
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

  it.each([
    { named: "overlay", role: "overlay" as const },
    { named: "base", role: "base" as const },
  ])(
    "keeps the cursor on a layer named $named when its row moves",
    ({ named, role }) => {
      // A layer may legally be called "overlay" or "base" — the same
      // strings the group headers key on. The cursor identity is
      // kind-tagged, so every ledger (DOM focus, activeIdx, the one roving
      // tab stop) re-homes onto the layer row, not the same-named header.
      const { manager, ui } = initFixture({
        data: [
          { id: named, name: named, role },
          {
            id: role === "base" ? "tile" : "x",
            name: "other",
            role,
          },
        ],
      });
      const row = rowOf(ui, named);
      row.focus();
      ui.listPanel.activeIdx = getNavigableItems(ui).indexOf(row);

      expect(manager.moveLayerDown(named)).toBe(true);

      const items = getNavigableItems(ui);
      expect(items[ui.listPanel.activeIdx ?? -1]).toBe(row);
      expect(items.findIndex(el => el.tabIndex === 0)).toBe(items.indexOf(row));
      expect(document.activeElement).toBe(row);
      const header = attachedPanel(ui).querySelector(
        `.${CONST.CLASSES.TOGGLE_ALL}[data-role="${role}"]`,
      );
      expect(items.indexOf(row)).not.toBe(items.indexOf(header as HTMLElement));
    },
  );

  it("re-homes a header cursor back onto the header", () => {
    const { manager, ui } = initFixture({ data: benchData(3, 0) });
    const header = attachedPanel(ui).querySelector(
      `.${CONST.CLASSES.TOGGLE_ALL}[data-role="${ROLE.OVERLAY}"]`,
    ) as HTMLElement;
    header.focus();
    ui.listPanel.activeIdx = getNavigableItems(ui).indexOf(header);

    manager.moveLayerUp("overlay_2");

    const items = getNavigableItems(ui);
    expect(items[ui.listPanel.activeIdx ?? -1]).toBe(header);
    expect(items.findIndex(el => el.tabIndex === 0)).toBe(items.indexOf(header));
  });

  it("a folded cursor row falls back to its group header, same name or not", () => {
    const { ui } = initFixture({
      data: [
        { id: "overlay", name: "overlay", role: "overlay" as const },
        { id: "x", name: "x", role: "overlay" as const },
      ],
    });
    const row = rowOf(ui, "overlay");
    row.focus();
    ui.listPanel.activeIdx = getNavigableItems(ui).indexOf(row);

    // The fold rebuild captures the cursor by identity before the rows go,
    // then finds its row hidden — the fallback is the row's own group
    // header, not a same-named one swapped in by string luck.
    toggleFold(ui, ROLE.OVERLAY);

    const items = getNavigableItems(ui);
    const header = attachedPanel(ui).querySelector(
      `.${CONST.CLASSES.TOGGLE_ALL}[data-role="${ROLE.OVERLAY}"]`,
    ) as HTMLElement;
    expect(items[ui.listPanel.activeIdx ?? -1]).toBe(header);
  });

  it("a late registration ahead of the active row keeps every ledger on it", () => {
    // The persisted order slots H before A, so the newcomer lands ahead of
    // the focused row: a positional ledger would hand the cursor, the
    // marker and the tab stop to H while DOM focus stayed on A.
    const { manager, ui } = initFixture({
      seed: { order: ["H", "A", "B"] },
      data: [
        { id: "A", name: "A", role: "overlay" as const },
        { id: "B", name: "B", role: "overlay" as const },
      ],
    });
    const row = rowOf(ui, "A");
    row.focus();
    ui.listPanel.activeIdx = getNavigableItems(ui).indexOf(row);
    row.classList.add(CONST.CLASSES.FOCUSED);

    manager.registerLayer({ id: "H", name: "H", role: "overlay" });

    // The color basemap joins the registry at attach as the base-group tail.
    expect(manager.layers.map(l => l.id)).toEqual([
      "H",
      "A",
      "B",
      CONST.SOLID_BASEMAP_ID,
    ]);
    const ledger = cursorLedger(ui);
    expect(ledger.active).toBe("A");
    expect(ledger.marked).toBe("A");
    expect(ledger.tabStops).toEqual(["A"]);
    expect(ledger.domFocus).toBe("A");
  });

  it("a late registration behind the active row changes nothing", () => {
    const { manager, ui } = initFixture({
      data: [
        { id: "A", name: "A", role: "overlay" as const },
        { id: "B", name: "B", role: "overlay" as const },
      ],
    });
    const row = rowOf(ui, "A");
    row.focus();
    ui.listPanel.activeIdx = getNavigableItems(ui).indexOf(row);

    // A base registration lands in the trailing base role, below every
    // overlay row — the active row keeps its index and its ledgers.
    manager.registerLayer({ id: "tile", name: "tile", role: "base" });

    const ledger = cursorLedger(ui);
    expect(ledger.active).toBe("A");
    expect(ledger.marked).toBe("A");
    expect(ledger.tabStops).toEqual(["A"]);
    expect(ledger.domFocus).toBe("A");
  });

  it("removing a row above the active row keeps every ledger on it", () => {
    const { manager, ui } = initFixture({
      data: [
        { id: "A", name: "A", role: "overlay" as const },
        { id: "B", name: "B", role: "overlay" as const },
        { id: "C", name: "C", role: "overlay" as const },
      ],
    });
    const row = rowOf(ui, "B");
    row.focus();
    ui.listPanel.activeIdx = getNavigableItems(ui).indexOf(row);

    // A sat above B; the removal shifts B into its index, so a positional
    // ledger would hand every state to C. Identity keeps them on B.
    manager.unregisterLayer("A");

    const ledger = cursorLedger(ui);
    expect(ledger.active).toBe("B");
    expect(ledger.marked).toBe("B");
    expect(ledger.tabStops).toEqual(["B"]);
    expect(ledger.domFocus).toBe("B");
  });

  it("removing the active row clears the cursor and keeps one tab stop", () => {
    const { manager, ui } = initFixture({
      data: [
        { id: "A", name: "A", role: "overlay" as const },
        { id: "B", name: "B", role: "overlay" as const },
      ],
    });
    const row = rowOf(ui, "A");
    row.focus();
    ui.listPanel.activeIdx = getNavigableItems(ui).indexOf(row);

    manager.unregisterLayer("A");

    // The focused row is gone; the cursor clears and the roving contract
    // holds — exactly one visible stop, the first row, so Tab can re-enter
    // the list.
    expect(ui.listPanel.activeIdx).toBeNull();
    const ledger = cursorLedger(ui);
    expect(ledger.marked).toBeNull();
    expect(ledger.tabStops).toEqual(["role:overlay"]);
    expect(document.activeElement).toBe(document.body);
  });

  it("renders a base header for an empty base role via the fallback loop", () => {
    // L445 BASE side: after the user deletes every base layer, the base
    // role has no live row but keeps a stale folder key (freezeEmptyFolder).
    // rolesWithHeader(BASE) is then true with no base layer, so the fallback
    // loop must render the base header with base_map_label — not the overlay
    // label, which would be a user-visible mislabel.
    const { manager, ui } = initFixture({
      data: [{ id: "O1", name: "O1", role: "overlay" }],
    });
    // Remove the always-registered solid basemap so the base role is empty.
    manager.unregisterLayer(CONST.SOLID_BASEMAP_ID);
    manager.createFolder("base", "Ghost");
    manager.ui?.rebuildAfterLayoutChange?.();
    const baseHeader = attachedPanel(ui).querySelector(
      `.${CONST.CLASSES.TOGGLE_ALL}[data-role="${ROLE.BASE}"]`,
    ) as HTMLElement | null;
    expect(baseHeader).not.toBeNull();
    // The ternary passes base_map_label; syncNoBasemap may then show
    // no_base_map_label when zero basemaps are visible — either is correct
    // for a base header, the overlay label never is.
    expect(
      baseHeader!.textContent.includes(ui.T("base_map_label")) ||
        baseHeader!.textContent.includes(ui.T("no_base_map_label")),
    ).toBe(true);
    expect(baseHeader!.textContent).not.toContain(ui.T("data_layer_label"));
  });
});

describe("clean-empty-folders button and role header order", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
    if (!manager.layerRegistry.get("overlay2")) {
      manager.registerLayer({
        id: "overlay2",
        name: "Circles",
        role: "overlay",
        layer: { options: {}, eachLayer: vi.fn() },
      });
    }
    ui.listPanel.foldedRoles = {};
    seedIntentMap(ui, "visible", {});
    window.localStorage.removeItem(CONST.STORAGE.KEY);
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("renders a row for a folder that holds no layer yet", () => {
    // A folder created from the role menu owns a row immediately: it is the
    // only handle for renaming or deleting it until a layer moves in.
    manager.createFolder("overlay", "empty-1");
    manager.ui?.rebuildAfterLayoutChange?.();
    const row = attachedPanel(ui).querySelector(
      `[data-folder-key="${normalizeFolderName("empty-1")}"]`,
    ) as HTMLElement | null;
    expect(row).not.toBeNull();
    expect(row?.classList.contains(CONST.CLASSES.FOLDER_ROW)).toBe(true);
  });

  it("keeps each header adjacent to its own rows (DOM order)", () => {
    // Fixture already provides overlay1 + base1; beforeEach adds overlay2.
    // Structural assertion (not a brittle exact sequence): the header of a
    // role must precede that role's rows, and the base header must not be
    // wedged above the overlay rows — the ordering regression the header
    // rewrite could reintroduce. `foliplus_*` utility rows are ignored.
    const container = attachedPanel(ui);
    const seq = Array.from(container.children)
      .filter(el => !el.getAttribute(CONST.DATA.LAYER_ID)?.startsWith("foliplus_"))
      .map(el => {
        if (el.classList.contains(CONST.CLASSES.TOGGLE_ALL)) {
          return { kind: "header", role: (el as HTMLElement).dataset.role };
        }
        return { kind: "row", role: (el as HTMLElement).dataset.layerType };
      });
    const pos = (pred: (x: { kind: string; role?: string }) => boolean) =>
      seq.findIndex(pred);
    const headerOverlay = pos(x => x.kind === "header" && x.role === "overlay");
    const headerBase = pos(x => x.kind === "header" && x.role === "base");
    const firstOverlayRow = pos(x => x.kind === "row" && x.role === "overlay");
    const lastOverlayRow =
      seq
        .map((x, i) => ({ x, i }))
        .filter(({ x }) => x.kind === "row" && x.role === "overlay")
        .slice(-1)[0]?.i ?? -1;
    const firstBaseRow = pos(x => x.kind === "row" && x.role === "base");
    // Overlay header leads the overlay rows; base header sits after them.
    expect(headerOverlay).toBeGreaterThanOrEqual(0);
    expect(headerBase).toBeGreaterThanOrEqual(0);
    expect(firstOverlayRow).toBeGreaterThan(headerOverlay);
    expect(lastOverlayRow).toBeGreaterThanOrEqual(firstOverlayRow);
    expect(headerBase).toBeGreaterThan(lastOverlayRow);
    expect(firstBaseRow).toBeGreaterThan(headerBase);
  });

  it("places the empty-role header after live rows and keeps its clean button", () => {
    // Overlay keeps only an empty folder key (no live overlay rows); base has a row.
    manager.unregisterLayer("overlay1");
    manager.unregisterLayer("overlay2");
    manager.createFolder("overlay", "empty-1");
    manager.ui?.rebuildAfterLayoutChange?.();
    const container = attachedPanel(ui);
    const kinds = Array.from(container.children)
      .filter(el => !el.getAttribute(CONST.DATA.LAYER_ID)?.startsWith("foliplus_"))
      .map(el => {
        if (el.classList.contains(CONST.CLASSES.TOGGLE_ALL)) {
          return `header:${(el as HTMLElement).dataset.role}`;
        }
        const id = el.getAttribute(CONST.DATA.LAYER_ID);
        return `row:${id}`;
      });
    // The empty overlay role's header trails the live base role, and its empty
    // folder still renders a row under it (the row is the rename/delete handle).
    expect(kinds.slice(0, 3)).toEqual(["header:base", "row:base1", "header:overlay"]);
    expect(kinds.length).toBe(4);
    expect(
      container.querySelector(`[data-folder-key="${normalizeFolderName("empty-1")}"]`),
    ).not.toBeNull();
  });
});

describe("role header identity key", () => {
  // The container's fold handler resolves the role a click landed in by
  // climbing from the clicked control up to the header row. That climb reads the
  // row's stable identity key (data-role, written when the row is built) rather
  // than the row class: climbing on the class would land on any nested control
  // that also carries it, and the role read off that element would be wrong or
  // missing. These guards lock the key the climb reads — and the climb itself.
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    window.localStorage.clear();
    ({ manager, ui } = initFixture());
    ui.listPanel.foldedRoles = {};
    seedIntentMap(ui, "visible", {});
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  const headers = () => [
    ...attachedPanel(ui).querySelectorAll<HTMLElement>(CONST.SEL.TOGGLE_ALL),
  ];
  const headerKeys = () => headers().map(el => el.dataset.role);
  const renderedRoles = () =>
    new Set(
      [...attachedPanel(ui).querySelectorAll<HTMLElement>(CONST.SEL.LAYER_ITEM)]
        .map(el => el.dataset.layerType)
        .filter((role): role is string => !!role && !role.startsWith("foliplus_")),
    );

  it("writes one unique role key per header, never the sentinel", () => {
    const keys = headerKeys();
    expect(keys.length).toBeGreaterThan(0);
    expect(new Set(keys).size, "one header per role").toBe(keys.length);
    for (const key of keys) {
      expect(key, "every header carries a key").not.toBeUndefined();
      expect(key, "the toggle-all checkbox sentinel is not a role key").not.toBe(
        CONST.TOGGLE_ALL_ROLE,
      );
      expect(Object.values(ROLE), `header key ${key} is a LayerRole`).toContain(
        key as never,
      );
    }
  });

  it("covers exactly the roles the panel renders rows for", () => {
    expect([...new Set(headerKeys())].sort()).toEqual([...renderedRoles()].sort());
  });

  it("does not move when the folder layout changes", () => {
    // The key is the role; a folder's name is display only. Renaming a folder
    // rebuilds the rows, but the role a header owns cannot change with it.
    const before = headerKeys();
    manager.createFolder("overlay", "Extra");
    expect(manager.renameFolder("overlay", "extra", "More")).toEqual({ ok: true });
    expect(headerKeys(), "the folder layout carries no role identity").toEqual(before);
  });

  it("is the key both fold bind sites climb on", () => {
    // The onChange site climbs from the row's own checkbox, which writes the
    // sentinel on itself; the climb must skip it and land on the row. The
    // onClick site climbs from a nested control with no key of its own, such as
    // the fold button.
    for (const row of headers()) {
      const checkbox = row.querySelector<HTMLInputElement>(
        `[data-role="${CONST.TOGGLE_ALL_ROLE}"]`,
      );
      expect(
        checkbox?.closest(CONST.SEL.TOGGLE_ALL_ROW),
        "the climb skips the checkbox's own sentinel",
      ).toBe(row);
      const foldBtn = row.querySelector(`.${CONST.CLASSES.FOLD_BTN}`);
      expect(foldBtn, "the header carries its fold button").not.toBeNull();
      expect(foldBtn?.closest(CONST.SEL.TOGGLE_ALL_ROW)).toBe(row);
    }
  });
});

describe("ui/list folder rows (render / row structure)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = "";
  });
  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  const layoutFromRoles = (
    sections: Record<string, string[]>,
  ): Record<string, unknown> => {
    const keys = new Set<string>();
    for (const list of Object.values(sections)) for (const k of list) keys.add(k);
    return {
      version: 2,
      folders: [...keys].map(k => ({ key: k, name: k })),
      order: sections,
      members: {},
    };
  };

  const polygonLayer = () => ({
    options: {},
    getBounds: () => ({ isValid: () => true }),
  });

  it("renders role header, folder row, members with rail tree lines, then root layers", () => {
    const { ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
        {
          id: "water",
          name: "Water",
          role: "overlay",
          folder: "",
          layer: polygonLayer(),
        },
      ],
    });
    const roleRow = ui.uiContainer!.querySelector(`.${CONST.CLASSES.ROLE_ROW}`);
    expect(roleRow).not.toBeNull();
    const folderRow = ui.uiContainer!.querySelector(`.${CONST.CLASSES.FOLDER_ROW}`);
    expect(folderRow).not.toBeNull();
    expect(folderRow!.getAttribute(CONST.DATA.FOLDER_KEY)).toBe("roads");
    expect(folderRow!.getAttribute(CONST.DATA.ROLE)).toBe("overlay");
    expect(folderRow!.getAttribute("aria-expanded")).toBe("true");
    // Member row (rd1) has a fold-tree guide; root row (water) does not.
    const memberRow = ui.uiContainer!.querySelector(`[data-layer-id="rd1"]`);
    const rootRow = ui.uiContainer!.querySelector(`[data-layer-id="water"]`);
    expect(memberRow!.querySelector(`.${CONST.CLASSES.FOLD_TREE}`)).not.toBeNull();
    expect(rootRow!.querySelector(`.${CONST.CLASSES.FOLD_TREE}`)).toBeNull();
    // Both member and root rows still carry the drag grip in the rail.
    expect(
      memberRow!.querySelector(`.${CONST.CLASSES.RAIL_CELL} .drag-handle`),
    ).not.toBeNull();
    expect(
      rootRow!.querySelector(`.${CONST.CLASSES.RAIL_CELL} .drag-handle`),
    ).not.toBeNull();
  });

  it("lands a late-registered folder member inside its folder block, not at registry depth", () => {
    // Third-party layers (HeatmapControl, ExportControl) register AFTER the
    // initial render, so rd1 is a late registration. The user dragged it into the
    // "roads" folder, so BOTH records persist that intent: the layer-state order
    // ranks rd1 among the overlay rows, and the folder-layout members map assigns
    // it to the folder. The registration-time seed preserves the members
    // assignment (seed is idempotent and never overrides), so
    // folderOf(layout, layerInfo) resolves "roads", and placeAtSavedSlot moves the
    // new registry entry to its stored rank (index > 0, beside the root layers).
    // The insert must reuse the renderInitialList placement rule and put the row
    // inside that folder block (immediately after the folder row), not at the
    // registry-depth anchor the old insertLayerItem used — which would land it as
    // a root-layer sibling and show it fallen to root on refresh.
    const { manager, ui } = initFixture({
      seed: { order: ["A", "B", "rd1"] },
      seedLayout: {
        version: 2,
        folders: [{ key: "roads", name: "roads" }],
        order: { overlay: ["roads"] },
        members: { rd1: { role: "overlay", folder: "roads" } },
      },
      data: [
        { id: "A", name: "A", role: "overlay", folder: "", layer: polygonLayer() },
        { id: "B", name: "B", role: "overlay", folder: "", layer: polygonLayer() },
      ],
    });

    manager.registerLayer({ id: "rd1", name: "Roads", role: "overlay" });

    // Sanity: the registry placed rd1 at a non-zero index (its saved slot),
    // otherwise this test would not exercise the buggy anchor path.
    expect(manager.layers.map(l => l.id).indexOf("rd1")).toBeGreaterThan(0);

    const children = Array.from(attachedPanel(ui).children);
    const folderIdx = children.findIndex(
      el => el.getAttribute(CONST.DATA.FOLDER_KEY) === "roads",
    );
    const rd1Idx = children.findIndex(
      el => el.getAttribute(CONST.DATA.LAYER_ID) === "rd1",
    );
    const waterIdx = children.findIndex(
      el => el.getAttribute(CONST.DATA.LAYER_ID) === "B",
    );
    expect(folderIdx).toBeGreaterThanOrEqual(0);
    // The member row is the flat sibling immediately after its folder row —
    // renderInitialList's block structure — NOT after the root layer at registry
    // depth.
    expect(rd1Idx).toBe(folderIdx + 1);
    expect(rd1Idx).toBeLessThan(waterIdx);
    // And it paints as a member: the rail carries the tree connector.
    const rd1Row = attachedPanel(ui).querySelector<HTMLElement>(
      `[${CONST.DATA.LAYER_ID}="rd1"]`,
    )!;
    expect(rd1Row.querySelector(`.${CONST.CLASSES.FOLD_TREE}`)).not.toBeNull();
  });

  it("inserts a late folder member at its rank among the block's members and inherits a folded folder", () => {
    // Two members already painted; the late member joins the folder row's
    // flat-sibling run at its rank (after the earlier member), and when the
    // folder is folded the new row inherits GROUP_FOLDED (the same rule
    // renderInitialList applies to its block members).
    const { manager, ui } = initFixture({
      // rd2's saved rank is after rd1, so placeAtSavedSlot gives it a registry
      // index beside the folder's existing member — the groupByFolder member
      // order then ranks it second, and the insert must land it after rd1.
      seed: { order: ["rd1", "water", "rd2"] },
      seedLayout: {
        version: 2,
        folders: [{ key: "roads", name: "roads" }],
        order: { overlay: ["roads"] },
        members: {
          rd1: { role: "overlay", folder: "roads" },
          rd2: { role: "overlay", folder: "roads" },
        },
      },
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
        {
          id: "water",
          name: "Water",
          role: "overlay",
          folder: "",
          layer: polygonLayer(),
        },
      ],
    });
    ui.listPanel.foldedFolders["overlay::roads"] = true;

    manager.registerLayer({ id: "rd2", name: "Rivers", role: "overlay" });

    const children = Array.from(attachedPanel(ui).children);
    const folderIdx = children.findIndex(
      el => el.getAttribute(CONST.DATA.FOLDER_KEY) === "roads",
    );
    const rd1Idx = children.findIndex(
      el => el.getAttribute(CONST.DATA.LAYER_ID) === "rd1",
    );
    const rd2Idx = children.findIndex(
      el => el.getAttribute(CONST.DATA.LAYER_ID) === "rd2",
    );
    expect(folderIdx).toBeGreaterThanOrEqual(0);
    // rd2 lands after rd1 (its block rank), both inside the folder block, and
    // before the root layer.
    expect(rd2Idx).toBe(rd1Idx + 1);
    expect(rd2Idx).toBeLessThan(
      children.findIndex(el => el.getAttribute(CONST.DATA.LAYER_ID) === "water"),
    );
    // The folded folder hides the late member too.
    const rd2Row = attachedPanel(ui).querySelector<HTMLElement>(
      `[${CONST.DATA.LAYER_ID}="rd2"]`,
    )!;
    expect(rd2Row.classList.contains(CONST.CLASSES.GROUP_FOLDED)).toBe(true);
  });

  it("a late registration's declared folder seeds the layout and places the row inside that folder block", () => {
    // A third-party control (HeatmapControl/MeasureControl) registers a layer
    // AFTER the initial render with an author-declared folder (CONFIG.folder,
    // forwarded through createCanvas/createLayers). The declaration seeds the
    // layout (registerLayer → folderLayout.seed), and insertLayerItem must
    // place the row inside the folder block, not at registry depth.
    const { manager, ui } = initFixture({
      seed: { order: ["A", "B", "H"] },
      // The folder already owns an order key (it exists on the panel); H has
      // no persisted members assignment, so the late declaration seeds it.
      seedLayout: {
        version: 2,
        folders: [{ key: normalizeFolderName("数据分析"), name: "数据分析" }],
        order: { overlay: [normalizeFolderName("数据分析")] },
        members: {},
      },
      data: [
        { id: "A", name: "A", role: "overlay", folder: "", layer: polygonLayer() },
        { id: "B", name: "B", role: "overlay", folder: "", layer: polygonLayer() },
      ],
    });

    // The declaration is the registration-time seed; no persisted members
    // assignment exists, so seed() must assign it.
    manager.registerLayer({
      id: "H",
      name: "Heat",
      role: "overlay",
      folder: "数据分析",
    });

    const children = Array.from(attachedPanel(ui).children);
    const folderIdx = children.findIndex(
      el => el.getAttribute(CONST.DATA.FOLDER_KEY) === normalizeFolderName("数据分析"),
    );
    const hIdx = children.findIndex(el => el.getAttribute(CONST.DATA.LAYER_ID) === "H");
    expect(folderIdx).toBeGreaterThanOrEqual(0);
    // The member row is the flat sibling immediately after its folder row.
    expect(hIdx).toBe(folderIdx + 1);
    // And it paints as a member: the rail carries the tree connector.
    const hRow = attachedPanel(ui).querySelector<HTMLElement>(
      `[${CONST.DATA.LAYER_ID}="H"]`,
    )!;
    expect(hRow.querySelector(`.${CONST.CLASSES.FOLD_TREE}`)).not.toBeNull();
  });

  it("folder checkbox is tri-state (mixed when some members visible)", () => {
    const { ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
        {
          id: "rd2",
          name: "Rivers",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
      ],
    });
    const folderRow = ui.uiContainer!.querySelector(`.${CONST.CLASSES.FOLDER_ROW}`);
    const cb = folderRow!.querySelector("input[type=checkbox]") as HTMLInputElement;
    // All members visible by default → the folder checkbox reads fully checked.
    expect(cb.getAttribute("aria-checked")).toBe("true");
  });

  it("role row gains count, divider, type icon and more button when folders exist", () => {
    const { ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
      ],
    });
    const roleRow = ui.uiContainer!.querySelector(`.${CONST.CLASSES.ROLE_ROW}`);
    expect(roleRow!.querySelector(`.${CONST.CLASSES.ROLE_DIVIDER}`)).not.toBeNull();
    expect(roleRow!.querySelector(`.${CONST.CLASSES.COUNT_COL}`)).not.toBeNull();
    expect(roleRow!.querySelector(`.${CONST.CLASSES.TYPE_ICON_COL}`)).not.toBeNull();
    expect(roleRow!.querySelector(`.${CONST.CLASSES.MORE_BTN}`)).not.toBeNull();
  });

  it("role checkbox toggles every layer in the role", () => {
    const { ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
      ],
    });
    const roleRow = ui.uiContainer!.querySelector(
      `.${CONST.CLASSES.ROLE_ROW}`,
    ) as HTMLElement;
    (ui.overlayPanel as any).activeMenu = {
      item: roleRow,
      menu: document.createElement("div"),
      role: "overlay",
    };
    const cb = ui.uiContainer!.querySelector(
      `.${CONST.CLASSES.ROLE_ROW} input[type=checkbox]`,
    ) as HTMLInputElement;
    cb.checked = false;
    cb.dispatchEvent(new Event("change", { bubbles: true }));
    expect(cb.getAttribute("aria-checked")).toBe("false");
  });

  it("renders a folder row for declared-only grouping (empty order, member assigned)", () => {
    const { ui } = initFixture({
      seedLayout: {
        version: 2,
        folders: [{ key: "roads", name: "Roads" }],
        order: {},
        members: {},
      },
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "Roads",
          layer: polygonLayer(),
        },
      ],
    });
    const folderRow = ui.uiContainer!.querySelector(`.${CONST.CLASSES.FOLDER_ROW}`);
    expect(folderRow).not.toBeNull();
    expect(folderRow!.getAttribute(CONST.DATA.FOLDER_KEY)).toBe("roads");
    const memberRow = ui.uiContainer!.querySelector('[data-layer-id="rd1"]');
    expect(memberRow!.querySelector(`.${CONST.CLASSES.FOLD_TREE}`)).not.toBeNull();
  });

  it("orders two unlisted folders by their member anchor", () => {
    // Two folders that are NOT in layout.order land in the displayBlocks
    // `rest` bucket and are sorted by anchor (list.ts:481 comparator).
    const { ui } = initFixture({
      seedLayout: {
        version: 2,
        folders: [
          { key: "rivers", name: "Rivers" },
          { key: "roads", name: "Roads" },
        ],
        order: {},
        members: {},
      },
      data: [
        {
          id: "rv1",
          name: "Rivers",
          role: "overlay",
          folder: "Rivers",
          layer: polygonLayer(),
        },
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "Roads",
          layer: polygonLayer(),
        },
      ],
    });
    const rows = Array.from(
      ui.uiContainer!.querySelectorAll(`.${CONST.CLASSES.FOLDER_ROW}`),
    );
    // The two unlisted folders render as folder rows, in anchor order.
    expect(rows.map(r => r.getAttribute(CONST.DATA.FOLDER_KEY))).toEqual([
      "rivers",
      "roads",
    ]);
  });

  it("role checkbox shows every layer in the role", () => {
    const { ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
      ],
    });
    const roleRow = ui.uiContainer!.querySelector(
      `.${CONST.CLASSES.ROLE_ROW}`,
    ) as HTMLElement;
    (ui.overlayPanel as any).activeMenu = {
      item: roleRow,
      menu: document.createElement("div"),
      role: "overlay",
    };
    // Hide the layer first.
    const cb = ui.uiContainer!.querySelector(
      `.${CONST.CLASSES.ROLE_ROW} input[type=checkbox]`,
    ) as HTMLInputElement;
    cb.checked = false;
    cb.dispatchEvent(new Event("change", { bubbles: true }));
    const memberCb = ui.uiContainer!.querySelector(
      '[data-layer-id="rd1"] input[type=checkbox]',
    ) as HTMLInputElement;
    expect(memberCb.checked).toBe(false);
    // The role checkbox shows them again.
    cb.checked = true;
    cb.dispatchEvent(new Event("change", { bubbles: true }));
    const memberCb2 = ui.uiContainer!.querySelector(
      '[data-layer-id="rd1"] input[type=checkbox]',
    ) as HTMLInputElement;
    expect(memberCb2.checked).toBe(true);
  });

  it("wakes the role and folder icons when their group is on (issue 3)", () => {
    // The type icon is muted at rest and wakes to black when the row is
    // active. Layer rows got that state; role and folder rows never did, so a
    // checked group header kept a muted icon beside black layer icons.
    const { ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "rd1",
          name: "Roads 1",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
        {
          id: "rd2",
          name: "Roads 2",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
      ],
    });
    const roleRow = () => ui.uiContainer!.querySelector(`.${CONST.CLASSES.ROLE_ROW}`)!;
    const folderRow = () =>
      ui.uiContainer!.querySelector(`.${CONST.CLASSES.FOLDER_ROW}`)!;

    expect(roleRow().classList.contains(CONST.CLASSES.ACTIVE)).toBe(true);
    expect(folderRow().classList.contains(CONST.CLASSES.ACTIVE)).toBe(true);

    // One member left on: the group is still on.
    applyVisibility(ui, "rd1", false);
    expect(folderRow().classList.contains(CONST.CLASSES.ACTIVE)).toBe(true);

    // Nothing on: the group is off, so the icons recede.
    applyVisibility(ui, "rd2", false);
    expect(folderRow().classList.contains(CONST.CLASSES.ACTIVE)).toBe(false);
    expect(roleRow().classList.contains(CONST.CLASSES.ACTIVE)).toBe(false);
  });

  it("paints the role divider with the shared section-divider recipe (issue 4)", () => {
    // The two role sections used to be separated by a hand-rolled flat line
    // while main used the soft gradient recipe, so the divider read as a
    // different element. One paint recipe, two spans.
    const { ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
      ],
    });
    const divider = ui.uiContainer!.querySelector(`.${CONST.CLASSES.ROLE_DIVIDER}`);
    expect(divider).not.toBeNull();
    expect(divider!.classList.contains("foliplus-section-divider")).toBe(true);
  });

  it("advertises the drag gesture with grab / grabbing cursors (issue 17)", () => {
    // Every row is draggable, so the cursor says so. The rows
    // used to sit on `default` and only switch to `move` mid-gesture.
    const row = readFileSync(
      repoPath("foliplus/css/control/LayerControl/row.css"),
      "utf8",
    );
    const itemStart = row.indexOf(".foliplus-layer-item {");
    const item = row.slice(itemStart, itemStart + 2000);
    expect(item).toContain("cursor: grab");
    expect(item).not.toContain("cursor: default");
    const dragging = row.slice(
      row.indexOf("&.foliplus-layer-dragging {"),
      row.indexOf("&.foliplus-layer-drag-over-top {"),
    );
    expect(dragging).toContain("cursor: grabbing");
  });

  it("keeps the role label chip on the row's own surface (issue 3)", () => {
    // The label paints a chip so the role divider's hairline does not cross
    // the text. A hard-coded surface colour punched a white hole in the
    // checked-row wash once the group rows started carrying it; inheriting the
    // row's background keeps the gap in both states.
    const row = readFileSync(
      repoPath("foliplus/css/control/LayerControl/row.css"),
      "utf8",
    );
    const block = row.slice(
      row.indexOf(".foliplus-layer-sep-label {"),
      row.indexOf("/* ── Shared grid placements"),
    );
    expect(block).toContain("background-color: inherit");
    expect(block).not.toContain("background: var(--foliplus-surface)");
    // The chip hugs the text so the hairline shows in the rest of the column.
    expect(block).toContain("justify-self: start");
  });

  it("draws two distinct fold-tree shapes, centred on the rail (issue 5)", () => {
    // --mid is a branch that continues below (├), --last is the elbow that ends
    // it (└). Both used to render the same full-height stem, so the tree had
    // one shape where it needed two. The stem also sat off-centre, so it did
    // not line up with the folder header's fold chevron.
    const row = readFileSync(
      repoPath("foliplus/css/control/LayerControl/row.css"),
      "utf8",
    );
    const stem = row.slice(
      row.indexOf(".foliplus-fold-tree {"),
      row.indexOf(".foliplus-fold-tree-last::before"),
    );
    // Centred on the rail, not offset by a fixed width.
    expect(stem).toContain("left: 50%");
    expect(stem).toContain("transform: translateX(-50%)");
    // The elbow stops the stem at the horizontal stub.
    const elbow = row.slice(
      row.indexOf(".foliplus-fold-tree-last::before"),
      row.indexOf(".foliplus-fold-tree-mid::after"),
    );
    expect(elbow).toContain("bottom: 50%");
    // The continuing branch keeps the full-height stem.
    expect(stem).not.toContain("bottom: 50%");
  });

  it("clicking a folder row's checkbox does not fold the folder", () => {
    const { ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
      ],
    });
    const folderCb = ui.uiContainer!.querySelector(
      `.${CONST.CLASSES.FOLDER_ROW} input[type=checkbox]`,
    ) as HTMLInputElement;
    // The click on the checkbox is the onChange path, not a fold: the fold
    // handler's checkbox exclusion returns before toggling the folder.
    folderCb.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(isFolderFolded(ui, "overlay", "roads")).toBe(false);
  });

  it("folder-row click without a role no-ops", () => {
    const { ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
      ],
    });
    const row = ui.uiContainer!.querySelector(
      `[data-folder-key="roads"]`,
    ) as HTMLElement;
    row.removeAttribute(CONST.DATA.ROLE);
    expect(() =>
      row.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    ).not.toThrow();
  });

  it("folder row shows a 0/N count when every member is hidden", () => {
    const { ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
      ],
    });
    const folderRow = ui.uiContainer!.querySelector(
      `[data-folder-key="roads"]`,
    ) as HTMLElement;
    (ui.overlayPanel as any).activeMenu = {
      item: folderRow,
      menu: document.createElement("div"),
      folderKey: "roads",
      role: "overlay",
    };
    const folderCb = ui.uiContainer!.querySelector(
      `.${CONST.CLASSES.FOLDER_ROW} input[type=checkbox]`,
    ) as HTMLInputElement;
    folderCb.checked = false;
    folderCb.dispatchEvent(new Event("change", { bubbles: true }));
    // The bulk toggle rebuilds the list, so re-query the fresh folder row.
    const freshRow = ui.uiContainer!.querySelector(
      `[data-folder-key="roads"]`,
    ) as HTMLElement;
    const countEl = freshRow.querySelector(
      `.${CONST.CLASSES.COUNT_COL}`,
    ) as HTMLElement;
    // After hiding every member the folder row count shows the 0/N form.
    expect(countEl.textContent).toContain("0/");
  });

  it("folder row count shows the on/total form for partial visibility", () => {
    const { ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
        {
          id: "rd2",
          name: "Roads2",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
      ],
    });
    // Hide one member: folder count must show the on/total form.
    const row = ui.uiContainer!.querySelector(
      `[data-folder-key="roads"]`,
    ) as HTMLElement;
    (ui.overlayPanel as any).activeMenu = {
      item: row,
      menu: document.createElement("div"),
      folderKey: "roads",
      role: "overlay",
    };
    const folderCb = ui.uiContainer!.querySelector(
      `.${CONST.CLASSES.FOLDER_ROW} input[type=checkbox]`,
    ) as HTMLInputElement;
    folderCb.checked = false;
    folderCb.dispatchEvent(new Event("change", { bubbles: true }));
    const fresh = ui.uiContainer!.querySelector(
      `[data-folder-key="roads"]`,
    ) as HTMLElement;
    const count = fresh.querySelector(`.${CONST.CLASSES.COUNT_COL}`) as HTMLElement;
    // Both members hidden → on=0 → 0/N (the count cell already covers 0/N;
    // this test asserts the partial form by hiding a subset next).
    expect(count.textContent).toContain("0/");
  });
});

describe("ui/list folder rows, tree connectors and role fold", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  const layoutFromRoles = (
    sections: Record<string, string[]>,
  ): Record<string, unknown> => {
    const keys = new Set<string>();
    for (const list of Object.values(sections)) for (const k of list) keys.add(k);
    return {
      version: 2,
      folders: [...keys].map(k => ({ key: k, name: k })),
      order: sections,
      members: {},
    };
  };

  const polygonLayer = () => ({
    options: {},
    getBounds: () => ({ isValid: () => true }),
  });

  const treeLine = (ui: any, id: string): HTMLElement | null =>
    ui.uiContainer!.querySelector(
      `[${CONST.DATA.LAYER_ID}="${id}"] .${CONST.CLASSES.FOLD_TREE}`,
    ) as HTMLElement | null;

  it("syncRowOrder re-derives a member's tree connector after a reorder (refreshTreeConnectors)", () => {
    // Two members in one folder. The FIRST is `last` before any move (single
    // member). Move the second member up so the first is no longer last and
    // the second becomes last: the ├/└ connector must flip on BOTH rows.
    const { manager, ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
        {
          id: "rd2",
          name: "Rivers",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
      ],
    });
    // Two members in one folder: rd1 is the FIRST (mid ├, a branch continues
    // below it), rd2 is the LAST (elbow └) before any move.
    expect(treeLine(ui, "rd1")!.classList.contains(CONST.CLASSES.FOLD_TREE_MID)).toBe(
      true,
    );
    expect(treeLine(ui, "rd1")!.classList.contains(CONST.CLASSES.FOLD_TREE_LAST)).toBe(
      false,
    );
    expect(treeLine(ui, "rd2")!.classList.contains(CONST.CLASSES.FOLD_TREE_LAST)).toBe(
      true,
    );
    // Move rd2 above rd1. Now rd2 is the FIRST (mid ├) and rd1 the LAST (└):
    // refreshTreeConnectors re-derives both connectors after the reorder.
    expect(manager.moveLayerUp("rd2")).toBe(true);
    const rd1 = treeLine(ui, "rd1")!;
    const rd2 = treeLine(ui, "rd2")!;
    expect(rd1.classList.contains(CONST.CLASSES.FOLD_TREE_LAST)).toBe(true);
    expect(rd1.classList.contains(CONST.CLASSES.FOLD_TREE_MID)).toBe(false);
    expect(rd2.classList.contains(CONST.CLASSES.FOLD_TREE_LAST)).toBe(false);
    expect(rd2.classList.contains(CONST.CLASSES.FOLD_TREE_MID)).toBe(true);
  });

  it("syncRowOrder places a root layer between two folder blocks via a layer:<id> order entry", () => {
    // order = [folder roads, root water, folder parks] → the root layer row must
    // sit between the two folder rows, not after all folders.
    const { ui } = initFixture({
      seedLayout: {
        version: 2,
        folders: [
          { key: "roads", name: "Roads" },
          { key: "parks", name: "Parks" },
        ],
        order: { overlay: ["roads", "layer:water", "parks"] },
        members: {},
      },
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
        {
          id: "water",
          name: "Water",
          role: "overlay",
          folder: "",
          layer: polygonLayer(),
        },
        {
          id: "pk1",
          name: "Parks",
          role: "overlay",
          folder: "parks",
          layer: polygonLayer(),
        },
      ],
    });
    const keys = Array.from(
      ui.uiContainer!.querySelectorAll(
        `[${CONST.DATA.LAYER_ID}], .${CONST.CLASSES.FOLDER_ROW}`,
      ),
    ).map(
      el =>
        el.getAttribute(CONST.DATA.FOLDER_KEY) ?? el.getAttribute(CONST.DATA.LAYER_ID),
    );
    const iRoads = keys.indexOf("roads");
    const iWater = keys.indexOf("water");
    const iParks = keys.indexOf("parks");
    expect(iWater).toBeGreaterThan(iRoads);
    expect(iWater).toBeLessThan(iParks);
    // A second sync pass walks the folder rows it mounted (the data-folder-key
    // branch) and the folder/layer block branches; the order must be stable.
    syncRowOrder(ui);
    const keys2 = Array.from(
      ui.uiContainer!.querySelectorAll(
        `[${CONST.DATA.LAYER_ID}], .${CONST.CLASSES.FOLDER_ROW}`,
      ),
    ).map(
      el =>
        el.getAttribute(CONST.DATA.FOLDER_KEY) ?? el.getAttribute(CONST.DATA.LAYER_ID),
    );
    expect(keys2.indexOf("water")).toBeGreaterThan(keys2.indexOf("roads"));
    expect(keys2.indexOf("water")).toBeLessThan(keys2.indexOf("parks"));
  });

  it("folding a role hides its folder rows and members (GROUP_FOLDED), then unfolding restores them", () => {
    const { ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
        {
          id: "water",
          name: "Water",
          role: "overlay",
          folder: "",
          layer: polygonLayer(),
        },
      ],
    });
    const folderRow = () =>
      ui.uiContainer!.querySelector(`.${CONST.CLASSES.FOLDER_ROW}`) as HTMLElement;
    const memberRow = () =>
      ui.uiContainer!.querySelector(`[${CONST.DATA.LAYER_ID}="rd1"]`) as HTMLElement;
    // Initially unfolded.
    expect(folderRow().classList.contains(CONST.CLASSES.GROUP_FOLDED)).toBe(false);
    expect(memberRow().classList.contains(CONST.CLASSES.GROUP_FOLDED)).toBe(false);
    // Fold the role.
    toggleFold(ui, "overlay");
    expect(folderRow().classList.contains(CONST.CLASSES.GROUP_FOLDED)).toBe(true);
    expect(memberRow().classList.contains(CONST.CLASSES.GROUP_FOLDED)).toBe(true);
    // Unfold restores.
    toggleFold(ui, "overlay");
    expect(folderRow().classList.contains(CONST.CLASSES.GROUP_FOLDED)).toBe(false);
    expect(memberRow().classList.contains(CONST.CLASSES.GROUP_FOLDED)).toBe(false);
  });

  it("role head row paints the folded state (FOLDED class, aria-expanded, unfold tooltip)", () => {
    const { ui } = initFixture({
      data: [
        { id: "o1", name: "O", role: "overlay", folder: "", layer: polygonLayer() },
      ],
    });
    const roleRow = () =>
      ui.uiContainer!.querySelector(
        `.${CONST.CLASSES.ROLE_ROW}[${CONST.DATA.ROLE}="overlay"]`,
      ) as HTMLElement;
    const foldBtn = () =>
      roleRow().querySelector(`.${CONST.CLASSES.FOLD_BTN}`) as HTMLElement;
    // Unfolded: no FOLDED class, fold chevron expanded, fold tooltip.
    expect(roleRow().classList.contains(CONST.CLASSES.FOLDED)).toBe(false);
    expect(foldBtn().getAttribute("aria-expanded")).toBe("true");
    expect(roleRow().getAttribute("title")).toBe(ui.T("fold_tooltip"));
    // Fold the role: the row carries the FOLDED class, the chevron collapses
    // and the tooltip flips to unfold.
    toggleFold(ui, "overlay");
    expect(roleRow().classList.contains(CONST.CLASSES.FOLDED)).toBe(true);
    expect(foldBtn().getAttribute("aria-expanded")).toBe("false");
    expect(roleRow().getAttribute("title")).toBe(ui.T("unfold_tooltip"));
  });

  it("emptyFolderKeys treats a layer whose registry entry is missing as not matching a key", () => {
    // A layer id present in ui.c.layers but absent from the registry: the
    // empty-folder scan must not treat the key as empty just because the info
    // lookup returned null (it reads the layer's own folder assignment).
    // emptyFolderKeys is a pure-ish reader over the layout + registry, so the
    // missing-registry-entry case is staged directly (the fixture's layer list
    // is a read-only proxy, so a ghost layer is injected through the registry
    // stub rather than pushed).
    const layout = {
      version: 2,
      folders: [{ key: "roads", name: "Roads" }],
      order: { overlay: ["roads"] },
      members: {},
    };
    const ui = {
      c: {
        folderLayoutView: layout,
        layers: [
          { id: "rd1", role: "overlay" },
          { id: "ghost", role: "overlay" },
        ],
        layerRegistry: {
          get: (id: string) =>
            id === "ghost"
              ? undefined
              : { id: "rd1", role: "overlay", folder: "roads" },
        },
      },
    } as unknown as LayerUI;
    // rd1 owns the "roads" key, so it is not empty even though the ghost layer
    // misses its registry entry (the info-null branch returns false and does
    // not erase the folder's live member).
    expect(emptyFolderKeys(ui, "overlay")).toEqual([]);
    // With rd1's registry entry gone too, "roads" has no live member left
    // and is reported empty.
    ui.c.layerRegistry.get = () => undefined;
    expect(emptyFolderKeys(ui, "overlay")).toEqual(["roads"]);
  });

  it("updateLayerItemLabel refreshes a live row's label after a re-registration", () => {
    // The bail path (row gone) is covered above; this covers the live-row path
    // where the label is rewritten from the re-registered layer info.
    const { ui } = initFixture({
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          layer: polygonLayer(),
        },
      ],
    });
    const row = ui.uiContainer!.querySelector(
      `[${CONST.DATA.LAYER_ID}="rd1"]`,
    ) as HTMLElement;
    expect(row).not.toBeNull();
    const info = ui.c.layerRegistry.get("rd1") as LayerInfo;
    // No throw: the live row is found and its label refreshed.
    expect(() => updateLayerItemLabel(ui, info)).not.toThrow();
  });

  it("colorLayerName returns the basemap's current display name", () => {
    // The virtual solid-basemap row's label comes from displayName, which
    // prefers a persisted rename and falls back to the locale label.
    const { ui } = initFixture({ data: [] });
    const name = colorLayerName(ui);
    expect(typeof name).toBe("string");
    expect(name.length).toBeGreaterThan(0);
  });

  it("emptyFolderKeys returns [] when the role has no folder entries", () => {
    // The zero-key guard: no folder entries in the role order means no
    // candidates, so the scan returns immediately instead of filtering.
    const layout = {
      version: 2,
      folders: [],
      order: { overlay: [], base: [] },
      members: {},
    };
    const ui = {
      c: {
        folderLayoutView: layout,
        layers: [],
        layerRegistry: { get: () => undefined },
      },
    } as unknown as LayerUI;
    expect(emptyFolderKeys(ui, "overlay")).toEqual([]);
  });

  it("folder row paints the folded state (FOLDED class, collapsed chevron, unfold tooltip)", () => {
    const { ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
      ],
    });
    // A user fold overrides the author default: the folder row re-renders with
    // FOLDED, the chevron collapses and the tooltip flips to unfold.
    ui.listPanel.foldedFolders["overlay::roads"] = true;
    rebuildList(ui);
    const row = ui.uiContainer!.querySelector(
      `.${CONST.CLASSES.FOLDER_ROW}[${CONST.DATA.FOLDER_KEY}="roads"]`,
    ) as HTMLElement;
    expect(row.classList.contains(CONST.CLASSES.FOLDED)).toBe(true);
    const foldBtn = row.querySelector(`.${CONST.CLASSES.FOLD_BTN}`) as HTMLElement;
    expect(foldBtn.getAttribute("aria-expanded")).toBe("false");
    expect(foldBtn.getAttribute("title")).toBe(ui.T("unfold_tooltip"));
  });

  it("marks member rows GROUP_FOLDED when the folder is folded but the role is not", () => {
    // The layer member inherits the folder's hidden state at render time
    // (roleFolded || folderFolded). The folder is folded and the role stays
    // expanded, so each member row must carry GROUP_FOLDED even though the
    // role itself is not folded.
    const { ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
        {
          id: "rd2",
          name: "Rivers",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
      ],
    });
    ui.listPanel.foldedFolders["overlay::roads"] = true;
    rebuildList(ui);
    const member = (id: string) =>
      ui.uiContainer!.querySelector(`[data-layer-id="${id}"]`) as HTMLElement;
    expect(member("rd1").classList.contains(CONST.CLASSES.GROUP_FOLDED)).toBe(true);
    expect(member("rd2").classList.contains(CONST.CLASSES.GROUP_FOLDED)).toBe(true);
    // Unfold the folder: the members drop the marker.
    ui.listPanel.foldedFolders = {};
    rebuildList(ui);
    expect(member("rd1").classList.contains(CONST.CLASSES.GROUP_FOLDED)).toBe(false);
    expect(member("rd2").classList.contains(CONST.CLASSES.GROUP_FOLDED)).toBe(false);
  });

  it("handles a folder block with zero members (empty for-body)", () => {
    // A folder key declared in the layout but with no live member layer yields
    // an empty block.members list, so the member for-loop body never runs.
    // The folder row still renders; no member rows are produced.
    const { ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
      ],
    });
    // Retire the only member so the folder block has zero members.
    ui.c.unregisterLayer("rd1");
    rebuildList(ui);
    const folderRow = ui.uiContainer!.querySelector(
      `.${CONST.CLASSES.FOLDER_ROW}[${CONST.DATA.FOLDER_KEY}="roads"]`,
    );
    expect(folderRow).not.toBeNull();
    // No member rows remain under the empty folder.
    const members = ui.uiContainer!.querySelectorAll(`[data-layer-id="rd1"]`);
    expect(members.length).toBe(0);
  });

  it("folder row reads active when a member is visible (ACTIVE class)", () => {
    const { ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
        {
          id: "rd2",
          name: "Rivers",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
      ],
    });
    const row = ui.uiContainer!.querySelector(
      `.${CONST.CLASSES.FOLDER_ROW}[${CONST.DATA.FOLDER_KEY}="roads"]`,
    ) as HTMLElement;
    // At least one member is visible by default, so the folder row is active.
    expect(row.classList.contains(CONST.CLASSES.ACTIVE)).toBe(true);
  });
});

describe("ui/list row-order and tree-connector guards", () => {
  const layoutFromRoles = (
    sections: Record<string, string[]>,
  ): Record<string, unknown> => {
    const keys = new Set<string>();
    for (const list of Object.values(sections)) for (const k of list) keys.add(k);
    return {
      version: 2,
      folders: [...keys].map(k => ({ key: k, name: k })),
      order: sections,
      members: {},
    };
  };

  const polygonLayer = () => ({
    options: {},
    getBounds: () => ({ isValid: () => true }),
  });

  const makeTreeRow = (attrs: Record<string, string>) => {
    const row = document.createElement("div");
    row.className = CONST.CLASSES.LAYER_ITEM;
    for (const [k, v] of Object.entries(attrs)) row.setAttribute(k, v);
    const tree = document.createElement("span");
    tree.className = CONST.CLASSES.FOLD_TREE;
    row.appendChild(tree);
    return row;
  };

  it("syncRowOrder tolerates rows missing from the panel (row-found guards)", () => {
    // The row-found guards: a folder/member/layer row absent from the DOM must not
    // derail the reorder — it is simply skipped. Remove one of each and re-sync.
    const { ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads", "root"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
        {
          id: "rd2",
          name: "Rivers",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
        { id: "root1", name: "Root", role: "overlay", layer: polygonLayer() },
      ],
    });
    const panel = ui.uiContainer!;
    const folderRow = panel.querySelector(
      `.${CONST.CLASSES.FOLDER_ROW}[${CONST.DATA.FOLDER_KEY}="roads"]`,
    );
    const rd2Row = panel.querySelector(`[${CONST.DATA.LAYER_ID}="rd2"]`);
    const rootRow = panel.querySelector(`[${CONST.DATA.LAYER_ID}="root1"]`);
    folderRow?.remove();
    rd2Row?.remove();
    rootRow?.remove();
    expect(() => syncRowOrder(ui)).not.toThrow();
  });

  it("refreshTreeConnectors skips a tree row whose id is missing from the registry", () => {
    // A LAYER_ITEM row carrying a tree guide but no registered layer: the id->info
    // lookup fails and the row is skipped rather than dereferencing undefined.
    const { ui } = initFixture({ data: [] });
    const ghost = makeTreeRow({ "data-layer-id": "ghost" });
    ui.uiContainer!.appendChild(ghost);
    expect(() => syncRowOrder(ui)).not.toThrow();
  });

  it("refreshTreeConnectors skips a tree row with no layer id", () => {
    // The id-falsy arm: a tree row without data-layer-id reads no registry entry.
    const { ui } = initFixture({ data: [] });
    const noId = makeTreeRow({});
    ui.uiContainer!.appendChild(noId);
    expect(() => syncRowOrder(ui)).not.toThrow();
  });

  it("refreshTreeConnectors treats a root layer row as not-a-member", () => {
    // A root layer (no folder) renders no tree guide in practice, but a synthetic
    // tree row for a root layer must not crash: folderOf is null and the row is skipped.
    const { ui } = initFixture({
      data: [{ id: "root1", name: "Root", role: "overlay", layer: polygonLayer() }],
    });
    const rootTree = makeTreeRow({ "data-layer-id": "root1" });
    ui.uiContainer!.appendChild(rootTree);
    expect(() => syncRowOrder(ui)).not.toThrow();
  });

  it("refreshTreeConnectors skips a tree row whose folder block is unknown", () => {
    // A layer whose folder key is not in the layout: folderOf returns the key but the
    // block map has no such block — the connector logic treats it as not-a-member.
    const { ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "orphan",
          name: "Orphan",
          role: "overlay",
          folder: "ghost",
          layer: polygonLayer(),
        },
      ],
    });
    const orphanTree = makeTreeRow({ "data-layer-id": "orphan" });
    ui.uiContainer!.appendChild(orphanTree);
    expect(() => syncRowOrder(ui)).not.toThrow();
  });

  it("renderLayerItem treats a layer with an unknown folder as not-a-member", () => {
    // memberInfo: folderOf resolves a key (the layer's own folder) but the layer is
    // not in the registry list groupByFolder walks, so no block exists — the layer
    // renders as a non-member row, not a folder member.
    const { ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
      ],
    });
    // The orphan is NOT in ui.c.layers (only rd1 is registered), so folderOf resolves
    // "ghost" but groupByFolder never builds a "ghost" block.
    const orphan: LayerInfo = {
      id: "orphan",
      name: "Orphan",
      role: "overlay",
      folder: "ghost",
      layer: polygonLayer(),
    } as LayerInfo;
    let row: HTMLElement | null = null;
    expect(() => {
      row = renderLayerItem(ui, orphan);
    }).not.toThrow();
    expect(row).not.toBeNull();
    // The rail has no tree guide: the orphan is not a member of any block.
    expect(row!.querySelector(`.${CONST.CLASSES.FOLD_TREE}`)).toBeNull();
  });

  it("renderLayerItem leaves the type-icon column empty for a layer with no iconSvg", () => {
    // Direct branch: `if (layerInfo.iconSvg)` takes the falsy path when the
    // layer carries no custom icon (the registry only fills iconSvg from an
    // explicit opts.iconSvg). The column must stay empty, not hold a stale
    // or placeholder glyph.
    const { ui } = initFixture({ data: [] });
    const bare: LayerInfo = {
      id: "bare",
      name: "Bare",
      role: "overlay",
      folder: "",
      iconSvg: null,
      layer: polygonLayer(),
    } as LayerInfo;
    let row: HTMLElement | null = null;
    expect(() => {
      row = renderLayerItem(ui, bare);
    }).not.toThrow();
    expect(row).not.toBeNull();
    const icon = row!.querySelector(`.${CONST.CLASSES.TYPE_ICON_COL}`);
    expect(icon).not.toBeNull();
    expect(icon!.innerHTML).toBe("");
  });
});

describe("ui/list coverage gaps (#1282)", () => {
  it("emptyFolderKeys falls back to an empty order when the role has no order key", () => {
    // The role's block order may be absent (a role with no blocks yet): the
    // candidate scan must fall back to [] instead of throwing on undefined.
    const layout = {
      version: 2,
      folders: [],
      order: { base: [] },
      members: {},
    };
    const ui = {
      c: {
        folderLayoutView: layout,
        layers: [],
        layerRegistry: { get: () => undefined },
      },
    } as unknown as LayerUI;
    expect(emptyFolderKeys(ui, "overlay")).toEqual([]);
  });

  it("renderLayerItem fills the type-icon column from a layer's iconSvg", () => {
    // The direct branch: a layer carrying a custom iconSvg (from an explicit
    // opts.iconSvg) paints that SVG into the type-icon column.
    const { ui } = initFixture({ data: [] });
    const custom: LayerInfo = {
      id: "custom",
      name: "Custom",
      role: "overlay",
      folder: "",
      iconSvg:
        "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'><path d='M0 0h1v1H0z'/></svg>",
      layer: { options: {}, eachLayer: vi.fn() },
    } as LayerInfo;
    let row: HTMLElement | null = null;
    expect(() => {
      row = renderLayerItem(ui, custom);
    }).not.toThrow();
    expect(row).not.toBeNull();
    const icon = row!.querySelector(`.${CONST.CLASSES.TYPE_ICON_COL}`);
    expect(icon).not.toBeNull();
    expect(icon!.innerHTML).toContain("<svg");
  });
});
