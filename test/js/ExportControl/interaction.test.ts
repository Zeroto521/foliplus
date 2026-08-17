import { describe, expect, it, vi } from "vitest";
import { registerInteractions, registerDrag, registerCropMouseDown } from "#foliplus/ExportControl/interaction.js";

function makeMgr(): any {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const map: any = {
    foliplus: {},
    getContainer: vi.fn(() => container),
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
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("registerInteractions returns cleanup", () => {
    const mgr = makeMgr();
    const cleanup = registerInteractions(mgr);
    expect(typeof cleanup).toBe("function");
    cleanup();
  });

  it("Escape handler calls onKeyDown", () => {
    const mgr = makeMgr();
    const cleanup = registerInteractions(mgr);
    const container = mgr.map.getContainer();
    container.setAttribute("tabindex", "-1");
    document.body.appendChild(container);
    container.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(mgr.onKeyDown).toHaveBeenCalled();
    cleanup();
  });

  it("Ctrl+Z handler calls onKeyDown", () => {
    const mgr = makeMgr();
    const cleanup = registerInteractions(mgr);
    const container = mgr.map.getContainer();
    container.setAttribute("tabindex", "-1");
    document.body.appendChild(container);
    container.focus();
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
    expect(mgr.onKeyDown).toHaveBeenCalled();
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

  it("Enter handler calls onKeyDown", () => {
    const mgr = makeMgr();
    const cleanup = registerInteractions(mgr);
    const container = mgr.map.getContainer();
    container.setAttribute("tabindex", "-1");
    document.body.appendChild(container);
    container.focus();
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(mgr.onKeyDown).toHaveBeenCalled();
    cleanup();
  });

  it("Ctrl+Shift+Z handler calls onKeyDown", () => {
    const mgr = makeMgr();
    const cleanup = registerInteractions(mgr);
    const container = mgr.map.getContainer();
    container.setAttribute("tabindex", "-1");
    document.body.appendChild(container);
    container.focus();
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, shiftKey: true, bubbles: true }));
    expect(mgr.onKeyDown).toHaveBeenCalled();
    cleanup();
  });

  it("registerDrag mousemove and mouseup handlers work", () => {
    const mgr = makeMgr();
    const cleanup = registerDrag(mgr);
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    expect(mgr.onMouseMove).toHaveBeenCalled();
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    expect(mgr.onMouseUp).toHaveBeenCalled();
    cleanup();
  });

  it("registerCropMouseDown mousedown handler calls onMouseDown", () => {
    const mgr = makeMgr();
    const el = document.createElement("div");
    document.body.appendChild(el);
    const cleanup = registerCropMouseDown(mgr, el);
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(mgr.onMouseDown).toHaveBeenCalled();
    cleanup();
  });
});
