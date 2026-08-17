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
  it("registerSchemeBarEvents returns cleanup", () => {
    const ctrl = makeCtrl();
    const cleanup = registerSchemeBarEvents(ctrl.map, ctrl);
    expect(typeof cleanup).toBe("function");
    cleanup();
  });

  it("registerDropdownEvents returns cleanup", () => {
    const ctrl = makeCtrl();
    const items: HTMLElement[] = [document.createElement("div"), document.createElement("div")];
    const cleanup = registerDropdownEvents(ctrl.map, ctrl, items);
    expect(typeof cleanup).toBe("function");
    cleanup();
  });
});
