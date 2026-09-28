// Shared browser probe: absolute document/window listener count.
//
// Metric. Wraps EventTarget.prototype.addEventListener / removeEventListener
// and counts only calls whose target is `document` or `window`: +1 on each
// add, -1 on each removal — either an explicit removeEventListener or an abort
// of the AbortSignal the listener was bound to. Installed via
// page.add_init_script, i.e. before the page's own scripts run, so
// `__probeDocSum()` is the number of listeners present on those two targets
// right now, not a delta measured from somewhere in the middle of the page's
// life.
//
// Absolute counts are what the drift gates assert against, and they need the
// init-script install. Installed after load the same wrapper only sees a net
// delta, which passes a listener bound once on re-attach and never removed:
// the baseline already contains it, so nothing ever grows. Absolute counts
// catch that shape (`added[i] == base` fails), so that is what this probe
// reports.
//
// Cross-check. `DOMDebugger.getEventListeners` over a CDP session returns the
// engine's own listener lists for the same two targets; on a HeatmapControl
// page the engine reports 24 document + 19 window listeners at the end of
// every remove→add cycle, identical between cycles. The wrapper reproduces
// that count from t=0, which is what makes the invariants below meaningful.
//
// Why a prototype wrapper, not the alternatives: getEventListeners(target) is
// a DevTools-console-only API — unreachable from page.evaluate, Chromium-only,
// and a point-in-time snapshot rather than something a Python test can ask for
// cheaply. `document._listeners` does not exist: engines keep listener lists
// in internal slots, unreachable from JS. Every registration funnels through
// the two prototype methods, so that is the only hook that sees all of them —
// including Leaflet's L.DomEvent and every {signal} listener, which call the
// same methods from the same page world this probe runs in. Poking internals
// is deliberate: probes are test-only code, and reading internals is where
// static guards (which only scan production source) are allowed to stop —
// same idiom as the `map._events` gates.
//
// Two patches are load-bearing, not decoration.
//
// 1. AbortController.prototype.abort. A listener registered with `{ signal }`
//    is dropped by the engine when the signal aborts, without
//    removeEventListener ever being called. Without the abort hook such a
//    listener is counted as an add and never as a removal — and {signal}
//    listeners are exactly the ones cleaned on removeControl, because
//    BaseControl.onRemove aborts the controller. A naive add/remove counter
//    would report one phantom leak per round on code that is already correct.
//
// 2. The duplicate guard below. Re-adding the same (type, fn, capture) triple
//    is a no-op per spec, so counting it would make a component that re-binds
//    a listener on every attach read as drift.
//
// Installation is per-page: each Playwright page is a fresh world and the page
// is closed when the test ends, so nothing leaks into other tests. The guard
// makes a second install a no-op.
(() => {
  if (window.__probeDocSum) return;

  const tracked = new Set([document, window]);
  const perFn = new Map(); // target -> Map(fn -> entry[])
  const perSignal = new Map(); // AbortSignal -> entry[]
  const counts = new Map([
    ["doc", 0],
    ["win", 0],
  ]);
  const keyOf = target => (target === document ? "doc" : "win");

  // Legacy third arg (`addEventListener(type, fn, useCapture)`) as well as the
  // options-object form.
  const captureOf = options =>
    options === true || (options && options.capture === true);

  const kill = entry => {
    if (!entry.live) return;
    entry.live = false;
    const key = keyOf(entry.target);
    counts.set(key, counts.get(key) - 1);
  };

  const siblingsOf = (target, fn) => (perFn.get(target) ?? new Map()).get(fn) ?? [];

  const ET = EventTarget.prototype;
  const nativeAdd = ET.addEventListener;
  const nativeRemove = ET.removeEventListener;

  ET.addEventListener = function (type, fn, options) {
    if (tracked.has(this)) {
      const capture = captureOf(options);
      const siblings = siblingsOf(this, fn);
      const alreadyBound = siblings.some(
        entry => entry.live && entry.type === type && entry.capture === capture,
      );
      if (!alreadyBound) {
        const key = keyOf(this);
        counts.set(key, counts.get(key) + 1);
        const entry = { target: this, type, capture, live: true };
        const byFn = perFn.get(this) ?? new Map();
        const bucket = byFn.get(fn) ?? [];
        bucket.push(entry);
        byFn.set(fn, bucket);
        perFn.set(this, byFn);
        // Only a real add is abortable; a deduped call added nothing to count,
        // so it has no matching removal to record.
        const signal = options && options.signal;
        if (signal) {
          const registered = perSignal.get(signal) ?? [];
          registered.push(entry);
          perSignal.set(signal, registered);
        }
      }
    }
    return nativeAdd.call(this, type, fn, options);
  };

  ET.removeEventListener = function (type, fn, options) {
    if (tracked.has(this)) {
      const capture = captureOf(options);
      const siblings = siblingsOf(this, fn);
      const idx = siblings.findIndex(
        entry => entry.live && entry.type === type && entry.capture === capture,
      );
      if (idx >= 0) kill(siblings[idx]);
    }
    return nativeRemove.call(this, type, fn, options);
  };

  const AC = AbortController.prototype;
  const nativeAbort = AC.abort;
  AC.abort = function (reason) {
    const registered = perSignal.get(this.signal);
    if (registered) {
      perSignal.delete(this.signal);
      for (const entry of registered) kill(entry);
    }
    return nativeAbort.call(this, reason);
  };

  window.__probeDocSum = () => ({
    doc: counts.get("doc"),
    win: counts.get("win"),
    total: counts.get("doc") + counts.get("win"),
  });

  // The page is not finished attaching when a page.evaluate returns: the
  // controls' init passes settle one macrotask after load (see the
  // HeatmapControl layer scan), so a baseline taken immediately is a state no
  // later addControl produces. Sample until two consecutive macrotasks agree,
  // and fail loudly rather than reporting a moving baseline.
  window.__probeDocBase = async () => {
    const settle = () => new Promise(resolve => setTimeout(resolve, 0));
    let prev = null;
    let stable = 0;
    for (let i = 0; i < 25 && stable < 2; i++) {
      await settle();
      const now = window.__probeDocSum().total;
      stable = now === prev ? stable + 1 : 0;
      prev = now;
    }
    if (stable < 2) {
      throw new Error(
        "_probe/doc_listener_probe: the document/window listener count was " +
          "still changing after 25 macrotasks; the page never settled",
      );
    }
    return prev;
  };
})();
