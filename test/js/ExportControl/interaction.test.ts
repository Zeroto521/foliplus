import { describe, expect, it, vi } from "vitest";
import { registerInteractions, registerDrag, registerCropMouseDown } from "#foliplus/ExportControl/interaction.js";

function makeMgr(): any {
  const map: any = {
    foliplus: {},
    getContainer: vi.fn(() => document.createElement("div")),
    on: vi.fn(),
  };
  return {
    map,
    onKeyDown: vi.fn(),
    onMouseDown: vi.fn(),
    onMouseMove: vi.fn(),
    onMouseUp: vi.fn(),
  };
}

describe("ExportControl interaction", () => {
  it("registerInteractions returns cleanup", () => {
    const mgr = makeMgr();
    const cleanup = registerInteractions(mgr);
    expect(typeof cleanup).toBe("function");
    cleanup();
  });

  it("registerDrag returns cleanup", () => {
    const mgr = makeMgr();
    const cleanup = registerDrag(mgr);
    expect(typeof cleanup).toBe("function");
    cleanup();
  });

  it("registerCropMouseDown returns cleanup", () => {
    const mgr = makeMgr();
    const el = document.createElement("div");
    const cleanup = registerCropMouseDown(mgr, el);
    expect(typeof cleanup).toBe("function");
    cleanup();
  });
});
