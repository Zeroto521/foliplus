// Provides lifecycle hooks and auto-cleanup of listeners.
// Subclasses define:
//   - init()       — called at construction (before DOM added)
//   - buildDOM()   — returns the container element (called in onAdd)
//   - destroy()    — override to release resources on removal
//
// Listener helpers (tracked, auto-unbound on remove):
//   - this.listenDOM(el, ev, fn)  — L.DomEvent.on + tracked
//   - this.listenMap(ev, fn)      — this._map.on + tracked
//
// Notes:
//   - `map` is NOT a free variable here (common modules are imported, not
//     wrapped by the Jinja IIFE). Use `this._map`, which Leaflet sets after
//     the control is added to a map.
//   - Registration is idempotent: calling listen* twice never double-binds.
//   - onRemove is final — subclasses override destroy() instead.

/** True if a listener tuple with the same (target, event) is already tracked. */
const alreadyBound = (list: readonly unknown[][], item: readonly unknown[]): boolean =>
  list.some(it => it[0] === item[0] && it[1] === item[1]);

class BaseControl extends L.Control {
  events: Array<[HTMLElement, string, (e: Event) => void]>;
  mapListeners: Array<[string, L.LeafletEventHandlerFn]>;
  _map!: L.Map;
  init?(): void;
  buildDOM?(): HTMLElement;
  build?(): HTMLElement;

  constructor(options?: L.ControlOptions) {
    super(options);
    this.events = [];
    this.mapListeners = [];
    this.init?.();
  }

  onAdd(): HTMLElement {
    const container =
      this.buildDOM?.() ?? this.build?.() ?? document.createElement("div");
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);
    return container;
  }

  onRemove(): void {
    this.destroy();
    // Auto-unbind tracked listeners — always runs, cannot be skipped by subclasses.
    this.events.forEach(([el, ev, fn]) => L.DomEvent.off(el, ev, fn));
    this.events = [];
    this.mapListeners.forEach(([ev, fn]) => this._map.off(ev as any, fn));
    this.mapListeners = [];
  }

  /** Override to release resources on removal. Called before auto-unbind. */
  destroy(): void {}

  /** Track a L.DomEvent listener for auto-cleanup. */
  listenDOM(el: HTMLElement, ev: string, fn: (e: Event) => void): void {
    const item: [HTMLElement, string, (e: Event) => void] = [el, ev, fn];
    if (alreadyBound(this.events, item)) return;
    L.DomEvent.on(el, ev, fn);
    this.events.push(item);
  }

  /** Track a map event listener for auto-cleanup. */
  listenMap(ev: string, fn: L.LeafletEventHandlerFn): void {
    const item: [string, L.LeafletEventHandlerFn] = [ev, fn];
    if (alreadyBound(this.mapListeners, item)) return;
    this._map.on(ev, fn);
    this.mapListeners.push(item);
  }
}

export { BaseControl };
