// Provides lifecycle hooks and auto-cleanup of listeners.
//
// Lifecycle contract:
//   1. Construction — `init()` runs exactly once.
//   2. onAdd()      — builds DOM via buildDOM()/build() and installs a fresh
//                     AbortController for this mounting.
//   3. onRemove()   — destroys lifecycle resources in order:
//                        destroy() → onMap listener cleanup → effect cleanup
//                        → abort the current signal
//                     Then clears the abort-controller field. A re-add
//                     installs a fresh controller on the next onAdd.
//   4. The same instance may be removed and re-added repeatedly; each
//      mounting cycle gets brand-new DOM and brand-new lifecycle resources.
//      A stale, already-aborted signal would leave every `{signal}`
//      listener permanently dead without any error — the hardest class
//      of leak to track down — so a fresh controller per mounting is
//      mandatory.
//
// Helper surface (all tracked, auto-cleaned on remove):
//   - this.on(target, event, fn, options?) — DOM listener via
//     `addEventListener(..., {signal: this.signal})`; the browser handles
//     teardown, so the component has nothing to remember. Returns an
//     early-unbind function.
//   - this.onMap(event, fn) — Leaflet event listener (map / layer / control);
//     Leaflet has no `signal` API, so this keeps its own bookkeeping.
//   - this.effect(setup) — anything else a component sets up and has to
//     tear down: debounce factories, MutationObserver, ResizeObserver,
//     setTimeout/Interval handle wrappers, raf loops. The setup closure
//     may return a cleanup function or a value carrying its own
//     `.cancel()` / `.disconnect()`; either is registered and runs on
//     remove.
//   - this.listenDOM / listenMap / trackCleanup — legacy aliases over the
//     above; kept so existing call sites are untouched.
//
// Notes:
//   - `map` is NOT a free variable here (common modules are imported, not
//     wrapped by the Jinja IIFE). Use `this._map`, which Leaflet sets
//     after the control is added to a map.
//   - document/window-level listeners, and any listener with capture /
//     passive / once options, MUST also come through `this.on` (or a
//     legacy alias). Bare `addEventListener` has no removal owner, and
//     the removal is exactly what this class exists for.
//   - `this.signal` throws when the control is detached; a detached read
//     is a programming error, and a silent fallback would hide it.
import { EVENTS, ensureEvents } from "#core/event/index.js";

/** Tag cleanup closures so the legacy `listenDOM` alias can dedup by
 *  `(event, fn)` without a parallel array. The signal already prevents
 *  duplicate browser listeners, but a second registration would still
 *  push a second cleanup entry, doubling the unbind call. */
const FINGERPRINT = "__fp";

type TaggedCleanup = (() => void) & { [FINGERPRINT]?: string };

const fingerprint = (event: string, fn: unknown): string => {
  const s = fn as { toString?: () => string };
  return `${event}\u0001${typeof s.toString === "function" ? s.toString() : ""}`;
};

class BaseControl extends L.Control {
  /**
   * One AbortController per mounting. Installed once at construction so
   * `this.signal` is readable from `init()` onward; replaced on every
   * `onAdd()` so a re-attached instance never carries a stale, already-
   * aborted signal. An aborted signal would leave every `{signal}`
   * listener permanently dead without any error — no error, no warning,
   * just silently-dead handlers — the hardest leak to track down.
   */
  private _ac = new AbortController();

  /** Legacy field. The signal handles DOM listener teardown, so this is
   *  only populated by the `listenDOM` alias for backwards-compatible
   *  introspection (e.g. "how many DOM listeners did this mounting
   *  register"). Cleared on `onRemove` alongside every other array. */
  events: Array<[EventTarget, string, EventListenerOrEventListenerObject]> = [];
  mapListeners: Array<[string, L.LeafletEventHandlerFn]> = [];
  cleanups: Array<() => void> = [];

  _map!: L.Map;
  init?(): void;
  buildDOM?(): HTMLElement;
  build?(): HTMLElement;

  constructor(options?: L.ControlOptions) {
    super(options);
    this.events = [];
    this.mapListeners = [];
    this.cleanups = [];
    this.init?.();
  }

