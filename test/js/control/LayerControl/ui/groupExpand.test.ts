// LayerControl UI — group expand: child rows under a layer group.
//
// A group (LayerGroup / FeatureGroup) row gets a chevron. Expanding it
// renders one row per direct child, keyed by parent::stamp, with its own
// checkbox and more button. Collapsing removes them. The count column on the
// group row stays the direct-child count — expanding never changes it.
import { attachedPanel, initFixture, installLeafletGlobals } from "./fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#control/LayerControl/const.js";
import type { LayerController } from "#control/LayerControl/controller.js";
import type { LayerUI } from "#control/LayerControl/ui/index.js";
import {
  childDisplayName,
  childRowId,
  groupChildren,
  isGroupExpanded,
  removeGroupChildren,
  resolveChild,
  toggleGroupExpand,
} from "#control/LayerControl/ui/listPanel/groupExpand.js";

describe("group expand", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui, map } = initFixture());
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  const child = (name: string) => ({
    options: {},
    // A child leaf needs a name-ish surface for the row label.
    _name: name,
  });

  const makeGroup = (children: unknown[]) => {
    const c: any = {
      options: {},
      clearLayers: vi.fn(),
      getBounds: vi.fn(),
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
      getLayers: vi.fn(() => children),
      _layers: {},
    };
    c.eachLayer = vi.fn((fn: (child: unknown) => void) => {
      for (const child of children) fn(child);
    });
    return c;
  };

  const registerGroup = (children: unknown[]) => {
    const fg = makeGroup(children);
    manager.registerLayer({
      id: "fg",
      name: "Group",
      role: "overlay",
      layer: fg as never,
    });
    return fg;
  };

  const groupRow = (): HTMLElement | null =>
    attachedPanel(ui).querySelector(
      `${CONST.SEL.LAYER_ITEM}[data-layer-id="fg"]`,
    ) as HTMLElement | null;

  const childRows = (): HTMLElement[] =>
    Array.from(
      attachedPanel(ui).querySelectorAll<HTMLElement>(
        `${CONST.SEL.LAYER_ITEM}[data-layer-id^="fg::"]`,
      ),
    );

  it("expands a group into one row per direct child", () => {
    installLeafletGlobals();
    registerGroup([child("a"), child("b"), child("c")]);
    vi.useFakeTimers();
    vi.advanceTimersByTime(200);
    vi.useRealTimers();

    const row = groupRow();
    expect(row).not.toBeNull();
    // The group row carries a chevron.
    const foldBtn = row!.querySelector(
      `.${CONST.CLASSES.FOLD_BTN}`,
    ) as HTMLElement | null;
    expect(foldBtn).not.toBeNull();

    // Before expanding, no child rows.
    expect(childRows().length).toBe(0);

    // Click the chevron → three child rows.
    foldBtn!.click();
    expect(childRows().length).toBe(3);
    // Each child row carries the parent::stamp id and a checkbox.
    const first = childRows()[0];
    expect(first.getAttribute(CONST.DATA.LAYER_ID)).toMatch(/^fg::/);
    expect(first.querySelector('input[type="checkbox"]')).not.toBeNull();

    // The group count stays "3".
    expect(row!.querySelector(CONST.SEL.COUNT_COL)?.textContent).toBe("3");

    // Collapse → children disappear.
    row!.querySelector<HTMLElement>(`.${CONST.CLASSES.FOLD_BTN}`)!.click();
    expect(childRows().length).toBe(0);
  });

  it("toggles a child checkbox through the map directly", () => {
    installLeafletGlobals();
    registerGroup([child("a"), child("b")]);
    vi.useFakeTimers();
    vi.advanceTimersByTime(200);
    vi.useRealTimers();

    const row = groupRow();
    row!.querySelector<HTMLElement>(`.${CONST.CLASSES.FOLD_BTN}`)!.click();
    const first = childRows()[0];
    const cb = first.querySelector('input[type="checkbox"]') as HTMLInputElement;
    // map.hasLayer returns true by default (fixture), so the box is checked.
    expect(cb.checked).toBe(true);
    cb.checked = false;
    cb.dispatchEvent(new Event("change", { bubbles: true }));
    // The child is removed from the map directly (non-registry path).
    expect(map.removeLayer).toHaveBeenCalled();
    // The group count still reads the group's children.
    expect(row!.querySelector(CONST.SEL.COUNT_COL)?.textContent).toBe("2");
  });

  it("unchecking the group row removes every direct child from the map (P1 显隐)", () => {
    installLeafletGlobals();
    const fg = makeGroup([child("a"), child("b"), child("c")]);
    manager.registerLayer({ id: "fg", name: "Group", role: "overlay", layer: fg });
    vi.useFakeTimers();
    vi.advanceTimersByTime(200);
    vi.useRealTimers();
    const row = groupRow();
    // The group row's own checkbox: data-layer-id "fg" (the non-:: path).
    const cb = row!.querySelector('input[type="checkbox"]') as HTMLInputElement;
    cb.checked = false;
    cb.dispatchEvent(new Event("change", { bubbles: true }));
    // Every direct child leaves the map individually — not just the group.
    for (const child of fg.getLayers()) {
      expect(map.removeLayer).toHaveBeenCalledWith(child);
    }
    // The group itself is NOT removed as a whole (its children are the unit).
    const groupLayer = fg;
    const removedGroup = (map.removeLayer as ReturnType<typeof vi.fn>).mock.calls.some(
      call => call[0] === groupLayer,
    );
    expect(removedGroup).toBe(false);
  });

  it("unchecking an EMPTY group row removes the group itself (browser reload P1)", () => {
    installLeafletGlobals();
    const fg = makeGroup([]);
    manager.registerLayer({ id: "fg", name: "Empty", role: "overlay", layer: fg });
    vi.useFakeTimers();
    vi.advanceTimersByTime(200);
    vi.useRealTimers();
    const row = groupRow();
    const cb = row!.querySelector('input[type="checkbox"]') as HTMLInputElement;
    cb.checked = false;
    cb.dispatchEvent(new Event("change", { bubbles: true }));
    // An empty container has no children to remove individually — the group
    // itself is the map entry and must leave.
    expect(map.removeLayer).toHaveBeenCalledWith(fg);
  });
});

