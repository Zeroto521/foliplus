import { describe, expect, it, vi } from "vitest";
import {
  registerExportClick,
  registerInteractions,
} from "#foliplus/MeasureControl/interaction.js";

function makeMgr(): any {
  const map: any = {
    foliplus: {},
    getContainer: vi.fn(() => document.createElement("div")),
    on: vi.fn(),
  };
  return {
    map,
    currentMode: null,
    onKeyDown: vi.fn(),
    clearActiveMode: vi.fn(),
  };
}

describe("MeasureControl interaction", () => {
  it("registerInteractions returns cleanup function", () => {
    const mgr = makeMgr();
    const cleanup = registerInteractions(mgr);
    expect(typeof cleanup).toBe("function");
    cleanup();
  });

  it("Escape handler calls onKeyDown", () => {
    const mgr = makeMgr();
    const handler = registerInteractions(mgr);
    // Simulate Escape keydown via document
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(mgr.onKeyDown).toHaveBeenCalled();
    handler();
  });
});

describe("registerExportClick", () => {
  it("binds a click handler to the given element", () => {
    const mgr = makeMgr() as any;
    mgr.onExportClick = vi.fn();
    const el = document.createElement("button");
    const cleanup = registerExportClick(mgr, el);
    el.click();
    expect(mgr.onExportClick).toHaveBeenCalled();
    cleanup();
  });
});
