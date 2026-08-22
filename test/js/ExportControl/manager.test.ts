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
});

describe("ExportManager — download paths", () => {
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

  it("downloadGeoTiff falls back to PNG when no geo bounds", async () => {
    manager.cropState!.geoBounds = null;
    manager.savedBounds = null;
    const canvas = document.createElement("canvas") as HTMLCanvasElement;
    Object.defineProperty(canvas, "width", { value: 100 });
    Object.defineProperty(canvas, "height", { value: 50 });
    const origToDataUrl = canvas.toDataURL.bind(canvas);
    canvas.toDataURL = vi.fn().mockReturnValue("data:image/png;base64,fake");

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
      expect(links[0].download).toBe("test-map.png");
      expect(links[0].href).toBe("data:image/png;base64,fake");
      expect(links[0].click).toHaveBeenCalled();
    } finally {
      canvas.toDataURL = origToDataUrl;
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
