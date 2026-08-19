import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as UI from "#foliplus/MeasureControl/ui.js";

// Mock delete-icon helpers — capture the click callback so tests can trigger it.
const { attachDelClick } = vi.hoisted(() => ({
  attachDelClick: vi.fn((marker: any, cb: () => void) => {
    marker._delClick = cb;
  }),
}));

vi.mock("#common/delicon.js", () => ({
  makeDelIcon: vi.fn(() => ({ getElement: vi.fn(() => null) })),
  attachDelClick,
  toggleDelIcon: vi.fn(),
  hideDelIcons: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createToggleUI", () => {
  it("toggles X when called with no args", () => {
    const state = { isXVisible: false, isLabelsVisible: true };
    const render = vi.fn();
    const toggle = UI.createToggleUI(state, render);

    toggle();

    expect(state.isXVisible).toBe(true);
    expect(render).toHaveBeenCalledWith(state);
  });

  it("toggles labels when called with undefined, false", () => {
    const state = { isXVisible: false, isLabelsVisible: true };
    const render = vi.fn();
    const toggle = UI.createToggleUI(state, render);

    toggle(undefined, false);

    expect(state.isLabelsVisible).toBe(false);
    expect(render).toHaveBeenCalled();
  });

  it("resets labels when toggleLabels is reset", () => {
    const state = { isXVisible: true, isLabelsVisible: false };
    const render = vi.fn();
    const toggle = UI.createToggleUI(state, render);

    toggle(undefined, "reset" as const);

    expect(state.isLabelsVisible).toBe(true);
  });

  it("renders with current state after every toggle", () => {
    const state = { isXVisible: false, isLabelsVisible: true };
    const render = vi.fn();
    const toggle = UI.createToggleUI(state, render);

    toggle();
    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledWith({
      isXVisible: true,
      isLabelsVisible: true,
    });

    toggle(undefined, false);
    expect(render).toHaveBeenCalledTimes(2);
    expect(render).toHaveBeenLastCalledWith({
      isXVisible: false,
      isLabelsVisible: false,
    });
  });
});

describe("setupMapClickActive", () => {
  const makeMgr = (suppressHideDel = false) => ({
    map: { on: vi.fn(), off: vi.fn() },
    isSuppressHideDel: suppressHideDel,
  });

  const makeState = (xVisible = false) => ({
    isXVisible: xVisible,
    isLabelsVisible: true,
  });

  it("registers a map click handler", () => {
    const mgr = makeMgr();
    const state = makeState(false);
    const toggleUI = vi.fn();

    UI.setupMapClickActive(mgr, state, toggleUI);

    expect(mgr.map.on).toHaveBeenCalledWith("click", expect.any(Function));
  });

  it("does nothing when isXVisible is false", () => {
    const mgr = makeMgr();
    const state = makeState(false);
    const toggleUI = vi.fn();
    const handler = UI.setupMapClickActive(mgr, state, toggleUI);

    handler();

    expect(toggleUI).not.toHaveBeenCalled();
  });

  it("calls toggle with RESET when isXVisible is true", () => {
    const mgr = makeMgr();
    const state = makeState(true);
    const toggleUI = vi.fn();
    const handler = UI.setupMapClickActive(mgr, state, toggleUI);

    handler();

    expect(toggleUI).toHaveBeenCalledWith(false, "reset");
  });

  it("does nothing when suppress-hide is active", () => {
    const mgr = makeMgr(true);
    const state = makeState(true);
    const toggleUI = vi.fn();
    const handler = UI.setupMapClickActive(mgr, state, toggleUI);

    handler();

    expect(toggleUI).not.toHaveBeenCalled();
  });

  it("does nothing when extra guard returns true", () => {
    const mgr = makeMgr();
    const state = makeState(true);
    const toggleUI = vi.fn();
    const guard = vi.fn(() => true);
    const handler = UI.setupMapClickActive(mgr, state, toggleUI, guard);

    handler();

    expect(toggleUI).not.toHaveBeenCalled();
    expect(guard).toHaveBeenCalled();
  });

  it("proceeds when extra guard returns false", () => {
    const mgr = makeMgr();
    const state = makeState(true);
    const toggleUI = vi.fn();
    const guard = vi.fn(() => false);
    const handler = UI.setupMapClickActive(mgr, state, toggleUI, guard);

    handler();

    expect(toggleUI).toHaveBeenCalledWith(false, "reset");
  });

  it("returns the handler for cleanup", () => {
    const mgr = makeMgr();
    const state = makeState(false);
    const toggleUI = vi.fn();

    const handler = UI.setupMapClickActive(mgr, state, toggleUI);

    expect(typeof handler).toBe("function");
  });
});

describe("resortLayers", () => {
  const makeLayers = () => ({
    addLayer: vi.fn(l => l),
    removeLayer: vi.fn(),
  });

  const makeLayer = (id: string) => ({ _id: id, on: vi.fn() }) as L.Layer;

  it("removes then re-adds all layers in each collection", () => {
    const layers = makeLayers();
    const a = makeLayer("a");
    const b = makeLayer("b");

    UI.resortLayers(layers, [a, b]);

    expect(layers.removeLayer).toHaveBeenCalledTimes(2);
    expect(layers.addLayer).toHaveBeenCalledTimes(2);
  });

  it("processes collections in order", () => {
    const layers = makeLayers();
    const first = makeLayer("first");
    const second = makeLayer("second");

    UI.resortLayers(layers, [first], [second]);

    const callOrder = [
      ...layers.removeLayer.mock.calls.map(c => c[0]._id),
      ...layers.addLayer.mock.calls.map(c => c[0]._id),
    ];
    expect(callOrder).toEqual(["first", "second", "first", "second"]);
  });

  it("handles multiple collections of multiple layers", () => {
    const layers = makeLayers();
    const a = makeLayer("a");
    const b = makeLayer("b");
    const c = makeLayer("c");

    UI.resortLayers(layers, [a, b], [c]);

    expect(layers.removeLayer).toHaveBeenCalledTimes(3);
    expect(layers.addLayer).toHaveBeenCalledTimes(3);
  });
});

describe("attachCircleUI — delete flow", () => {
  const makeLayer = (name: string) => ({
    _name: name,
    on: vi.fn(),
    getElement: vi.fn(() => null),
    setZIndexOffset: vi.fn(),
  });

  const makeOpts = () => {
    const layers = {
      removeLayer: vi.fn(),
      addLayer: vi.fn(l => l),
      unregister: vi.fn(),
    };
    const delMarker = makeLayer("delMarker");
    const onDelete = vi.fn();
    const opts = {
      layers,
      circle: makeLayer("circle"),
      radiusLine: makeLayer("radiusLine"),
      radiusNode: makeLayer("radiusNode"),
      centerFinal: makeLayer("centerFinal"),
      delMarker,
      radiusLabel: makeLayer("radiusLabel"),
      onDelete,
    };
    return { layers, delMarker, onDelete, opts };
  };

  const makeMgr = () => ({
    map: { on: vi.fn(), off: vi.fn() },
    isSuppressHideDel: false,
  });

  it("attaches the X delete callback to delMarker", () => {
    const { delMarker, opts } = makeOpts();
    UI.attachCircleUI(makeMgr() as any, opts as any);

    expect(attachDelClick).toHaveBeenCalledWith(delMarker, expect.any(Function));
    expect(typeof (delMarker as any)._delClick).toBe("function");
  });

  it("removes all circle layers and calls onDelete on X click", () => {
    const { layers, delMarker, onDelete, opts } = makeOpts();
    UI.attachCircleUI(makeMgr() as any, opts as any);

    (delMarker as any)._delClick();

    expect(layers.removeLayer).toHaveBeenCalledWith(opts.circle);
    expect(layers.removeLayer).toHaveBeenCalledWith(opts.radiusLine);
    expect(layers.removeLayer).toHaveBeenCalledWith(opts.radiusNode);
    expect(layers.removeLayer).toHaveBeenCalledWith(opts.centerFinal);
    expect(layers.removeLayer).toHaveBeenCalledWith(delMarker);
    expect(layers.removeLayer).toHaveBeenCalledWith(opts.radiusLabel);
    expect(onDelete).toHaveBeenCalled();
    expect(layers.unregister).toHaveBeenCalled();
  });

  it("does nothing on map click after deletion (isDeleted guard)", () => {
    const { layers, delMarker, opts } = makeOpts();
    const mgr = makeMgr();
    const { onMapClickActive } = UI.attachCircleUI(mgr as any, opts as any);

    (delMarker as any)._delClick();
    onMapClickActive();

    // state.isXVisible is still false, so toggleUI would hide more layers —
    // but after deletion the map-click handler must not toggle.
    expect(mgr.map.on).toHaveBeenCalledWith("click", expect.any(Function));
  });

  it("toggling the X icon delegates to applyVisibilityToggle", () => {
    const { delMarker, opts } = makeOpts();
    UI.attachCircleUI(makeMgr() as any, opts as any);

    // Non-X click on the circle toggles visibility
    const clickHandler = (opts.circle.on as any).mock.calls.find(
      (c: any[]) => c[0] === "click",
    )?.[1];
    expect(clickHandler).toBeDefined();
    clickHandler({ originalEvent: { target: null } } as any);

    expect(delMarker.setZIndexOffset).toHaveBeenCalled();
  });
});