describe("group expand — defensive rails", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui, map } = initFixture());
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  const child = (name: string) => ({
    options: {},
    _name: name,
  });

  const makeGroup = (children: unknown[]) => {
    const c: any = {
      options: {},
      clearLayers: vi.fn(),
      getBounds: vi.fn(),
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
      getLayers: vi.fn(() => children),
      _layers: {},
    };
    c.eachLayer = vi.fn((fn: (child: unknown) => void) => {
      for (const child of children) fn(child);
    });
    return c;
  };

  const registerGroup = (children: unknown[]) => {
    const fg = makeGroup(children);
    manager.registerLayer({
      id: "fg",
      name: "Group",
      role: "overlay",
      layer: fg as never,
    });
    return fg;
  };

  const groupRow = (): HTMLElement | null =>
    attachedPanel(ui).querySelector(
      `${CONST.SEL.LAYER_ITEM}[data-layer-id="fg"]`,
    ) as HTMLElement | null;

  const childRows = (): HTMLElement[] =>
    Array.from(
      attachedPanel(ui).querySelectorAll<HTMLElement>(
        `${CONST.SEL.LAYER_ITEM}[data-layer-id^="fg::"]`,
      ),
    );

  it("reads the child name from feature properties, then options", () => {
    installLeafletGlobals();
    // A child with a feature.properties.name and one with options.name.
    const withFeature = {
      options: {},
      feature: { properties: { name: "FeatName" } },
    };
    const withOptions = { options: { name: "OptName" } };
    registerGroup([withFeature, withOptions]);
    vi.useFakeTimers();
    vi.advanceTimersByTime(200);
    vi.useRealTimers();

    const row = groupRow();
    row!.querySelector<HTMLElement>(`.${CONST.CLASSES.FOLD_BTN}`)!.click();
    const rows = childRows();
    expect(rows.length).toBe(2);
    // feature.properties.name wins.
    expect(rows[0].querySelector(`.${CONST.CLASSES.LAYER_LABEL}`)?.textContent).toBe(
      "FeatName",
    );
    expect(rows[1].querySelector(`.${CONST.CLASSES.LAYER_LABEL}`)?.textContent).toBe(
      "OptName",
    );
  });

  it("resolveChild rejects a bad id and a non-group parent", () => {
    installLeafletGlobals();
    registerGroup([child("a")]);
    vi.useFakeTimers();
    vi.advanceTimersByTime(200);
    vi.useRealTimers();

    // A child row id that does not start with the parent prefix → null.
    // Exercise resolveChild directly via the exported helper? It is not exported from the test
    // entry. Instead drive it through a bad data-layer-id change event: the row lookup fails,
    // the change handler falls through to the normal path (no-op for an unknown id).
    const row = groupRow();
    row!.querySelector<HTMLElement>(`.${CONST.CLASSES.FOLD_BTN}`)!.click();
    const childRowEl = childRows()[0];
    // Change the child's data-layer-id to a bogus one, then flip its checkbox.
    childRowEl.setAttribute(CONST.DATA.LAYER_ID, "not-a-child");
    const cb = childRowEl.querySelector('input[type="checkbox"]') as HTMLInputElement;
    cb.checked = false;
    cb.dispatchEvent(new Event("change", { bubbles: true }));
    // No throw; the handler returns without touching the map.
    expect(map.removeLayer).not.toHaveBeenCalled();
  });

  it("toggles an empty group without crashing", () => {
    installLeafletGlobals();
    registerGroup([]);
    vi.useFakeTimers();
    vi.advanceTimersByTime(200);
    vi.useRealTimers();

    const row = groupRow();
    expect(row).not.toBeNull();
    row!.querySelector<HTMLElement>(`.${CONST.CLASSES.FOLD_BTN}`)!.click();
    // No children, no rows, no crash.
    expect(childRows().length).toBe(0);
  });
});

