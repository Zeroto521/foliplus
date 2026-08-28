import { describe, expect, it, vi } from "vitest";
import {
  registerCropMouseDown,
  registerDrag,
  registerInteractions,
} from "#foliplus/ExportControl/interaction.js";

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

  it("cleanup unregisters all shortcuts (Escape + Enter)", () => {
    const mgr = makeMgr();
    const cleanup = registerInteractions(mgr);
    const container = mgr.map.getContainer();
    container.setAttribute("tabindex", "-1");
    container.focus();

    // Verify both shortcuts respond before cleanup
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    container.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(mgr.onKeyDown).toHaveBeenCalledTimes(2);

    // After cleanup, none of them should fire
    cleanup();
    mgr.onKeyDown.mockClear();
    container.focus();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    container.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(mgr.onKeyDown).not.toHaveBeenCalled();
  });

  it("Escape handler calls onKeyDown", () => {
    const mgr = makeMgr();
    const cleanup = registerInteractions(mgr);
    const container = mgr.map.getContainer();
    container.setAttribute("tabindex", "-1");
    document.body.appendChild(container);
    container.focus();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
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
    container.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
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

  it("registerDrag is removed after cleanup", () => {
    const mgr = makeMgr();
    const cleanup = registerDrag(mgr);
    cleanup();
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    expect(mgr.onMouseMove).not.toHaveBeenCalled();
    expect(mgr.onMouseUp).not.toHaveBeenCalled();
  });

  it("registerCropMouseDown is removed after cleanup", () => {
    const mgr = makeMgr();
    const el = document.createElement("div");
    document.body.appendChild(el);
    const cleanup = registerCropMouseDown(mgr, el);
    cleanup();
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(mgr.onMouseDown).not.toHaveBeenCalled();
  });

  it("drag handlers do not preventDefault on non-mouse events", () => {
    const mgr = makeMgr();
    const cleanup = registerDrag(mgr);
    // Mousemove and mouseup are registered; keydown should not dispatch to them
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(mgr.onMouseMove).not.toHaveBeenCalled();
    expect(mgr.onMouseUp).not.toHaveBeenCalled();
    cleanup();
  });

  it("Escape does not fire onKeyDown when document is in fullscreen", () => {
    const mgr = makeMgr();
    const cleanup = registerInteractions(mgr);
    // Simulate fullscreen by setting document.fullscreenElement
    Object.defineProperty(document, "fullscreenElement", {
      value: document.body,
      configurable: true,
    });

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(mgr.onKeyDown).not.toHaveBeenCalled();

    cleanup();
    Object.defineProperty(document, "fullscreenElement", {
      value: null,
      configurable: true,
    });
  });

  it("Escape fires onKeyDown when document is NOT in fullscreen", () => {
    const mgr = makeMgr();
    const cleanup = registerInteractions(mgr);

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(mgr.onKeyDown).toHaveBeenCalled();

    cleanup();
  });
});
