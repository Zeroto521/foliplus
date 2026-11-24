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
import { childRowId } from "#control/LayerControl/ui/listPanel/groupExpand.js";
import { styleCapability } from "#control/LayerControl/ui/style/styleCapability.js";

describe("child layer registration", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
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
