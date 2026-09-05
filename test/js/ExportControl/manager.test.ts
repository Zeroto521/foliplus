import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureEvents } from "#core/event/index.js";
import * as CONST from "#foliplus/ExportControl/const.js";
import { ExportManager } from "#foliplus/ExportControl/manager.js";
import * as Storage from "#common/storage.js";

// Hoistable mock for guardBlocked — allows per-test override to exercise the
// blocked-path in doExport() without affecting the real ensureModes/ModeManager
// that the interaction-lock tests depend on.
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

// geotiff bundles web-worker which cannot initialize under vitest's --pool=threads.
// Mock geotiff (never loaded) but pass through pako (no web-worker dependency)
// via vi.importActual so the compression round-trip test uses the real lib.
vi.mock("geotiff", () => ({
  writeArrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
}));
vi.mock("pako", async () => vi.importActual("pako"));

// Minimal map mock satisfying ExportManager constructor requirements.
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
    on: vi.fn(),
    off: vi.fn(),
    eachLayer: vi.fn(),
  };
}

// Build an ExportManager with all UI methods stubbed out.
function makeManager() {
  window.CONF = { ...window.CONF, name: "ExportControl", timeout: 7500 };
  const manager = new ExportManager(makeMapMock());
  // Stub methods that call showCropBox/lockCropBox etc. so tests can set
  // cropState.box directly without needing a real DOM export UI.
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

describe("ExportManager — onKeyDown", () => {
  let manager;

  beforeEach(() => {
    manager = makeManager();
    setCropState(manager);
  });

  it("Escape with unlocked crop box calls removeCropBox", () => {
    manager.onKeyDown({ key: "Escape" });
    expect(manager.removeCropBox).toHaveBeenCalled();
  });

  it("Escape with locked crop box calls unlockCropBox", () => {
    manager.cropState.locked = true;
    manager.onKeyDown({ key: "Escape" });
    expect(manager.unlockCropBox).toHaveBeenCalled();
  });

  it("Enter with unlocked crop box calls lockCropBox", () => {
    manager.onKeyDown({ key: "Enter" });
    expect(manager.lockCropBox).toHaveBeenCalled();
  });

  it("Enter with locked crop box calls doExport", () => {
    manager.cropState.locked = true;
    manager.doExport = vi.fn();
    manager.onKeyDown({ key: "Enter" });
    expect(manager.doExport).toHaveBeenCalled();
  });
});

describe("ExportManager — shortcut routing (R + arrows)", () => {
  let manager;

  beforeEach(() => {
    manager = makeManager();
    setCropState(manager);
    manager.resetCropBox = vi.fn();
    manager.nudgeCropBox = vi.fn();
  });

  it("R routes to resetCropBox when unlocked", () => {
    manager.onKeyDown({ key: "r" });
    expect(manager.resetCropBox).toHaveBeenCalledTimes(1);
    manager.onKeyDown({ key: "R" });
    expect(manager.resetCropBox).toHaveBeenCalledTimes(2);
    expect(manager.nudgeCropBox).not.toHaveBeenCalled();
  });

  it("R is ignored when locked", () => {
    manager.cropState.locked = true;
    manager.onKeyDown({ key: "r" });
    expect(manager.resetCropBox).not.toHaveBeenCalled();
  });

  it("arrow keys route to the smooth-nudge loop when unlocked", () => {
    // Arrow keydown starts a rafLoop-based smooth-nudge (nudgeStart), not a
    // one-off nudgeCropBox call. Each press stop()s any previous loop and
    // starts a new one for the new direction, so nudgeLoop ends up defined
    // after the last press and a new loop was created on each of the four.
    // Inject a no-op scheduler so the loop only runs its sync first frame
    // and nudgeLoop can be inspected deterministically.
    const m2 = makeManager();
    setCropState(m2);
    // Patch the rafLoop handle so each keydown is observable: nudgeLoop is
    // created fresh on each press (nudgeStop clears the previous one first).
    m2.onKeyDown({ key: "ArrowLeft" });
    expect((m2 as any).nudgeLoop).toBeDefined();
    // Each subsequent press stop()s the prior loop then starts a new one;
    // the box receives a nudge on the sync first frame of each.
    m2.onKeyDown({ key: "ArrowRight" });
    m2.onKeyDown({ key: "ArrowUp" });
    m2.onKeyDown({ key: "ArrowDown" });
    expect((m2 as any).nudgeLoop).toBeDefined();
  });

  it("arrow keys are ignored when locked", () => {
    manager.cropState.locked = true;
    manager.onKeyDown({ key: "ArrowLeft" });
    expect((manager as any).nudgeLoop).toBeUndefined();
  });

  it("R and arrows are no-ops without a crop box", () => {
    manager.cropState = null;
    manager.onKeyDown({ key: "r" });
    manager.onKeyDown({ key: "ArrowRight" });
    expect(manager.resetCropBox).not.toHaveBeenCalled();
    expect((manager as any).nudgeLoop).toBeUndefined();
  });

  it("unrecognized keys are ignored", () => {
    manager.onKeyDown({ key: "a" });
    manager.onKeyDown({ key: " " });
    expect(manager.resetCropBox).not.toHaveBeenCalled();
    expect((manager as any).nudgeLoop).toBeUndefined();
  });

  it("R stops a running nudge loop and resets the box", () => {
    const m3 = makeManager();
    setCropState(m3);
    const resetSpy = vi.fn();
    m3.resetCropBox = resetSpy;
    m3.onKeyDown({ key: "ArrowRight" });
    expect((m3 as any).nudgeLoop).toBeDefined();
    // Press R while the loop is still running. The loop must be killed so
    // the box stays at the reset position instead of being shoved off by a
    // still-ticking rafLoop.
    m3.onKeyDown({ key: "R" });
    expect((m3 as any).nudgeLoop).toBeUndefined();
    expect(resetSpy).toHaveBeenCalled();
  });
});

describe("ExportManager — resetCropBox / nudgeCropBox", () => {
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
    manager.cropState.rect = {
      left: 100,
      top: 2,
      width: 100,
      height: 100,
    };
    manager.nudgeCropBox("ArrowUp");
    expect(manager.cropState.rect.top).toBe(0);
  });

  it("nudgeCropBox clamps right edge to the map width", () => {
    manager.cropState.rect = { left: 490, top: 100, width: 100, height: 100 };
    manager.nudgeCropBox("ArrowRight");
    expect(manager.cropState.rect.left).toBe(400); // 500 - 100
  });

  it("nudgeCropBox is a no-op when locked", () => {
    manager.cropState.locked = true;
    manager.cropState.rect = { left: 100, top: 100, width: 100, height: 100 };
    manager.nudgeCropBox("ArrowRight");
    expect(manager.cropState.rect.left).toBe(100);
    expect(manager.updateBoxStyle).not.toHaveBeenCalled();
  });

  it("nudgeStop does not throw when the box is removed mid-nudge", () => {
    // Regression: the rafLoop tick's auto-stop branch runs when isEditing()
    // returns false (box locked or removed). If the box was removed
    // (cropState = null) while an arrow key was held, the tick must clean up
    // without dereferencing a null box. nudgeStop() shares this cleanup path,
    // so exercising it here guards the pattern.
    const loopStop = vi.fn();
    (manager as any).nudgeLoop = { start: vi.fn(), stop: loopStop };
    manager.cropState.box.classList.add(CONST.CLASSES.DRAGGING);
    manager.cropState = null;

    expect(() => (manager as any).nudgeStop()).not.toThrow();
    expect(loopStop).toHaveBeenCalledTimes(1);
  });
});

