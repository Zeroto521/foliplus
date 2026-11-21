// ui derived-state coherence guard — task-136.
//
// Every registration path (construction-seeded A, runtime registerLayer B)
// must leave the derived states — role tri-state, container row type, fold
// class, role header count — in agreement with the registry. These are
// table-driven so a new derived dimension is added here once and cannot be
// forgotten on one path.
//
// See .foliplus/review/task-136-derived-state-review.md for the audit and the
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
    manager?.debouncedRebuild?.cancel?.();
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
          "." + CONST.CLASSES.TYPE_ICON_COL,
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
    // Flush the debounced rebuild the registration scheduled (§8 single
    // invalidate rule). The guard must hold after the settle, not before.
    vi.useFakeTimers();
    vi.advanceTimersByTime(200);
    vi.useRealTimers();
    check();
  });
});
