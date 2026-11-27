// test/js/control/LayerControl/ui/overlayPanel/openSurface — the single
// "what is open" state machine.
//
// The pairwise matrix in ../teardown.test.ts pins mutual exclusion through the
// user-facing entry points. This file pins the machine itself: one stored
// state, projections for readers, the close dispatch, and the extension-point
// table every surface kind must register into.
import { findItem, initFixture } from "../fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS } from "#core/event/index.js";
import type { LayerUI } from "#control/LayerControl/ui/index.js";
import {
  clearSurface,
  closeSurface,
  openSurface,
  surfaceCloserKinds,
} from "#control/LayerControl/ui/overlayPanel/openSurface.js";

describe("LayerUI openSurface state machine", () => {
  let ui: LayerUI;

  beforeEach(() => {
    ({ ui } = initFixture());
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  const row = (): HTMLElement => findItem(ui, "overlay1");

  it("stores one surface and projects it through every derived getter", () => {
    ui.openAttrsPanel(row());

    expect(ui.overlayPanel.surface?.kind).toBe("attrs");
    expect(ui.overlayPanel.activeAttrsPanel?.layerId).toBe("overlay1");
    // Every other projection is null because there is only ONE state — the
    // getters cannot disagree with each other.
    expect(ui.overlayPanel.activeMenu).toBeNull();
    expect(ui.overlayPanel.activeFilterPanel).toBeNull();
    expect(ui.overlayPanel.stylePanelLayerId).toBeNull();
    expect(ui.overlayPanel.activeRenameId).toBeNull();
    expect(ui.overlayPanel.activeRenameRow).toBeNull();
  });

  it("closes the previous surface before storing the next one", () => {
    ui.openAttrsPanel(row());
    const panel = ui.overlayPanel.activeAttrsPanel!.panel;
    const unregister = vi.fn();
    ui.overlayPanel.attrsOverlayUnregister = unregister;

    ui.openMoreMenu(row());

    expect(unregister).toHaveBeenCalledTimes(1);
    expect(ui.overlayPanel.surface?.kind).toBe("menu");
    expect(ui.overlayPanel.activeAttrsPanel).toBeNull();
    expect(ui.overlayPanel.attrsOverlayUnregister).toBeNull();
    expect(panel.isConnected).toBe(false);
  });

  it("closes the open surface through its registered closer", () => {
    ui.openMoreMenu(row());
    const menu = ui.overlayPanel.activeMenu!.menu;

    expect(closeSurface(ui)).toBe(true);

    expect(ui.overlayPanel.surface).toBeNull();
    expect(ui.overlayPanel.activeMenu).toBeNull();
    expect(menu.isConnected).toBe(false);
    // Nothing open is not an error, and it is not a second close.
    expect(closeSurface(ui)).toBe(false);
  });

  it("clearSurface only clears the kind that is actually open", () => {
    ui.openAttrsPanel(row());

    clearSurface(ui, "menu");
    expect(ui.overlayPanel.surface?.kind).toBe("attrs");

    clearSurface(ui, "attrs");
    expect(ui.overlayPanel.surface).toBeNull();
  });

  it("openSurface is itself the exclusivity rule", () => {
    // No closeOverlays, no per-kind knowledge: the machine closes the attrs
    // surface because a different kind is being opened.
    ui.openAttrsPanel(row());
    openSurface(ui, { kind: "rename", row: row(), layerId: "overlay1" });

    expect(ui.overlayPanel.surface?.kind).toBe("rename");
    expect(ui.overlayPanel.activeAttrsPanel).toBeNull();
    expect(ui.overlayPanel.activeRenameId).toBe("overlay1");
  });

  it("an unregistered kind cannot leave a phantom surface behind", () => {
    // A surface kind whose owner failed to register a closer must still be
    // cleared: the fallback in closeSurface keeps the machine honest.
    (ui.overlayPanel as unknown as { surface: unknown }).surface = { kind: "ghost" };

    expect(closeSurface(ui)).toBe(true);
    expect(ui.overlayPanel.surface).toBeNull();
  });

  it("every OpenSurface kind registers a closer once the shell is imported", () => {
    // The extension point is a two-sided contract: a new member in OpenSurface
    // without a registerSurfaceCloser call would close no DOM. This is the
    // guard that makes the missing half fail here instead of in the browser.
    expect(surfaceCloserKinds().sort()).toEqual([
      "attrs",
      "filter",
      "menu",
      "rename",
      "style",
    ]);
  });

  it("the menu's .open class is a render product, not the state", () => {
    ui.openMoreMenu(row());
    const menu = ui.overlayPanel.activeMenu!.menu;
    // The class is written when the element is built ...
    expect(menu.classList.contains("open")).toBe(true);
    // ... while the state is what readers consult.
    expect(ui.overlayPanel.activeMenu?.item.isConnected).toBe(true);

    ui.closeMoreMenu(false);

    // Close removes the element; the state and the class leave together because
    // the class never was the state.
    expect(menu.isConnected).toBe(false);
    expect(ui.overlayPanel.surface).toBeNull();
  });

  it("Escape closes the one open surface", () => {
    ui.openAttrsPanel(row());
    const checkbox = row().querySelector('input[type="checkbox"]') as HTMLInputElement;
    checkbox.focus();

    checkbox.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }),
    );

    expect(ui.overlayPanel.surface).toBeNull();
    expect(row().querySelector(".foliplus-layer-attrs-panel")).toBeNull();
  });

  it("an outside press closes the one open surface", () => {
    ui.openAttrsPanel(row());

    document.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );

    expect(ui.overlayPanel.surface).toBeNull();
    expect(row().querySelector(".foliplus-layer-attrs-panel")).toBeNull();
  });

  it("LAYER_REMOVED of the anchor closes the open surface", () => {
    ui.openAttrsPanel(row());
    expect(ui.overlayPanel.surface?.kind).toBe("attrs");

    ui.events.emit(EVENTS.LAYER_REMOVED, { id: "overlay1" });

    expect(ui.overlayPanel.surface).toBeNull();
  });
});
