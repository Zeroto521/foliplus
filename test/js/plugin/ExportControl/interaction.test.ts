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
    onKeyUp: vi.fn(),
    onPointerDown: vi.fn(),
    onPointerMove: vi.fn(),
    onPointerUp: vi.fn(),
    onPointerCancel: vi.fn(),
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

  it("R and arrow keys reach onKeyDown when container is focused", () => {
    const mgr = makeMgr();
    const cleanup = registerInteractions(mgr);
    const container = mgr.map.getContainer();
    container.setAttribute("tabindex", "-1");
    document.body.appendChild(container);
    container.focus();

    for (const key of ["r", "R", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
      container.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    }
    expect(mgr.onKeyDown).toHaveBeenCalledTimes(6);
    cleanup();
  });

  it("arrow keyup reaches onKeyUp when the container is focused", () => {
    const mgr = makeMgr();
    const cleanup = registerInteractions(mgr);
    const container = mgr.map.getContainer();
    container.setAttribute("tabindex", "-1");
    document.body.appendChild(container);
    container.focus();

    for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
      container.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
    }
    expect(mgr.onKeyUp).toHaveBeenCalledTimes(4);
    cleanup();
  });

  it("arrow keyup fires globally even when container is not focused", () => {
    // The keyup must fire globally, not container-bound, because focus can
    // leave the map between keydown and keyup (click elsewhere, Tab). If the
    // matching keyup were container-bound it'd be filtered out and the
    // rafLoop would drift forever. onKeyUp only acts on arrow keys and
    // stops the loop, so firing globally is safe.
    const mgr = makeMgr();
    const cleanup = registerInteractions(mgr);
    const container = mgr.map.getContainer();
    container.setAttribute("tabindex", "-1");
    document.body.appendChild(container);
    // Focus body, NOT the container — the old behavior silently dropped
    // keyup here; the new behavior catches it.
    document.body.focus();

    for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
      document.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
    }
    expect(mgr.onKeyUp).toHaveBeenCalledTimes(4);
    cleanup();
  });

  it("R and arrow keys do not fire when the container is not focused", () => {
    const mgr = makeMgr();
    const cleanup = registerInteractions(mgr);
    const container = mgr.map.getContainer();
    container.setAttribute("tabindex", "-1");
    document.body.appendChild(container);
    document.body.focus();

    for (const key of ["r", "R", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
      document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    }
    expect(mgr.onKeyDown).not.toHaveBeenCalled();
    cleanup();
  });

  it("cleanup suppresses R and arrow keys", () => {
    const mgr = makeMgr();
    const cleanup = registerInteractions(mgr);
    const container = mgr.map.getContainer();
    container.setAttribute("tabindex", "-1");
    document.body.appendChild(container);
    container.focus();

    cleanup();
    for (const key of ["r", "R", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
      container.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    }
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

  it("registerDrag pointermove and pointerup handlers work", () => {
    const mgr = makeMgr();
    const cleanup = registerDrag(mgr);
    document.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, pointerId: 1 }),
    );
    expect(mgr.onPointerMove).toHaveBeenCalled();
    document.dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }),
    );
    expect(mgr.onPointerUp).toHaveBeenCalled();
    cleanup();
  });

  it("registerDrag pointercancel handler releases the drag", () => {
    // A pinch or OS gesture cancels the pointer without a pointerup; the drag
    // must end there, otherwise the next drag inherits the stale anchor.
    const mgr = makeMgr();
    const cleanup = registerDrag(mgr);
    document.dispatchEvent(
      new PointerEvent("pointercancel", { bubbles: true, pointerId: 1 }),
    );
    expect(mgr.onPointerCancel).toHaveBeenCalled();
    cleanup();
  });

  it("registerCropMouseDown pointerdown handler calls onPointerDown", () => {
    const mgr = makeMgr();
    const el = document.createElement("div");
    document.body.appendChild(el);
    const cleanup = registerCropMouseDown(mgr, el);
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(mgr.onPointerDown).toHaveBeenCalled();
    cleanup();
  });

  it("registerDrag is removed after cleanup", () => {
    const mgr = makeMgr();
    const cleanup = registerDrag(mgr);
    cleanup();
    document.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, pointerId: 1 }),
    );
    document.dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }),
    );
    expect(mgr.onPointerMove).not.toHaveBeenCalled();
    expect(mgr.onPointerUp).not.toHaveBeenCalled();
  });

  it("registerCropMouseDown is removed after cleanup", () => {
    const mgr = makeMgr();
    const el = document.createElement("div");
    document.body.appendChild(el);
    const cleanup = registerCropMouseDown(mgr, el);
    cleanup();
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(mgr.onPointerDown).not.toHaveBeenCalled();
  });

  it("drag handlers do not fire for non-pointer events", () => {
    const mgr = makeMgr();
    const cleanup = registerDrag(mgr);
    // pointermove and pointerup are registered; keydown must not dispatch
    // to them.
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(mgr.onPointerMove).not.toHaveBeenCalled();
    expect(mgr.onPointerUp).not.toHaveBeenCalled();
    // Legacy mouse events must not drive the drag either, or the old jump
    // path would come back through the mouse listener while the pointer
    // listeners hold the capture.
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    expect(mgr.onPointerMove).not.toHaveBeenCalled();
    expect(mgr.onPointerUp).not.toHaveBeenCalled();
    cleanup();
  });
});
