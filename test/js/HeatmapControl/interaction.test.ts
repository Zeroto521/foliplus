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
    (window as any).CONF.schemes = ["thermal", "rainbow", "grayscale"];
  });

  afterEach(() => {
    document.body.innerHTML = "";
    delete (window as any).CONF.schemes;
  });

  it("registerSchemeBarEvents returns cleanup", () => {
    const ctrl = makeCtrl();
    const cleanup = registerSchemeBarEvents(ctrl.map, ctrl);
    expect(typeof cleanup).toBe("function");
    cleanup();
  });

  it("ArrowLeft from middle goes to prev", () => {
    const ctrl = makeCtrl();
    ctrl.m.currentScheme = "rainbow";
    const cleanup = registerSchemeBarEvents(ctrl.map, ctrl);
    document.body.appendChild(ctrl.schemeBar);
    ctrl.schemeBar.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
    );
    expect(ctrl.updateScheme).toHaveBeenCalled();
    expect(ctrl.m.currentScheme).toBe("thermal");
    cleanup();
  });

  it("ArrowLeft at first does nothing", () => {
    const ctrl = makeCtrl();
    ctrl.m.currentScheme = "thermal";
    const cleanup = registerSchemeBarEvents(ctrl.map, ctrl);
    document.body.appendChild(ctrl.schemeBar);
    ctrl.schemeBar.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
    );
    expect(ctrl.updateScheme).not.toHaveBeenCalled();
    cleanup();
  });

  it("ArrowRight from middle goes to next", () => {
    const ctrl = makeCtrl();
    ctrl.m.currentScheme = "rainbow";
    const cleanup = registerSchemeBarEvents(ctrl.map, ctrl);
    document.body.appendChild(ctrl.schemeBar);
    ctrl.schemeBar.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    expect(ctrl.updateScheme).toHaveBeenCalled();
    expect(ctrl.m.currentScheme).toBe("grayscale");
    cleanup();
  });

  it("Enter/Space/ArrowUp/ArrowDown on schemeBar call toggleDropdown", () => {
    for (const key of ["Enter", " ", "ArrowUp", "ArrowDown"]) {
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