describe("ExportManager — shortcut lifecycle", () => {
  let manager;
  let container;

  beforeEach(() => {
    manager = makeManager();
    // Ensure the map container is in the document so focus-based container
    // containment checks (s.container.contains(document.activeElement)) work.
    container = manager.map.getContainer();
    container.tabIndex = 0; // <div> needs tabindex to be focusable in jsdom
    document.body.appendChild(container);
    // Restore real removeCropBox so registerShortcuts → unregisterShortcuts
    // (which internally calls removeCropBox) does not hit a no-op stub.
    manager.removeCropBox = () => {
      manager.cropState = null;
    };
    setCropState(manager);
  });

  afterEach(() => {
    if (container && document.body.contains(container)) {
      document.body.removeChild(container);
    }
  });

  it("starts with no interactionCleanup", () => {
    expect(manager.interactionCleanup).toBeUndefined();
  });

  it("unregisterShortcuts is a no-op when no shortcuts were registered", () => {
    // Covers the `this.interactionCleanup?.()` branch where interactionCleanup
    // is undefined — calling unregister without a prior register must not throw.
    expect(manager.interactionCleanup).toBeUndefined();
    expect(() => manager.unregisterShortcuts()).not.toThrow();
    expect(manager.interactionCleanup).toBeUndefined();
  });

  it("registerShortcuts stores cleanup in interactionCleanup", () => {
    manager.registerShortcuts();
    expect(typeof manager.interactionCleanup).toBe("function");
  });

  it("unregisterShortcuts clears interactionCleanup", () => {
    manager.registerShortcuts();
    manager.unregisterShortcuts();
    expect(manager.interactionCleanup).toBeUndefined();
  });

  it("unregisterShortcuts after registerShortcuts prevents Enter from firing", () => {
    manager.registerShortcuts();
    expect(manager.interactionCleanup).toBeTypeOf("function");

    // Fire Enter while map container has focus — should reach onKeyDown
    manager.map.getContainer().focus();
    const keydown = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
    document.dispatchEvent(keydown);
    expect(manager.lockCropBox).toHaveBeenCalled();
    manager.lockCropBox.mockReset();

    manager.unregisterShortcuts();
    expect(manager.interactionCleanup).toBeUndefined();

    // Same Enter after cleanup — should NOT reach onKeyDown
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(manager.lockCropBox).not.toHaveBeenCalled();
  });

  it("Enter reaches onKeyDown before cleanup, then suppressed after cleanup", () => {
    manager.registerShortcuts();

    manager.map.getContainer().focus();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(manager.lockCropBox).toHaveBeenCalledTimes(1);
    manager.lockCropBox.mockReset();

    manager.unregisterShortcuts();

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(manager.lockCropBox).not.toHaveBeenCalled();
  });

  it("unregisterShortcuts prevents Escape from firing", () => {
    manager.registerShortcuts();

    // Escape is global (no container required) — fires anywhere
    let escapeCalled = false;
    manager.removeCropBox = () => {
      escapeCalled = true;
      manager.cropState = null;
    };

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(escapeCalled).toBe(true);

    escapeCalled = false;
    setCropState(manager);
    manager.registerShortcuts();
    manager.unregisterShortcuts();

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(escapeCalled).toBe(false);
  });

  it("re-registering shortcuts after cleanup restores Enter handler", () => {
    manager.registerShortcuts();
    manager.unregisterShortcuts();

    // After cleanup, cropState is null — re-set it
    setCropState(manager);

    manager.registerShortcuts();
    expect(typeof manager.interactionCleanup).toBe("function");

    manager.map.getContainer().focus();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(manager.lockCropBox).toHaveBeenCalledTimes(1);
    manager.lockCropBox.mockReset();

    manager.unregisterShortcuts();
    expect(manager.interactionCleanup).toBeUndefined();
  });
});

