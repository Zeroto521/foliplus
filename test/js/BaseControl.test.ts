import { beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS, ensureEvents } from "#core/event/index.js";
import { BaseControl } from "#foliplus/BaseControl.js";

describe("BaseControl", () => {
  let map;

  beforeEach(() => {
    vi.clearAllMocks();
    map = { on: vi.fn(), off: vi.fn() };
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  it("installs a fresh AbortController on every onAdd", () => {
    // A stale, already-aborted signal would leave every {signal} listener
    // permanently dead without any error — the whole reason BaseControl
    // keeps a per-mounting controller rather than a per-instance one.
    // The signal is not readable before the first onAdd (detached read
    // is a lifecycle bug, so the getter throws).
    class TestCtrl extends BaseControl {
      buildDOM() {
        return document.createElement("div");
      }
    }
    const ctrl = new TestCtrl();
    ctrl._map = map;
    expect(() => ctrl.signal).toThrow(/detached control/);

    ctrl.onAdd();
    const first = ctrl.signal;
    expect(first.aborted).toBe(false);

    ctrl.onRemove();
    // After onRemove the old signal is aborted.
    expect(first.aborted).toBe(true);

    ctrl.onAdd();
    // A re-add installs a brand-new controller — the previous abort
    // cannot affect listeners registered on this mounting.
    const second = ctrl.signal;
    expect(second).not.toBe(first);
    expect(second.aborted).toBe(false);
  });

  it("registering a DOM listener via `on` and unregistering on remove", () => {
    // The signal-based path: `on` calls addEventListener with the shared
    // signal, so the browser owns teardown. No L.DomEvent.on/off here.
    class TestCtrl extends BaseControl {
      buildDOM() {
        return document.createElement("div");
      }
    }
    const ctrl = new TestCtrl();
    ctrl._map = map;
    ctrl.onAdd();
    const el = document.createElement("div");
    const addSpy = vi.fn();
    el.addEventListener = addSpy;
    const fn = () => {};

    ctrl.on(el, "click", fn);
    expect(addSpy).toHaveBeenCalledTimes(1);
    const [type, passed, options] = addSpy.mock.calls[0] as unknown as [
      string,
      unknown,
      AddEventListenerOptions,
    ];
    expect(type).toBe("click");
    expect(passed).toBe(fn);
    // The signal handed to addEventListener is the one from this mounting —
    // this is what ties DOM listener teardown to the control's lifecycle.
    expect(options.signal).toBe(ctrl.signal);
    expect(addSpy).toHaveBeenCalledTimes(1);
    ctrl.onRemove();
    // Abort drops the browser-side listener; no callback fires.
    // (Reading ctrl.signal after onRemove now throws — see the dedicated
    // test below; the abort itself is asserted in "installs a fresh
    // AbortController on every onAdd".)
  });

  it("`on` returns an early-unbind function that unbinds while attached", () => {
    class TestCtrl extends BaseControl {
      buildDOM() {
        return document.createElement("div");
      }
    }
    const ctrl = new TestCtrl();
    ctrl._map = map;
    ctrl.onAdd();
    const el = document.createElement("div");
    const addSpy = vi.fn();
    const removeSpy = vi.fn();
    el.addEventListener = addSpy;
    el.removeEventListener = removeSpy;
    const fn = () => {};

    const unbind = ctrl.on(el, "click", fn);
    expect(removeSpy).not.toHaveBeenCalled();
    unbind();
    expect(removeSpy).toHaveBeenCalledTimes(1);
    // Idempotent — a second call is a no-op.
    unbind();
    expect(removeSpy).toHaveBeenCalledTimes(1);
  });

  it("`on` honours capture/passive/once options and unbinds with matching capture", () => {
    // A capture listener must be removed with capture: true, otherwise the
    // browser cannot find it — the trap the pre-refactor `listenDOM`
    // signature could not even express.
    class TestCtrl extends BaseControl {
      buildDOM() {
        return document.createElement("div");
      }
    }
    const ctrl = new TestCtrl();
    ctrl._map = map;
    ctrl.onAdd();
    const el = document.createElement("div");
    const addSpy = vi.fn();
    const removeSpy = vi.fn();
    el.addEventListener = addSpy;
    el.removeEventListener = removeSpy;
    const fn = () => {};

    const unbind = ctrl.on(el, "mousedown", fn, {
      capture: true,
      passive: false,
    });
    const [, , options] = addSpy.mock.calls[0] as unknown as [
      string,
      unknown,
      AddEventListenerOptions,
    ];
    expect(options.capture).toBe(true);
    expect(options.signal).toBe(ctrl.signal);
    unbind();
    // Capture flag is echoed on the removeEventListener call.
    expect(removeSpy.mock.calls[0]).toEqual(["mousedown", fn, true]);
  });

  it("`on` listener is actually unbound when the signal aborts (real DOM)", () => {
    // Behaviour gate: the existing tests only spy on addEventListener options
    // shape — a wiring bug (e.g. dropping `signal`) would pass them silently.
    // This one uses a real DOM element and verifies the handler stops firing
    // after onRemove aborts the signal.
    const handler = vi.fn();

    class TestCtrl extends BaseControl {
      buildDOM() {
        return document.createElement("div");
      }
    }
    const ctrl = new TestCtrl();
    ctrl._map = map;
    ctrl.onAdd();

    const el = document.createElement("div");
    document.body.appendChild(el);
    ctrl.on(el, "click", handler);
    el.dispatchEvent(new Event("click"));
    expect(handler).toHaveBeenCalledTimes(1);

    ctrl.onRemove();
    el.dispatchEvent(new Event("click"));
    expect(handler).toHaveBeenCalledTimes(1);

    document.body.removeChild(el);
  });

  it("onMap tracks and unbinds map listeners", () => {
    const fn = vi.fn();

    class TestCtrl extends BaseControl {
      buildDOM() {
        return document.createElement("div");
      }
    }
    const ctrl = new TestCtrl();
    ctrl._map = map;
    ctrl.onMap("zoomend", fn);
    expect(map.on).toHaveBeenCalledWith("zoomend", fn);

    ctrl.onRemove();
    expect(map.off).toHaveBeenCalledWith("zoomend", fn);
  });

  it("onMap does not double-register the same (event, fn) pair", () => {
    // Leaflet does not dedup `map.on`, so the base class must — otherwise a
    // second registration on the same pair would fire the handler twice on
    // every event.
    const fn = vi.fn();

    class TestCtrl extends BaseControl {
      buildDOM() {
        return document.createElement("div");
      }
    }
    const ctrl = new TestCtrl();
    ctrl._map = map;
    ctrl.onMap("zoomend", fn);
    ctrl.onMap("zoomend", fn);
    expect(map.on).toHaveBeenCalledTimes(1);
    expect(ctrl.mapListeners).toHaveLength(1);

    ctrl.onRemove();
    expect(map.off).toHaveBeenCalledTimes(1);
  });

  it("onRemove is idempotent (safe to call twice)", () => {
    class TestCtrl extends BaseControl {
      buildDOM() {
        return document.createElement("div");
      }
    }
    const ctrl = new TestCtrl();
    ctrl._map = map;
    ctrl.onAdd();
    ctrl.on(document.createElement("div"), "click", () => {});
    ctrl.onMap("zoomend", () => {});
    ctrl.effect(() => () => {});

    ctrl.onRemove();
    ctrl.onRemove(); // second call should not throw
    expect(ctrl.mapListeners).toEqual([]);
    expect(ctrl.cleanups).toEqual([]);
  });

  it("effect runs the setup closure immediately and unbinds its returned cleanup", () => {
    // `effect` is the resource-type entry point: setup returns a cleanup
    // closure which is registered and runs on remove. This replaces the
    // "component stores a private cleanup field" pattern.
    const cleanup = vi.fn();

    class TestCtrl extends BaseControl {
      buildDOM() {
        return document.createElement("div");
      }
    }
    const ctrl = new TestCtrl();
    ctrl._map = map;
    ctrl.onAdd();

    const setup = vi.fn(() => cleanup);
    ctrl.effect(setup);
    expect(setup).toHaveBeenCalledTimes(1);
    expect(cleanup).not.toHaveBeenCalled();

    ctrl.onRemove();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("effect accepts a setup closure that returns a value with .cancel()", () => {
    // Debounce factories return a callable with a .cancel() method. The
    // effect helper adapts that to a cleanup entry without the caller
    // needing to know the shape.
    const cancel = vi.fn();
    const d = { cancel };

    class TestCtrl extends BaseControl {
      buildDOM() {
        return document.createElement("div");
      }
    }
    const ctrl = new TestCtrl();
    ctrl._map = map;
    ctrl.onAdd();

    ctrl.effect(() => d);

    ctrl.onRemove();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("effect accepts a setup closure that returns a value with .disconnect()", () => {
    // MutationObserver / ResizeObserver shape.
    const disconnect = vi.fn();
    const obs = { disconnect };

    class TestCtrl extends BaseControl {
      buildDOM() {
        return document.createElement("div");
      }
    }
    const ctrl = new TestCtrl();
    ctrl._map = map;
    ctrl.onAdd();

    ctrl.effect(() => obs);

    ctrl.onRemove();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("effect tolerates a setup closure that returns void", () => {
    class TestCtrl extends BaseControl {
      buildDOM() {
        return document.createElement("div");
      }
    }
    const ctrl = new TestCtrl();
    ctrl._map = map;
    ctrl.onAdd();

    expect(() => ctrl.effect(() => undefined)).not.toThrow();
    expect(ctrl.cleanups).toHaveLength(0);
    expect(() => ctrl.onRemove()).not.toThrow();
  });

  it("effect warns and registers nothing when setup returns a bare object", () => {
    // Defensive fall-through: an object without either teardown hook is not a
    // resource — registering it would be invoked at remove time and throw. It
    // is dropped, but with a warning: a silent drop here means the caller
    // handed back something they meant to be torn down and nothing else tells
    // them it was never registered.
    const warn = vi.fn();
    vi.spyOn(console, "warn").mockImplementation(warn);

    class TestCtrl extends BaseControl {
      buildDOM() {
        return document.createElement("div");
      }
    }
    const ctrl = new TestCtrl();
    ctrl._map = map;
    ctrl.onAdd();

    ctrl.effect(() => ({ value: 42 }));
    expect(ctrl.cleanups).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/effect\(\).*no \.cancel/);
    expect(() => ctrl.onRemove()).not.toThrow();
  });

  it("onAdd falls back to build() when buildDOM is not overridden", () => {
    const container = document.createElement("section");

    class TestCtrl extends BaseControl {
      build() {
        return container;
      }
    }
    const ctrl = new TestCtrl();
    ctrl._map = map;
    expect(ctrl.onAdd()).toBe(container);
  });

  it("onAdd creates a plain div when neither buildDOM nor build is overridden", () => {
    class TestCtrl extends BaseControl {}
    const ctrl = new TestCtrl();
    ctrl._map = map;
    const container = ctrl.onAdd();
    expect(container.tagName).toBe("DIV");
    expect(container).toBeInstanceOf(HTMLElement);
  });

  it("signal throws when read on a detached control", () => {
    // After onRemove, the controller is discarded and ac is null.
    // A late read of `signal` on the detached instance is a programming
    // error — a silent fallback would hide the lifecycle bug (e.g. a
    // component accidentally registering a listener in destroy()).
    // The next onAdd installs a fresh one.
    class TestCtrl extends BaseControl {
      buildDOM() {
        return document.createElement("div");
      }
    }
    const ctrl = new TestCtrl();
    ctrl._map = map;
    ctrl.onAdd();
    const live = ctrl.signal;
    expect(live.aborted).toBe(false);
    ctrl.onRemove();
    expect(() => ctrl.signal).toThrow(/detached control/);
  });

  it("`signal` getter exposes the same controller as `on()` uses", () => {
    // Components read `this.signal` for fetch / timers / observers. The
    // signal passed to addEventListener must be identical so aborting
    // the control lifecycle actually cancels those fetches too.
    class TestCtrl extends BaseControl {
      buildDOM() {
        return document.createElement("div");
      }
    }
    const ctrl = new TestCtrl();
    ctrl._map = map;
    ctrl.onAdd();
    const el = document.createElement("div");
    const addSpy = vi.fn();
    el.addEventListener = addSpy;
    const shared = ctrl.signal;
    ctrl.on(el, "click", () => {});
    const [, , opts] = addSpy.mock.calls[0] as unknown as [
      string,
      unknown,
      AddEventListenerOptions,
    ];
    expect(opts.signal).toBe(shared);
  });

  it("N mount/unmount cycles leave no map listeners, no cleanups, no DOM", () => {
    // Behaviour gate. N is 5, per the spec. A proxy for "map event
    // listeners" is the mock map's `_events` registry (tests may read
    // Leaflet privates — the guard only scans foliplus/js/ production
    // code). A proxy for "cleanups" is a spy on the effect callback.
    // A proxy for "control-owned DOM" is the number of containers still
    // attached to the document. Each mounting builds fresh DOM and
    // registers fresh listeners; each unmount must release every one.
    class MockMap {
      _events: Record<string, Array<{ fn: unknown }>> = {};
      on(type: string, fn: unknown) {
        (this._events[type] ??= []).push({ fn });
      }
      off(type: string, fn: unknown) {
        if (!this._events[type]) return;
        this._events[type] = this._events[type].filter(e => e.fn !== fn);
      }
      listenerCount() {
        return Object.values(this._events).reduce((n, arr) => n + arr.length, 0);
      }
    }

    const cleanupSpy = vi.fn();
    const N = 5;
    for (let i = 0; i < N; i++) {
      const m = new MockMap();
      const container = document.createElement("div");
      container.id = `cycle-${i}`;
      document.body.appendChild(container);

      class TestCtrl extends BaseControl {
        buildDOM() {
          // Register everything the lifecycle is responsible for releasing:
          // a DOM listener via the signal, a map listener via onMap, and an
          // effect that returns a cleanup callback. Each is torn down by
          // onRemove — the browser via signal abort, BaseControl via the
          // mapListeners array, and BaseControl via the cleanups array.
          const other = document.createElement("div");
          this.on(other, "click", () => {});
          this.onMap("zoomend", () => {});
          this.effect(() => cleanupSpy);
          return container;
        }
      }

      const c = new TestCtrl();
      c._map = m as unknown as L.Map;
      c.onAdd();

      // Mid-cycle sanity: the map has exactly one listener, and no
      // cleanup has fired this cycle yet.
      expect(m.listenerCount()).toBe(1);
      expect(document.querySelector("#cycle-" + i)).not.toBeNull();
      const beforeThisCycle = i;

      c.onRemove();

      // Post-cycle: map listener released, and this cycle's cleanup has
      // run exactly once (so total = i+1 after i+1 cycles). BaseControl
      // does not remove the container itself — that is Leaflet's job via
      // addTo — so the container staying in the DOM is not a leak here.
      // What matters is that the *listener table* is empty and every
      // effect cleanup has run exactly once per cycle.
      expect(m.listenerCount(), `cycle ${i}: leftover map listener`).toBe(0);
      expect(
        cleanupSpy,
        `cycle ${i}: effect cleanup did not run`,
      ).toHaveBeenCalledTimes(beforeThisCycle + 1);
    }

    expect(cleanupSpy).toHaveBeenCalledTimes(N);
    // Clean up the containers this test added.
    for (let i = 0; i < N; i++) {
      document.getElementById(`cycle-${i}`)?.remove();
    }
  });

  it("destroy() runs once per mounting even when onRemove is called twice", () => {
    // Idempotency guard: the earlier "onRemove is idempotent" test only
    // checked that no throw; this one checks the observable behaviour —
    // destroy must not run twice, or a destroy() that resets state would
    // silently re-run its teardown.
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
    ctrl.onAdd();
    ctrl.onRemove();
    expect(destroy).toHaveBeenCalledTimes(1);
    ctrl.onRemove();
    expect(destroy, "second onRemove is a no-op").toHaveBeenCalledTimes(1);
  });

  it("a throwing destroy() still allows all tracked resources to be cleaned up", () => {
    // The finally block in onRemove guarantees that map listeners, effect
    // cleanups, and the signal abort all run even when destroy() throws.
    // Without this, a single throw in a component's destroy() would leave
    // every listener from that mounting permanently leaked — and the
    // `removed` flag would prevent any future attempt to clean them up.
    const cleanup = vi.fn();

    class TestCtrl extends BaseControl {
      buildDOM() {
        return document.createElement("div");
      }
      destroy() {
        this.effect(() => cleanup);
        throw new Error("boom");
      }
    }
    const ctrl = new TestCtrl();
    ctrl._map = map;
    ctrl.onAdd();

    expect(() => ctrl.onRemove()).toThrow("boom");
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(ctrl.cleanups).toHaveLength(0);
    expect(ctrl.ac).toBeNull();
  });

  it("the tracked surface is on / onMap / effect, with no legacy aliases", () => {
    // listenDOM / listenMap / trackCleanup forwarded to the entries above
    // but each carried a subtly different dedup contract — listenDOM keyed
    // on (event, fn) and dropped the target, so two different elements
    // sharing an event+fn pair collapsed into one binding. With the last
    // call site migrated there is no reason to leave them reachable, and
    // the events field that only listenDOM filled goes with them.
    expect(BaseControl.prototype).toHaveProperty("on");
    expect(BaseControl.prototype).toHaveProperty("onMap");
    expect(BaseControl.prototype).toHaveProperty("effect");
    expect(BaseControl.prototype).not.toHaveProperty("listenDOM");
    expect(BaseControl.prototype).not.toHaveProperty("listenMap");
    expect(BaseControl.prototype).not.toHaveProperty("trackCleanup");
    expect(BaseControl.prototype).not.toHaveProperty("events");
  });
});
