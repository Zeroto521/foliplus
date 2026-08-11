import * as CONST from "#foliplus/MeasureControl/MeasureControl.const.js";
import {
  MODE_MAP,
  MarkerMode,
  MeasureMode,
  PreviewMode,
} from "#foliplus/MeasureControl/MeasureControl.mode.js";
import { describe, expect, it, vi } from "vitest";

function makeManagerMock() {
  return {
    map: { on: vi.fn(), off: vi.fn() },
    layers: { addLayer: vi.fn(l => l), removeLayer: vi.fn() },
    nextMeasurementId: vi.fn(() => "test-id"),
    currentMode: null,
  };
}

describe("MeasureMode — base class", () => {
  it("m getter returns manager", () => {
    const manager = makeManagerMock();
    const mode = new MeasureMode(manager);
    expect(mode.m).toBe(manager);
  });

  it("cleanup calls _cleanup once and nulls it", () => {
    const manager = makeManagerMock();
    const mode = new MeasureMode(manager);
    const fn = vi.fn();
    mode._cleanup = fn;
    mode.cleanup();
    expect(fn).toHaveBeenCalledOnce();
    expect(mode._cleanup).toBeNull();
  });

  it("cleanup is safe when _cleanup is null", () => {
    const mode = new MeasureMode(makeManagerMock());
    expect(() => mode.cleanup()).not.toThrow();
  });

  it("nextMeasurementId delegates to manager", () => {
    const manager = makeManagerMock();
    const mode = new MeasureMode(manager);
    mode.cleanup = vi.fn(); // suppress start warning
    const id = mode.nextMeasurementId();
    expect(manager.nextMeasurementId).toHaveBeenCalled();
    expect(id).toBe("test-id");
  });
});

describe("PreviewMode — tracking preview layers", () => {
  it("addPreview tracks layer in previewLayers", () => {
    const manager = makeManagerMock();
    const mode = new PreviewMode(manager);
    const fakeLayer = {};
    mode.addPreview(fakeLayer);
    expect(mode.previewLayers).toContain(fakeLayer);
    expect(manager.layers.addLayer).toHaveBeenCalledWith(fakeLayer);
  });

  it("removePreview removes a tracked layer", () => {
    const manager = makeManagerMock();
    const mode = new PreviewMode(manager);
    const fakeLayer = {};
    mode.previewLayers = [fakeLayer];
    mode.removePreview(fakeLayer);
    expect(mode.previewLayers).not.toContain(fakeLayer);
    expect(manager.layers.removeLayer).toHaveBeenCalledWith(fakeLayer);
  });

  it("removePreview is safe for non-tracked layer", () => {
    const manager = makeManagerMock();
    const mode = new PreviewMode(manager);
    expect(() => mode.removePreview({})).not.toThrow();
  });

  it("clearPreviews removes all tracked layers", () => {
    const manager = makeManagerMock();
    const mode = new PreviewMode(manager);
    const a = {},
      b = {};
    mode.previewLayers = [a, b];
    mode.clearPreviews();
    expect(mode.previewLayers).toHaveLength(0);
    expect(manager.layers.removeLayer).toHaveBeenCalledWith(a);
    expect(manager.layers.removeLayer).toHaveBeenCalledWith(b);
  });

  it("isFinished starts as false", () => {
    const mode = new PreviewMode(makeManagerMock());
    expect(mode.isFinished).toBe(false);
  });
});

describe("MarkerMode — TYPE", () => {
  it("has correct TYPE constant", () => {
    expect(MarkerMode.TYPE).toBe(CONST.MODE.MARKER);
  });
});

describe("MODE_MAP", () => {
  it("maps all four mode types to their classes", () => {
    expect(MODE_MAP[CONST.MODE.MARKER]).toBe(MarkerMode);
    expect(MODE_MAP[CONST.MODE.DISTANCE]).toBeDefined();
    expect(MODE_MAP[CONST.MODE.POLYGON]).toBeDefined();
    expect(MODE_MAP[CONST.MODE.CIRCLE]).toBeDefined();
  });

  it("covers all CONST.MODE keys", () => {
    const modeKeys = Object.values(CONST.MODE).filter(k => k !== "clear");
    for (const key of modeKeys) {
      expect(MODE_MAP[key]).toBeDefined();
    }
  });
});