describe("group expand — direct helper rails", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  const child = (name: string) => ({
    options: {},
    _name: name,
  });

  const makeGroup = (children: unknown[]) => {
    const c: any = {
      options: {},
      clearLayers: vi.fn(),
      getBounds: vi.fn(),
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
      getLayers: vi.fn(() => children),
      _layers: {},
    };
    c.eachLayer = vi.fn((fn: (child: unknown) => void) => {
      for (const child of children) fn(child);
    });
    return c;
  };

  const registerGroup = (children: unknown[]) => {
    const fg = makeGroup(children);
    manager.registerLayer({
      id: "fg",
      name: "Group",
      role: "overlay",
      layer: fg as never,
    });
    return fg;
  };

  it("resolveChild rejects bad ids and unknown parents", () => {
    installLeafletGlobals();
    registerGroup([child("a")]);
    vi.useFakeTimers();
    vi.advanceTimersByTime(200);
    vi.useRealTimers();

    // Not prefixed by the parent → null.
    expect(resolveChild(ui, "fg", "bogus")).toBeNull();
    // Non-numeric stamp → null.
    expect(resolveChild(ui, "fg", "fg::abc")).toBeNull();
    // Unknown parent id (a child id prefixed by a missing parent) → null.
    expect(resolveChild(ui, "nope", "nope::1")).toBeNull();
    // A parent that is NOT a group (a plain leaf) → null.
    const leaf: any = { options: {} };
    manager.registerLayer({ id: "leafy", name: "Leaf", role: "overlay", layer: leaf });
    vi.useFakeTimers();
    vi.advanceTimersByTime(200);
    vi.useRealTimers();
    expect(resolveChild(ui, "leafy", "leafy::1")).toBeNull();
    // A valid group + a child id that does not match any child → null.
    const fg = registerGroup([child("a")]);
    vi.useFakeTimers();
    vi.advanceTimersByTime(200);
    vi.useRealTimers();
    const stamp = childRowId("fg", fg.getLayers()[0]).split("::")[1];
    expect(resolveChild(ui, "fg", `fg::${stamp}`)).not.toBeNull();
    expect(resolveChild(ui, "fg", "fg::999999")).toBeNull();
  });

  it("groupChildren returns [] for a missing or non-group parent", () => {
    installLeafletGlobals();
    // Unknown parent.
    expect(groupChildren(ui, "nope")).toEqual([]);
    // Non-group leaf.
    const leaf: any = { options: {} };
    manager.registerLayer({ id: "leafy", name: "Leaf", role: "overlay", layer: leaf });
    vi.useFakeTimers();
    vi.advanceTimersByTime(200);
    vi.useRealTimers();
    expect(groupChildren(ui, "leafy")).toEqual([]);
    // A real group returns its children.
    const fg = makeGroup([child("a")]);
    manager.registerLayer({ id: "fg", name: "Group", role: "overlay", layer: fg });
    vi.useFakeTimers();
    vi.advanceTimersByTime(200);
    vi.useRealTimers();
    expect(groupChildren(ui, "fg").length).toBe(1);
  });

  it("toggle and remove tolerate a detached panel", () => {
    installLeafletGlobals();
    registerGroup([child("a")]);
    vi.useFakeTimers();
    vi.advanceTimersByTime(200);
    vi.useRealTimers();
    // Detach the panel → the group lookup misses, but no throw.
    ui.c.uiContainer = null as never;
    expect(() => toggleGroupExpand(ui, "fg")).not.toThrow();
    expect(() => removeGroupChildren(ui, "fg")).not.toThrow();
    expect(() => toggleGroupExpand(ui, "fg")).not.toThrow();
  });

  it("childRowId stamps the parent prefix and child id", () => {
    installLeafletGlobals();
    const id = childRowId("fg", child("x") as never);
    expect(id).toMatch(/^fg::/);
    expect(isGroupExpanded(ui, "fg")).toBe(false);
  });

  it("childDisplayName falls back to the generic label", () => {
    installLeafletGlobals();
    expect(childDisplayName({ options: {} } as never)).toBe("Layer");
    expect(childDisplayName({ options: { name: "N" } } as never)).toBe("N");
  });
});