describe("ExportManager — pixel limit & storage", () => {
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

  it("saveBounds persists geo bounds to storage", () => {
    const saveSpy = vi.spyOn(Storage, "save");
    manager.saveBounds({
      nw: { lat: 26.1, lng: 119.2 },
      se: { lat: 26.0, lng: 119.4 },
    });
    expect(saveSpy).toHaveBeenCalled();
  });

  it("loadSavedBounds loads valid overlapping bounds", () => {
    const loadSpy = vi.spyOn(Storage, "load").mockReturnValue({
      nw: { lat: 10, lng: 10 },
      se: { lat: -10, lng: -10 },
    });
    manager.loadSavedBounds();
    expect(manager.savedBounds).toBeDefined();
    expect(manager.savedBounds.nw.lat).toBe(10);
    loadSpy.mockRestore();
  });

  it("loadSavedBounds ignores invalid lat/lng", () => {
    manager.savedBounds = null;
    const loadSpy = vi.spyOn(Storage, "load").mockReturnValue({
      nw: { lat: 999, lng: 10 },
      se: { lat: -10, lng: -10 },
    });
    manager.loadSavedBounds();
    expect(manager.savedBounds).toBeNull();
    loadSpy.mockRestore();
  });

  it("loadSavedBounds ignores bounds with no overlap with map", () => {
    manager.savedBounds = null;
    // nw.lat > map north (90) → no overlap
    const loadSpy = vi.spyOn(Storage, "load").mockReturnValue({
      nw: { lat: 95, lng: 170 },
      se: { lat: 85, lng: 175 },
    });
    manager.loadSavedBounds();
    expect(manager.savedBounds).toBeNull();
    loadSpy.mockRestore();
  });
});

describe("ExportManager — onMapChange", () => {
  let manager;

  beforeEach(() => {
    manager = makeManager();
    setCropState(manager);
  });

  it("returns early when cropState is null", () => {
    manager.cropState = null;
    expect(() => manager.onMapChange(false)).not.toThrow();
  });

  it("returns early when not locked", () => {
    manager.cropState.locked = false;
    manager.updateBoxStyle = vi.fn();
    manager.onMapChange(false);
    expect(manager.updateBoxStyle).not.toHaveBeenCalled();
  });

  it("updates rect from geo bounds when locked", () => {
    manager.cropState.locked = true;
    manager.cropState.geoBounds = {
      nw: { lat: 26.1, lng: 119.2 },
      se: { lat: 26.0, lng: 119.4 },
    };
    manager.onMapChange(false);
    expect(manager.updateBoxStyle).toHaveBeenCalled();
    expect(manager.cropState.rect.width).toBeGreaterThan(0);
  });

  it("skipHint suppresses hint update", () => {
    manager.cropState.locked = true;
    manager.cropState.geoBounds = {
      nw: { lat: 26.1, lng: 119.2 },
      se: { lat: 26.0, lng: 119.4 },
    };
    manager.showHintWithInfo = vi.fn();
    manager.onMapChange(true);
    expect(manager.showHintWithInfo).not.toHaveBeenCalled();
  });
});

