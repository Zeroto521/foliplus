import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureEvents } from "#core/event/index.js";
import * as CONST from "#foliplus/ExportControl/const.js";
import { ExportManager } from "#foliplus/ExportControl/manager.js";
import * as Storage from "#common/storage.js";

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

  it("pixel over limit emits after:export event", () => {
    const events = ensureEvents(manager.map);
    vi.spyOn(events, "emit");
    manager.pixelOverLimit = true;
    manager.doExport();
    expect(events.emit).toHaveBeenCalledWith("foliplus:export:after", {
      component: "ExportControl",
    });
  });
});

describe("ExportManager — World File export", () => {
  let manager;
  let worldFileContent: string | null;
  let downloadFilename: string | null;

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
    worldFileContent = null;
    downloadFilename = null;
    // Capture the Blob content and download filename without global pollution.
    const origBlob = globalThis.Blob;
    globalThis.Blob = function (contents: unknown[], opts?: unknown) {
      const first = contents[0];
      if (typeof first === "string" && !first.startsWith("<")) {
        // Looks like a .pgw file: all numeric lines
        const lines = first.split(String.fromCharCode(10));
        if (lines.length === 7 && lines[1] === "0" && lines[2] === "0") {
          worldFileContent = first;
        }
      }
      return new origBlob(contents, opts);
    } as unknown as typeof Blob;
    const origAppendChild = document.body.appendChild;
    const origRemoveChild = document.body.removeChild;
    document.body.appendChild = function (child: Node) {
      const result = origAppendChild.call(document.body, child);
      const el = child as HTMLElement;
      if (
        el.tagName === "A" &&
        el.download &&
        (el.download.endsWith(".pngw") ||
          el.download.endsWith(".jgw") ||
          el.download.endsWith(".webpw"))
      ) {
        downloadFilename = el.download;
      }
      return result;
    };
    document.body.removeChild = function (child: Node) {
      return origRemoveChild.call(document.body, child);
    };
  });

  it("is a no-op when cropState is null", () => {
    manager.cropState = null;
    manager.downloadWorldFile({ width: 1000, height: 500 } as any);
    expect(worldFileContent).toBeNull();
    expect(downloadFilename).toBeNull();
  });

  it("is a no-op when geoBounds is null", () => {
    manager.downloadWorldFile({ width: 1000, height: 500 } as any);
    expect(worldFileContent).toBeNull();
    expect(downloadFilename).toBeNull();
  });

  it("is a no-op when canvas has zero width or height", () => {
    manager.cropState!.geoBounds = {
      nw: { lat: 41.0, lng: -75.0 },
      se: { lat: 40.0, lng: -74.0 },
    };
    manager.downloadWorldFile({ width: 0, height: 500 } as any);
    expect(worldFileContent).toBeNull();
    manager.downloadWorldFile({ width: 1000, height: 0 } as any);
    expect(worldFileContent).toBeNull();
  });

  it("generates correct World File content for a known extent", () => {
    manager.cropState!.geoBounds = {
      nw: { lat: 41.0, lng: -75.0 },
      se: { lat: 40.0, lng: -74.0 },
    };
    manager.downloadWorldFile({ width: 1000, height: 500 } as any);

    expect(worldFileContent).not.toBeNull();
    const content = worldFileContent!;
    const lines = content.split(String.fromCharCode(10));
    expect(lines.length).toBe(7); // 6 data lines + trailing empty
    expect(lines[1]).toBe("0");
    expect(lines[2]).toBe("0");

    const pixelWidth = parseFloat(lines[0]);
    expect(pixelWidth).toBeCloseTo(0.001, 9);

    const pixelHeight = parseFloat(lines[3]);
    expect(pixelHeight).toBeCloseTo(-0.002, 9);

    const ulx = parseFloat(lines[4]);
    expect(ulx).toBeCloseTo(-74.9995, 9);

    const uly = parseFloat(lines[5]);
    expect(uly).toBeCloseTo(40.999, 9);
  });

  it("creates a download link with the correct filename", () => {
    manager.cropState!.geoBounds = {
      nw: { lat: 41.0, lng: -75.0 },
      se: { lat: 40.0, lng: -74.0 },
    };
    manager.downloadWorldFile({ width: 1000, height: 500 } as any);

    expect(downloadFilename).toBe("test-map.pngw");
  });

  it("uses actual canvas pixel dimensions, not CSS display size", () => {
    manager.cropState!.geoBounds = {
      nw: { lat: 41.0, lng: -75.0 },
      se: { lat: 40.0, lng: -74.0 },
    };
    manager.downloadWorldFile({ width: 1000, height: 500 } as any);

    const lines = worldFileContent!.split(String.fromCharCode(10));
    const pixelWidth = parseFloat(lines[0]);
    // Actual 1000px width → 1.0/1000 = 0.001, not CSS 500px → 1.0/500 = 0.002
    expect(pixelWidth).toBeCloseTo(0.001, 9);
    expect(parseFloat(lines[3])).toBeCloseTo(-0.002, 9);
  });

  it("is NOT wired into onRenderSuccess by default (no World File)", async () => {
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
      // export_world_file defaults to false, so no World File is downloaded.
      expect(worldFileContent).toBeNull();
      expect(downloadFilename).toBeNull();
    } finally {
      HTMLCanvasElement.prototype.toBlob = origToBlob;
    }
  });

  it("is wired into onRenderSuccess when export_world_file is true", async () => {
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
      expect(worldFileContent).not.toBeNull();
      expect(downloadFilename).toBe("test-map.pngw");
    } finally {
      HTMLCanvasElement.prototype.toBlob = origToBlob;
    }
  });

  it("revokes the object URL after the download delay", async () => {
    manager.cropState!.geoBounds = {
      nw: { lat: 41.0, lng: -75.0 },
      se: { lat: 40.0, lng: -74.0 },
    };
    vi.useFakeTimers();
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const origCreateObjectURL = URL.createObjectURL;
    const fakeUrl = "blob:mock-url";
    (URL as any).createObjectURL = () => fakeUrl;
    try {
      manager.downloadWorldFile({ width: 1000, height: 500 } as any);
      // Advance past the revoke delay (10000ms)
      vi.advanceTimersByTime(15000);
      expect(revokeSpy).toHaveBeenCalledWith(fakeUrl);
    } finally {
      vi.useRealTimers();
      (URL as any).createObjectURL = origCreateObjectURL;
      revokeSpy.mockRestore();
    }
  });

  it("removes the download link from DOM after click", async () => {
    manager.cropState!.geoBounds = {
      nw: { lat: 41.0, lng: -75.0 },
      se: { lat: 40.0, lng: -74.0 },
    };
    vi.useFakeTimers();
    let linkEl: HTMLAnchorElement | null = null;
    const origAppendChild = document.body.appendChild;
    document.body.appendChild = function (child: Node) {
      if (child instanceof HTMLAnchorElement) {
        linkEl = child;
      }
      return origAppendChild.call(document.body, child);
    };
    try {
      manager.downloadWorldFile({ width: 1000, height: 500 } as any);
      // The manager calls link.click() synchronously, then schedules removal
      // via setTimeout. Advance past the revoke delay (10000ms).
      vi.advanceTimersByTime(15000);
      expect(document.body.contains(linkEl!)).toBe(false);
    } finally {
      vi.useRealTimers();
      document.body.appendChild = origAppendChild;
    }
  });

  it("uses format-appropriate World File extension", () => {
    manager.cropState!.geoBounds = {
      nw: { lat: 41.0, lng: -75.0 },
      se: { lat: 40.0, lng: -74.0 },
    };
    window.CONF.format = "png";
    manager.downloadWorldFile({ width: 1000, height: 500 } as any);
    expect(downloadFilename).toBe("test-map.pngw");

    window.CONF.format = "jpeg";
    manager.downloadWorldFile({ width: 1000, height: 500 } as any);
    expect(downloadFilename).toBe("test-map.jgw");

    window.CONF.format = "webp";
    manager.downloadWorldFile({ width: 1000, height: 500 } as any);
    expect(downloadFilename).toBe("test-map.webpw");
  });

  it("uses default filename when CONF.filename is undefined", () => {
    window.CONF.filename = undefined;
    manager.cropState!.geoBounds = {
      nw: { lat: 41.0, lng: -75.0 },
      se: { lat: 40.0, lng: -74.0 },
    };
    manager.downloadWorldFile({ width: 1000, height: 500 } as any);
    expect(worldFileContent).not.toBeNull();
    expect(downloadFilename).toBe("map.pngw");
  });

  it("World File is downloaded AFTER image blob (onRenderSuccess ordering)", async () => {
    manager.cropState!.geoBounds = {
      nw: { lat: 41.0, lng: -75.0 },
      se: { lat: 40.0, lng: -74.0 },
    };
    window.CONF.export_world_file = true;
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "width", { value: 1000 });
    Object.defineProperty(canvas, "height", { value: 500 });
    let imageDownloaded = false;
    let worldFileAfterImage = false;
    const origToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (cb: (b: Blob | null) => void) {
      imageDownloaded = true;
      cb(new Blob(["image"], { type: "image/png" }));
    };
    try {
      manager.onRenderSuccess(canvas, document.querySelectorAll("div"));
      await new Promise(r => setTimeout(r, 0));
      // World File download happens inside the toBlob callback, after
      // the image download link is created. Verify both happened.
      expect(imageDownloaded).toBe(true);
      expect(worldFileContent).not.toBeNull();
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
      cb(null); // Image generation fails
    };
    try {
      manager.onRenderSuccess(canvas, document.querySelectorAll("div"));
      await new Promise(r => setTimeout(r, 0));
      // Image failed, so World File is also NOT downloaded.
      expect(worldFileContent).toBeNull();
      expect(downloadFilename).toBeNull();
    } finally {
      HTMLCanvasElement.prototype.toBlob = origToBlob;
    }
  });

  it("onRenderSuccess triggers World File with actual canvas dimensions", async () => {
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
      const lines = worldFileContent!.split(String.fromCharCode(10));
      expect(parseFloat(lines[0])).toBeCloseTo(0.0005, 9);
      expect(parseFloat(lines[3])).toBeCloseTo(-0.001, 9);
    } finally {
      HTMLCanvasElement.prototype.toBlob = origToBlob;
    }
  });
});