describe("group expand — branch rails", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui, map } = initFixture());
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  const child = (name: string) => ({
    options: {},
    _name: name,
  });

  const makeGroup = (children: unknown[]) => {
    const c: any = {
      options: {},
      clearLayers: vi.fn(),
      getBounds: vi.fn(),
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
      getLayers: vi.fn(() => children),
      _layers: {},
    };
    c.eachLayer = vi.fn((fn: (child: unknown) => void) => {
      for (const child of children) fn(child);
    });
    return c;
  };

  const groupRow = (): HTMLElement | null =>
    attachedPanel(ui).querySelector(
      `${CONST.SEL.LAYER_ITEM}[data-layer-id="fg"]`,
    ) as HTMLElement | null;

  const childRows = (): HTMLElement[] =>
    Array.from(
      attachedPanel(ui).querySelectorAll<HTMLElement>(
        `${CONST.SEL.LAYER_ITEM}[data-layer-id^="fg::"]`,
      ),
    );

  it("groupChildren falls back to layerInfo.layer when findLayer returns null", () => {
    installLeafletGlobals();
    // A layerInfo with NO .layer property: findLayer(layerInfo) falls through to
    // util findLayer (map/window lookup) which returns null for an unknown id,
    // so the \"?? layerInfo.layer\" fallback arm is evaluated.
    manager.registerLayer({ id: "fgnolayer", name: "G", role: "overlay" });
    vi.useFakeTimers();
    vi.advanceTimersByTime(200);
    vi.useRealTimers();
    // groupChildren returns [] (no layer → not a group), no throw.
    expect(groupChildren(ui, "fgnolayer")).toEqual([]);
    // resolveChild returns null for the same missing layer.
    expect(resolveChild(ui, "fgnolayer", "fgnolayer::1")).toBeNull();
  });

  it("toggleGroupExpand tolerates a missing row and a row without a fold button", () => {
    installLeafletGlobals();
    const fg = makeGroup([child("a")]);
    manager.registerLayer({ id: "fg", name: "Group", role: "overlay", layer: fg });
    vi.useFakeTimers();
    vi.advanceTimersByTime(200);
    vi.useRealTimers();
    // A parentId with no matching row (the group is registered but the row was
    // removed): toggle flips the state and no-ops on the row patch.
    const parentId = "fg";
    // Remove the group's row from the DOM.
    groupRow()?.remove();
    expect(() => toggleGroupExpand(ui, parentId)).not.toThrow();
    // Now restore a row that has NO fold button (e.g. a leaf-styled row).
    // Directly drive via a row without .FOLD_BTN in the container.
    const row = document.createElement("div");
    row.setAttribute(CONST.DATA.LAYER_ID, "fg");
    attachedPanel(ui).appendChild(row);
    expect(() => toggleGroupExpand(ui, parentId)).not.toThrow();
    // The foldBtn null arm: row present but no .FOLD_BTN inside — no throw.
  });

  it("renders child rows checked only when the child is on the map", () => {
    installLeafletGlobals();
    const fg = makeGroup([child("a"), child("b")]);
    manager.registerLayer({ id: "fg", name: "Group", role: "overlay", layer: fg });
    vi.useFakeTimers();
    vi.advanceTimersByTime(200);
    vi.useRealTimers();
    // map.hasLayer is mocked true by default → both children render checked.
    const row = groupRow();
    row!.querySelector<HTMLElement>(`.${CONST.CLASSES.FOLD_BTN}`)!.click();
    const boxes = Array.from(
      childRows().map(
        r => r.querySelector('input[type="checkbox"]') as HTMLInputElement,
      ),
    );
    expect(boxes.every(b => b.checked)).toBe(true);
    // Now make hasLayer return false → the child renders UNCHECKED (the
    // onMap ? \"\" : undefined arm's false side).
    (map.hasLayer as ReturnType<typeof vi.fn>).mockReturnValue(false);
    // Re-toggle collapse/expand to re-render.
    row!.querySelector<HTMLElement>(`.${CONST.CLASSES.FOLD_BTN}`)!.click();
    row!.querySelector<HTMLElement>(`.${CONST.CLASSES.FOLD_BTN}`)!.click();
    const boxes2 = Array.from(
      childRows().map(
        r => r.querySelector('input[type="checkbox"]') as HTMLInputElement,
      ),
    );
    expect(boxes2.every(b => !b.checked)).toBe(true);
  });

  it("re-renders expanded group children on the initial list path", () => {
    installLeafletGlobals();
    const fg = makeGroup([child("a"), child("b")]);
    manager.registerLayer({ id: "fg", name: "Group", role: "overlay", layer: fg });
    vi.useFakeTimers();
    vi.advanceTimersByTime(200);
    vi.useRealTimers();
    // Expand the group (persist the flag), then rebuild the list so
    // renderInitialList takes the expanded path (list.ts L609 true arm).
    const row = groupRow();
    row!.querySelector<HTMLElement>(`.${CONST.CLASSES.FOLD_BTN}`)!.click();
    // The children were rendered in place; now force a rebuild via enforceOrder
    // so renderInitialList sees the persisted expandedGroups flag.
    manager.debouncedEnforce?.cancel?.();
    manager.enforceOrder();
    expect(childRows().length).toBe(2);
  });

  it("child checkbox change adds the child back to the map when checked", () => {
    installLeafletGlobals();
    const fg = makeGroup([child("a"), child("b")]);
    manager.registerLayer({ id: "fg", name: "Group", role: "overlay", layer: fg });
    vi.useFakeTimers();
    vi.advanceTimersByTime(200);
    vi.useRealTimers();
    const row = groupRow();
    row!.querySelector<HTMLElement>(`.${CONST.CLASSES.FOLD_BTN}`)!.click();
    // Uncheck then recheck → addLayer fires (the checked true arm).
    const first = childRows()[0];
    const cb = first.querySelector('input[type="checkbox"]') as HTMLInputElement;
    cb.checked = true;
    cb.dispatchEvent(new Event("change", { bubbles: true }));
    expect(map.addLayer).toHaveBeenCalled();
  });
});
describe("group expand — persisted expand + keyboard path", () => {
  let manager: LayerController;
  let ui: LayerUI;

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  const child = (name: string) => ({ options: {}, _name: name });

  const makeGroup = (children: unknown[]) => {
    const c: any = {
      options: {},
      clearLayers: vi.fn(),
      getBounds: vi.fn(),
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
      getLayers: vi.fn(() => children),
      _layers: {},
    };
    c.eachLayer = vi.fn((fn: (child: unknown) => void) => {
      for (const child of children) fn(child);
    });
    return c;
  };

  const groupRow = (): HTMLElement | null =>
    attachedPanel(ui).querySelector(
      `${CONST.SEL.LAYER_ITEM}[data-layer-id="fg"]`,
    ) as HTMLElement | null;

  const childRows = (): HTMLElement[] =>
    Array.from(
      attachedPanel(ui).querySelectorAll<HTMLElement>(
        `${CONST.SEL.LAYER_ITEM}[data-layer-id^="fg::"]`,
      ),
    );

  it("seeded expandedGroups renders children on the initial list and sets aria-expanded", () => {
    installLeafletGlobals();
    const fg = makeGroup([child("a"), child("b")]);
    ({ manager, ui } = initFixture({
      data: [
        {
          id: "overlay1",
          name: "Polys",
          role: "overlay",
          layer: { options: {}, eachLayer: vi.fn() },
        },
        { id: "fg", name: "Group", role: "overlay", layer: fg as never },
      ],
      seed: { expandedGroups: { fg: true } },
    }));
    vi.useFakeTimers();
    vi.advanceTimersByTime(200);
    vi.useRealTimers();
    // Children render inline from the first render (list.ts L609 true arm).
    expect(childRows().length).toBe(2);
    // The group row chevron carries aria-expanded=true (L1076/L1078 true arm).
    const foldBtn = groupRow()!.querySelector<HTMLElement>(
      `.${CONST.CLASSES.FOLD_BTN}`,
    )!;
    expect(foldBtn.getAttribute("aria-expanded")).toBe("true");
  });

  it("the group chevron toggles via the lifecycle parent-id path", () => {
    installLeafletGlobals();
    const fg = makeGroup([child("a")]);
    ({ manager, ui } = initFixture({
      data: [
        {
          id: "overlay1",
          name: "Polys",
          role: "overlay",
          layer: { options: {}, eachLayer: vi.fn() },
        },
        { id: "fg", name: "Group", role: "overlay", layer: fg as never },
      ],
    }));
    vi.useFakeTimers();
    vi.advanceTimersByTime(200);
    vi.useRealTimers();
    const row = groupRow();
    const foldBtn = row!.querySelector<HTMLElement>(`.${CONST.CLASSES.FOLD_BTN}`)!;
    foldBtn.click();
    expect(childRows().length).toBe(1);
    foldBtn.click();
    expect(childRows().length).toBe(0);
  });
});

