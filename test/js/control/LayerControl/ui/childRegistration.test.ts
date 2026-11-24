// LayerControl UI — child-layer registration (stage 2).
//
// An expanded group container used to render its direct children as pure DOM
// rows with no LayerInfo, so the style and filter panels could not resolve
// them. This suite pins the stage-2 contract: every rendered child row owns a
// registry-only LayerInfo (child: true, parentId), the entry exists iff the row
// is rendered, and the style / filter projections answer for it.
import { attachedPanel, initFixture, installLeafletGlobals } from "./fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#control/LayerControl/const.js";
import type { LayerController } from "#control/LayerControl/controller.js";
import type { LayerUI } from "#control/LayerControl/ui/index.js";
import { INTENT } from "#control/LayerControl/ui/intent.js";
import {
  childRowId,
  focusChildLayer,
} from "#control/LayerControl/ui/listPanel/groupExpand.js";
import { styleCapability } from "#control/LayerControl/ui/style/styleCapability.js";

describe("child layer registration", () => {
  let manager: LayerController;
  let ui: LayerUI;
  let map: any;

  beforeEach(() => {
    ({ manager, ui, map } = initFixture());
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    // The FeatureGroup class is a test-local addition to the mock L (see
    // makeGroup); drop it so a later file in the same worker sees the fixture's
    // own shape-fallback world again.
    delete (window.L as unknown as { FeatureGroup?: unknown }).FeatureGroup;
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  /** A polygon child leaf: areal rings + a real setStyle + optional GeoJSON
   *  properties (the filter builder reads feature.properties). */
  const makeChild = (props?: Record<string, unknown>) => {
    const leaf = new window.L.Polygon();
    leaf.setStyle = vi.fn();
    leaf.feature = props
      ? { type: "Feature", geometry: { type: "Polygon" }, properties: props }
      : undefined;
    return leaf;
  };

  const makeGroup = (children: unknown[]) => {
    // The fixture's mock L has no FeatureGroup class, so isGroupLayer falls
    // back to the GeoJSON shape ("every child carries a feature envelope") —
    // which would misread a group whose children carry .feature as a data
    // layer. Register the canonical class for these groups: a real
    // L.FeatureGroup is a user-facing group whatever its children carry.
    const FeatureGroup =
      typeof (window.L as unknown as { FeatureGroup?: unknown }).FeatureGroup ===
      "function"
        ? (window.L as unknown as { FeatureGroup: new () => object }).FeatureGroup
        : ((window.L as unknown as { FeatureGroup: new () => object }).FeatureGroup =
            class FeatureGroup {});
    const group: any = {
      options: {},
      clearLayers: vi.fn(),
      getBounds: vi.fn(),
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
      getLayers: vi.fn(() => children),
      _layers: {},
    };
    Object.setPrototypeOf(group, FeatureGroup.prototype);
    group.eachLayer = vi.fn((fn: (child: unknown) => void) => {
      for (const child of children) fn(child);
    });
    return group;
  };

  const registerGroup = (children: unknown[]) => {
    const group = makeGroup(children);
    manager.registerLayer({
      id: "fg",
      name: "Group",
      role: "overlay",
      layer: group as never,
    });
    vi.useFakeTimers();
    vi.advanceTimersByTime(200);
    vi.useRealTimers();
    return group;
  };

  const groupRow = (): HTMLElement =>
    attachedPanel(ui).querySelector(
      `${CONST.SEL.LAYER_ITEM}[data-layer-id="fg"]`,
    ) as HTMLElement;

  const expandGroup = (): void => {
    groupRow().querySelector<HTMLElement>(`.${CONST.CLASSES.FOLD_BTN}`)!.click();
  };

  const childRows = (): HTMLElement[] =>
    Array.from(
      attachedPanel(ui).querySelectorAll<HTMLElement>(
        `${CONST.SEL.LAYER_ITEM}[data-layer-id^="fg::"]`,
      ),
    );

  it("registers each rendered child row as a registry-only LayerInfo", () => {
    installLeafletGlobals();
    const a = makeChild({ a: 1 });
    const b = makeChild({ b: 2 });
    registerGroup([a, b]);
    expandGroup();

    expect(childRows().length).toBe(2);
    for (const child of [a, b]) {
      const info = manager.layerRegistry.get(childRowId("fg", child));
      expect(info).toBeDefined();
      expect(info!.child).toBe(true);
      expect(info!.parentId).toBe("fg");
      expect(info!.layer).toBe(child);
      expect(info!.role).toBe("overlay");
    }
  });

  it("keeps child entries out of the ordered list and the role count", () => {
    installLeafletGlobals();
    registerGroup([makeChild({ a: 1 }), makeChild({ b: 2 })]);
    const before = manager.layers.length;
    expandGroup();

    expect(manager.layers.length).toBe(before);
    expect(manager.layers.some(entry => entry.child)).toBe(false);
    // The group row's count stays its direct-child count.
    expect(groupRow().querySelector(CONST.SEL.COUNT_COL)?.textContent).toBe("2");
  });

  it("unregisters the children when the group collapses", () => {
    installLeafletGlobals();
    const a = makeChild();
    registerGroup([a]);
    expandGroup();
    const id = childRowId("fg", a);
    expect(manager.layerRegistry.get(id)).toBeDefined();

    groupRow().querySelector<HTMLElement>(`.${CONST.CLASSES.FOLD_BTN}`)!.click();

    expect(childRows().length).toBe(0);
    expect(manager.layerRegistry.get(id)).toBeUndefined();
  });

  it("re-registers the entries after a panel rebuild (entry iff row)", () => {
    installLeafletGlobals();
    const a = makeChild();
    registerGroup([a]);
    expandGroup();
    const id = childRowId("fg", a);

    ui.rebuildAfterLayoutChange();

    expect(childRows().length).toBe(1);
    expect(manager.layerRegistry.get(id)).toBeDefined();
  });

  it("removes the child rows when a group is unregistered", () => {
    installLeafletGlobals();
    const a = makeChild();
    const b = makeChild();
    registerGroup([a, b]);
    expandGroup();
    expect(childRows().length).toBe(2);

    manager.unregisterLayer("fg");

    expect(childRows().length).toBe(0);
    expect(attachedPanel(ui).querySelector('[data-layer-id="fg"]')).toBeNull();
  });

  it("removes the child rows and entries when a group is deleted", () => {
    installLeafletGlobals();
    const a = makeChild();
    registerGroup([a]);
    expandGroup();
    const id = childRowId("fg", a);
    expect(manager.layerRegistry.get(id)).toBeDefined();

    expect(manager.deleteLayer("fg")).toBe(true);

    expect(childRows().length).toBe(0);
    expect(manager.layerRegistry.get(id)).toBeUndefined();
  });

  it("cascades a parent unregister to its child entries", () => {
    installLeafletGlobals();
    const a = makeChild();
    const b = makeChild();
    registerGroup([a, b]);
    expandGroup();
    const ids = [childRowId("fg", a), childRowId("fg", b)];
    for (const id of ids) expect(manager.layerRegistry.get(id)).toBeDefined();

    manager.unregisterLayer("fg");

    for (const id of ids) expect(manager.layerRegistry.get(id)).toBeUndefined();
  });

  it("answers the style projection with the child's leaf-level dims", () => {
    installLeafletGlobals();
    const child = makeChild({ a: 1 });
    registerGroup([child]);
    expandGroup();

    const cap = styleCapability(ui, childRowId("fg", child));
    expect(cap.geometry).toBe("polygon");
    // Leaf-level axes are honest: the style panel writes them through the
    // child's own leaves.
    expect(cap.dims.fill).toBe(true);
    expect(cap.dims.border).toBe(true);
    // Pane-level axes are not: the child paints in the parent group's pane.
    expect(cap.dims.opacity).toBe(false);
    expect(cap.dims.zoomRange).toBe(false);
  });

  it("declares the generic filter capability on the child entry", () => {
    installLeafletGlobals();
    const child = makeChild({ score: 7 });
    registerGroup([child]);
    expandGroup();

    const info = manager.layerRegistry.get(childRowId("fg", child))!;
    expect(typeof info.filterProvider).toBe("function");
    expect(typeof info.filterSetter).toBe("function");
    expect(manager.hasFilterableFields(info.id)).toBe(true);
    const model = info.filterProvider!();
    expect(model).not.toBeNull();
    expect(model!.dimensions.map(d => d.field)).toContain("score");
  });

  it("repaints child rows when the group row is toggled off", () => {
    installLeafletGlobals();
    const a = makeChild();
    const b = makeChild();
    const group = registerGroup([a, b]);
    expandGroup();
    // The group's own checkbox drives map membership through the projection;
    // make the map reflect that so the child rows read a real fact.
    map.hasLayer = vi.fn((layer: unknown) => layer === group);

    const groupBox = groupRow().querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    groupBox.checked = false;
    groupBox.dispatchEvent(new Event("change", { bubbles: true }));

    const boxes = childRows().map(
      row => (row.querySelector('input[type="checkbox"]') as HTMLInputElement).checked,
    );
    expect(boxes).toEqual([false, false]);
    expect(childRows()[0].querySelector(CONST.SEL.COUNT_COL)?.textContent).toBe("0/1");
  });

  it("repaints child rows when the role toggle-all hides the group", () => {
    installLeafletGlobals();
    const a = makeChild();
    const group = registerGroup([a]);
    expandGroup();
    map.hasLayer = vi.fn((layer: unknown) => layer === group);

    const allBox = attachedPanel(ui).querySelector(
      `.${CONST.CLASSES.TOGGLE_ALL}[data-role="overlay"] input[type="checkbox"]`,
    ) as HTMLInputElement;
    allBox.checked = false;
    allBox.dispatchEvent(new Event("change", { bubbles: true }));

    const childBox = childRows()[0].querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(childBox.checked).toBe(false);
  });

  it("keeps a focused child visible by marking the pane it paints through", () => {
    installLeafletGlobals();
    const child = makeChild();
    const paneEl = document.createElement("div");
    paneEl.className = "foliplus-layer-pane";
    map.getPane = vi.fn((name: string) =>
      name === "child-pane" ? paneEl : document.createElement("div"),
    );
    registerGroup([child]);
    expandGroup();
    // A real focusable child carries bounds; the fixture's Polygon has none.
    child.getBounds = () => ({
      isValid: () => true,
      getSouthWest: () => ({ lat: 30, lng: 100 }),
      getNorthEast: () => ({ lat: 40, lng: 110 }),
      getCenter: () => ({ lat: 35, lng: 105 }),
    });
    // The child declares its own pane (a third-party layer can). Focus must
    // mark it, or the focus-hide CSS swallows the very layer being focused.
    child.options.pane = "child-pane";
    expect(ui.c.getLayerPanes(child)).toContain("child-pane");

    focusChildLayer(ui, "fg", childRowId("fg", child));

    expect(paneEl.classList.contains(CONST.CLASSES.FOCUS_PANE)).toBe(true);
  });

  it("refreshes a child row's filtered count without touching its checkbox", () => {
    installLeafletGlobals();
    const child = makeChild({ score: 7 });
    registerGroup([child]);
    expandGroup();
    const id = childRowId("fg", child);
    // Hide the child through its own checkbox: that is a map fact, not a
    // registry intent (child entries have none).
    map.hasLayer = vi.fn((layer: unknown) => layer !== child);
    const row = childRows()[0];
    const box = row.querySelector('input[type="checkbox"]') as HTMLInputElement;
    box.checked = false;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    expect(box.checked).toBe(false);

    // Filter the child so nothing matches: the kept count is 0 of 1.
    manager.layerRegistry.get(id)!.filterSetter!({
      kind: "atom",
      field: "score",
      op: "between",
      range: [0, 1],
    });

    const countCol = row.querySelector(CONST.SEL.COUNT_COL) as HTMLElement;
    expect(countCol.classList.contains(CONST.CLASSES.COUNT_FILTERED)).toBe(true);
    expect(countCol.querySelector(`.${CONST.CLASSES.COUNT_VALUE}`)?.textContent).toBe(
      "0",
    );
    // The filter repaint must not resurrect the checkbox from an intent the
    // child never had.
    expect(
      (row.querySelector('input[type="checkbox"]') as HTMLInputElement).checked,
    ).toBe(false);
  });

  it("does not persist a child's style intent under its unstable stamp id", () => {
    installLeafletGlobals();
    const child = makeChild();
    registerGroup([child]);
    expandGroup();
    const childId = childRowId("fg", child);

    // What a style panel write does: one intent keyed by the row id.
    ui.intentStore.setRaw(childId, INTENT.FILL_COLOR, "#112233");
    // A normal registry layer must still persist — the strip is child-only.
    ui.intentStore.setRaw("overlay1", INTENT.FILL_COLOR, "#445566");
    ui.saveState();
    manager.persistence.flushAll();
    const record = JSON.parse(
      window.localStorage.getItem(CONST.STORAGE.KEY) as string,
    ) as { layers?: Record<string, unknown> };
    const ids = Object.keys(record.layers ?? {});

    expect(ids).not.toContain(childId);
    expect(ids).toContain("overlay1");
  });

  it("offers style and filter in the child row's ⋮ menu", () => {
    installLeafletGlobals();
    const child = makeChild({ score: 7 });
    registerGroup([child]);
    expandGroup();

    const row = childRows()[0];
    ui.openMoreMenu(row);

    const menu = attachedPanel(ui).querySelector(`.${CONST.CLASSES.MORE_MENU}`);
    expect(menu).not.toBeNull();
    const styleEntry = menu!.querySelector(
      `[data-action="${CONST.ACTION.STYLE_LAYER}"]`,
    );
    const filterEntry = menu!.querySelector(
      `[data-action="${CONST.ACTION.FILTER_LAYER}"]`,
    );
    expect(styleEntry).not.toBeNull();
    expect(styleEntry!.getAttribute("aria-disabled")).toBe("false");
    expect(filterEntry).not.toBeNull();
    expect(filterEntry!.getAttribute("aria-disabled")).toBe("false");
  });

  it("renders the style panel against the child's own leaves", () => {
    installLeafletGlobals();
    const child = makeChild({ score: 7 });
    registerGroup([child]);
    expandGroup();

    ui.openStylePanel(childRowId("fg", child));

    const row = childRows()[0];
    expect(row.querySelector(`.${CONST.CLASSES.STYLE_PANEL}`)).not.toBeNull();
    // A polygon child has an honest fill row; the pane-level rows (opacity /
    // zoom range) are absent because the child owns no pane.
    expect(row.querySelector(`.${CONST.CLASSES.STYLE_FILL_ROW}`)).not.toBeNull();
  });

  it("renders the filter panel with the child's own fields", () => {
    installLeafletGlobals();
    const child = makeChild({ score: 7 });
    registerGroup([child]);
    expandGroup();

    const row = childRows()[0];
    ui.openFilterPanel(row);

    expect(row.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`)).not.toBeNull();
  });
});
