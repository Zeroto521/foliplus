import { beforeEach, describe, expect, it, vi } from "vitest";
import { BaseControl } from "#foliplus/BaseControl.js";

describe("BaseControl", () => {
  let map;

  beforeEach(() => {
    vi.clearAllMocks();
    map = { on: vi.fn(), off: vi.fn() };
  });

  it("calls init() at construction", () => {
    const init = vi.fn();
    class TestCtrl extends BaseControl {
      init() {
        init();
      }
    }
    new TestCtrl();
    expect(init).toHaveBeenCalled();
  });

  it("calls buildDOM() in onAdd and returns the container", () => {
    const container = document.createElement("div");
    class TestCtrl extends BaseControl {
      buildDOM() {
        return container;
      }
    }
    const ctrl = new TestCtrl();
    ctrl._map = map;
    const result = ctrl.onAdd();
    expect(result).toBe(container);
  });

  it("disables click/scroll propagation on the container", () => {
    class TestCtrl extends BaseControl {
      buildDOM() {
        return document.createElement("div");
      }
    }
    const ctrl = new TestCtrl();
    ctrl._map = map;
    ctrl.onAdd();
    expect(window.L.DomEvent.disableClickPropagation).toHaveBeenCalled();
    expect(window.L.DomEvent.disableScrollPropagation).toHaveBeenCalled();
  });

  it("calls destroy() in onRemove", () => {
    const destroy = vi.fn();
    class TestCtrl extends BaseControl {
      buildDOM() {
        return document.createElement("div");
      }
      destroy() {
        destroy();
      }
    }
    const ctrl = new TestCtrl();
    ctrl._map = map;
    ctrl.onRemove();
    expect(destroy).toHaveBeenCalled();
  });

  it("listenDOM tracks and unbinds L.DomEvent listeners", () => {
    const el = document.createElement("div");
    const fn = vi.fn();
    window.L.DomEvent.on = vi.fn();
    window.L.DomEvent.off = vi.fn();

    class TestCtrl extends BaseControl {
      buildDOM() {
        return document.createElement("div");
      }
    }
    const ctrl = new TestCtrl();
    ctrl.listenDOM(el, "click", fn);
    expect(window.L.DomEvent.on).toHaveBeenCalledWith(el, "click", fn);

    ctrl.onRemove();
    expect(window.L.DomEvent.off).toHaveBeenCalledWith(el, "click", fn);
  });

  it("listenMap tracks and unbinds map listeners", () => {
    const fn = vi.fn();
    class TestCtrl extends BaseControl {
      buildDOM() {
        return document.createElement("div");
      }
    }
    const ctrl = new TestCtrl();
    ctrl._map = map;
    ctrl.listenMap("zoomend", fn);
    expect(map.on).toHaveBeenCalledWith("zoomend", fn);

    ctrl.onRemove();
    expect(map.off).toHaveBeenCalledWith("zoomend", fn);
  });

  it("onRemove is idempotent (safe to call twice)", () => {
    const fn = vi.fn();
    window.L.DomEvent.on = vi.fn();
    window.L.DomEvent.off = vi.fn();

    class TestCtrl extends BaseControl {
      buildDOM() {
        return document.createElement("div");
      }
    }
    const ctrl = new TestCtrl();
    ctrl._map = map;
    ctrl.listenDOM(document.createElement("div"), "click", fn);
    ctrl.listenMap("zoomend", fn);

    ctrl.onRemove();
    ctrl.onRemove(); // second call should not throw
    expect(ctrl.events).toEqual([]);
    expect(ctrl.mapListeners).toEqual([]);
  });

  it("listenDOM does not double-bind the same listener", () => {
    window.L.DomEvent.on = vi.fn();
    class TestCtrl extends BaseControl {
      buildDOM() {
        return document.createElement("div");
      }
    }
    const ctrl = new TestCtrl();
    const el = document.createElement("div");
    const fn = vi.fn();
    ctrl.listenDOM(el, "click", fn);
    ctrl.listenDOM(el, "click", fn);
    expect(window.L.DomEvent.on).toHaveBeenCalledTimes(1);
  });
});