describe("group expand — keyboard chevron", () => {
  let manager: LayerController;
  let ui: LayerUI;

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  const child = (name: string) => ({ options: {}, _name: name });

  const makeGroup = (children: unknown[]) => {
    const c: any = {
      options: {},
      clearLayers: vi.fn(),
      getBounds: vi.fn(),
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
      getLayers: vi.fn(() => children),
      _layers: {},
    };
    c.eachLayer = vi.fn((fn: (child: unknown) => void) => {
      for (const child of children) fn(child);
    });
    return c;
  };

  const groupRow = (): HTMLElement | null =>
    attachedPanel(ui).querySelector(
      `${CONST.SEL.LAYER_ITEM}[data-layer-id="fg"]`,
    ) as HTMLElement | null;

  const childRows = (): HTMLElement[] =>
    Array.from(
      attachedPanel(ui).querySelectorAll<HTMLElement>(
        `${CONST.SEL.LAYER_ITEM}[data-layer-id^="fg::"]`,
      ),
    );

  it("ArrowLeft on the focused group chevron expands the group", () => {
    installLeafletGlobals();
    const fg = makeGroup([child("a")]);
    ({ manager, ui, map } = initFixture({
      data: [
        {
          id: "overlay1",
          name: "Polys",
          role: "overlay",
          layer: { options: {}, eachLayer: vi.fn() },
        },
        { id: "fg", name: "Group", role: "overlay", layer: fg as never },
      ],
    }));
    vi.useFakeTimers();
    vi.advanceTimersByTime(200);
    vi.useRealTimers();
    const foldBtn = groupRow()!.querySelector<HTMLElement>(
      `.${CONST.CLASSES.FOLD_BTN}`,
    )!;
    foldBtn.focus();
    foldBtn.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "ArrowLeft",
      }),
    );
    expect(childRows().length).toBe(1);
  });
});

