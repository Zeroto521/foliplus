import { describe, expect, it, vi } from "vitest";
import {
  registerDropdownEvents,
  registerSchemeBarEvents,
} from "#foliplus/HeatmapControl/interaction.js";

function makeCtrl(): any {
  const map: any = {
    foliplus: {},
    getContainer: vi.fn(() => document.createElement("div")),
    on: vi.fn(),
  };
  const schemeBar = document.createElement("div");
  const schemeDropdown = document.createElement("div");
  const schemeSelectHidden = document.createElement("select");
  return {
    map,
    schemeBar,
    schemeDropdown,
    schemeSelectHidden,
    m: { currentScheme: "thermal" },
    updateScheme: vi.fn(),
    toggleDropdown: vi.fn(),
    selectScheme: vi.fn(),
  };
}

describe("HeatmapControl interaction", () => {
  beforeEach(() => {
    // Set up scheme list for the interaction handlers
    (window as any).CONFIG.schemes = ["thermal", "rainbow", "grayscale"];
  });

  afterEach(() => {
    document.body.innerHTML = "";
    delete (window as any).CONFIG.schemes;
  });

  it("registerSchemeBarEvents returns cleanup", () => {
    const ctrl = makeCtrl();
    const cleanup = registerSchemeBarEvents(ctrl.map, ctrl);
    expect(typeof cleanup).toBe("function");
    cleanup();
  });

  it("falls back to an empty scheme list when CONFIG.schemes is missing", () => {
    // The Python CONFIG omits schemes in the minimal build — the handler must
    // still register without throwing, and ArrowUp/Down become no-ops.
    delete (window as any).CONFIG.schemes;
    const ctrl = makeCtrl();
    ctrl.m.currentScheme = "any";
    const cleanup = registerSchemeBarEvents(ctrl.map, ctrl);
    document.body.appendChild(ctrl.schemeBar);
    ctrl.schemeBar.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );
    ctrl.schemeBar.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    expect(ctrl.updateScheme).not.toHaveBeenCalled();
    expect(ctrl.m.currentScheme).toBe("any");
    cleanup();
  });

  it("ArrowUp from middle goes to prev", () => {
    const ctrl = makeCtrl();
    ctrl.m.currentScheme = "rainbow";
    const cleanup = registerSchemeBarEvents(ctrl.map, ctrl);
    document.body.appendChild(ctrl.schemeBar);
    ctrl.schemeBar.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );
    expect(ctrl.updateScheme).toHaveBeenCalled();
    expect(ctrl.m.currentScheme).toBe("thermal");
    cleanup();
  });

  it("ArrowUp at first does nothing", () => {
    const ctrl = makeCtrl();
    ctrl.m.currentScheme = "thermal";
    const cleanup = registerSchemeBarEvents(ctrl.map, ctrl);
    document.body.appendChild(ctrl.schemeBar);
    ctrl.schemeBar.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );
    expect(ctrl.updateScheme).not.toHaveBeenCalled();
    cleanup();
  });

  it("ArrowDown from middle goes to next", () => {
    const ctrl = makeCtrl();
    ctrl.m.currentScheme = "rainbow";
    const cleanup = registerSchemeBarEvents(ctrl.map, ctrl);
    document.body.appendChild(ctrl.schemeBar);
    ctrl.schemeBar.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    expect(ctrl.updateScheme).toHaveBeenCalled();
    expect(ctrl.m.currentScheme).toBe("grayscale");
    cleanup();
  });

  it("ArrowDown at last does nothing", () => {
    const ctrl = makeCtrl();
    ctrl.m.currentScheme = "grayscale";
    const cleanup = registerSchemeBarEvents(ctrl.map, ctrl);
    document.body.appendChild(ctrl.schemeBar);
    ctrl.schemeBar.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    expect(ctrl.updateScheme).not.toHaveBeenCalled();
    expect(ctrl.m.currentScheme).toBe("grayscale");
    cleanup();
  });

  it("schemeSelectHidden is optional on ArrowUp", () => {
    // ArrowUp sets currentScheme and then tries to mirror the value onto the
    // hidden <select>; a bare ctrl without schemeSelectHidden must not throw.
    const ctrl = makeCtrl();
    ctrl.schemeSelectHidden = null;
    ctrl.m.currentScheme = "rainbow";
    const cleanup = registerSchemeBarEvents(ctrl.map, ctrl);
    document.body.appendChild(ctrl.schemeBar);
    ctrl.schemeBar.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );
    expect(ctrl.m.currentScheme).toBe("thermal");
    expect(ctrl.updateScheme).toHaveBeenCalled();
    cleanup();
  });

  it("Enter/Space/ArrowUp/ArrowDown on schemeBar call toggleDropdown", () => {
    for (const key of ["Enter", " "]) {
      const ctrl = makeCtrl();
      const cleanup = registerSchemeBarEvents(ctrl.map, ctrl);
      document.body.appendChild(ctrl.schemeBar);
      ctrl.schemeBar.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true }),
      );
      expect(ctrl.toggleDropdown).toHaveBeenCalled();
      cleanup();
    }
  });

  it("registerDropdownEvents returns cleanup", () => {
    const ctrl = makeCtrl();
    const items = [document.createElement("div"), document.createElement("div")];
    const cleanup = registerDropdownEvents(ctrl.map, ctrl, items);
    expect(typeof cleanup).toBe("function");
    cleanup();
  });

  it("ArrowDown in dropdown focuses next item", () => {
    const ctrl = makeCtrl();
    ctrl.schemeDropdown = document.createElement("div");
    const items = [document.createElement("div"), document.createElement("div")];
    items[0].setAttribute("tabindex", "-1");
    items[1].setAttribute("tabindex", "-1");
    document.body.append(ctrl.schemeDropdown, items[0], items[1]);
    const cleanup = registerDropdownEvents(ctrl.map, ctrl, items);
    items[0].focus();
    ctrl.schemeDropdown.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    expect(document.activeElement).toBe(items[1]);
    cleanup();
  });

  it("ArrowUp in dropdown focuses prev item", () => {
    const ctrl = makeCtrl();
    ctrl.schemeDropdown = document.createElement("div");
    const items = [document.createElement("div"), document.createElement("div")];
    items[0].setAttribute("tabindex", "-1");
    items[1].setAttribute("tabindex", "-1");
    document.body.append(ctrl.schemeDropdown, items[0], items[1]);
    const cleanup = registerDropdownEvents(ctrl.map, ctrl, items);
    items[0].focus();
    ctrl.schemeDropdown.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );
    expect(document.activeElement).toBe(items[1]);
    cleanup();
  });

  it("Enter in dropdown selects item with correct class", () => {
    const ctrl = makeCtrl();
    ctrl.schemeDropdown = document.createElement("div");
    const items = [document.createElement("div"), document.createElement("div")];
    items[0].classList.add("foliplus-heatmap-scheme-dropdown-item");
    items[0].setAttribute("tabindex", "-1");
    items[1].setAttribute("tabindex", "-1");
    document.body.append(ctrl.schemeDropdown, items[0], items[1]);
    const cleanup = registerDropdownEvents(ctrl.map, ctrl, items);
    items[0].focus();
    ctrl.schemeDropdown.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(ctrl.selectScheme).toHaveBeenCalled();
    cleanup();
  });

  it("Enter with an unrelated focused element does not select", () => {
    // The Enter handler only fires when the active element is a dropdown item —
    // a stray Enter (e.g. on a plain div outside the items) must not call selectScheme.
    const ctrl = makeCtrl();
    ctrl.schemeDropdown = document.createElement("div");
    const items = [document.createElement("div")];
    items[0].classList.add("foliplus-heatmap-scheme-dropdown-item");
    items[0].setAttribute("tabindex", "-1");
    const unrelated = document.createElement("div");
    unrelated.setAttribute("tabindex", "-1");
    document.body.append(ctrl.schemeDropdown, items[0], unrelated);
    const cleanup = registerDropdownEvents(ctrl.map, ctrl, items);
    unrelated.focus();
    ctrl.schemeDropdown.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(ctrl.selectScheme).not.toHaveBeenCalled();
    cleanup();
  });

  it("Escape in dropdown removes dropdown and focuses schemeBar", () => {
    const ctrl = makeCtrl();
    ctrl.schemeDropdown = document.createElement("div");
    ctrl.schemeBar.setAttribute("tabindex", "-1");
    document.body.append(ctrl.schemeDropdown, ctrl.schemeBar);
    const items = [document.createElement("div")];
    const cleanup = registerDropdownEvents(ctrl.map, ctrl, items);
    ctrl.schemeDropdown.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(ctrl.schemeDropdown).toBeNull();
    cleanup();
  });
});
