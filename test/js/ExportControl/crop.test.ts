import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/ExportControl/const.js";
import { ExportManager } from "#foliplus/ExportControl/manager.js";

vi.mock("#common/locale.js", async () => {
  const real = await vi.importActual("#common/locale.js");
  const TABLES: Record<string, string> = {
    hint_locked: "Locked: resize with the handles",
    hint_restore: "Restored saved crop area",
    hint_unlocked: "Resize the crop area",
    status_exporting: "Exporting map...",
    status_progress: "Exporting map... ({pct}%)",
    status_success: "Export successful",
  };
  return {
    ...real,
    createScopedTranslator: (_conf: { name: string }) => (key: string) =>
      TABLES[key] ?? key,
  };
});

// Hoistable mock for guardBlocked — nudgeCropBoxDelta and other crop module
// paths run doExport through the manager delegate; guardBlocked sits in
// session.ts's doExport so the crop-module tests must neutralize it.
const modeMocks = vi.hoisted(() => ({
  guardBlocked: vi.fn(() => false),
}));

vi.mock("#core/mode.js", async () => {
  const real = (await vi.importActual("#core/mode.js")) as Record<string, unknown>;
  return {
    ...real,
    guardBlocked: modeMocks.guardBlocked,
  };
});

// geotiff bundles web-worker which cannot initialize under vitest --pool=threads.
vi.mock("geotiff", () => ({
  writeArrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
}));
vi.mock("pako", async () => vi.importActual("pako"));

function makeMapMock() {
  const container = document.createElement("div");
  return {
    getContainer: () => container,
    getBounds: () => ({
      getSouth: () => -90,
      getNorth: () => 90,
      getEast: () => 180,
      getWest: () => -180,
    }),
    latLngToContainerPoint: vi.fn(({ lat, lng }) => ({ x: lng, y: lat })),
    dragging: { disable: vi.fn(), enable: vi.fn() },
    scrollWheelZoom: { disable: vi.fn(), enable: vi.fn() },
    doubleClickZoom: { disable: vi.fn(), enable: vi.fn() },
    boxZoom: { disable: vi.fn(), enable: vi.fn() },
    keyboard: { disable: vi.fn(), enable: vi.fn() },
    touchZoom: { disable: vi.fn(), enable: vi.fn() },
    foliplus: { showHint: vi.fn(), hideHint: vi.fn() },
    on: vi.fn(),
    off: vi.fn(),
    eachLayer: vi.fn(),
  };
}

function makeManager(scheduler?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>) {
  window.CONF = { ...window.CONF, name: "ExportControl", timeout: 7500 };
  const manager = scheduler
    ? new ExportManager(makeMapMock(), scheduler)
    : new ExportManager(makeMapMock());
  manager.showCropBox = vi.fn();
  manager.lockCropBox = vi.fn();
  manager.unlockCropBox = vi.fn();
  manager.removeCropBox = vi.fn();
  manager.updateBoxStyle = vi.fn();
  manager.showHintWithInfo = vi.fn();
  manager.showGlobalHint = vi.fn();
  return manager;
}

function setCropState(manager, rect = { left: 10, top: 10, width: 100, height: 100 }) {
  const box = document.createElement("div");
  manager.cropState = { rect, locked: false, box, geoBounds: null };
}

