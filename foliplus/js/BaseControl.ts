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
// Helper surface (exactly three, all tracked, auto-cleaned on remove):
//   - this.on(target, event, fn, options?) — DOM listener via
//     `addEventListener(..., {signal: this.signal})`; the browser handles
//     teardown, so the component has nothing to remember. Returns an
//     early-unbind function. The `signal` option needs Chrome 98 /
//     Firefox 88 / Safari 15.4 — inside the browserslist (`> 0.5%`,
//     `last 2 versions`, `Firefox ESR`, `not dead`), but a tighter target
//     would have to reimplement teardown itself.
//   - this.onMap(event, fn) — Leaflet event listener (map / layer / control);
//     Leaflet has no `signal` API, so this keeps its own bookkeeping.
//   - this.effect(setup) — anything else a component sets up and has to
//     tear down: debounce factories, MutationObserver, ResizeObserver,
//     setTimeout/Interval handle wrappers, raf loops. The setup closure
//     may return a cleanup function or a value carrying its own
//     `.cancel()` / `.disconnect()`; either is registered and runs on
//     remove.
//
// Notes:
//   - `map` is NOT a free variable here (common modules are imported, not
//     wrapped by the Jinja IIFE). Use `this._map`, which Leaflet sets
//     after the control is added to a map.
//   - document/window-level listeners, and any listener with capture /
//     passive / once options, MUST come through `this.on`. Bare
//     `addEventListener` has no removal owner, and the removal is exactly
//     what this class exists for.
//   - `this.signal` throws when the control is detached; a detached read
//     is a programming error, and a silent fallback would hide it.
import { EVENTS, ensureEvents } from "#core/event/index.js";
import { createLogger } from "#common/log.js";

const log = createLogger("BaseControl");

class BaseControl extends L.Control {
  /**
   * One AbortController per mounting. Installed on every `onAdd()` so
   * listeners registered inside `buildDOM()` capture the signal for that
   * mounting; aborted on `onRemove()` and the field set to `null`. A
   * re-attached instance never carries a stale, already-aborted signal —
   * an aborted signal would leave every `{signal}` listener permanently
   * dead without any error (no error, no warning, just silently-dead
   * handlers), the hardest class of leak to track down. The field is
   * `null` between construction and the first `onAdd()`, which is why
   * the `signal` getter throws on a detached read.
   */
  private ac: AbortController | null = null;

  /**
   * Idempotency flag for `onRemove()`. Distinct from `ac === null`:
   * the latter also covers "never mounted", and a component that calls
   * `onRemove()` without a preceding `onAdd()` (the unit-test pattern)
   * must still have its registered listeners cleaned up. Only the
   * second call within the same mounting cycle short-circuits.
   */
  private removed = false;

  mapListeners: Array<[string, L.LeafletEventHandlerFn]> = [];
  cleanups: Array<() => void> = [];

  _map!: L.Map;
  init?(): void;
  buildDOM?(): HTMLElement;
  build?(): HTMLElement;

  constructor(options?: L.ControlOptions) {
    super(options);
    this.init?.();
  }

  onAdd(): HTMLElement {
    // Every mounting cycle installs a brand-new controller BEFORE building
    // the DOM, so listeners registered inside buildDOM() capture the
    // signal for this mounting. An aborted signal (from a previous mount)
    // would silently disable every `{signal}` listener registered against
    // it — no error, no warning, just dead handlers — so a stale
    // controller is exactly the failure mode to prevent.
    this.ac = new AbortController();
    this.removed = false;
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
    // re-iterate the already-cleared arrays. `removed` is set before
    // destroy() so a re-entrant call from destroy() itself is also
    // guarded; the second call hits the early return and never reaches
    // the cleanup — which is correct, because the first call's finally
    // block has already torn everything down.
    // The flag is `removed`, not `ac === null` — the latter also
    // matches "never mounted", and a component that calls `onRemove()`
    // without a preceding `onAdd()` (the unit-test pattern) must still
    // have its registered listeners cleaned up.
    if (this.removed) return;
    this.removed = true;
    try {
      this.destroy();
    } finally {
      // Auto-unbind tracked listeners — always runs, cannot be skipped by
      // subclasses or by a throwing destroy(). Order matters: map listeners
      // are unbound against a live map, effect cleanups may still consult
      // the signal (they see it live here), and only then does the signal
      // abort. DOM listeners attached via `{signal}` are dropped by the
      // browser on abort — no callback fires — so there is no window of
      // double-cleanup to worry about.
      this.mapListeners.forEach(([event, fn]) => this._map.off(event, fn));
      this.mapListeners = [];
      this.cleanups.forEach(fn => fn());
      this.cleanups = [];
      this.ac?.abort();
      this.ac = null;
    }
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
    if (!this.ac) {
      throw new Error(
        `${this.constructor.name}: read of \`signal\` on a detached control — ` +
          `register listeners inside onAdd/buildDOM, not at construction.`,
      );
    }
    return this.ac.signal;
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
   * has no `signal` API, so these live in a bookkeeping array the base
   * class unbinds on remove. Idempotent on the same `(event, fn)` pair.
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
   * is wrapped into a cleanup and registered. A value with neither hook
   * is a no-op that logs a warning: registering it would be invoked at
   * remove time and throw.
   *
   * Covers every shape of "resource the component owns for this
   * mounting": debounce factories, MutationObserver / ResizeObserver,
   * timers, raf loops, helper factories that return their own unbind,
   * and multi-step setup that installs several sub-resources and has to
   * unwind them all.
   */
  effect(
    setup: () => void | (() => void) | { cancel?: () => void; disconnect?: () => void },
  ): void {
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
      log.warn(
        `${this.constructor.name}.effect(): setup returned a value with no ` +
          `.cancel() or .disconnect() — nothing registered`,
      );
      return;
    }
    this.cleanups.push(result);
  }
}

export { BaseControl };
