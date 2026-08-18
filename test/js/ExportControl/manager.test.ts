import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureEvents } from "#core/event/index.js";
import * as CONST from "#foliplus/ExportControl/const.js";
import { ExportManager } from "#foliplus/ExportControl/manager.js";
import * as Storage from "#common/storage.js";

<<<<<<< Updated upstream
// --- Capture helpers for download tests ---
let capturedDownloadFilename: string | null;
let capturedDownloadMime: string | null;
let capturedDownloadBlob: Blob | null;

function extractWorldFileFromZip(zipBytes: Uint8Array): string | null {
  let offset = 0;
  while (offset < zipBytes.length) {
    if (offset + 4 > zipBytes.length) break;
    const sig = new DataView(zipBytes.buffer, offset, 4).getUint32(0, true);
    if (sig !== 0x04034b50) break;
    if (offset + 30 > zipBytes.length) break;
    const view = new DataView(zipBytes.buffer, offset, 30);
    const nameLen = view.getUint16(26, true);
    const extraLen = view.getUint16(28, true);
    const compSize = view.getUint32(18, true);
    const dataStart = offset + 30 + nameLen + extraLen;
    const dataEnd = dataStart + compSize;
    if (dataEnd > zipBytes.length) break;
    const filename = new TextDecoder().decode(
      zipBytes.slice(offset + 30, offset + 30 + nameLen),
    );
    if (
      filename.endsWith(".pngw") ||
      filename.endsWith(".jgw") ||
      filename.endsWith(".webpw")
    ) {
      return new TextDecoder().decode(zipBytes.slice(dataStart, dataEnd));
    }
    offset = dataEnd;
  }
  return null;
}
=======
>>>>>>> Stashed changes

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

