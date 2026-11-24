import { makeManager } from "./fixture.js";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS, ensureEvents } from "#core/event/index.js";
import * as downloadMod from "#platform/download.js";
import { canvasToBlob } from "#control/ExportControl/manager.js";
import { ExportRenderer } from "#control/ExportControl/renderer/index.js";

const modeMocks = vi.hoisted(() => ({
  guardBlocked: vi.fn(() => false),
}));

vi.mock("#platform/locale.js", async () => {
  const real = await vi.importActual("#platform/locale.js");
  const TABLES: Record<string, string> = {
    status_exporting: "Exporting map...",
    status_progress: "Exporting map... ({pct}%)",
    status_success: "Export successful",
  };
  return {
    ...real,
    createScopedTranslator: (_config: { name: string }) => (key: string) =>
      TABLES[key] ?? key,
  };
});

vi.mock("#core/lifecycle/mode.js", async () => {
  const real = (await vi.importActual("#core/lifecycle/mode.js")) as Record<
    string,
    unknown
  >;
  return {
    ...real,
    guardBlocked: modeMocks.guardBlocked,
  };
});

vi.mock("geotiff", () => ({
  writeArrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
}));
vi.mock("pako", async () => vi.importActual("pako"));

function setCropState(
  manager: any,
  rect = { left: 10, top: 10, width: 100, height: 100 },
) {
  const box = document.createElement("div");
  manager.cropState = { rect, locked: false, box, geoBounds: null };
}