describe("cropMethods — resetCropBox / nudgeCropBox", () => {
  let manager;

  beforeEach(() => {
    manager = makeManager();
    setCropState(manager);
    manager.mapContainer.getBoundingClientRect = () => ({
      width: 500,
      height: 400,
    });
  });

  it("resetCropBox restores the default centered box", () => {
    manager.cropState.rect = { left: 10, top: 10, width: 100, height: 100 };
    manager.resetCropBox();
    // defaultRect with a 500x400 map and PADDING_RATIO 0.25
    expect(manager.cropState.rect).toEqual({
      left: 125,
      top: 100,
      width: 250,
      height: 200,
    });
    expect(manager.updateBoxStyle).toHaveBeenCalled();
    expect(manager.showHintWithInfo).toHaveBeenCalled();
  });

  it("resetCropBox is a no-op when locked", () => {
    manager.cropState.locked = true;
    manager.cropState.rect = { left: 10, top: 10, width: 100, height: 100 };
    manager.resetCropBox();
    expect(manager.cropState.rect).toEqual({
      left: 10,
      top: 10,
      width: 100,
      height: 100,
    });
    expect(manager.updateBoxStyle).not.toHaveBeenCalled();
  });

  it("nudgeCropBox moves right by NUDGE_STEP", () => {
    manager.cropState.rect = { left: 100, top: 100, width: 100, height: 100 };
    manager.nudgeCropBox("ArrowRight");
    expect(manager.cropState.rect.left).toBe(100 + CONST.CROP.NUDGE_STEP);
    expect(manager.updateBoxStyle).toHaveBeenCalled();
  });

  it("nudgeCropBox moves left by NUDGE_STEP", () => {
    manager.cropState.rect = { left: 100, top: 100, width: 100, height: 100 };
    manager.nudgeCropBox("ArrowLeft");
    expect(manager.cropState.rect.left).toBe(100 - CONST.CROP.NUDGE_STEP);
  });

  it("applyRect is a no-op without a crop box", () => {
    manager.cropState = null;
    // applyRect guards against a missing crop box; call it directly (private).
    (manager as any).applyRect({ left: 0, top: 0, width: 50, height: 50 });
    expect(manager.updateBoxStyle).not.toHaveBeenCalled();
    expect(manager.showHintWithInfo).not.toHaveBeenCalled();
  });

  it("nudgeCropBox suppresses the box transition and does not refresh the hint", () => {
    // Keyboard auto-repeat fires several keydowns per second; the box's default
    // transition would make each nudge chase the input instead of tracking it,
    // so nudge adds the .dragging class (same suppression as mouse dragging).
    // And since the size never changes, the hint text is unchanged — refreshing
    // it would rebuild the element and re-run its entry animation every press.
    manager.nudgeCropBox("ArrowRight");
    expect(manager.cropState.box.classList.contains(CONST.CLASSES.DRAGGING)).toBe(true);
    expect(manager.showHintWithInfo).not.toHaveBeenCalled();
  });

  it("onKeyUp restores the box transition suppressed by nudging", () => {
    manager.nudgeCropBox("ArrowDown");
    expect(manager.cropState.box.classList.contains(CONST.CLASSES.DRAGGING)).toBe(true);

    manager.onKeyUp({ key: "ArrowDown" } as KeyboardEvent);
    expect(manager.cropState.box.classList.contains(CONST.CLASSES.DRAGGING)).toBe(
      false,
    );
  });

  it("onKeyUp for an arrow key stops the smooth-nudge loop", () => {
    // keyup is the release signal that must stop the rafLoop — without it the
    // loop keeps ticking at ~60Hz and the box drifts forever after a single
    // press. The loop is stored on manager.nudgeLoop (via the private
    // nudgeStart/nudgeStop pair) so we can assert it's cleared after keyup.
    manager.nudgeCropBox("ArrowRight");

    // Simulate the loop the manager would create on a real keydown.
    const loopStop = vi.fn();
    (manager as any).nudgeLoop = { start: vi.fn(), stop: loopStop };

    manager.onKeyUp({ key: "ArrowRight" } as KeyboardEvent);
    expect(loopStop).toHaveBeenCalledTimes(1);
    expect((manager as any).nudgeLoop).toBeUndefined();
  });

  it("onKeyUp ignores non-arrow keys and a missing crop box", () => {
    manager.onKeyUp({ key: "Enter" } as KeyboardEvent);
    expect(manager.cropState.box.classList.contains(CONST.CLASSES.DRAGGING)).toBe(
      false,
    );

    manager.cropState = null;
    manager.onKeyUp({ key: "ArrowLeft" } as KeyboardEvent);
  });

  it("nudgeCropBox moves up and clamps at the map top edge", () => {
    manager.cropState.rect = { left: 100, top: 0, width: 100, height: 100 };
    manager.nudgeCropBox("ArrowUp");
    expect(manager.cropState.rect.top).toBe(0);
  });

  it("nudgeCropBox clamps right edge to the map width", () => {
    manager.cropState.rect = { left: 400, top: 100, width: 100, height: 100 };
    manager.nudgeCropBox("ArrowRight");
    expect(manager.cropState.rect.left).toBe(500 - 100);
  });

  it("nudgeCropBox is a no-op when locked", () => {
    manager.cropState.locked = true;
    const before = { ...manager.cropState.rect };
    manager.nudgeCropBox("ArrowRight");
    expect(manager.cropState.rect).toEqual(before);
  });

  it("nudgeStop does not throw when the box is removed mid-nudge", () => {
    manager.nudgeCropBox("ArrowRight");
    manager.cropState = null;
    expect(() => manager.nudgeStop()).not.toThrow();
  });
});

