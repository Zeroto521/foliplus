// ui derived-state coherence guard.
//
// Every registration path (construction-seeded A, runtime registerLayer B)
// must leave the derived states — role tri-state, container row type, fold
// class, role header count — in agreement with the registry. These are
// table-driven so a new derived dimension is added here once and cannot be
// forgotten on one path.
//
// See the derived-state coherence review for the audit and the
// single "mutation → invalidate → rebuildList" rule this guards.
import {
  TileLayer,
  attachedPanel,
  initFixture,
  installLeafletGlobals,
  polygonLayer,
} from "./fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROLE } from "#core/layer/index.js";
import * as CONST from "#control/LayerControl/const.js";
import type { LayerController } from "#control/LayerControl/controller.js";
import type { LayerUI } from "#control/LayerControl/ui/index.js";

describe("ui derived-state coherence — B-path (runtime registerLayer)", () => {
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

  const toggleAllCheckbox = (role: string): HTMLInputElement =>
    attachedPanel(ui).querySelector(
      `${CONST.SEL.TOGGLE_ALL}[data-role="${role}"] input[type="checkbox"]`,
    ) as HTMLInputElement;

  const rowCount = (role: string): number =>
    attachedPanel(ui).querySelectorAll(
      role === ROLE.BASE
        ? `${CONST.SEL.LAYER_ITEM}[data-layer-type="${ROLE.BASE}"]`
        : `${CONST.SEL.LAYER_ITEM}:not([data-layer-type="${ROLE.BASE}"])`,
    ).length;

  // The coherence table: each row is one derived dimension, checked after a
  // runtime registration. A dimension that drifts from the registry fails here
  // rather than surfacing as a user-visible stale panel.
  const coherenceTable: Array<{
    name: string;
    register: () => void;
    check: () => void;
  }> = [
    {
      name: "role tri-state total tracks the registry",
      register: () =>
        manager.registerLayer({
          id: "overlay2",
          name: "Late",
          role: "overlay",
          layer: polygonLayer(),
        }),
      check: () => {
        // Two overlays, both visible → checked, not indeterminate.
        const cb = toggleAllCheckbox(ROLE.OVERLAY);
        expect(cb).not.toBeNull();
        expect(cb.checked).toBe(true);
        expect(cb.indeterminate).toBe(false);
        // Hiding one of two must leave the role indeterminate.
        const row = attachedPanel(ui).querySelector(
          `${CONST.SEL.LAYER_ITEM}[data-layer-id="overlay2"] input[type="checkbox"]`,
        ) as HTMLInputElement;
        row.checked = false;
        row.dispatchEvent(new Event("change", { bubbles: true }));
        const after = toggleAllCheckbox(ROLE.OVERLAY);
        expect(after.indeterminate).toBe(true);
        expect(after.checked).toBe(false);
      },
    },
    {
      name: "container row renders the group glyph + child count",
      register: () => {
        const fg = {
          options: {},
          eachLayer: vi.fn((cb: (c: unknown) => void) => {
            cb({ options: {} });
            cb({ options: {} });
          }),
          addLayer: vi.fn(),
          getLayers: vi.fn(() => [{ options: {} }, { options: {} }]),
          getBounds: vi.fn(),
          _layers: {},
        };
        manager.registerLayer({
          id: "fg_late",
          name: "Late Group",
          role: "overlay",
          layer: fg as never,
        });
      },
      check: () => {
        const row = attachedPanel(ui).querySelector(
          `${CONST.SEL.LAYER_ITEM}[data-layer-id="fg_late"]`,
        ) as HTMLElement | null;
        expect(row).not.toBeNull();
        // The container row's type column carries the group glyph.
        const typeCol = row!.querySelector(
          `.${CONST.CLASSES.TYPE_ICON_COL}`,
        ) as HTMLElement | null;
        expect(typeCol?.innerHTML).toContain("<svg");
        // Its count is the direct child count (2), not a feature census.
        expect(row!.querySelector(CONST.SEL.COUNT_COL)?.textContent).toBe("2");
      },
    },
    {
      name: "base role header reflects a base registered at runtime",
      register: () =>
        manager.registerLayer({
          id: "base_late",
          name: "Late Base",
          role: "base",
          layer: new TileLayer(),
          paneName: "tilePane",
        }),
      check: () => {
        // The late base row is present and counted in the base role.
        expect(rowCount(ROLE.BASE)).toBeGreaterThanOrEqual(2);
        const cb = toggleAllCheckbox(ROLE.BASE);
        expect(cb).not.toBeNull();
      },
    },
  ];

  it.each(coherenceTable)("$name", ({ register, check }) => {
    installLeafletGlobals();
    register();
    // The barrier invalidates synchronously inside the registration, so the
    // coherence guard is checked after the settle already happened.
    check();
  });
});
describe("ui derived-state coherence — tree connector (delete path)", () => {
  let manager: LayerController;
  let ui: LayerUI;

  const layoutFromRoles = (sections: Record<string, string[]>) => {
    const keys = new Set<string>();
    for (const list of Object.values(sections)) for (const k of list) keys.add(k);
    return {
      version: 2,
      folders: [...keys].map(k => ({ key: k, name: k })),
      order: sections,
      members: {},
    };
  };

  const tree = (id: string): HTMLElement | null =>
    attachedPanel(ui).querySelector(
      `[data-layer-id="${id}"] .${CONST.CLASSES.FOLD_TREE}`,
    );

  beforeEach(() => {
    installLeafletGlobals();
    ({ manager, ui } = initFixture({
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
    }));
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("deleting the folder's last member flips the prior member to LAST", () => {
    expect(tree("rd1")?.classList.contains(CONST.CLASSES.FOLD_TREE_LAST)).toBe(false);
    expect(tree("rd1")?.classList.contains(CONST.CLASSES.FOLD_TREE_MID)).toBe(true);
    expect(tree("rd2")?.classList.contains(CONST.CLASSES.FOLD_TREE_LAST)).toBe(true);
    manager.deleteLayer("rd2");
    expect(tree("rd1")?.classList.contains(CONST.CLASSES.FOLD_TREE_LAST)).toBe(true);
    expect(tree("rd1")?.classList.contains(CONST.CLASSES.FOLD_TREE_MID)).toBe(false);
  });

  it("registering a new member computes the new row's connector and leaves prior rows coherent", () => {
    expect(tree("rd2")?.classList.contains(CONST.CLASSES.FOLD_TREE_LAST)).toBe(true);
    manager.registerLayer({
      id: "rd3",
      name: "Lakes",
      role: "overlay",
      folder: "roads",
      layer: polygonLayer(),
    });
    // New row at front: it is not the last member, so it must show MID, and
    // the prior last member (rd2) must remain LAST — the block order is
    // [rd3, rd1, rd2] because prepend() puts new overlays at index 0.
    expect(tree("rd3")?.classList.contains(CONST.CLASSES.FOLD_TREE_MID)).toBe(true);
    expect(tree("rd3")?.classList.contains(CONST.CLASSES.FOLD_TREE_LAST)).toBe(false);
    expect(tree("rd2")?.classList.contains(CONST.CLASSES.FOLD_TREE_LAST)).toBe(true);
    expect(tree("rd1")?.classList.contains(CONST.CLASSES.FOLD_TREE_MID)).toBe(true);
  });
});

describe("ui derived-state mechanism — the barrier re-derives every dimension", () => {
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

  it("registerLayer schedules a barrier that re-derives tree connectors", () => {
    const spy = vi.spyOn(ui, "refreshTreeConnectors");
    manager.registerLayer({
      id: "overlay2",
      name: "Late",
      role: "overlay",
      layer: polygonLayer(),
    });
    expect(spy).toHaveBeenCalled();
  });

  it("deleteLayer schedules a barrier that re-derives tree connectors", () => {
    const spy = vi.spyOn(ui, "refreshTreeConnectors");
    manager.deleteLayer("overlay1");
    expect(spy).toHaveBeenCalled();
  });
});
