import { beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/MeasureControl/const.js";
import {
  DistanceMode,
  MeasureMode,
  PolygonMode,
  PreviewMode,
} from "#foliplus/MeasureControl/mode/index.js";
import { initMocks, makeManagerMock } from "./setup.js";

beforeEach(initMocks);

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
    mode.cleanup = vi.fn();
    const id = mode.nextMeasurementId();
    expect(manager.nextMeasurementId).toHaveBeenCalled();
    expect(id).toBe("test-id");
  });

  it("toGeoFeature throws on base class", () => {
    expect(() => MeasureMode.toGeoFeature({ type: "unknown" })).toThrow();
  });
});

describe("PreviewMode — tracking preview layers", () => {
  it("addPreview tracks layer in previewLayers", () => {
    const manager = makeManagerMock();
    const mode = new PreviewMode(manager);
    const fakeLayer = {};
    mode.addPreview(fakeLayer);
    expect(mode.previewLayers).toContain(fakeLayer);
    expect(manager.layers.addLayer).toHaveBeenCalledWith(fakeLayer, false, false);
  });

  // Without the flag forwarded, a preview label lands in the graph pane and is
  // painted under the very path it labels.
  it("forwards isLabel so preview labels route to the label pane", () => {
    const manager = makeManagerMock();
    const mode = new PreviewMode(manager);
    mode.addPreview({}, true);
    expect(manager.layers.addLayer).toHaveBeenCalledWith({}, true, false);
  });

  // Without it, a marker placed before the shapes exist sits permanently first
  // in the graph pane and the radius line paints over it.
  it("forwards isNode so preview markers route to the node pane", () => {
    const manager = makeManagerMock();
    const mode = new PreviewMode(manager);
    mode.addPreview({}, false, true);
    expect(manager.layers.addLayer).toHaveBeenCalledWith({}, false, true);
  });

  it("adds non-label previews to the graph pane by default", () => {
    const manager = makeManagerMock();
    const mode = new PreviewMode(manager);
    mode.addPreview({});
    expect(manager.layers.addLayer).toHaveBeenCalledWith({}, false, false);
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

  it("addPreview returns the layer for chaining", () => {
    const manager = makeManagerMock();
    const mode = new PreviewMode(manager);
    const fakeLayer = {};
    const result = mode.addPreview(fakeLayer);
    expect(result).toBe(fakeLayer);
  });
});

describe("Mode — TYPE constants", () => {
  it("DistanceMode TYPE equals MODE.DISTANCE", () => {
    expect(DistanceMode.TYPE).toBe(CONST.MODE.DISTANCE);
  });

  it("PolygonMode TYPE equals MODE.POLYGON", () => {
    expect(PolygonMode.TYPE).toBe(CONST.MODE.POLYGON);
  });
});