describe("cropMethods — checkPixelLimit", () => {
  let manager;

  beforeEach(() => {
    manager = makeManager();
  });

  it("checkPixelLimit sets pixelOverLimit when over max_pixels", () => {
    window.CONF.max_pixels = 10000; // 100x100
    manager.checkPixelLimit({ width: 200, height: 200 });
    expect(manager.pixelOverLimit).toBe(true);
  });

  it("checkPixelLimit does not flag when under max_pixels", () => {
    window.CONF.max_pixels = 10000;
    manager.checkPixelLimit({ width: 50, height: 50 });
    expect(manager.pixelOverLimit).toBe(false);
  });

  it("checkPixelLimit does not flag when max_pixels is null", () => {
    window.CONF.max_pixels = null;
    manager.checkPixelLimit({ width: 9999, height: 9999 });
    expect(manager.pixelOverLimit).toBe(false);
  });
});

describe("cropMethods — pointer drag", () => {
  let manager;

  beforeEach(() => {
    manager = makeManager();
    setCropState(manager);
  });

  function makePointerEvent(opts: {
    clientX?: number;
    clientY?: number;
    pointerId?: number | null;
    target?: Element;
  } = {}) {
    const target = opts.target ?? document.createElement("div");
    return {
      clientX: opts.clientX ?? 0,
      clientY: opts.clientY ?? 0,
      pointerId: opts.pointerId ?? 1,
      target,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
      stopPropagation: vi.fn(),
    };
  }

  function makeDraggableContainer(width = 500, height = 400) {
    const container = manager.map.getContainer();
    container.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width,
      height,
      right: width,
      bottom: height,
    });
    return container;
  }

  it("onPointerDown sets dragging true for box body", () => {
    const box = document.createElement("div");
    box.classList.add(CONST.CLASSES.BOX);
    manager.cropState.box = box;
    const event = makePointerEvent({ target: box, clientX: 100, clientY: 100 });

    manager.onPointerDown(event as any);

    expect(manager.dragState.dragging).toBe(true);
    expect(manager.dragState.dragType).toBe("move");
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("onPointerDown captures the pointer on the box", () => {
    const box = document.createElement("div");
    box.classList.add(CONST.CLASSES.BOX);
    box.setPointerCapture = vi.fn();
    manager.cropState.box = box;
    const event = makePointerEvent({ target: box, pointerId: 42 });

    manager.onPointerDown(event as any);

    expect(box.setPointerCapture).toHaveBeenCalledWith(42);
  });

  it("onPointerDown still starts the drag if capture throws", () => {
    const box = document.createElement("div");
    box.classList.add(CONST.CLASSES.BOX);
    box.setPointerCapture = vi.fn(() => {
      throw new Error("capture failed");
    });
    manager.cropState.box = box;

    manager.onPointerDown(makePointerEvent({ target: box }) as any);

    expect(manager.dragState.dragging).toBe(true);
  });

  it("onPointerDown ignores a press outside the box and handles", () => {
    const outside = document.createElement("div");
    const event = makePointerEvent({ target: outside });

    manager.onPointerDown(event as any);

    expect(manager.dragState.dragging).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("onPointerDown sets dragType for a handle", () => {
    const handle = document.createElement("div");
    handle.classList.add(CONST.CLASSES.HANDLE);
    handle.dataset.pos = "tl";
    manager.cropState.box = document.createElement("div");

    manager.onPointerDown(makePointerEvent({ target: handle }) as any);

    expect(manager.dragState.dragType).toBe("tl");
  });

  it("onPointerDown sets dragType move for the center", () => {
    const center = document.createElement("div");
    center.classList.add(CONST.CLASSES.CENTER);
    manager.cropState.box = document.createElement("div");

    manager.onPointerDown(makePointerEvent({ target: center }) as any);

    expect(manager.dragState.dragType).toBe("move");
  });

  it("onPointerDown ignores the press when the box is locked", () => {
    manager.cropState.locked = true;
    const box = document.createElement("div");
    box.classList.add(CONST.CLASSES.BOX);
    manager.cropState.box = box;
    const event = makePointerEvent({ target: box });

    manager.onPointerDown(event as any);

    expect(manager.dragState.dragging).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("onPointerDown handle without data-pos falls back to a null drag type", () => {
    const handle = document.createElement("div");
    handle.classList.add(CONST.CLASSES.HANDLE);
    manager.cropState.box = document.createElement("div");

    manager.onPointerDown(makePointerEvent({ target: handle }) as any);

    expect(manager.dragState.dragging).toBe(true);
    expect(manager.dragState.dragType).toBeNull();
  });

  it("onPointerMove with a null drag type leaves the rect unchanged", () => {
    const rect = { left: 20, top: 20, width: 100, height: 80 };
    manager.cropState.rect = rect;
    manager.dragState.dragging = true;
    manager.dragState.dragType = null;
    manager.dragState.lastX = 10;
    manager.dragState.lastY = 10;
    makeDraggableContainer();

    manager.onPointerMove({ clientX: 30, clientY: 40 } as any);

    expect(manager.cropState.rect).toEqual(rect);
  });

  it("onPointerDown cancels the press so mousedown cannot also fire", () => {
    const box = document.createElement("div");
    box.classList.add(CONST.CLASSES.BOX);
    manager.cropState.box = box;
    const event = makePointerEvent({ target: box });

    manager.onPointerDown(event as any);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopImmediatePropagation).toHaveBeenCalled();
  });

  it("onPointerDown does not claim a press outside the box", () => {
    const outside = document.createElement("div");
    const event = makePointerEvent({ target: outside });

    manager.onPointerDown(event as any);

    expect(manager.dragState.dragging).toBe(false);
  });

  it("onPointerMove moves the box when dragging move", () => {
    manager.cropState.rect = { left: 50, top: 50, width: 100, height: 80 };
    manager.dragState = { dragging: true, dragType: "move", lastX: 100, lastY: 100 };
    makeDraggableContainer();

    manager.onPointerMove({ clientX: 130, clientY: 120 } as any);

    expect(manager.cropState.rect.left).toBe(80);
    expect(manager.cropState.rect.top).toBe(70);
    expect(manager.updateBoxStyle).toHaveBeenCalled();
  });

  it("onPointerMove does not advance the anchor when not dragging", () => {
    manager.cropState.rect = { left: 50, top: 50, width: 100, height: 80 };
    manager.dragState.dragging = false;
    makeDraggableContainer();

    manager.onPointerMove({ clientX: 200, clientY: 200 } as any);

    // Not dragging → early return; lastX/lastY are untouched.
    expect(manager.dragState.lastX).toBe(0);
    expect(manager.dragState.lastY).toBe(0);
  });

  it("onPointerMove resizes from a handle", () => {
    manager.cropState.rect = { left: 50, top: 50, width: 100, height: 80 };
    manager.dragState = { dragging: true, dragType: "br", lastX: 150, lastY: 130 };
    makeDraggableContainer(500, 400);

    manager.onPointerMove({ clientX: 170, clientY: 150 } as any);

    expect(manager.cropState.rect.width).toBe(120);
    expect(manager.cropState.rect.height).toBe(100);
  });

  it("onPointerMove resizes from a left handle", () => {
    manager.cropState.rect = { left: 50, top: 50, width: 100, height: 80 };
    manager.dragState = { dragging: true, dragType: "l", lastX: 100, lastY: 100 };
    makeDraggableContainer();

    manager.onPointerMove({ clientX: 130, clientY: 100 } as any);

    expect(manager.cropState.rect.left).toBe(80);
    expect(manager.cropState.rect.width).toBe(70);
  });

  it("onPointerMove clamps a left handle at MIN_SIZE when shrinking from the left", () => {
    // Dragging the left handle rightward shrinks the box; the shrink is
    // capped so the width never drops below CONST.CROP.MIN_SIZE — regardless
    // of where the pointer lands.
    manager.cropState.rect = { left: 10, top: 50, width: 100, height: 80 };
    manager.dragState = { dragging: true, dragType: "l", lastX: 100, lastY: 100 };
    makeDraggableContainer();

    manager.onPointerMove({ clientX: 200, clientY: 100 } as any);

    // dx = 100, but the allowed shrink is width - MIN_SIZE = 60.
    expect(manager.cropState.rect.left).toBe(10 + 60);
    expect(manager.cropState.rect.width).toBe(40);
  });

  it("onPointerMove resizes from a top handle", () => {
    manager.cropState.rect = { left: 50, top: 50, width: 100, height: 80 };
    manager.dragState = { dragging: true, dragType: "t", lastX: 100, lastY: 100 };
    makeDraggableContainer();

    manager.onPointerMove({ clientX: 100, clientY: 130 } as any);

    expect(manager.cropState.rect.top).toBe(80);
    expect(manager.cropState.rect.height).toBe(50);
  });

  it("onPointerMove clamps a top handle at MIN_SIZE when shrinking from the top", () => {
    // Dragging the top handle downward shrinks the box; the shrink is capped
    // by MIN_SIZE so the height never collapses below the drag threshold.
    manager.cropState.rect = { left: 50, top: 10, width: 100, height: 80 };
    manager.dragState = { dragging: true, dragType: "t", lastX: 100, lastY: 100 };
    makeDraggableContainer();

    manager.onPointerMove({ clientX: 100, clientY: 200 } as any);

    // dy = 100, but the allowed shrink is height - MIN_SIZE = 40.
    expect(manager.cropState.rect.top).toBe(10 + 40);
    expect(manager.cropState.rect.height).toBe(40);
  });

  it("onPointerMove ignores a move after the crop box is gone", () => {
    manager.dragState = { dragging: true, dragType: "move", lastX: 100, lastY: 100 };
    manager.cropState = null;
    makeDraggableContainer();

    manager.onPointerMove({ clientX: 130, clientY: 120 } as any);

    expect(manager.updateBoxStyle).not.toHaveBeenCalled();
  });

  it("onPointerUp releases the pointer and resets drag state", () => {
    const target = document.createElement("div");
    target.setPointerCapture = vi.fn();
    target.hasPointerCapture = vi.fn(() => true);
    target.releasePointerCapture = vi.fn();
    manager.dragState = { dragging: true, dragType: "move", lastX: 0, lastY: 0 };
    manager.cropState.box = document.createElement("div");

    manager.onPointerUp({ target, pointerId: 7 } as any);

    expect(manager.dragState.dragging).toBe(false);
    expect(manager.dragState.dragType).toBeNull();
    expect(target.releasePointerCapture).toHaveBeenCalledWith(7);
  });

  it("onPointerUp unregisters the drag listeners", () => {
    const cleanup = vi.fn();
    manager.dragCleanup = cleanup;
    manager.dragState.dragging = true;

    manager.onPointerUp({ target: document.createElement("div"), pointerId: null } as any);

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(manager.dragCleanup).toBeUndefined();
  });

  it("onPointerUp does not unregister when the gesture never started", () => {
    const cleanup = vi.fn();
    manager.dragCleanup = cleanup;
    manager.dragState.dragging = false;

    manager.onPointerUp({ target: document.createElement("div"), pointerId: null } as any);

    expect(cleanup).not.toHaveBeenCalled();
    expect(manager.dragCleanup).toBe(cleanup);
  });

  it("onPointerUp does not touch the box when the gesture never started", () => {
    manager.dragState.dragging = false;
    const box = document.createElement("div");
    manager.cropState.box = box;

    manager.onPointerUp({ target: box, pointerId: 1 } as any);

    expect(box.classList.contains(CONST.CLASSES.DRAGGING)).toBe(false);
  });

  it("onPointerUp ignores a non-element target", () => {
    manager.dragState.dragging = true;
    manager.cropState.box = document.createElement("div");

    manager.onPointerUp({ target: document, pointerId: 1 } as any);

    expect(manager.dragState.dragging).toBe(false);
  });

  it("onPointerCancel releases the drag like pointerup", () => {
    manager.dragState.dragging = true;
    manager.cropState.box = document.createElement("div");

    manager.onPointerCancel({ target: document.createElement("div"), pointerId: null } as any);

    expect(manager.dragState.dragging).toBe(false);
    expect(manager.dragState.dragType).toBeNull();
  });

  it("onPointerMove accumulates deltas across events without drift", () => {
    // The incremental model telescopes the deltas; clamping on one frame
    // must not leak an offset into the next frame.
    const startX = 100;
    const startY = 50;
    const travelX = 60;
    const travelY = 30;
    manager.cropState.rect = { left: startX, top: startY, width: 50, height: 40 };
    manager.dragState = { dragging: true, dragType: "move", lastX: startX, lastY: startY };
    makeDraggableContainer(500, 400);
    const steps: Array<[number, number]> = [];
    let x = startX;
    let y = startY;
    for (let i = 0; i < 6; i++) {
      x += Math.ceil(travelX / 6);
      y += Math.ceil(travelY / 6);
      steps.push([x, y]);
    }
    for (const [x2, y2] of steps) {
      manager.onPointerMove({ clientX: x2, clientY: y2 } as any);
    }
    expect(manager.cropState.rect.left).toBe(startX + travelX);
    expect(manager.cropState.rect.top).toBe(startY + travelY);
  });
});

describe("cropMethods — nudge continuous stream", () => {
  let manager;
  let container;

  beforeEach(async () => {
    vi.useFakeTimers();
    // Start from a known clock so performance.now() is deterministic.
    vi.setSystemTime(new Date(2000, 0, 1));

    manager = makeManager(setTimeout);
    container = manager.map.getContainer();
    document.body.appendChild(container);
    container.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 500,
      height: 400,
    });
    setCropState(manager, { left: 100, top: 100, width: 100, height: 100 });
  });

  afterEach(() => {
    vi.useRealTimers();
    if (container && document.body.contains(container)) {
      document.body.removeChild(container);
    }
  });

  it("tap yields exactly one sync step, no continuous stream", async () => {
    manager.onKeyDown({ key: "ArrowRight" });
    expect(manager.cropState.rect.left).toBe(100 + CONST.CROP.NUDGE_STEP);

    // Hold well past the delay WITHOUT releasing — the loop should be ticking
    // but we haven't called keyup yet. Advance past the gate.
    vi.setSystemTime(new Date(2000, 0, 1, 0, 0, 0, 350));
    await vi.advanceTimersByTimeAsync(300);

    // Still exactly the sync step — per-frame deltas only apply AFTER the gate.
    expect(manager.cropState.rect.left).toBe(100 + CONST.CROP.NUDGE_STEP);

    // Release. No further motion should happen.
    manager.onKeyUp({ key: "ArrowRight" } as KeyboardEvent);
    const finalLeft = manager.cropState.rect.left;
    await vi.advanceTimersByTimeAsync(100);
    expect(manager.cropState.rect.left).toBe(finalLeft);
  });

  it("hold past NUDGE_HOLD_DELAY triggers continuous fractional motion", async () => {
    const realDelta = (manager as any).nudgeCropBoxDelta.bind(manager);
    (manager as any).nudgeCropBoxDelta = vi.fn((dx: number, dy: number) =>
      realDelta(dx, dy),
    );

    manager.onKeyDown({ key: "ArrowRight" });
    expect(manager.cropState.rect.left).toBe(100 + CONST.CROP.NUDGE_STEP);

    const startLeft = manager.cropState.rect.left;
    for (let i = 0; i < 30; i++) {
      vi.setSystemTime(new Date(2000, 0, 1, 0, 0, 0, 16 + i * 16));
      await vi.advanceTimersByTimeAsync(16);
    }

    expect(manager.cropState.rect.left).toBeGreaterThan(startLeft);
    expect((manager as any).nudgeCropBoxDelta.mock.calls.length).toBeGreaterThan(1);
  });

  it("crop box removal mid-loop stops the loop without throwing", async () => {
    manager.onKeyDown({ key: "ArrowRight" });
    expect(manager.cropState.rect.left).toBe(100 + CONST.CROP.NUDGE_STEP);

    manager.cropState = null;
    vi.setSystemTime(new Date(2000, 0, 1, 0, 0, 0, 350));
    expect(async () => {
      await vi.advanceTimersByTimeAsync(500);
    }).not.toThrow();
    await vi.advanceTimersByTimeAsync(500);
  });

  it("direction switch stops the stale Right loop and starts a fresh Up loop", async () => {
    const realDelta2 = (manager as any).nudgeCropBoxDelta.bind(manager);
    (manager as any).nudgeCropBoxDelta = vi.fn((dx: number, dy: number) =>
      realDelta2(dx, dy),
    );

    manager.onKeyDown({ key: "ArrowRight" });
    expect(manager.cropState.rect.left).toBe(100 + CONST.CROP.NUDGE_STEP);
    expect(manager.cropState.rect.top).toBe(100);

    vi.setSystemTime(new Date(2000, 0, 1, 0, 0, 0, 50));
    await vi.advanceTimersByTimeAsync(32);

    manager.onKeyDown({ key: "ArrowUp" });
    expect(manager.cropState.rect.top).toBe(100 - CONST.CROP.NUDGE_STEP);
    expect(manager.cropState.rect.left).toBe(100 + CONST.CROP.NUDGE_STEP);

    const leftAtSwitch = manager.cropState.rect.left;
    vi.setSystemTime(new Date(2000, 0, 1, 0, 0, 0, 350));
    for (let i = 0; i < 25; i++) {
      vi.setSystemTime(new Date(2000, 0, 1, 0, 0, 0, 350 + i * 16));
      await vi.advanceTimersByTimeAsync(16);
    }
    expect(manager.cropState.rect.left).toBe(leftAtSwitch);
    expect(manager.cropState.rect.top).toBeLessThan(100 - CONST.CROP.NUDGE_STEP);
  });

  it("Nudge_HOLD_DELAY boundary: at 299ms no stream, at 301ms stream begins", async () => {
    const realDelta3 = (manager as any).nudgeCropBoxDelta.bind(manager);
    (manager as any).nudgeCropBoxDelta = vi.fn((dx: number, dy: number) =>
      realDelta3(dx, dy),
    );

    manager.onKeyDown({ key: "ArrowRight" });
    const afterSync = manager.cropState.rect.left;
    expect(afterSync).toBe(100 + CONST.CROP.NUDGE_STEP);

    vi.setSystemTime(new Date(2000, 0, 1, 0, 0, 0, 299));
    await vi.advanceTimersByTimeAsync(299);
    expect(manager.cropState.rect.left).toBe(afterSync);

    vi.setSystemTime(new Date(2000, 0, 1, 0, 0, 0, 315));
    await vi.advanceTimersByTimeAsync(16);
    expect(manager.cropState.rect.left).toBeGreaterThan(afterSync);
  });
});
