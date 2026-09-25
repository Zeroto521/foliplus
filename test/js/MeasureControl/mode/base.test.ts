import { beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/MeasureControl/const.js";
import {
  createDeferredDelete,
  wireFinalized,
} from "#foliplus/MeasureControl/mode/base.js";
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
    // No pane name: geometry defaults to the base pane, unlike labels which
    // must pass CONST.PANES.LABEL to avoid competing for SVG paint order.
    expect(manager.layers.addLayer).toHaveBeenCalledWith(fakeLayer, undefined);
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
    const a = {};
    const b = {};
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

  it("stamps the export opt-out onto a preview layer's element", () => {
    // The preview is a drawing aid, so a mid-drawing export must not freeze it
    // in the picture.  addPreview is the single funnel — pinToTop and
    // moveCursorNode rebuild by remove + re-add through it — so the stamp lives
    // here rather than at each call site.
    const manager = makeManagerMock();
    const mode = new PreviewMode(manager);
    const classList = { add: vi.fn() };
    mode.addPreview({ getElement: () => ({ classList }) } as any);
    expect(classList.add).toHaveBeenCalledWith(CONST.CLASSES.SKIP_EXPORT);
  });

  it("re-stamps after a pinToTop rebuild and skips a layer with no element", () => {
    const manager = makeManagerMock();
    const mode = new PreviewMode(manager);
    const classList = { add: vi.fn() };
    mode.pinToTop({ getElement: () => ({ classList }) } as any);
    expect(classList.add).toHaveBeenCalledTimes(1);
    expect(() => mode.addPreview({} as any)).not.toThrow();
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

describe("createDeferredDelete — delayed delete thunk", () => {
  it("onDelete is a no-op before setDelete", () => {
    const { onDelete } = createDeferredDelete();
    expect(() => onDelete()).not.toThrow();
  });

  it("onDelete forwards to the thunk assigned by setDelete", () => {
    const { onDelete, setDelete } = createDeferredDelete();
    const fn = vi.fn();
    setDelete(fn);
    onDelete();
    expect(fn).toHaveBeenCalledOnce();
  });

  it("setDelete replaces the previous thunk", () => {
    const { onDelete, setDelete } = createDeferredDelete();
    const first = vi.fn();
    const second = vi.fn();
    setDelete(first);
    setDelete(second);
    onDelete();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });
});

describe("wireFinalized — registerFinalized + delete-then-teardown", () => {
  const makeOpts = () => ({
    id: "w1",
    teardown: vi.fn(),
    removeLayers: vi.fn(),
    onDelete: vi.fn(),
  });

  it("registers teardown via registerFinalized with the given id", () => {
    const manager = makeManagerMock();
    const opts = makeOpts();
    wireFinalized(manager as any, manager.layers as any, opts);
    expect(manager.registerFinalized).toHaveBeenCalledWith(opts.teardown, "w1");
    expect(manager.editHandles.has("w1")).toBe(true);
  });

  it("delete runs unregister → teardown → removeLayers → onDelete → unregister", () => {
    const manager = makeManagerMock();
    const opts = makeOpts();
    const order: string[] = [];
    opts.teardown.mockImplementation(() => order.push("teardown"));
    opts.removeLayers.mockImplementation(() => order.push("removeLayers"));
    opts.onDelete.mockImplementation(() => order.push("onDelete"));
    manager.layers.unregister.mockImplementation(() => order.push("unregister"));

    const { delete: del } = wireFinalized(manager as any, manager.layers as any, opts);
    del();

    expect(order).toEqual(["teardown", "removeLayers", "onDelete", "unregister"]);
    // registerFinalized's unregister thunk dropped the handle
    expect(manager.editHandles.has("w1")).toBe(false);
  });

  it("delete calls teardown exactly once (no double-dispose)", () => {
    const manager = makeManagerMock();
    const opts = makeOpts();
    const { delete: del } = wireFinalized(manager as any, manager.layers as any, opts);
    del();
    expect(opts.teardown).toHaveBeenCalledOnce();
    expect(opts.removeLayers).toHaveBeenCalledOnce();
    expect(opts.onDelete).toHaveBeenCalledOnce();
  });

  it("clearAll (finalized path) runs teardown without removeLayers/onDelete", () => {
    const manager = makeManagerMock();
    const opts = makeOpts();
    wireFinalized(manager as any, manager.layers as any, opts);
    manager.clearAll();
    expect(opts.teardown).toHaveBeenCalledOnce();
    expect(opts.removeLayers).not.toHaveBeenCalled();
    expect(opts.onDelete).not.toHaveBeenCalled();
  });
});