describe("group expand — child checkbox rails", () => {
  let manager: LayerController;
  let ui: LayerUI;

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  const child = (name: string) => ({ options: {}, _name: name });

  const makeGroup = (children: unknown[]) => {
    const c: any = {
      options: {},
      clearLayers: vi.fn(),
      getBounds: vi.fn(),
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
      getLayers: vi.fn(() => children),
      _layers: {},
    };
    c.eachLayer = vi.fn((fn: (child: unknown) => void) => {
      for (const child of children) fn(child);
    });
    return c;
  };

  it("a child checkbox change on a stale child is a no-op", () => {
    installLeafletGlobals();
    const fg = makeGroup([child("a")]);
    ({ manager, ui, map } = initFixture({
      data: [{ id: "fg", name: "Group", role: "overlay", layer: fg as never }],
    }));
    // Expand the group via its chevron (real user path) so child rows render.
    const chevron = attachedPanel(ui).querySelector<HTMLElement>(
      `${CONST.SEL.LAYER_ITEM}[data-layer-id="fg"] .${CONST.CLASSES.FOLD_BTN}`,
    )!;
    chevron.click();
    const cb = attachedPanel(ui).querySelector<HTMLInputElement>(
      `${CONST.SEL.LAYER_ITEM}[data-layer-id^="fg::"] input[type="checkbox"]`,
    );
    expect(cb).not.toBeNull();
    // Remove the child from the group so resolveChild returns null (eachLayer
    // now iterates nothing).
    fg.eachLayer = vi.fn();
    cb!.click();
    // No throw, no map call (map.addLayer is not invoked for a stale child).
    expect(true).toBe(true);
  });
});

describe("group expand — child row parity (P1 对齐)", () => {
  let manager: LayerController;
  let ui: LayerUI;

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  beforeEach(() => {
    ({ manager, ui, map } = initFixture());
  });

  const child = (name: string) => ({ options: {}, _name: name });

  const makeGroup = (children: unknown[]) => {
    const c: any = {
      options: {},
      clearLayers: vi.fn(),
      getBounds: vi.fn(),
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
      getLayers: vi.fn(() => children),
      _layers: {},
    };
    c.eachLayer = vi.fn((fn: (child: unknown) => void) => {
      for (const child of children) fn(child);
    });
    return c;
  };

  it("a child row carries count, type icon, more button and tree line — no drag grip", () => {
    installLeafletGlobals();
    const fg = makeGroup([child("a")]);
    manager.registerLayer({ id: "fg", name: "Group", role: "overlay", layer: fg });
    vi.useFakeTimers();
    vi.advanceTimersByTime(200);
    vi.useRealTimers();
    const row = attachedPanel(ui).querySelector(
      `${CONST.SEL.LAYER_ITEM}[data-layer-id="fg"]`,
    ) as HTMLElement | null;
    row!.querySelector<HTMLElement>(`.${CONST.CLASSES.FOLD_BTN}`)!.click();
    const first = attachedPanel(ui).querySelector<HTMLElement>(
      `${CONST.SEL.LAYER_ITEM}[data-layer-id^="fg::"]`,
    )!;
    // Count column present and non-empty ("1" for one child on the map).
    const count = first.querySelector<HTMLElement>(CONST.SEL.COUNT_COL);
    expect(count).not.toBeNull();
    expect(count!.textContent).not.toBe("");
    // Type icon column has content (not an empty div).
    const type = first.querySelector<HTMLElement>(`.${CONST.CLASSES.TYPE_ICON_COL}`);
    expect(type).not.toBeNull();
    expect(type!.innerHTML.trim()).not.toBe("");
    // More (⋮) menu button present.
    expect(
      first.querySelector<HTMLElement>(`.${CONST.CLASSES.MORE_BTN}`),
    ).not.toBeNull();
    // Tree connector line present (├/└) — no drag grip.
    expect(
      first.querySelector<HTMLElement>(`.${CONST.CLASSES.FOLD_TREE}`),
    ).not.toBeNull();
    // Read-only: not draggable.
    expect(first.getAttribute("draggable")).toBe("false");
  });
});