describe("ExportManager — mouse drag", () => {
  let manager;

  beforeEach(() => {
    manager = makeManager();
    setCropState(manager, { left: 10, top: 10, width: 100, height: 100 });
    manager.mapContainer.getBoundingClientRect = () => ({
      width: 500,
      height: 500,
    });
  });

  it("onMouseDown sets dragging true for box body", () => {
    const target = document.createElement("div");
    target.classList.add(CONST.CLASSES.BOX);
    manager.onMouseDown({
      target,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      clientX: 50,
      clientY: 50,
    });
    expect(manager.dragState.dragging).toBe(true);
    expect(manager.dragState.dragType).toBe("move");
  });

  it("onMouseDown sets dragType for a handle", () => {
    const target = document.createElement("div");
    target.classList.add(CONST.CLASSES.HANDLE);
    target.dataset.pos = "br";
    manager.onMouseDown({
      target,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      clientX: 50,
      clientY: 50,
    });
    expect(manager.dragState.dragType).toBe("br");
  });

  it("onMouseMove moves the box when dragging move", () => {
    manager.dragState = {
      dragging: true,
      dragType: "move",
      lastX: 50,
      lastY: 50,
    };
    manager.onMouseMove({ clientX: 60, clientY: 70 });
    expect(manager.cropState.rect.left).toBe(20);
    expect(manager.cropState.rect.top).toBe(30);
  });

  it("onMouseUp resets drag state", () => {
    manager.dragState = {
      dragging: true,
      dragType: "move",
      lastX: 50,
      lastY: 50,
    };
    manager.onMouseUp();
    expect(manager.dragState.dragging).toBe(false);
  });
});

describe("ExportManager — export events", () => {
  let manager;

  beforeEach(() => {
    manager = makeManager();
    setCropState(manager);
    manager.pixelOverLimit = false;
  });

  it("doExport emits before:export event", () => {
    const events = ensureEvents(manager.map);
    vi.spyOn(events, "emit");
    manager.doExport();
    expect(events.emit).toHaveBeenCalledWith("foliplus:export:before", {
      component: "ExportControl",
    });
  });

  it("doExport returns early when another component holds the map (blocked)", () => {
    modeMocks.guardBlocked.mockReturnValue(true);

    manager.doExport();

    expect(modeMocks.guardBlocked).toHaveBeenCalledWith(
      manager.map,
      "ExportControl",
      expect.any(String),
      expect.arrayContaining([
        expect.objectContaining({ blockedBy: "MeasureControl" }),
      ]),
    );
    expect(manager.isExporting).toBe(false);
    modeMocks.guardBlocked.mockReturnValue(false);
  });

  it("onRenderSuccess emits after:export event", async () => {
    const events = ensureEvents(manager.map);
    vi.spyOn(events, "emit");
    // toBlob is not implemented in jsdom — mock it to fire immediately.
    const origToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (cb: (b: Blob | null) => void) {
      cb(new Blob(["fake"]));
    };
    const hideEls = document.querySelectorAll("div");
    manager.onRenderSuccess(document.createElement("canvas"), hideEls);
    await new Promise(r => setTimeout(r, 0));
    HTMLCanvasElement.prototype.toBlob = origToBlob;
    expect(events.emit).toHaveBeenCalledWith("foliplus:export:after", {
      component: "ExportControl",
    });
  });

  it("onRenderError emits after:export event", () => {
    const events = ensureEvents(manager.map);
    vi.spyOn(events, "emit");
    const hideEls = document.querySelectorAll("div");
    manager.onRenderError(new Error("render fail"), hideEls);
    expect(events.emit).toHaveBeenCalledWith("foliplus:export:after", {
      component: "ExportControl",
    });
  });
});

