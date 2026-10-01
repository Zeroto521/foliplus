import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/LayerControl/const.js";
import type { LayerManager } from "#foliplus/LayerControl/manager.js";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import { findItem, initFixture } from "./fixture.js";

// focusLayer() reaches guardBlocked() through a free import rather than a
// `map.foliplus` reference, so it has to be mocked to flip the block on.
const modeMocks = vi.hoisted(() => ({
  guardBlocked: vi.fn(() => false),
  ensureModes: vi.fn(() => ({ setMode: vi.fn() })),
  ModeManager: vi.fn(),
}));

vi.mock("#core/mode.js", () => ({
  ensureModes: modeMocks.ensureModes,
  guardBlocked: modeMocks.guardBlocked,
  ModeManager: modeMocks.ModeManager,
}));

/**
 * The five surfaces that compete for the same spot — the two floating panels,
 * the overflow menu, the inline rename input, and the map-wide focus
 * spotlight. `ui/overlays.ts` makes them mutually exclusive; every entry must
 * clear every other one. Focus counts as an overlay even though it is a map
 * state rather than a floating panel: that asymmetry is what let the
 * attributes panel survive a focus in the first place.
 */
type Surface = "attrs" | "style" | "menu" | "rename" | "focus";

const SURFACES = Object.keys({
  attrs: 1,
  style: 1,
  menu: 1,
  rename: 1,
  focus: 1,
}) as Surface[];

const NAME: Record<Surface, string> = {
  attrs: "the attributes panel",
  style: "the style panel",
  menu: "the overflow menu",
  rename: "the rename input",
  focus: "the focus spotlight",
};

/** Each entry point, in terms of the `ui` instance the user drives. */
const OPEN: Record<Surface, (ui: LayerUI, item: HTMLElement) => void> = {
  attrs: (ui, item) => ui.openAttrsPanel(item),
  style: ui => ui.openStylePanel("overlay1"),
  menu: (ui, item) => ui.openMoreMenu(item),
  rename: ui => ui.renameLayer("overlay1"),
  focus: ui => ui.focusLayer("overlay1"),
};

/** The DOM / state trace each surface leaves behind when it is up. */
const IS_UP: Record<Surface, (ui: LayerUI) => boolean> = {
  attrs: ui =>
    ui.uiContainer.querySelectorAll(`.${CONST.CLASSES.ATTRS_PANEL}`).length > 0,
  style: ui => ui.stylePanelLayerId !== null,
  menu: ui => ui.activeMenu !== null,
  rename: ui => ui.activeRenameId !== null,
  focus: ui => ui.isFocusing(),
};

describe("LayerUI overlay mutual exclusion", () => {
  let manager: LayerManager;
  let ui: LayerUI;
  let map: any;

  beforeEach(() => {
    ({ manager, ui, map } = initFixture());
    // The fixture's data layer carries no real leaves, so the style panel
    // would build empty: seed the field cache and the annotation capability
    // the way the panel's own tests do, so `openStylePanel` renders.
    ui.fieldCache.set("overlay1", [{ name: "count", numeric: true }]);
    const surface = manager.surfaceFor(
      manager.layerRegistry.get("overlay1")!,
    ) as unknown as { capabilities: Record<string, unknown> };
    surface.capabilities = { ...surface.capabilities, annotation: "pane" };
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  for (const from of SURFACES) {
    for (const to of SURFACES) {
      if (from === to) continue;
      it(`opening ${NAME[to]} drops ${NAME[from]}`, () => {
        const item = findItem(ui, "overlay1");

        OPEN[from](ui, item);
        expect(IS_UP[from](ui)).toBe(true);

        OPEN[to](ui, item);

        expect(IS_UP[from](ui)).toBe(false);
        expect(IS_UP[to](ui)).toBe(true);
      });
    }
  }

  it("a panel-triggered focus teardown shows no hint", () => {
    // closeOverlays tears focus down through the silent dismissFocus.
    // cancelFocus would flash "Focus cancelled" — a false alarm: the focus
    // was replaced, not dismissed by the user.
    vi.useFakeTimers();

    ui.focusLayer("overlay1");
    expect(ui.isFocusing()).toBe(true);

    const hintSpy = vi.fn();
    map.foliplus.showHint = hintSpy;

    const item = findItem(ui, "overlay1");
    ui.openAttrsPanel(item);

    expect(ui.isFocusing()).toBe(false);
    expect(hintSpy).not.toHaveBeenCalled();
  });

  it("Escape still announces the focus it cancels", () => {
    // The hint belongs to the one path where a human dismissed the focus on
    // purpose — not to the state cleanup a panel triggers on its way in.
    ui.focusLayer("overlay1");

    const hintSpy = vi.fn();
    map.foliplus.showHint = hintSpy;

    ui.cancelFocus();

    expect(ui.isFocusing()).toBe(false);
    expect(hintSpy).toHaveBeenCalledWith(
      "LayerControl",
      expect.stringContaining("focus_cancelled"),
      expect.any(Number),
    );
  });

  describe("the clear point sits behind the entry's guards", () => {
    it("a blocked focus leaves an open panel alone", () => {
      const item = findItem(ui, "overlay1");
      ui.openStylePanel("overlay1");
      expect(ui.stylePanelLayerId).toBe("overlay1");

      // Trips focusLayer's guardBlocked before it reaches closeOverlays.
      modeMocks.guardBlocked.mockReturnValue(true);

      ui.focusLayer("overlay1");

      expect(modeMocks.guardBlocked).toHaveBeenCalled();
      expect(ui.isFocusing()).toBe(false);
      expect(ui.stylePanelLayerId).toBe("overlay1");
    });

    it("an unfocusable row leaves an open panel alone", () => {
      const item = findItem(ui, "overlay1");
      ui.openStylePanel("overlay1");

      const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
      checkbox.checked = false;

      ui.focusLayer("overlay1");

      expect(ui.isFocusing()).toBe(false);
      expect(ui.stylePanelLayerId).toBe("overlay1");
    });

    it("renameLayer with no id leaves an open panel alone", () => {
      ui.openStylePanel("overlay1");
      expect(ui.stylePanelLayerId).toBe("overlay1");

      ui.renameLayer("");

      expect(ui.activeRenameId).toBeNull();
      expect(ui.stylePanelLayerId).toBe("overlay1");
    });

    it("openStylePanel with no id leaves an open panel alone", () => {
      ui.openAttrsPanel(findItem(ui, "overlay1"));
      expect(IS_UP.attrs(ui)).toBe(true);

      ui.openStylePanel("");

      expect(ui.stylePanelLayerId).toBeNull();
      expect(IS_UP.attrs(ui)).toBe(true);
    });
  });

  it("renameLayer leaves the cursor in the inline input", () => {
    // closeOverlays' closeMoreMenu(true) parks focus on the row first; the
    // input has to take it back, otherwise the menu-click rename lands on a
    // row instead of an editable field.
    const item = findItem(ui, "overlay1");
    ui.openMoreMenu(item);

    ui.renameLayer("overlay1");

    const input = item.querySelector(
      `.${CONST.CLASSES.RENAME_INPUT}`,
    ) as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
  });
});