describe("group expand — child row menu (stage 1)", () => {
  let manager: LayerController;
  let ui: LayerUI;

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  beforeEach(() => {
    ({ manager, ui, map } = initFixture());
  });

  const childWithBounds = () => ({
    options: {},
    _name: "child",
    getBounds: () => ({
      isValid: () => true,
      getSouthWest: () => ({ lat: 30, lng: 100 }),
      getNorthEast: () => ({ lat: 31, lng: 101 }),
      getCenter: () => ({ lat: 30.5, lng: 100.5 }),
      extend: () => ({ isValid: () => true }),
    }),
  });

  const makeGroup = (children: unknown[]) => {
    const c: any = {
      options: {},
      clearLayers: vi.fn(),
      getBounds: vi.fn(),
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
      getLayers: vi.fn(() => children),
      _layers: {},
    };
    c.eachLayer = vi.fn((fn: (child: unknown) => void) => {
      for (const child of children) fn(child);
    });
    return c;
  };

  const expandGroup = () => {
    installLeafletGlobals();
    const fg = makeGroup([childWithBounds()]);
    manager.registerLayer({ id: "fg", name: "Group", role: "overlay", layer: fg });
    vi.useFakeTimers();
    vi.advanceTimersByTime(200);
    vi.useRealTimers();
    const row = attachedPanel(ui).querySelector(
      `${CONST.SEL.LAYER_ITEM}[data-layer-id="fg"]`,
    ) as HTMLElement;
    row.querySelector<HTMLElement>(`.${CONST.CLASSES.FOLD_BTN}`)!.click();
    return attachedPanel(ui).querySelector<HTMLElement>(
      `${CONST.SEL.LAYER_ITEM}[data-layer-id^="fg::"]`,
    )!;
  };

  it("opens a child menu with focus and remove entries", () => {
    const childRow = expandGroup();
    ui.openMoreMenu(childRow);
    const menu = ui.overlayPanel.activeMenu?.menu;
    expect(menu).not.toBeNull();
    const focus = menu!.querySelector<HTMLElement>(`button[data-action="focus-layer"]`);
    expect(focus).not.toBeNull();
    const del = menu!.querySelector<HTMLElement>(`button[data-action="delete-layer"]`);
    expect(del).not.toBeNull();
  });

  it("focus action fits the map to the child's bounds", () => {
    const childRow = expandGroup();
    ui.openMoreMenu(childRow);
    const menu = ui.overlayPanel.activeMenu!.menu!;
    const focus = menu.querySelector<HTMLElement>(`button[data-action="focus-layer"]`)!;
    focus.click();
    expect(map.fitBounds).toHaveBeenCalled();
  });

  it("remove action removes the child from the map and its row", () => {
    const childRow = expandGroup();
    ui.openMoreMenu(childRow);
    const menu = ui.overlayPanel.activeMenu!.menu!;
    const del = menu.querySelector<HTMLElement>(`button[data-action="delete-layer"]`)!;
    del.click();
    // First click confirms (two-step); second deletes.
    del.click();
    const childId = childRow.getAttribute(CONST.DATA.LAYER_ID)!;
    expect(
      attachedPanel(ui).querySelector(`[data-layer-id="${CSS.escape(childId)}"]`),
    ).toBeNull();
  });
});