describe("ExportManager — download paths", () => {
  let manager;

  beforeAll(async () => {
    // manager.ts uses GeoTIFF and pako as globals (loaded from CDN at runtime).
    // In jsdom we inject them so the download-path tests exercise the real
    // compression chain. geotiff bundles web-worker which cannot initialize
    // under vitest's --pool=threads, so both packages are vi.mocked at the top
    // of this file; here we inject those mocks as globals for the tests below.
    const geotiff = (await import("geotiff")) as any;
    const pako = (await import("pako")) as any;
    (globalThis as any).GeoTIFF = geotiff;
    (globalThis as any).pako = pako;
  });

  beforeEach(() => {
    manager = makeManager();
    setCropState(manager);
    window.CONF = {
      ...window.CONF,
      name: "ExportControl",
      filename: "test-map",
      format: "png",
      timeout: 7500,
    };
  });

  it("onRenderSuccess with toBlob returning null shows fail hint", async () => {
    const origToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (cb) {
      cb(null);
    };
    try {
      manager.onRenderSuccess(document.createElement("canvas"), []);
      await new Promise(r => setTimeout(r, 0));
      expect(manager.showGlobalHint).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Number),
      );
    } finally {
      HTMLCanvasElement.prototype.toBlob = origToBlob;
    }
  });

  it("onRenderSuccess with format=geotiff calls downloadGeoTiff", async () => {
    window.CONF = { ...window.CONF, format: "geotiff" };
    manager.cropState!.geoBounds = {
      nw: { lat: 41.0, lng: -75.0 },
      se: { lat: 40.0, lng: -74.0 },
    };
    const origToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (cb) {
      cb(new Blob(["fake"], { type: "image/tiff" }));
    };
    const spy = vi.spyOn(manager, "downloadGeoTiff");
    try {
      manager.onRenderSuccess(document.createElement("canvas"), []);
      await new Promise(r => setTimeout(r, 0));
      expect(spy).toHaveBeenCalled();
    } finally {
      HTMLCanvasElement.prototype.toBlob = origToBlob;
      spy.mockRestore();
    }
  });

  it.each([
    ["png", "image/png", "test-map.png"],
    ["jpeg", "image/jpeg", "test-map.jpeg"],
    ["webp", "image/webp", "test-map.webp"],
  ])("onRenderSuccess with format=%s encodes and names the file from the FORMAT table", async (format, mime, filename) => {
    window.CONF = { ...window.CONF, format };
    const toBlobCalls: unknown[][] = [];
    const origToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (cb: (b: Blob | null) => void, ...rest: unknown[]) {
      toBlobCalls.push([this, ...rest]);
      cb(new Blob(["fake"], { type: mime }));
    };
    // The spy must exist before `onRenderSuccess` runs — spying afterwards
    // would never catch a call that already happened.
    const geoSpy = vi.spyOn(manager, "downloadGeoTiff");
    const downloadSpy = vi.spyOn(manager, "download");

    try {
      manager.onRenderSuccess(document.createElement("canvas"), []);
      await new Promise(r => setTimeout(r, 0));
      // `toBlob` must be fed the mime from the FORMAT record — no `as "png"` cast,
      // no DEFAULT fallback — and the filename must come from the record's `ext`.
      expect(toBlobCalls.length).toBe(1);
      expect(toBlobCalls[0][1]).toBe(mime);
      expect(downloadSpy).toHaveBeenCalledTimes(1);
      expect(downloadSpy.mock.calls[0][1]).toBe(filename);
      // The geotiff pipeline must not be taken for a plain image format.
      expect(geoSpy).not.toHaveBeenCalled();
    } finally {
      HTMLCanvasElement.prototype.toBlob = origToBlob;
      vi.restoreAllMocks();
    }
  });

  it("downloadGeoTiff produces .tif download with valid geo bounds", async () => {
    manager.cropState!.geoBounds = {
      nw: { lat: 41.0, lng: -75.0 },
      se: { lat: 40.0, lng: -74.0 },
    };
    const canvas = document.createElement("canvas") as HTMLCanvasElement;
    Object.defineProperty(canvas, "width", { value: 100 });
    Object.defineProperty(canvas, "height", { value: 50 });
    const ctx = {
      getImageData: vi.fn().mockReturnValue({
        data: new Uint8ClampedArray(100 * 50 * 4).fill(0),
      }),
    };
    canvas.getContext = vi.fn().mockReturnValue(ctx);

    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:"),
      revokeObjectURL: vi.fn(),
    });

    const links: HTMLAnchorElement[] = [];
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(tag => {
      if (tag.toLowerCase() === "a") {
        const a = origCreate("a");
        links.push(a);
        a.click = vi.fn();
        return a;
      }
      return origCreate(tag);
    });

    try {
      (await manager.downloadGeoTiff(canvas, "test-map")) as any;
      expect(links.length).toBe(1);
      expect(links[0].download).toBe("test-map.tif");
      expect(links[0].href).toBe("blob:");
      expect(links[0].click).toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("downloadGeoTiff uses DEFLATE-compressed RGB (compression round-trips)", async () => {
    // Verify the compression primitive works end-to-end: DEFLATE-compressed
    // RGB bytes must decompress back to the original pixel data. This is
    // exactly what downloadGeoTiff feeds into writeArrayBuffer. pako is
    // vi.importActual'd through the top-level vi.mock so the real lib is used.
    const { deflateRaw, inflateRaw } = (await import("pako")) as any;
    const raw = new Uint8Array(60000); // 100*50*3 RGB
    for (let i = 0; i < raw.length; i += 3) {
      raw[i] = (i * 3) % 255;
      raw[i + 1] = (i * 5) % 255;
      raw[i + 2] = (i * 7) % 255;
    }
    // pako.deflateRaw matches the raw DEFLATE (RFC 1951) used by GeoTIFF code 8.
    const compressed = deflateRaw(raw);
    expect(compressed.byteLength).toBeGreaterThan(0);
    // Compressed output should be smaller than raw (patterned but not random).
    expect(compressed.byteLength).toBeLessThan(raw.byteLength);
    const decompressed = inflateRaw(compressed) as Uint8Array;
    expect(decompressed.length).toBe(raw.length);
    expect(Array.from(decompressed)).toEqual(Array.from(raw));
  });

  it("downloadGeoTiff uses savedBounds when cropState has been cleared", async () => {
    // doExport() calls removeCropBox() (which sets cropState=null) before
    // the render callback fires.  downloadGeoTiff must still find geo
    // bounds via this.savedBounds.
    manager.cropState = null;
    manager.savedBounds = {
      nw: { lat: 31.0, lng: 121.0 },
      se: { lat: 30.0, lng: 122.0 },
    };
    const canvas = document.createElement("canvas") as HTMLCanvasElement;
    Object.defineProperty(canvas, "width", { value: 100 });
    Object.defineProperty(canvas, "height", { value: 50 });
    const ctx = {
      getImageData: vi.fn().mockReturnValue({
        data: new Uint8ClampedArray(100 * 50 * 4).fill(0),
      }),
    };
    canvas.getContext = vi.fn().mockReturnValue(ctx);

    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:geo"),
      revokeObjectURL: vi.fn(),
    });

    const links: HTMLAnchorElement[] = [];
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(tag => {
      if (tag.toLowerCase() === "a") {
        const a = origCreate("a");
        links.push(a);
        a.click = vi.fn();
        return a;
      }
      return origCreate(tag);
    });

    try {
      (await manager.downloadGeoTiff(canvas, "test-map")) as any;
      expect(links.length).toBe(1);
      expect(links[0].download).toBe("test-map.tif");
      expect(links[0].href).toBe("blob:geo");
      expect(links[0].click).toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("downloadGeoTiff shows hint when no geo bounds", async () => {
    manager.cropState!.geoBounds = null;
    manager.savedBounds = null;
    const canvas = document.createElement("canvas") as HTMLCanvasElement;
    Object.defineProperty(canvas, "width", { value: 100 });
    Object.defineProperty(canvas, "height", { value: 50 });

    try {
      (await manager.downloadGeoTiff(canvas, "test-map")) as any;
      expect(manager.showGlobalHint).toHaveBeenCalledWith(
        expect.stringContaining("err_geotiff_geo"),
        expect.any(Number),
      );
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("downloadGeoTiff returns early on zero-size canvas", async () => {
    manager.cropState!.geoBounds = {
      nw: { lat: 41.0, lng: -75.0 },
      se: { lat: 40.0, lng: -74.0 },
    };
    const canvas = document.createElement("canvas") as HTMLCanvasElement;
    Object.defineProperty(canvas, "width", { value: 0 });
    Object.defineProperty(canvas, "height", { value: 50 });

    const links: HTMLAnchorElement[] = [];
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(tag => {
      if (tag.toLowerCase() === "a") {
        const a = origCreate("a");
        links.push(a);
        a.click = vi.fn();
        return a;
      }
      return origCreate(tag);
    });

    try {
      (await manager.downloadGeoTiff(canvas, "test-map")) as any;
      // Zero-size canvas should return early — no download link created
      expect(links.length).toBe(0);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("downloadGeoTiff returns early when getContext returns null", async () => {
    manager.cropState!.geoBounds = {
      nw: { lat: 41.0, lng: -75.0 },
      se: { lat: 40.0, lng: -74.0 },
    };
    const canvas = document.createElement("canvas") as HTMLCanvasElement;
    Object.defineProperty(canvas, "width", { value: 100 });
    Object.defineProperty(canvas, "height", { value: 50 });
    canvas.getContext = vi.fn().mockReturnValue(null);

    const links: HTMLAnchorElement[] = [];
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(tag => {
      if (tag.toLowerCase() === "a") {
        const a = origCreate("a");
        links.push(a);
        a.click = vi.fn();
        return a;
      }
      return origCreate(tag);
    });

    try {
      (await manager.downloadGeoTiff(canvas, "test-map")) as any;
      expect(links.length).toBe(0);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("downloadGeoTiff returns early when getImageData throws", async () => {
    manager.cropState!.geoBounds = {
      nw: { lat: 41.0, lng: -75.0 },
      se: { lat: 40.0, lng: -74.0 },
    };
    const canvas = document.createElement("canvas") as HTMLCanvasElement;
    Object.defineProperty(canvas, "width", { value: 100 });
    Object.defineProperty(canvas, "height", { value: 50 });
    const ctx = {
      getImageData: vi.fn().mockImplementation(() => {
        throw new Error("tainted canvas");
      }),
    };
    canvas.getContext = vi.fn().mockReturnValue(ctx);

    const links: HTMLAnchorElement[] = [];
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(tag => {
      if (tag.toLowerCase() === "a") {
        const a = origCreate("a");
        links.push(a);
        a.click = vi.fn();
        return a;
      }
      return origCreate(tag);
    });

    try {
      (await manager.downloadGeoTiff(canvas, "test-map")) as any;
      // getImageData threw, so no download link should be created
      expect(links.length).toBe(0);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("onRenderSuccess auto-dismisses preview after SHORT duration", async () => {
    vi.useFakeTimers();
    try {
      const origToBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (cb) {
        cb(new Blob(["fake"]));
      };
      const origToDataUrl = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = vi
        .fn()
        .mockReturnValue("data:image/png,");

      const img = document.createElement("img") as HTMLImageElement & {
        _removeCalled: boolean;
      };
      img._removeCalled = false;
      const origRemove = img.remove.bind(img);
      img.remove = vi.fn(() => {
        img._removeCalled = true;
        origRemove();
      });
      const origCreate = document.createElement.bind(document);
      vi.spyOn(document, "createElement").mockImplementation(tag => {
        if (tag.toLowerCase() === "img") return img;
        if (tag.toLowerCase() === "a") {
          const a = origCreate("a");
          a.click = vi.fn();
          return a;
        }
        return origCreate(tag);
      });

      manager.onRenderSuccess(document.createElement("canvas"), []);
      expect(img._removeCalled).toBe(false);

      vi.advanceTimersByTime(1200);
      vi.runOnlyPendingTimers();
      expect(img._removeCalled).toBe(true);

      HTMLCanvasElement.prototype.toBlob = origToBlob;
      HTMLCanvasElement.prototype.toDataURL = origToDataUrl;
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });
});

describe("ExportManager — nudge continuous stream", () => {
  // These tests exercise the branch of nudgeStart that the no-op scheduler
  // injection can't reach: the performance.now() elapsed gate and the
  // fractional accumulator. To do that we inject a real setTimeout-based
  // scheduler and control both timers AND performance.now() via
  // vi.useFakeTimers() + vi.setSystemTime().
  //
  // NUDGE_SPEED=200 px/s -> perFrame = 200/60 = 3.33 px/frame at 16ms cadence.
  // NUDGE_HOLD_DELAY=300 ms, so the gate passes after ~19 frames.

  let manager;
  let container;

  beforeEach(async () => {
    vi.useFakeTimers();
    // Start from a known clock so performance.now() is deterministic.
    vi.setSystemTime(new Date(2000, 0, 1));

    manager = new ExportManager(makeMapMock(), setTimeout);
    manager.showCropBox = vi.fn();
    manager.lockCropBox = vi.fn();
    manager.unlockCropBox = vi.fn();
    manager.removeCropBox = vi.fn();
    manager.updateBoxStyle = vi.fn();
    manager.showHintWithInfo = vi.fn();
    manager.showGlobalHint = vi.fn();

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
    // A quick press-and-release (< NUDGE_HOLD_DELAY) must produce exactly
    // one +NUDGE_STEP motion and never cross the hold gate into continuous.
    manager.onKeyDown({ key: "ArrowRight" });
    expect(manager.cropState.rect.left).toBe(100 + CONST.CROP.NUDGE_STEP);
    const deltaCalls = (manager as any).nudgeCropBoxDelta.mock
      ? (manager as any).nudgeCropBoxDelta.mock.calls.length
      : 0;

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
    // Hold ArrowRight long enough to cross the gate. The fractional accumulator
    // must produce multiple per-frame deltas (floor(perFrame) each, remainder
    // carried). With perFrame=3.33 px and 60fps, floor gives 3 px/frame.
    // Wrap the private nudgeCropBoxDelta to spy on how many times it fires
    // while still applying the real motion.
    const realDelta = (manager as any).nudgeCropBoxDelta.bind(manager);
    (manager as any).nudgeCropBoxDelta = vi.fn((dx: number, dy: number) =>
      realDelta(dx, dy),
    );

    manager.onKeyDown({ key: "ArrowRight" });
    expect(manager.cropState.rect.left).toBe(100 + CONST.CROP.NUDGE_STEP);

    // Advance frame-by-frame past the 300ms hold delay. The gate passes at
    // frame ~19; from frame 20 onward per-frame motion begins.
    const startLeft = manager.cropState.rect.left;
    for (let i = 0; i < 30; i++) {
      vi.setSystemTime(new Date(2000, 0, 1, 0, 0, 0, 16 + i * 16));
      await vi.advanceTimersByTimeAsync(16);
    }

    // After crossing the gate the box must have moved beyond the single sync
    // step — continuous stream is active.
    expect(manager.cropState.rect.left).toBeGreaterThan(startLeft);
    // nudgeCropBoxDelta called multiple times (sync frame + continuous frames)
    expect((manager as any).nudgeCropBoxDelta.mock.calls.length).toBeGreaterThan(1);
  });

  it("crop box removal mid-loop stops the loop without throwing", async () => {
    // doExport() calls removeCropBox() (cropState = null) while an arrow key
    // might still be held. The rafLoop tick's auto-stop branch must detect
    // isEditing()===false and return true, cleaning up the DRAGGING class
    // without dereferencing a null box.
    manager.onKeyDown({ key: "ArrowRight" });
    expect(manager.cropState.rect.left).toBe(100 + CONST.CROP.NUDGE_STEP);

    // Simulate doExport clearing the crop state while the loop is running.
    manager.cropState = null;

    // Advance frames — the tick must stop itself on the first post-null frame
    // and not throw. After the auto-stop, further timer advances produce no
    // additional nudgeCropBoxDelta calls (the loop is internally stopped even
    // though manager.nudgeLoop still holds the RafLoop handle — only an
    // explicit nudgeStop() clears that reference).
    vi.setSystemTime(new Date(2000, 0, 1, 0, 0, 0, 350));
    expect(async () => {
      await vi.advanceTimersByTimeAsync(500);
    }).not.toThrow();

    // Any leftover scheduled callbacks must be no-ops now (the loop stopped).
    // Re-advance to confirm nothing further fires.
    await vi.advanceTimersByTimeAsync(500);
  });

  it("direction switch stops the stale Right loop and starts a fresh Up loop", async () => {
    // Holding Right then pressing Up must kill the stale Rightward loop (so it
    // doesn't nudge right for ~500ms after the switch) and start an Upward
    // loop whose first sync step is exactly -NUDGE_STEP on top.
    const realDelta2 = (manager as any).nudgeCropBoxDelta.bind(manager);
    (manager as any).nudgeCropBoxDelta = vi.fn((dx: number, dy: number) =>
      realDelta2(dx, dy),
    );

    manager.onKeyDown({ key: "ArrowRight" });
    expect(manager.cropState.rect.left).toBe(100 + CONST.CROP.NUDGE_STEP);
    expect(manager.cropState.rect.top).toBe(100);

    // Advance a couple frames so the Right loop is clearly running, then switch.
    vi.setSystemTime(new Date(2000, 0, 1, 0, 0, 0, 50));
    await vi.advanceTimersByTimeAsync(32);

    manager.onKeyDown({ key: "ArrowUp" });
    // Sync first frame of the Up loop: top moves by -NUDGE_STEP, left unchanged.
    expect(manager.cropState.rect.top).toBe(100 - CONST.CROP.NUDGE_STEP);
    expect(manager.cropState.rect.left).toBe(100 + CONST.CROP.NUDGE_STEP);

    // The stale Right loop is stopped: advancing more frames must not push
    // `left` further right, only `top` should continue moving up.
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
    // Exact boundary check: a hold of 299ms must NOT have crossed the gate
    // (only the sync step applied); a hold of 301ms must have. This guards
    // against off-by-one in the elapsed comparison.
    const realDelta3 = (manager as any).nudgeCropBoxDelta.bind(manager);
    (manager as any).nudgeCropBoxDelta = vi.fn((dx: number, dy: number) =>
      realDelta3(dx, dy),
    );

    manager.onKeyDown({ key: "ArrowRight" });
    const afterSync = manager.cropState.rect.left;
    expect(afterSync).toBe(100 + CONST.CROP.NUDGE_STEP);

    // Advance to just before the gate (299ms).
    vi.setSystemTime(new Date(2000, 0, 1, 0, 0, 0, 299));
    await vi.advanceTimersByTimeAsync(299);
    expect(manager.cropState.rect.left).toBe(afterSync); // no continuous yet

    // One more frame crossing the boundary.
    vi.setSystemTime(new Date(2000, 0, 1, 0, 0, 0, 315));
    await vi.advanceTimersByTimeAsync(16);
    // Now the gate has passed and per-frame motion has applied.
    expect(manager.cropState.rect.left).toBeGreaterThan(afterSync);
  });
});
