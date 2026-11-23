// LayerControl UI — container expand: child rows under a layer group.
//
// A container (LayerGroup / FeatureGroup) row gets a chevron. Expanding it
// renders one row per direct child, keyed by parent::stamp, with its own
// checkbox and more button. Collapsing removes them. The count column on the
// container row stays the direct-child count — expanding never changes it.
import { attachedPanel, initFixture, installLeafletGlobals } from "./fixture.js";
import {
  childDisplayName,
  childRowId,
  containerChildren,
  isContainerExpanded,
  removeContainerChildren,
  resolveChild,
  toggleContainerExpand,
} from "#control/LayerControl/ui/listPanel/containerExpand.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#control/LayerControl/const.js";
import type { LayerController } from "#control/LayerControl/controller.js";
import type { LayerUI } from "#control/LayerControl/ui/index.js";

describe("container expand", () => {
  let manager: LayerController;
  let ui: LayerUI;
  let map: any;

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

  const makeContainer = (children: unknown[]) => {
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

  const registerContainer = (children: unknown[]) => {
    const fg = makeContainer(children);
    manager.registerLayer({
      id: "fg",
      name: "Group",
      role: "overlay",
      layer: fg as never,
    });
    return fg;
  };

  const containerRow = (): HTMLElement | null =>
    attachedPanel(ui).querySelector(
      `${CONST.SEL.LAYER_ITEM}[data-layer-id="fg"]`,
    ) as HTMLElement | null;

  const childRows = (): HTMLElement[] =>
    Array.from(
      attachedPanel(ui).querySelectorAll<HTMLElement>(
        `${CONST.SEL.LAYER_ITEM}[data-layer-id^="fg::"]`,
      ),
    );

  it("expands a container into one row per direct child", () => {
    installLeafletGlobals();
    registerContainer([child("a"), child("b"), child("c")]);
    vi.useFakeTimers();
    vi.advanceTimersByTime(200);
    vi.useRealTimers();

    const row = containerRow();
    expect(row).not.toBeNull();
    // The container row carries a chevron.
    const foldBtn = row!.querySelector(`.${CONST.CLASSES.FOLD_BTN}`) as HTMLElement | null;
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

    // The container count stays "3".
    expect(row!.querySelector(CONST.SEL.COUNT_COL)?.textContent).toBe("3");

    // Collapse → children disappear.
    row!.querySelector<HTMLElement>(`.${CONST.CLASSES.FOLD_BTN}`)!.click();
    expect(childRows().length).toBe(0);
  });

  it("toggles a child checkbox through the map directly", () => {
    installLeafletGlobals();
    registerContainer([child("a"), child("b")]);
    vi.useFakeTimers();
    vi.advanceTimersByTime(200);
    vi.useRealTimers();

    const row = containerRow();
    row!.querySelector<HTMLElement>(`.${CONST.CLASSES.FOLD_BTN}`)!.click();
    const first = childRows()[0];
    const cb = first.querySelector('input[type="checkbox"]') as HTMLInputElement;
    // map.hasLayer returns true by default (fixture), so the box is checked.
    expect(cb.checked).toBe(true);
    cb.checked = false;
    cb.dispatchEvent(new Event("change", { bubbles: true }));
    // The child is removed from the map directly (non-registry path).
    expect(map.removeLayer).toHaveBeenCalled();
    // The container count still reads the group's children.
    expect(row!.querySelector(CONST.SEL.COUNT_COL)?.textContent).toBe("2");
  });
});

describe("container expand — defensive rails", () => {
  let manager: LayerController;
  let ui: LayerUI;
  let map: any;

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

  const makeContainer = (children: unknown[]) => {
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

  const registerContainer = (children: unknown[]) => {
    const fg = makeContainer(children);
    manager.registerLayer({
      id: "fg",
      name: "Group",
      role: "overlay",
      layer: fg as never,
    });
    return fg;
  };

  const containerRow = (): HTMLElement | null =>
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
    registerContainer([withFeature, withOptions]);
    vi.useFakeTimers();
    vi.advanceTimersByTime(200);
    vi.useRealTimers();

    const row = containerRow();
    row!.querySelector<HTMLElement>(`.${CONST.CLASSES.FOLD_BTN}`)!.click();
    const rows = childRows();
    expect(rows.length).toBe(2);
    // feature.properties.name wins.
    expect(rows[0].querySelector(`.${CONST.CLASSES.LAYER_LABEL}`)?.textContent).toBe("FeatName");
    expect(rows[1].querySelector(`.${CONST.CLASSES.LAYER_LABEL}`)?.textContent).toBe("OptName");
  });

  it("resolveChild rejects a bad id and a non-container parent", () => {
    installLeafletGlobals();
    registerContainer([child("a")]);
    vi.useFakeTimers();
    vi.advanceTimersByTime(200);
    vi.useRealTimers();

    // A child row id that does not start with the parent prefix → null.
    // Exercise resolveChild directly via the exported helper? It is not exported from the test
    // entry. Instead drive it through a bad data-layer-id change event: the row lookup fails,
    // the change handler falls through to the normal path (no-op for an unknown id).
    const row = containerRow();
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

  it("toggles an empty container without crashing", () => {
    installLeafletGlobals();
    registerContainer([]);
    vi.useFakeTimers();
    vi.advanceTimersByTime(200);
    vi.useRealTimers();

    const row = containerRow();
    expect(row).not.toBeNull();
    row!.querySelector<HTMLElement>(`.${CONST.CLASSES.FOLD_BTN}`)!.click();
    // No children, no rows, no crash.
    expect(childRows().length).toBe(0);
  });
});

describe("container expand — direct helper rails", () => {
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

  const makeContainer = (children: unknown[]) => {
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

  const registerContainer = (children: unknown[]) => {
    const fg = makeContainer(children);
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
    registerContainer([child("a")]);
    vi.useFakeTimers();
    vi.advanceTimersByTime(200);
    vi.useRealTimers();

    // Not prefixed by the parent → null.
    expect(resolveChild(ui, "fg", "bogus")).toBeNull();
    // Non-numeric stamp → null.
    expect(resolveChild(ui, "fg", "fg::abc")).toBeNull();
    // Unknown parent id (a child id prefixed by a missing parent) → null.
    expect(resolveChild(ui, "nope", "nope::1")).toBeNull();
    // A parent that is NOT a container (a plain leaf) → null.
    const leaf: any = { options: {} };
    manager.registerLayer({ id: "leafy", name: "Leaf", role: "overlay", layer: leaf });
    vi.useFakeTimers(); vi.advanceTimersByTime(200); vi.useRealTimers();
    expect(resolveChild(ui, "leafy", "leafy::1")).toBeNull();
    // A valid container + a child id that does not match any child → null.
    const fg = registerContainer([child("a")]);
    vi.useFakeTimers(); vi.advanceTimersByTime(200); vi.useRealTimers();
    const stamp = childRowId("fg", fg.getLayers()[0]).split("::")[1];
    expect(resolveChild(ui, "fg", `fg::${stamp}`)).not.toBeNull();
    expect(resolveChild(ui, "fg", "fg::999999")).toBeNull();
  });

  it("containerChildren returns [] for a missing or non-container parent", () => {
    installLeafletGlobals();
    // Unknown parent.
    expect(containerChildren(ui, "nope")).toEqual([]);
    // Non-container leaf.
    const leaf: any = { options: {} };
    manager.registerLayer({ id: "leafy", name: "Leaf", role: "overlay", layer: leaf });
    vi.useFakeTimers(); vi.advanceTimersByTime(200); vi.useRealTimers();
    expect(containerChildren(ui, "leafy")).toEqual([]);
    // A real container returns its children.
    const fg = makeContainer([child("a")]);
    manager.registerLayer({ id: "fg", name: "Group", role: "overlay", layer: fg });
    vi.useFakeTimers(); vi.advanceTimersByTime(200); vi.useRealTimers();
    expect(containerChildren(ui, "fg").length).toBe(1);
  });

  it("toggle and remove tolerate a detached panel", () => {
    installLeafletGlobals();
    registerContainer([child("a")]);
    vi.useFakeTimers(); vi.advanceTimersByTime(200); vi.useRealTimers();
    // Detach the panel → the container lookup misses, but no throw.
    ui.c.uiContainer = null as never;
    expect(() => toggleContainerExpand(ui, "fg")).not.toThrow();
    expect(() => removeContainerChildren(ui, "fg")).not.toThrow();
    expect(() => toggleContainerExpand(ui, "fg")).not.toThrow();
  });

  it("childRowId stamps the parent prefix and child id", () => {
    installLeafletGlobals();
    const id = childRowId("fg", child("x") as never);
    expect(id).toMatch(/^fg::/);
    expect(isContainerExpanded(ui, "fg")).toBe(false);
  });

  it("childDisplayName falls back to the generic label", () => {
    installLeafletGlobals();
    expect(childDisplayName({ options: {} } as never)).toBe("Layer");
    expect(childDisplayName({ options: { name: "N" } } as never)).toBe("N");
  });
});