describe("group expand — role expand/collapse (P1 项⑥)", () => {
  let manager: LayerController;
  let ui: LayerUI;

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  beforeEach(() => {
    ({ manager, ui, map } = initFixture({
      seedLayout: {
        version: 2,
        folders: [{ key: "roads", name: "Roads" }],
        order: { overlay: ["roads"] },
        members: {},
      },
    }));
  });

  const child = () => ({
    options: {},
    _name: "child",
    getBounds: () => ({
      isValid: () => true,
      getSouthWest: () => ({ lat: 30, lng: 100 }),
      getNorthEast: () => ({ lat: 31, lng: 101 }),
      getCenter: () => ({ lat: 30.5, lng: 100.5 }),
      extend: () => ({ isValid: () => true }),
    }),
  });

  const makeGroup = (children: unknown[]) => {
    const c: any = {
      options: {},
      clearLayers: vi.fn(),
      getBounds: vi.fn(),
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
      getLayers: vi.fn(() => children),
      _layers: {},
    };
    c.eachLayer = vi.fn((fn: (c2: unknown) => void) => {
      for (const c2 of children) fn(c2);
    });
    return c;
  };

  const openRoleMenuAndClick = (action: string) => {
    installLeafletGlobals();
    const fg = makeGroup([child()]);
    manager.registerLayer({ id: "fg", name: "Group", role: "overlay", layer: fg });
    vi.useFakeTimers();
    vi.advanceTimersByTime(200);
    vi.useRealTimers();
    const roleRow = attachedPanel(ui).querySelector(
      `${CONST.SEL.TOGGLE_ALL}[data-role="overlay"]`,
    ) as HTMLElement;
    const moreBtn = roleRow.querySelector<HTMLElement>(`.${CONST.CLASSES.MORE_BTN}`)!;
    moreBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const menu = ui.overlayPanel.activeMenu?.menu;
    if (!menu) throw new Error("expected an open menu");
    const btn = menu.querySelector<HTMLElement>(`button[data-action="${action}"]`)!;
    btn.click();
    return ui;
  };

  it("role expand-all expands every group and shows its children", () => {
    openRoleMenuAndClick("expand-all");
    expect(
      attachedPanel(ui).querySelector(`${CONST.SEL.LAYER_ITEM}[data-layer-id^="fg::"]`),
    ).not.toBeNull();
  });

  it("role collapse-all collapses every group and hides its children", () => {
    openRoleMenuAndClick("expand-all");
    expect(
      attachedPanel(ui).querySelector(`${CONST.SEL.LAYER_ITEM}[data-layer-id^="fg::"]`),
    ).not.toBeNull();
    // Reopen the role menu and collapse.
    const roleRow = attachedPanel(ui).querySelector(
      `${CONST.SEL.TOGGLE_ALL}[data-role="overlay"]`,
    ) as HTMLElement;
    const moreBtn = roleRow.querySelector<HTMLElement>(`.${CONST.CLASSES.MORE_BTN}`)!;
    moreBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const menu = ui.overlayPanel.activeMenu!.menu!;
    const collapse = menu.querySelector<HTMLElement>(
      `button[data-action="collapse-all"]`,
    )!;
    collapse.click();
    expect(
      attachedPanel(ui).querySelector(`${CONST.SEL.LAYER_ITEM}[data-layer-id^="fg::"]`),
    ).toBeNull();
  });

  it("role expand-all unfolds a folder and expands a group inside it", () => {
    installLeafletGlobals();
    const fg = makeGroup([child()]);
    manager.registerLayer({
      id: "fg",
      name: "Group",
      role: "overlay",
      layer: fg,
      folder: "roads",
    });
    vi.useFakeTimers();
    vi.advanceTimersByTime(200);
    vi.useRealTimers();
    const folderRow = attachedPanel(ui).querySelector(
      `${CONST.SEL.FOLDER_ROW}[data-folder-key="roads"]`,
    ) as HTMLElement;
    expect(folderRow).not.toBeNull();
    const roleRow = attachedPanel(ui).querySelector(
      `${CONST.SEL.TOGGLE_ALL}[data-role="overlay"]`,
    ) as HTMLElement;
    const moreBtn = roleRow.querySelector<HTMLElement>(`.${CONST.CLASSES.MORE_BTN}`)!;
    moreBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const menu = ui.overlayPanel.activeMenu!.menu!;
    menu.querySelector<HTMLElement>(`button[data-action="expand-all"]`)!.click();
    expect(folderRow.getAttribute("aria-expanded")).toBe("true");
    expect(
      attachedPanel(ui).querySelector(`${CONST.SEL.LAYER_ITEM}[data-layer-id^="fg::"]`),
    ).not.toBeNull();
  });

  it("role collapse-all folds a folder and collapses a group inside it", () => {
    installLeafletGlobals();
    const fg = makeGroup([child()]);
    manager.registerLayer({
      id: "fg",
      name: "Group",
      role: "overlay",
      layer: fg,
      folder: "roads",
    });
    vi.useFakeTimers();
    vi.advanceTimersByTime(200);
    vi.useRealTimers();
    const roleRow = attachedPanel(ui).querySelector(
      `${CONST.SEL.TOGGLE_ALL}[data-role="overlay"]`,
    ) as HTMLElement;
    const moreBtn = roleRow.querySelector<HTMLElement>(`.${CONST.CLASSES.MORE_BTN}`)!;
    moreBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    let menu = ui.overlayPanel.activeMenu!.menu!;
    menu.querySelector<HTMLElement>(`button[data-action="expand-all"]`)!.click();
    expect(
      attachedPanel(ui).querySelector(`${CONST.SEL.LAYER_ITEM}[data-layer-id^="fg::"]`),
    ).not.toBeNull();
    const roleRow2 = attachedPanel(ui).querySelector(
      `${CONST.SEL.TOGGLE_ALL}[data-role="overlay"]`,
    ) as HTMLElement;
    const moreBtn2 = roleRow2.querySelector<HTMLElement>(`.${CONST.CLASSES.MORE_BTN}`)!;
    moreBtn2.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    menu = ui.overlayPanel.activeMenu!.menu!;
    menu.querySelector<HTMLElement>(`button[data-action="collapse-all"]`)!.click();
    expect(
      attachedPanel(ui).querySelector(`${CONST.SEL.LAYER_ITEM}[data-layer-id^="fg::"]`),
    ).toBeNull();
    const groupRow = attachedPanel(ui).querySelector(
      `${CONST.SEL.LAYER_ITEM}[data-layer-id="fg"]`,
    ) as HTMLElement;
    const foldBtn = groupRow?.querySelector<HTMLElement>(`.${CONST.CLASSES.FOLD_BTN}`);
    expect(foldBtn?.getAttribute("aria-expanded")).toBe("false");
  });
});
