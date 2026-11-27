// test/js/control/LayerControl/ui/overlayPanel/openSurface — the single
// "what is open" state machine.
//
// The pairwise matrix in ../teardown.test.ts pins mutual exclusion through the
// user-facing entry points. This file pins the machine itself: one stored
// state, projections for readers, the close dispatch, and the extension-point
// table every surface kind must register into.
import { repoPath } from "#test/path.js";
import { findItem, initFixture } from "../fixture.js";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS, publish } from "#core/event/index.js";
import type { LayerUI } from "#control/LayerControl/ui/index.js";
import {
  type OpenSurface,
  SURFACE_KINDS,
  clearSurface,
  closeSurface,
  openSurface,
  registerSurfaceCloser,
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
    openSurface(ui, { kind: "ghost" } as unknown as OpenSurface);

    expect(closeSurface(ui)).toBe(true);
    expect(ui.overlayPanel.surface).toBeNull();
  });

  it("every OpenSurface kind registers a closer once the shell is imported", () => {
    // The extension point is a two-sided contract. SURFACE_KINDS is
    // compiler-tied to the OpenSurface union (openSurface.ts asserts the two
    // agree in both directions), so a new kind cannot be added without listing
    // it — and a listed kind whose owner forgot registerSurfaceCloser fails
    // here instead of leaking an un-closable surface in the browser.
    expect([...surfaceCloserKinds()].sort()).toEqual([...SURFACE_KINDS].sort());
  });

  it("a throwing closer cannot wedge the machine", () => {
    ui.openMoreMenu(row());
    const closer = vi.fn(() => {
      throw new Error("closer-boom");
    });
    const previous = registerSurfaceCloser("menu", closer);
    try {
      // The close dispatch runs from the OVERLAY_CLEAR subscription; the bus
      // records the failure instead of aborting the opener, and the machine's
      // finally must leave NO surface behind — otherwise openSurface would see
      // the dead menu record and dispatch this same throwing closer a second
      // time (the Py2 bug this test pins).
      expect(() => ui.openAttrsPanel(row())).not.toThrow();
    } finally {
      registerSurfaceCloser("menu", previous!);
    }

    expect(ui.overlayPanel.surface?.kind).toBe("attrs");
    expect(ui.overlayPanel.activeAttrsPanel?.layerId).toBe("overlay1");
    expect(closer).toHaveBeenCalledTimes(1);
    // And the machine is still usable: a normal close works afterwards.
    expect(closeSurface(ui)).toBe(true);
    expect(ui.overlayPanel.surface).toBeNull();
  });

  it("re-opening the same kind closes the first surface before storing the next", () => {
    ui.openMoreMenu(row());
    const first = ui.overlayPanel.activeMenu!;

    ui.openMoreMenu(row());
    const second = ui.overlayPanel.activeMenu!;

    expect(second).not.toBe(first);
    expect(ui.overlayPanel.surface).toBe(second);
    expect(first.menu.isConnected).toBe(false);
    expect(second.menu.isConnected).toBe(true);
  });

  it("no production reader consults the menu's .open DOM class", () => {
    // The extension point's third leg: the class is a render product. This pins
    // that nothing reads it as state — a new reader would reintroduce the second
    // source of truth this machine replaced.
    const layerControlDir = repoPath("foliplus/js/control/LayerControl");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts")) files.push(full);
      }
    };
    walk(layerControlDir);

    // Reads: classList.contains / a selector mentioning the bare .open class.
    // Writes (classList.add/remove, a class attribute literal) are the render
    // product itself and stay legal.
    const readerPattern =
      /classList\.contains\(\s*["'`]open["'`]\s*\)|(?:querySelector|querySelectorAll|closest|matches)\(\s*[\s\S]{0,80}?\.open\b/;
    const readers = files.flatMap(file =>
      readFileSync(file, "utf8")
        .split("\n")
        .map((text, index) => ({ file, line: index + 1, text }))
        .filter(row => readerPattern.test(row.text)),
    );

    expect(readers).toEqual([]);
    // Guard the guard: the class is still written where the menu is built, so a
    // rename of that class cannot make the scan above trivially empty.
    const menuSource = readFileSync(
      join(layerControlDir, "ui/overlayPanel/menu.ts"),
      "utf8",
    );
    expect(menuSource.match(/\bopen`/g)?.length).toBe(3);
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

  it("OVERLAY_CLEAR closes the open surface (the lifecycle subscription is wired)", () => {
    // The cross-kind matrix cannot prove this: every opener also closes the
    // previous surface through openSurface itself, so that matrix stays green
    // even if the OVERLAY_CLEAR subscription disappeared. closeOverlays
    // (teardown.ts) is the one path that depends on the subscription.
    ui.openAttrsPanel(row());
    expect(ui.overlayPanel.surface?.kind).toBe("attrs");

    publish(ui.events, EVENTS.OVERLAY_CLEAR);

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
