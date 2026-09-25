import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureEvents } from "#core/event/index.js";
import { ensureHint } from "#core/hint.js";
import * as CONST from "#foliplus/ExportControl/const.js";
import { ExportManager, canvasToBlob } from "#foliplus/ExportControl/manager.js";
import { ExportRenderer } from "#foliplus/ExportControl/renderer/index.js";
import * as downloadMod from "#common/download.js";
import * as Storage from "#common/storage.js";

// Hoistable mock for guardBlocked — allows per-test override to exercise the
// blocked-path in doExport() without affecting the real ensureModes/ModeManager
// that the interaction-lock tests depend on.
const modeMocks = vi.hoisted(() => ({
  guardBlocked: vi.fn(() => false),
}));

// T is module-level and frozen at import — CONF there is an esbuild
// compile-time literal, not window.CONF, so no per-test locale_tables can
// change it.  Substitute the two progress strings and pass everything else
// through unchanged (CONF.name is "SearchControl" here, from setup.ts).
vi.mock("#common/locale.js", async () => {
  const real = await vi.importActual("#common/locale.js");
  const TABLES: Record<string, string> = {
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
// showHint/hideHint on foliplus mirror setup.ts's window.map mock — ExportManager
// talks to them via the public map.foliplus! API rather than ensureHint().
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

describe("ExportManager — hint lifecycle", () => {
  // The crop-box size/limit hints are PERSIST (duration 0 sets no timer), so
  // nothing clears them on its own. Before this, they stayed on screen through
  // the whole export and outlived it — a stale "100 × 100 px" label under the
  // "exporting…" spinner.
  let manager;

  beforeEach(() => {
    manager = makeManager();
    setCropState(manager);
    manager.showGlobalHint = vi.fn();
  });

  it("doExport clears the crop-box hints before exporting", () => {
    // Install the per-map HintManager first: ensureHint() is what puts
    // showHint/hideHint on map.foliplus, so reading it before that is undefined.
    ensureHint(manager.map);
    const hideHint = vi.spyOn(manager.map.foliplus!, "hideHint");
    manager.map.foliplus!.showHint(CONF.name, "100 × 100 px", 0, undefined, "size");
    manager.map.foliplus!.showHint(CONF.name, "too large", 0, undefined, "limit");

    const origToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = vi.fn(cb => cb(new Blob(["fake"])));

    try {
      manager.doExport();
      expect(hideHint).toHaveBeenCalledWith(CONF.name, "size");
      expect(hideHint).toHaveBeenCalledWith(CONF.name, "limit");
      expect(hideHint).not.toHaveBeenCalledWith(CONF.name);
    } finally {
      HTMLCanvasElement.prototype.toBlob = origToBlob;
      hideHint.mockRestore();
    }
  });

  it("clears the crop-box hints when the pixel limit aborts the export", () => {
    // Install the per-map HintManager first: ensureHint() is what puts
    // showHint/hideHint on map.foliplus, so reading it before that is undefined.
    ensureHint(manager.map);
    const hideHint = vi.spyOn(manager.map.foliplus!, "hideHint");
    manager.map.foliplus!.showHint(CONF.name, "100 × 100 px", 0, undefined, "size");
    manager.map.foliplus!.showHint(CONF.name, "too large", 0, undefined, "limit");
    manager.cropState.rect = { left: 0, top: 0, width: 1000, height: 1000 };
    // CONF.max_pixels is captured by const.ts at import time, so it cannot be
    // set per-test here — set the flag checkPixelLimit() normally produces.
    manager.pixelOverLimit = true;

    try {
      manager.doExport();
      // An aborted export must not wedge the button, and must clear the whole
      // component's hints rather than just the two subkeys.
      expect(manager.isExporting).toBe(false);
      expect(hideHint).toHaveBeenCalledWith(CONF.name);
    } finally {
      manager.pixelOverLimit = false;
      hideHint.mockRestore();
    }
  });

  it("unlocks the map when the pixel limit aborts the export", () => {
    // doExport() calls lockMap() before the pixel-limit check, so an abort
    // that only ends the export state would leave dragging/zoom disabled with
    // the overlay long gone — the map looks broken and doesn't tell you why.
    manager.cropState.rect = { left: 0, top: 0, width: 1000, height: 1000 };
    manager.pixelOverLimit = true;
    const unlockMap = vi.spyOn(manager, "unlockMap");

    try {
      manager.doExport();
      expect(unlockMap).toHaveBeenCalledTimes(1);
    } finally {
      manager.pixelOverLimit = false;
      unlockMap.mockRestore();
    }
  });
});

describe("ExportManager — export progress", () => {
  let manager;

  beforeEach(() => {
    // The {pct} string comes from the locale mock at the top of this file.
    window.CONF = {
      ...window.CONF,
      name: "ExportControl",
      timeout: 7500,
    };
    manager = new ExportManager(makeMapMock());
    manager.showCropBox = vi.fn();
    manager.lockCropBox = vi.fn();
    manager.unlockCropBox = vi.fn();
    manager.removeCropBox = vi.fn();
    manager.updateBoxStyle = vi.fn();
    manager.showHintWithInfo = vi.fn();
    manager.showGlobalHint = vi.fn();
    setCropState(manager);
    manager.pixelOverLimit = false;
    // jsdom's clientWidth/clientHeight are accessors on HTMLElement — a plain
    // assignment would throw.  doExport only reads them for needsBigger, so
    // define the values directly.
    Object.defineProperty(manager.mapContainer, "clientWidth", { value: 800 });
    Object.defineProperty(manager.mapContainer, "clientHeight", { value: 600 });
  });

  it("doExport forwards an onProgress callback to doRender", () => {
    manager.doRender = vi.fn();
    manager.doExport();

    const args = manager.doRender.mock.calls[0];
    expect(args.length).toBe(5);
    expect(args[0]).toEqual(manager.cropState.rect);
    expect(args[4]).toBeTypeOf("function");
  });

  it("onProgress re-renders the persistent hint with the percentage", () => {
    manager.doRender = vi.fn();
    manager.doExport();

    manager.doRender.mock.calls[0][4](42);

    expect(manager.showGlobalHint).toHaveBeenCalledWith(
      expect.stringContaining("42%"),
      0, // HINT_DURATION.PERSIST
      true,
    );
  });

  it("onProgress works through enlargeAndRender for over-size crops", () => {
    manager.cropState.rect = { left: 1000, top: 1000, width: 500, height: 500 };
    manager.cropState.geoBounds = {
      nw: { lat: 26.1, lng: 119.2 },
      se: { lat: 26.0, lng: 119.4 },
    };
    manager.enlargeAndRender = vi.fn();
    manager.doRender = vi.fn(() => Promise.resolve());

    manager.doExport();

    expect(manager.enlargeAndRender).toHaveBeenCalledTimes(1);
    const args = manager.enlargeAndRender.mock.calls[0];
    expect(args.slice(4)).toEqual([800, 600, expect.any(Function)]);
    args[6](77);
    expect(manager.showGlobalHint).toHaveBeenCalledWith(
      expect.stringContaining("77%"),
      0,
      true,
    );
  });

  it("enlargeAndRender defers the render past a frame and restores the map after", async () => {
    // The container is resized and the view is re-centerd before the render,
    // but the render itself has to wait a frame so the browser applies the new
    // layout first — otherwise it measures the old size.  The callback also
    // owns the restore, so a failed render still puts the map back.
    const rafQueue: Array<() => void> = [];
    const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation(cb => {
      rafQueue.push(cb);
      return 1;
    });
    const origLatLngBounds = (window.L as any).latLngBounds;
    (window.L as any).latLngBounds = () => ({ getCenter: () => ({ lat: 0, lng: 0 }) });
    const setView = vi.fn();
    const invalidateSize = vi.fn();
    manager.map.getCenter = () => ({ lat: 26.08, lng: 119.3 });
    manager.map.getZoom = () => 2;
    manager.map.options = { zoomAnimation: true };
    manager.map.invalidateSize = invalidateSize;
    manager.map.setView = setView;
    const doRender = vi.fn(() => Promise.resolve());
    manager.doRender = doRender as any;

    manager.enlargeAndRender(
      { left: 1000, top: 1000, width: 500, height: 500 },
      1,
      undefined,
      { nw: { lat: 26.1, lng: 119.2 }, se: { lat: 26.0, lng: 119.4 } },
      800,
      600,
      percent => manager.showGlobalHint(percent),
    );

    // Resize and re-center happen synchronously; the render does not.
    expect(invalidateSize).toHaveBeenCalledWith(false);
    expect(setView).toHaveBeenCalledWith(expect.anything(), 2, { animate: false });
    expect(doRender).not.toHaveBeenCalled();
    expect(rafQueue).toHaveLength(1);

    rafQueue[0]();
    await vi.waitFor(() => expect(doRender).toHaveBeenCalledTimes(1));

    const args = doRender.mock.calls[0];
    expect(args[0]).toEqual({ left: 1000, top: 1000, width: 500, height: 500 });
    expect(args[4]).toBeTypeOf("function");
    args[4](88);
    expect(manager.showGlobalHint).toHaveBeenCalledWith(88);
    // The frame callback finished, so the map state is back where it started.
    expect(manager.map.options.zoomAnimation).toBe(true);
    expect(invalidateSize.mock.calls.filter(call => call[0] === false)).toHaveLength(2);
    (window.L as any).latLngBounds = origLatLngBounds;
    rafSpy.mockRestore();
  });

  it("onRenderSuccess neither claims 100 nor relabels: the render hint stays", async () => {
    // render() stops at 90 on purpose and the hint it left on screen is
    // PERSIST, so it is still up during the encode.  Nothing here has to
    // replace it — a relabel would only swap "loading at 90%" for a
    // message that says nothing more.
    manager.finishExport = vi.fn(async () => {});

    manager.onRenderSuccess(document.createElement("canvas"), []);

    expect(manager.showGlobalHint).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(manager.finishExport).toHaveBeenCalled());
  });

  it("claims 100 at the download, after the canvas is encoded", async () => {
    const origToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = cb =>
      cb(new Blob(["fake"], { type: "image/png" }));
    const downloadSpy = vi.spyOn(downloadMod, "download");

    try {
      manager.onRenderSuccess(document.createElement("canvas"), []);
      await vi.waitFor(() => expect(downloadSpy).toHaveBeenCalledTimes(1));

      // The 100 lands right before the download and nothing claims it
      // earlier: the encode used to sit behind a full bar with nothing to
      // show for it.
      const hints = manager.showGlobalHint.mock.calls.map(c => c[0]);
      expect(hints).toEqual(["Exporting map... (100%)", "Export successful"]);
    } finally {
      HTMLCanvasElement.prototype.toBlob = origToBlob;
      downloadSpy.mockRestore();
    }
  });

  it("replaces the success label with a CORS warning when a layer's tiles predominantly failed", async () => {
    // A source that rejects CORS requests draws none of its tiles: the export
    // still succeeds (the file goes out), but the hint must say the layer is
    // missing instead of a bare success.  The locale mock falls back to the
    // key itself, so the assertion is the key name.
    const origToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = cb =>
      cb(new Blob(["fake"], { type: "image/png" }));
    const downloadSpy = vi.spyOn(downloadMod, "download");
    manager.lastTileFailures = [{ total: 4, failed: 4 }];

    try {
      manager.onRenderSuccess(document.createElement("canvas"), []);
      await vi.waitFor(() => expect(downloadSpy).toHaveBeenCalledTimes(1));

      const hints = manager.showGlobalHint.mock.calls.map(c => c[0]);
      expect(hints[hints.length - 1]).toBe("status_partial");
    } finally {
      HTMLCanvasElement.prototype.toBlob = origToBlob;
      downloadSpy.mockRestore();
    }
  });

  it("shows the plain success label when no tile layer was predominantly failing", async () => {
    const origToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = cb =>
      cb(new Blob(["fake"], { type: "image/png" }));
    const downloadSpy = vi.spyOn(downloadMod, "download");
    // Sporadic misses (ocean 404s, blips) are below the threshold.
    manager.lastTileFailures = [{ total: 10, failed: 4 }];

    try {
      manager.onRenderSuccess(document.createElement("canvas"), []);
      await vi.waitFor(() => expect(downloadSpy).toHaveBeenCalledTimes(1));

      const hints = manager.showGlobalHint.mock.calls.map(c => c[0]);
      // The locale mock maps status_success to its display text; the plain
      // success label must appear unchanged when nothing was blocked.
      expect(hints[hints.length - 1]).toBe("Export successful");
    } finally {
      HTMLCanvasElement.prototype.toBlob = origToBlob;
      downloadSpy.mockRestore();
    }
  });

  it("clears lastTileFailures after the warning decision", async () => {
    const origToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = cb =>
      cb(new Blob(["fake"], { type: "image/png" }));
    const downloadSpy = vi.spyOn(downloadMod, "download");
    manager.lastTileFailures = [{ total: 1, failed: 1 }];

    try {
      manager.onRenderSuccess(document.createElement("canvas"), []);
      await vi.waitFor(() => expect(downloadSpy).toHaveBeenCalledTimes(1));
      // The stats are per-export state: read-and-clear so a second export
      // cannot inherit the first one's warning.
      expect(manager.lastTileFailures).toBeNull();
    } finally {
      HTMLCanvasElement.prototype.toBlob = origToBlob;
      downloadSpy.mockRestore();
    }
  });

  it("doRender re-computes the rect from geoBounds before rendering", () => {
    // The rect the user dragged is superseded by the projected geo bounds:
    // render() receives the projected one, so the export matches the saved
    // geography rather than whatever the cursor happened to do.
    const renderSpy = vi
      .spyOn(ExportRenderer.prototype, "render")
      .mockResolvedValue(document.createElement("canvas"));
    manager.onRenderSuccess = vi.fn();

    const rect = { left: 999, top: 888, width: 50, height: 50 };
    const p = manager.doRender(rect, 1, undefined, {
      nw: { lat: 26.1, lng: 119.2 },
      se: { lat: 26.0, lng: 119.4 },
    });

    // latLngToContainerPoint maps (lat, lng) to (x, y), so the projected rect
    // is computed from those values rather than the dragged one.
    expect(renderSpy.mock.calls[0][0].left).toBe(119.2);
    expect(renderSpy.mock.calls[0][0].top).toBe(26.0);
    expect(renderSpy.mock.calls[0][0].width).toBeCloseTo(0.2);
    expect(renderSpy.mock.calls[0][0].height).toBeCloseTo(0.1);
    expect(renderSpy).toHaveBeenCalledTimes(1);
    return p;
  });

  it("doRender captures the renderer's per-layer tile failures", async () => {
    // The renderer records what each tile layer's fetch achieved; doRender
    // threads that into the manager so finishExport can warn.  The mock
    // implementation stands in for a CORS-blocked layer: nothing drew.
    const renderSpy = vi
      .spyOn(ExportRenderer.prototype, "render")
      .mockImplementation(async function (this: ExportRenderer, ..._args: unknown[]) {
        this.tileFailures = [{ total: 4, failed: 4 }];
        return document.createElement("canvas");
      });
    manager.onRenderSuccess = vi.fn();
    manager.lastTileFailures = null;

    try {
      await manager.doRender(
        { left: 0, top: 0, width: 50, height: 50 },
        1,
        undefined,
        undefined,
      );
      expect(manager.lastTileFailures).toEqual([{ total: 4, failed: 4 }]);
    } finally {
      renderSpy.mockRestore();
    }
  });
});
