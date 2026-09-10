import { beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS, ensureEvents } from "#core/event/index.js";
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

  it("emits CONTROL_ATTACHED after onAdd (ready signal)", () => {
    const seen: unknown[] = [];
    class TestCtrl extends BaseControl {
      buildDOM() {
        return document.createElement("div");
      }
    }
    const ctrl = new TestCtrl();
    ctrl._map = map;
    ensureEvents(map).on(EVENTS.CONTROL_ATTACHED, p => seen.push(p));

    ctrl.onAdd();

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ component: "TestCtrl" });
  });

  it("onAdd still works without an event bus (stub map)", () => {
    // map without foliplus: ensureEvents installs a bus, emit is a no-op —
    // onAdd must not throw.
    class TestCtrl extends BaseControl {
      buildDOM() {
        return document.createElement("div");
      }
    }
    const ctrl = new TestCtrl();
    ctrl._map = map;
    expect(() => ctrl.onAdd()).not.toThrow();
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