  onAdd(): HTMLElement {
    // Every mounting cycle installs a brand-new controller BEFORE building
    // the DOM, so listeners registered inside buildDOM() capture the
    // signal for this mounting. An aborted signal (from a previous mount)
    // would silently disable every `{signal}` listener registered against
    // it — no error, no warning, just dead handlers — so a stale
    // controller is exactly the failure mode to prevent.
    this._ac = new AbortController();
    const container =
      this.buildDOM?.() ?? this.build?.() ?? document.createElement("div");
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);
    // Ready signal: other controls (LayerControl's init pass) can run on
    // attach completion instead of a fixed delay.
    try {
      const events = ensureEvents(this._map);
      events.emit(EVENTS.CONTROL_ATTACHED, {
        component: this.constructor.name,
      });
    } catch {
      // No event bus on this map (lightweight stub) — init falls back to
      // its synchronous pass, which is sufficient without other controls.
    }
    return container;
  }

  onRemove(): void {
    // Idempotent: a second call (e.g. Leaflet removing the control again
    // after an internal state change) must not re-run destroy() or
    // re-iterate the already-cleared arrays. The signal is already
    // aborted, so registering against it in destroy() would silently
    // no-op; but the component's own destroy() code would run twice.
    if (this._ac === null) return;
    this.destroy();
    // Auto-unbind tracked listeners — always runs, cannot be skipped by
    // subclasses. Order matters: map listeners are unbound against a
    // live map, effect cleanups may still consult the signal (they see
    // it live here), and only then does the signal abort. DOM listeners
    // attached via `{signal}` are dropped by the browser on abort — no
    // callback fires — so there is no window of double-cleanup to worry
    // about.
    this.mapListeners.forEach(([event, fn]) => this._map.off(event, fn));
    this.mapListeners = [];
    this.cleanups.forEach(fn => fn());
    this.cleanups = [];
    this.events = [];
    this._ac?.abort();
    this._ac = null;
  }

  /** Override to release resources on removal. Called before auto-unbind. */
  destroy(): void {}

  /**
   * The abort signal for the current mounting. Components register DOM
   * listeners against it (via `this.on`) and can hand it to fetch /
   * timers / observers so they all share one lifecycle concept.
   *
   * A new controller is installed on every `onAdd()`; the previous one
   * is aborted on `onRemove()`. Reading this while detached throws — a
   * detached read is a lifecycle bug, and a silent fallback would hide
   * it.
   */
  get signal(): AbortSignal {
    if (!this._ac) {
      throw new Error(
        `${this.constructor.name}: read of \`signal\` on a detached control — ` +
          `register listeners inside onAdd/buildDOM, not at construction.`,
      );
    }
    return this._ac.signal;
  }

  /**
   * Register a DOM event listener for the current mounting. Any
   * `EventTarget` (window, document, element); any `capture` / `passive`
   * / `once` options. Teardown is the browser's job via the shared
   * signal — no pairing bookkeeping on the component side.
   *
   * Returns an unbind function for early removal while the control is
   * still attached. Calling it twice is a no-op.
   */
  on(
    target: EventTarget,
    type: string,
    fn: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions,
  ): () => void {
    const signal = this.signal;
    const capture = options?.capture ?? false;
    target.addEventListener(type, fn, { ...options, signal });
    let unbound = false;
    return () => {
      if (unbound) return;
      unbound = true;
      target.removeEventListener(type, fn, capture);
    };
  }

  /**
   * Register a Leaflet event listener (map / layer / control). Leaflet
   * has no `signal` API, so these live in a bookkeeping array the way
   * the old `listenMap` did. Idempotent on the same `(event, fn)` pair.
   */
  onMap(event: string, fn: L.LeafletEventHandlerFn): void {
    if (this.mapListeners.some(it => it[0] === event && it[1] === fn)) return;
    this._map.on(event, fn);
    this.mapListeners.push([event, fn]);
  }

  /**
   * Run a one-shot setup function for the current mounting; register
   * anything it returns as a cleanup to run on remove.
   *
   * Setup may return void (nothing to clean up), a teardown closure, or
   * a value carrying its own `.cancel()` / `.disconnect()` — any of which
   * is wrapped into a cleanup and registered.
   *
   * Covers every shape of "resource the component owns for this
   * mounting": debounce factories, MutationObserver / ResizeObserver,
   * timers, raf loops, helper factories that return their own unbind,
   * and multi-step setup that installs several sub-resources and has to
   * unwind them all.
   */
  effect(setup: () => void | (() => void)): void {
    const result = setup();
    if (result == null) return;
    if (typeof result !== "function") {
      const cancel =
        (result as { cancel?: () => void }).cancel ??
        (result as { disconnect?: () => void }).disconnect;
      if (typeof cancel === "function") {
        this.cleanups.push(cancel.bind(result));
        return;
      }
      return;
    }
    this.cleanups.push(result);
  }

  /**
   * Legacy alias for `trackCleanup(fn)`. New code should call `effect`
   * directly — it accepts the setup-closure form and covers the same
   * use case. Kept so `LayerControl/index.ts` and `HeatmapControl/index.ts`
   * are untouched. Idempotent on the same `fn` reference, matching the
   * original contract.
   */
  trackCleanup(fn: () => void): void {
    const fp = `${FINGERPRINT}\u0001${fn.toString()}`;
    if (this.cleanups.some(c => (c as TaggedCleanup)[FINGERPRINT] === fp)) return;
    const tagged = (() => fn()) as TaggedCleanup;
    tagged[FINGERPRINT] = fp;
    this.cleanups.push(tagged);
  }

  /**
   * Legacy alias for `on(el, event, fn, options?)`.
   *
   * Keeps the original idempotency contract: dedup by `(event, fn)`
   * across repeated calls on the same mounting. The dedup piggybacks on
   * the fingerprint tag `on` sets on the returned unbind closure, so no
   * parallel tracking array is needed. The signal handles teardown at
   * the browser level, so the alias does not need to keep its own
   * listener table.
   */
  listenDOM(
    el: EventTarget,
    event: string,
    fn: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions,
  ): void {
    const fp = fingerprint(event, fn);
    if (this.cleanups.some(c => (c as TaggedCleanup)[FINGERPRINT] === fp)) return;
    const unbind = this.on(el, event, fn, options);
    (unbind as TaggedCleanup)[FINGERPRINT] = fp;
    this.events.push([el, event, fn]);
    this.cleanups.push(unbind);
  }

  /** Legacy alias for `onMap`. */
  listenMap(event: string, fn: L.LeafletEventHandlerFn): void {
    this.onMap(event, fn);
  }
}

export { BaseControl };