describe("ExportManager — undo/redo", () => {
  let manager;

  beforeEach(() => {
    manager = makeManager();
  });

  it("pushUndoState records rect and clears redo", () => {
    setCropState(manager);
    manager.redoStack = [{ left: 0, top: 0, width: 50, height: 50 }];
    manager.pushUndoState();
    expect(manager.undoStack).toHaveLength(1);
    expect(manager.undoStack[0]).toEqual({
      left: 10,
      top: 10,
      width: 100,
      height: 100,
    });
    expect(manager.redoStack).toHaveLength(0);
  });

  it("pushUndoState is a no-op when cropState is null", () => {
    manager.pushUndoState();
    expect(manager.undoStack).toHaveLength(0);
  });

  it("undoCropBox restores last undo state", () => {
    setCropState(manager);
    manager.undoStack = [{ left: 5, top: 5, width: 50, height: 50 }];
    manager.undoCropBox();
    expect(manager.cropState.rect).toEqual({ left: 5, top: 5, width: 50, height: 50 });
    expect(manager.redoStack).toHaveLength(1);
  });

  it("undoCropBox is a no-op when stack is empty", () => {
    setCropState(manager);
    manager.undoCropBox();
    expect(manager.cropState.rect).toEqual({
      left: 10,
      top: 10,
      width: 100,
      height: 100,
    });
  });

  it("redoCropBox restores last redo state", () => {
    setCropState(manager);
    manager.redoStack = [{ left: 20, top: 20, width: 80, height: 80 }];
    manager.redoCropBox();
    expect(manager.cropState.rect).toEqual({
      left: 20,
      top: 20,
      width: 80,
      height: 80,
    });
    expect(manager.undoStack).toHaveLength(1);
  });

  it("undo/redo cycle round-trips", () => {
    setCropState(manager);
    const initial = { ...manager.cropState.rect };
    manager.undoStack = [{ left: 0, top: 0, width: 50, height: 50 }];
    manager.undoCropBox(); // → rect becomes undo state, redo gets initial
    manager.redoCropBox(); // → rect returns to initial
    expect(manager.cropState.rect).toEqual(initial);
  });

  it("undo stack is capped at UNDO_MAX entries", () => {
    setCropState(manager);
    // Push 21 entries (UNDO_MAX = 20)
    for (let i = 0; i < 21; i++) {
      manager.undoStack.push({ left: i, top: i, width: 10, height: 10 });
    }
    manager.undoCropBox(); // triggers the cap check via redoCropBox path too
    // After undoCropBox: old rect pushed to redo, stack pops 1 → length 20
    expect(manager.undoStack.length).toBeLessThanOrEqual(20);
  });
});

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

  it("Ctrl+Z calls undoCropBox", () => {
    const spy = vi.spyOn(manager, "undoCropBox");
    manager.onKeyDown({
      key: "z",
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      preventDefault: vi.fn(),
    });
    expect(spy).toHaveBeenCalled();
  });

  it("Ctrl+Shift+Z calls redoCropBox", () => {
    const spy = vi.spyOn(manager, "redoCropBox");
    manager.onKeyDown({
      key: "z",
      ctrlKey: true,
      metaKey: false,
      shiftKey: true,
      preventDefault: vi.fn(),
    });
    expect(spy).toHaveBeenCalled();
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

  it("onMouseUp resets drag state and pushes undo", () => {
    manager.dragState = {
      dragging: true,
      dragType: "move",
      lastX: 50,
      lastY: 50,
    };
    manager.onMouseUp();
    expect(manager.dragState.dragging).toBe(false);
    expect(manager.undoStack).toHaveLength(1);
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
<<<<<<< Updated upstream

describe("ExportManager — World File export", () => {
  let manager;

  beforeEach(() => {
    manager = makeManager();
    setCropState(manager);
    window.CONF = {
      ...window.CONF,
      name: "ExportControl",
      filename: "test-map",
      format: "png",
      timeout: 7500,
      export_world_file: false,
    };
    capturedDownloadFilename = null;
    capturedDownloadMime = null;
    capturedDownloadBlob = null;

    const origCreateObjectURL = URL.createObjectURL;
    (URL as any).createObjectURL = (blob: Blob) => {
      capturedDownloadBlob = blob;
      capturedDownloadMime = blob.type;
      return origCreateObjectURL.call(URL, blob);
    };
    const origAppendChild = document.body.appendChild;
    document.body.appendChild = function (child: Node) {
      const el = child as HTMLElement;
      if (el.tagName === "A" && el.download) {
        capturedDownloadFilename = el.download;
      }
      return origAppendChild.call(document.body, child);
    };
    const origRemoveChild = document.body.removeChild;
    document.body.removeChild = origRemoveChild;
  });

  it("getWorldFileBlob returns null when cropState is null", () => {
    manager.cropState = null;
    expect(manager.getWorldFileBlob({ width: 1000, height: 500 } as any)).toBeNull();
  });

  it("getWorldFileBlob returns null when geoBounds is null", () => {
    expect(manager.getWorldFileBlob({ width: 1000, height: 500 } as any)).toBeNull();
  });

  it("getWorldFileBlob returns null when canvas has zero width or height", () => {
    manager.cropState!.geoBounds = {
      nw: { lat: 41.0, lng: -75.0 },
      se: { lat: 40.0, lng: -74.0 },
    };
    expect(manager.getWorldFileBlob({ width: 0, height: 500 } as any)).toBeNull();
    expect(manager.getWorldFileBlob({ width: 1000, height: 0 } as any)).toBeNull();
  });

  it("generates correct World File content for a known extent", async () => {
    manager.cropState!.geoBounds = {
      nw: { lat: 41.0, lng: -75.0 },
      se: { lat: 40.0, lng: -74.0 },
    };
    const blob = manager.getWorldFileBlob({ width: 1000, height: 500 } as any);
    expect(blob).not.toBeNull();
    const text = await blob!.text();
    const lines = text.split(String.fromCharCode(10));
    expect(lines.length).toBe(7);
    expect(lines[1]).toBe("0");
    expect(lines[2]).toBe("0");
    expect(parseFloat(lines[0])).toBeCloseTo(0.001, 9);
    expect(parseFloat(lines[3])).toBeCloseTo(-0.002, 9);
    expect(parseFloat(lines[4])).toBeCloseTo(-74.9995, 9);
    expect(parseFloat(lines[5])).toBeCloseTo(40.999, 9);
  });

  it("uses actual canvas pixel dimensions, not CSS display size", async () => {
    manager.cropState!.geoBounds = {
      nw: { lat: 41.0, lng: -75.0 },
      se: { lat: 40.0, lng: -74.0 },
    };
    const blob = manager.getWorldFileBlob({ width: 1000, height: 500 } as any);
    const text = await blob!.text();
    const lines = text.split(String.fromCharCode(10));
    expect(parseFloat(lines[0])).toBeCloseTo(0.001, 9);
    expect(parseFloat(lines[3])).toBeCloseTo(-0.002, 9);
  });

  it("is NOT wired into onRenderSuccess by default (downloads only image)", async () => {
    manager.cropState!.geoBounds = {
      nw: { lat: 41.0, lng: -75.0 },
      se: { lat: 40.0, lng: -74.0 },
    };
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "width", { value: 1000 });
    Object.defineProperty(canvas, "height", { value: 500 });
    const origToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (cb: (b: Blob | null) => void) {
      cb(new Blob(["image"], { type: "image/png" }));
    };
    try {
      manager.onRenderSuccess(canvas, document.querySelectorAll("div"));
      expect(capturedDownloadFilename).toBe("test-map.png");
      expect(capturedDownloadMime).not.toBe("application/zip");
    } finally {
      HTMLCanvasElement.prototype.toBlob = origToBlob;
    }
  });

  it("is wired into onRenderSuccess when export_world_file is true (ZIP)", async () => {
    manager.cropState!.geoBounds = {
      nw: { lat: 41.0, lng: -75.0 },
      se: { lat: 40.0, lng: -74.0 },
    };
    window.CONF.export_world_file = true;
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "width", { value: 1000 });
    Object.defineProperty(canvas, "height", { value: 500 });
    const origToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (cb: (b: Blob | null) => void) {
      cb(new Blob(["image"], { type: "image/png" }));
    };
    try {
      manager.onRenderSuccess(canvas, document.querySelectorAll("div"));
      await new Promise(r => setTimeout(r, 0));
      expect(capturedDownloadFilename).toBe("test-map.zip");
      expect(capturedDownloadMime).toBe("application/zip");
    } finally {
      HTMLCanvasElement.prototype.toBlob = origToBlob;
    }
  });

  it("falls back to image-only download when geoBounds is null", async () => {
    manager.cropState = null;
    window.CONF.export_world_file = true;
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "width", { value: 1000 });
    Object.defineProperty(canvas, "height", { value: 500 });
    const origToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (cb: (b: Blob | null) => void) {
      cb(new Blob(["image"], { type: "image/png" }));
    };
    try {
      manager.onRenderSuccess(canvas, document.querySelectorAll("div"));
      expect(capturedDownloadFilename).toBe("test-map.png");
      expect(capturedDownloadMime).not.toBe("application/zip");
    } finally {
      HTMLCanvasElement.prototype.toBlob = origToBlob;
    }
  });

  it("World File is NOT downloaded when toBlob returns null (image failure)", async () => {
    manager.cropState!.geoBounds = {
      nw: { lat: 41.0, lng: -75.0 },
      se: { lat: 40.0, lng: -74.0 },
    };
    window.CONF.export_world_file = true;
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "width", { value: 1000 });
    Object.defineProperty(canvas, "height", { value: 500 });
    const origToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (cb: (b: Blob | null) => void) {
      cb(null);
    };
    try {
      manager.onRenderSuccess(canvas, document.querySelectorAll("div"));
      expect(capturedDownloadFilename).toBeNull();
    } finally {
      HTMLCanvasElement.prototype.toBlob = origToBlob;
    }
  });

  it("ZIP contains correct World File with canvas dimensions", async () => {
    manager.cropState!.geoBounds = {
      nw: { lat: 41.0, lng: -75.0 },
      se: { lat: 40.0, lng: -74.0 },
    };
    window.CONF.export_world_file = true;
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "width", { value: 2000 });
    Object.defineProperty(canvas, "height", { value: 1000 });
    const origToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (cb: (b: Blob | null) => void) {
      cb(new Blob(["image"], { type: "image/png" }));
    };
    try {
      manager.onRenderSuccess(canvas, document.querySelectorAll("div"));
      await new Promise(r => setTimeout(r, 0));
      expect(capturedDownloadFilename).toBe("test-map.zip");
      expect(capturedDownloadMime).toBe("application/zip");
      const zipBytes = new Uint8Array(await capturedDownloadBlob!.arrayBuffer());
      const wf = extractWorldFileFromZip(zipBytes);
      expect(wf).not.toBeNull();
      const lines = wf!.split(String.fromCharCode(10));
      expect(parseFloat(lines[0])).toBeCloseTo(0.0005, 9);
      expect(parseFloat(lines[3])).toBeCloseTo(-0.001, 9);
    } finally {
      HTMLCanvasElement.prototype.toBlob = origToBlob;
    }
  });

  it("downloads ZIP when export_world_file is true", async () => {
    manager.cropState!.geoBounds = {
      nw: { lat: 41.0, lng: -75.0 },
      se: { lat: 40.0, lng: -74.0 },
    };
    window.CONF.export_world_file = true;
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "width", { value: 1000 });
    Object.defineProperty(canvas, "height", { value: 500 });
    const origToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (cb: (b: Blob | null) => void) {
      cb(new Blob(["image"], { type: "image/png" }));
    };
    try {
      manager.onRenderSuccess(canvas, document.querySelectorAll("div"));
      await new Promise(r => setTimeout(r, 0));
      expect(capturedDownloadFilename).toBe("test-map.zip");
      expect(capturedDownloadMime).toBe("application/zip");
    } finally {
      HTMLCanvasElement.prototype.toBlob = origToBlob;
    }
  });

  it("downloads only image (not ZIP) when export_world_file is false", async () => {
    manager.cropState!.geoBounds = {
      nw: { lat: 41.0, lng: -75.0 },
      se: { lat: 40.0, lng: -74.0 },
    };
    window.CONF.export_world_file = false;
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "width", { value: 1000 });
    Object.defineProperty(canvas, "height", { value: 500 });
    const origToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (cb: (b: Blob | null) => void) {
      cb(new Blob(["image"], { type: "image/png" }));
    };
    try {
      manager.onRenderSuccess(canvas, document.querySelectorAll("div"));
      expect(capturedDownloadFilename).toBe("test-map.png");
      expect(capturedDownloadMime).not.toBe("application/zip");
    } finally {
      HTMLCanvasElement.prototype.toBlob = origToBlob;
    }
  });
});
=======
>>>>>>> Stashed changes
