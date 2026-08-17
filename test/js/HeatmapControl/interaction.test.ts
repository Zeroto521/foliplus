import { describe, expect, it, vi } from "vitest";
import { registerSchemeBarEvents, registerDropdownEvents } from "#foliplus/HeatmapControl/interaction.js";

function makeCtrl(): any {
  const map: any = {
    foliplus: {},
    getContainer: vi.fn(() => document.createElement("div")),
    on: vi.fn(),
  };
  const schemeBar = document.createElement("div");
  const schemeDropdown = document.createElement("div");
  document.body.appendChild(schemeBar);
  return {
    map,
    schemeBar,
    schemeDropdown,
    availableSchemes: ["thermal", "rainbow", "grayscale"],
    scheme: "thermal",
    updateScheme: vi.fn(),
    toggleDropdown: vi.fn(),
    selectScheme: vi.fn(),
  };
}

describe("HeatmapControl interaction", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("registerSchemeBarEvents returns cleanup", () => {
    const ctrl = makeCtrl();
    const cleanup = registerSchemeBarEvents(ctrl.map, ctrl);
    expect(typeof cleanup).toBe("function");
    cleanup();
  });

  it("ArrowLeft on schemeBar triggers prev scheme", () => {
    const ctrl = makeCtrl();
    ctrl.scheme = "rainbow"; // Start from middle
    const cleanup = registerSchemeBarEvents(ctrl.map, ctrl);
    ctrl.schemeBar.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(ctrl.updateScheme).toHaveBeenCalled();
    expect(ctrl.scheme).toBe("thermal");
    cleanup();
  });

  it("ArrowRight on schemeBar triggers next scheme", () => {
    const ctrl = makeCtrl();
    ctrl.scheme = "rainbow"; // Start from middle
    const cleanup = registerSchemeBarEvents(ctrl.map, ctrl);
    ctrl.schemeBar.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(ctrl.updateScheme).toHaveBeenCalled();
    expect(ctrl.scheme).toBe("grayscale");
    cleanup();
  });

  it("Enter on schemeBar calls toggleDropdown", () => {
    const ctrl = makeCtrl();
    const cleanup = registerSchemeBarEvents(ctrl.map, ctrl);
    ctrl.schemeBar.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(ctrl.toggleDropdown).toHaveBeenCalled();
    cleanup();
  });

  it("registerDropdownEvents returns cleanup", () => {
    const ctrl = makeCtrl();
    const items: HTMLElement[] = [document.createElement("div"), document.createElement("div")];
    document.body.appendChild(items[0]);
    document.body.appendChild(items[1]);
    const cleanup = registerDropdownEvents(ctrl.map, ctrl, items);
    expect(typeof cleanup).toBe("function");
    cleanup();
  });
});