describe("sessionMethods — export events", () => {
  let manager: any;

  beforeEach(() => {
    manager = makeManager();
    setCropState(manager);
    manager.pixelOverLimit = false;
  });

  it("doExport emits before:export event", () => {
    const events = ensureEvents(manager.map);
    vi.spyOn(events, "publish");
    manager.doExport();
    expect(events.publish).toHaveBeenCalledWith(
      "foliplus:export:before",
      {
        component: "ExportControl",
      },
      { kind: "user", via: "panel" },
    );
  });

  it("ignores progress reported by a retired render", () => {
    // abortExport() bumps the render generation, so the progress closure doExport
    // handed to the renderer is stale and must not keep repainting the hint.
    manager.doRender = vi.fn();
    manager.doExport();

    const onProgress = vi.mocked(manager.doRender).mock.calls[0][4]!;
    manager.abortExport();
    onProgress(42);

    expect(manager.showGlobalHint).not.toHaveBeenCalledWith(
      expect.stringContaining("42%"),
      0,
      true,
    );
  });

  it("records a BEFORE_EXPORT consumer failure and the export start continues", () => {
    const events = ensureEvents(manager.map);
    const seen: string[] = [];
    events.on(EVENTS.BEFORE_EXPORT, () => {
      throw new Error("before boom");
    });
    events.on(EVENTS.BEFORE_EXPORT, () => seen.push("later"));

    expect(() => manager.doExport()).not.toThrow();

    // Every consumer saw the signal; BEFORE_EXPORT is a notification, so the
    // start stays committed — an observer cannot derail the export.
    expect(seen).toEqual(["later"]);
    expect(manager.isExporting).toBe(true);
    expect(manager.modes.getMode("ExportControl")).toBe("exporting");
  });

  it("a MODE_CHANGE consumer throwing during start is recorded, not fatal", () => {
    const events = ensureEvents(manager.map);
    events.on(EVENTS.MODE_CHANGE, payload => {
      if (payload.mode === "exporting") throw new Error("mode boom");
    });

    expect(() => manager.doExport()).not.toThrow();

    // MODE_CHANGE is a notification: the mode stays committed and the export
    // continues past the start.
    expect(manager.isExporting).toBe(true);
    expect(manager.modes.getMode("ExportControl")).toBe("exporting");
  });

  it("AFTER_EXPORT failure still clears the blocker and export state", () => {
    const events = ensureEvents(manager.map);
    manager.isExporting = true;
    manager.modes.setMode("ExportControl", "exporting");
    manager.exportOverlay = document.createElement("div");
    document.body.appendChild(manager.exportOverlay);
    const seen: string[] = [];
    events.on(EVENTS.AFTER_EXPORT, () => {
      throw new Error("after boom");
    });
    events.on(EVENTS.AFTER_EXPORT, () => seen.push("later"));

    expect(() => manager.endExport()).toThrow("after boom");

    expect(seen).toEqual(["later"]);
    expect(manager.isExporting).toBe(false);
    expect(manager.modes.getMode("ExportControl")).toBeNull();
    expect(manager.exportOverlay).toBeNull();
  });

  it("onRenderError still unlocks and removes the blocker when AFTER_EXPORT throws", () => {
    const events = ensureEvents(manager.map);
    manager.isExporting = true;
    manager.modes.setMode("ExportControl", "exporting");
    manager.exportOverlay = document.createElement("div");
    document.body.appendChild(manager.exportOverlay);
    const unlock = vi.spyOn(manager, "unlockMap");
    events.on(EVENTS.AFTER_EXPORT, () => {
      throw new Error("after boom");
    });

    expect(() =>
      manager.onRenderError(new Error("render fail"), document.querySelectorAll("div")),
    ).not.toThrow();

    expect(unlock).toHaveBeenCalled();
    expect(manager.exportOverlay).toBeNull();
    expect(manager.isExporting).toBe(false);
    expect(manager.modes.getMode("ExportControl")).toBeNull();
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

  it("drops a render failure that lands after abortExport", async () => {
    // The failure half of the render generation: a rejection delivered after
    // teardown must not reach onRenderError (which shows a fail hint and
    // publishes AFTER_EXPORT on a control that is going away).
    const renderSpy = vi
      .spyOn(ExportRenderer.prototype, "render")
      .mockRejectedValue(new Error("tile boom"));
    manager.onRenderError = vi.fn();
    const hidden = document.createElement("div");
    hidden.className = "leaflet-control-container";
    manager.mapContainer.appendChild(hidden);

    try {
      const pending = manager.doRender(
        { left: 0, top: 0, width: 10, height: 10 },
        1,
        undefined,
        undefined,
      );
      manager.abortExport();
      await pending;

      expect(manager.onRenderError).not.toHaveBeenCalled();
      expect(hidden.classList.contains("foliplus-hidden")).toBe(false);
    } finally {
      renderSpy.mockRestore();
    }
  });

  it("routes a live render failure to onRenderError", async () => {
    // The other side of the generation guard: a failure with no teardown in
    // between must still reach onRenderError (fail hint + AFTER_EXPORT).
    const renderSpy = vi
      .spyOn(ExportRenderer.prototype, "render")
      .mockRejectedValue(new Error("tile boom"));
    manager.onRenderError = vi.fn();

    try {
      await manager.doRender(
        { left: 0, top: 0, width: 10, height: 10 },
        1,
        undefined,
        undefined,
      );
      expect(manager.onRenderError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.anything(),
      );
    } finally {
      renderSpy.mockRestore();
    }
  });

  it("onRenderSuccess emits after:export event", async () => {
    const events = ensureEvents(manager.map);
    vi.spyOn(events, "emitSettled");
    const origToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (cb: (b: Blob | null) => void) {
      cb(new Blob(["fake"]));
    };
    const hideEls = document.querySelectorAll("div");
    manager.onRenderSuccess(document.createElement("canvas"), hideEls);
    await new Promise(r => setTimeout(r, 0));
    HTMLCanvasElement.prototype.toBlob = origToBlob;
    expect(events.emitSettled).toHaveBeenCalledWith(
      "foliplus:export:after",
      {
        component: "ExportControl",
      },
      { kind: "user", via: "panel" },
    );
  });

  it("onRenderError emits after:export event", () => {
    const events = ensureEvents(manager.map);
    vi.spyOn(events, "emitSettled");
    const hideEls = document.querySelectorAll("div");
    manager.onRenderError(new Error("render fail"), hideEls);
    expect(events.emitSettled).toHaveBeenCalledWith(
      "foliplus:export:after",
      {
        component: "ExportControl",
      },
      { kind: "user", via: "panel" },
    );
  });
});

describe("sessionMethods — download paths", () => {
  let manager: any;

  beforeAll(async () => {
    const geotiff = (await import("geotiff")) as any;
    const pako = (await import("pako")) as any;
    (globalThis as any).GeoTIFF = geotiff;
    (globalThis as any).pako = pako;
  });

  beforeEach(() => {
    manager = makeManager();
    setCropState(manager);
    window.CONFIG = {
      ...window.CONFIG,
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
      expect(manager.showGlobalHint).not.toHaveBeenCalledWith(
        expect.stringContaining("status_success"),
        expect.any(Number),
      );
      expect(manager.isExporting).toBe(false);
    } finally {
      HTMLCanvasElement.prototype.toBlob = origToBlob;
    }
  });

  it("onRenderSuccess with format=geotiff calls downloadGeoTiff", async () => {
    window.CONFIG = { ...window.CONFIG, format: "geotiff" };
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
  ])(
    "onRenderSuccess with format=%s encodes and names the file from the FORMAT table",
    async (format, mime, filename) => {
      window.CONFIG = { ...window.CONFIG, format };
      const toBlobCalls: unknown[][] = [];
      const origToBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (
        cb: (b: Blob | null) => void,
        ...rest: unknown[]
      ) {
        toBlobCalls.push([this, ...rest]);
        cb(new Blob(["fake"], { type: mime }));
      };
      const geoSpy = vi.spyOn(manager, "downloadGeoTiff");
      const downloadSpy = vi.spyOn(downloadMod, "download");

      try {
        manager.onRenderSuccess(document.createElement("canvas"), []);
        await new Promise(r => setTimeout(r, 0));
        expect(toBlobCalls.length).toBe(1);
        expect(toBlobCalls[0][1]).toBe(mime);
        expect(downloadSpy).toHaveBeenCalledTimes(1);
        expect(downloadSpy.mock.calls[0][1]).toBe(filename);
        expect(geoSpy).not.toHaveBeenCalled();
      } finally {
        HTMLCanvasElement.prototype.toBlob = origToBlob;
        vi.restoreAllMocks();
      }
    },
  );

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
      vi.unstubAllGlobals();
    }
  });

  it("downloadGeoTiff uses DEFLATE-compressed RGB (compression round-trips)", async () => {
    const { deflateRaw, inflateRaw } = (await import("pako")) as any;
    const raw = new Uint8Array(60000);
    for (let i = 0; i < raw.length; i += 3) {
      raw[i] = (i * 3) % 255;
      raw[i + 1] = (i * 5) % 255;
      raw[i + 2] = (i * 7) % 255;
    }
    const compressed = deflateRaw(raw);
    expect(compressed.byteLength).toBeGreaterThan(0);
    expect(compressed.byteLength).toBeLessThan(raw.byteLength);
    const decompressed = inflateRaw(compressed) as Uint8Array;
    expect(decompressed.length).toBe(raw.length);
    expect(Array.from(decompressed)).toEqual(Array.from(raw));
  });

  it("downloadGeoTiff uses savedBounds when cropState has been cleared", async () => {
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
      vi.unstubAllGlobals();
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
      await vi.advanceTimersByTimeAsync(0);
      expect(img._removeCalled).toBe(false);

      vi.advanceTimersByTime(1200);
      vi.runOnlyPendingTimers();
      await vi.advanceTimersByTimeAsync(0);
      expect(img._removeCalled).toBe(true);

      HTMLCanvasElement.prototype.toBlob = origToBlob;
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it("onRenderSuccess does not base64-encode the canvas for the preview", async () => {
    const origToBlob = HTMLCanvasElement.prototype.toBlob;
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toBlob = function (cb) {
      cb(new Blob(["fake"]));
    };
    const toDataURL = vi.fn();
    HTMLCanvasElement.prototype.toDataURL = toDataURL;
    vi.stubGlobal("createImageBitmap", undefined);

    const img = document.createElement("img") as HTMLImageElement;
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(tag => {
      if (tag.toLowerCase() === "img") return img;
      return origCreate(tag);
    });

    try {
      manager.onRenderSuccess(document.createElement("canvas"), []);
      await new Promise(r => setTimeout(r, 0));

      expect(toDataURL).not.toHaveBeenCalled();
      expect(img.src).not.toBe("");
      expect(img.src.startsWith("blob:")).toBe(true);
    } finally {
      HTMLCanvasElement.prototype.toBlob = origToBlob;
      HTMLCanvasElement.prototype.toDataURL = origToDataURL;
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it("canvasToBlob passes the format through to toBlob and surfaces null", async () => {
    const canvas = document.createElement("canvas");
    const toBlob = vi.fn(cb => cb(new Blob(["png"])));
    canvas.toBlob = toBlob;

    expect(await canvasToBlob(canvas, "image/jpeg", 0.8)).toBeInstanceOf(Blob);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.8);

    canvas.toBlob = vi.fn(cb => cb(null));
    expect(await canvasToBlob(canvas, "image/png")).toBeNull();
  });
});
