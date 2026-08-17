// core/interaction — per-map user interaction manager (keyboard + mouse + touch).
// Provides a central document-level keydown listener that dispatches to
// registered shortcuts by priority, avoiding duplicate listeners across
// components and resolving key conflicts.

export interface InteractionDef {
  /** Event type: "keydown" (default), "mousedown", "mousemove", "mouseup", etc. */
  event?: string;
  /** Key to match (event.key), only for keydown. If omitted, matches any key. */
  key?: string;
  /** Require Ctrl (or Cmd on macOS) */
  ctrl?: boolean;
  /** Require Shift */
  shift?: boolean;
  /** Require Alt */
  alt?: boolean;
  /** Require Meta (Cmd on macOS) */
  meta?: boolean;
  /** Handler called when the shortcut matches */
  handler: (event: Event) => void;
  /** Higher priority wins when multiple shortcuts match the same key.
   *  Default 0. Negative values are allowed for fallback handlers. */
  priority?: number;
  /** If set, the shortcut only fires when the container (or a child) has focus.
   *  Uses document-level listener with focus check. */
  container?: HTMLElement;
  /** If set, binds keydown directly to this element instead of the document.
   *  Only fires when this element has focus (native behavior). */
  element?: HTMLElement;
  /** If true, the listener is automatically removed after the first trigger. */
  once?: boolean;
  /** Component name for debugging */
  component?: string;
}

// Per-map instance storage
const instances = new WeakMap<L.Map, InteractionManager>();

/** Ensure map.foliplus.keyboard has a per-map InteractionManager. Idempotent. */
export const ensureInteraction = (map: L.Map): InteractionManager => {
  const existing = instances.get(map);
  if (existing) return existing;
  const km = new InteractionManager(map);
  instances.set(map, km);
  if (!map.foliplus) (map as any).foliplus = {};
  map.foliplus!.keyboard = km;
  return km;
};

/**
 * Per-map keyboard shortcut manager.
 *
 * Attaches a single `document`-level keydown listener and dispatches to
 * registered shortcuts by priority. Components register/unregister their
 * shortcuts on mount/unmount.
 */
export class InteractionManager {
  private map: L.Map;
  private shortcuts: InteractionDef[] = [];
  private docListeners: Map<string, (event: Event) => void> = new Map();
  private observer: MutationObserver | null = null;
  private trackedElements: Map<HTMLElement, Set<string>> = new Map();

  constructor(map: L.Map) {
    this.map = map;
    map.on("unload" as any, () => this.clear());
  }

  /** Start observing DOM for element/container removal to auto-cleanup. */
  private ensureObserver(): void {
    if (this.observer) return;
    this.observer = new MutationObserver(mutations => {
      for (const m of mutations) {
        for (const removed of m.removedNodes) {
          if (!(removed instanceof HTMLElement)) continue;
          // Check if any tracked element is being removed
          for (const [el, components] of this.trackedElements) {
            if (!document.body.contains(el)) {
              // Element was removed from DOM — unregister all its components
              for (const c of components) this.unregister(c);
              this.trackedElements.delete(el);
            }
          }
        }
      }
    });
    this.observer.observe(document.body, { childList: true, subtree: true });
  }

  /** Track an element for auto-cleanup when it's removed from the DOM. */
  private trackElement(el: HTMLElement, component: string): void {
    if (!this.trackedElements.has(el)) {
      this.trackedElements.set(el, new Set());
    }
    this.trackedElements.get(el)!.add(component);
    this.ensureObserver();
  }

  /**
   * Register one or more shortcuts for a component.
   * @param component - Component name
   * @param defs - Shortcut definitions
   * @param container - Optional default container applied to all shortcuts that don't specify their own container
   * @returns A cleanup function that unregisters the component when called
   */
  register(
    component: string,
    defs: InteractionDef[],
    container?: HTMLElement,
  ): () => void {
    for (const d of defs) {
      const def = { ...d, component };
      if (container && !def.container && !def.element) {
        def.container = container;
      }
      if (def.element) {
        const eventType = def.event ?? "keydown";
        const handler = (event: Event) => {
          // Key matching only for keydown events
          if (eventType === "keydown" && def.key) {
            const ke = event as KeyboardEvent;
            if (def.key !== ke.key) return;
            if (def.ctrl && !ke.ctrlKey && !ke.metaKey) return;
            if (def.meta && !ke.metaKey) return;
            if (def.shift && !ke.shiftKey) return;
            if (def.alt && !ke.altKey) return;
          }
          event.preventDefault();
          event.stopPropagation();
          def.handler(event);
        };
        def.element.addEventListener(eventType, handler, def.once ? { once: true } : undefined);
        (def as any).elementHandler = handler;
        this.trackElement(def.element, component);
      }
      if (def.container && !def.element) {
        this.trackElement(def.container, component);
      }
      this.shortcuts.push(def);
    }
    this.ensureListener();
    // Return cleanup function
    return () => this.unregister(component);
  }

  /** Unregister all shortcuts for a component. */
  unregister(component: string): void {
    const removed = this.shortcuts.filter(s => s.component === component);
    for (const s of removed) {
      if (s.element && (s as any).elementHandler) {
        s.element.removeEventListener("keydown", (s as any).elementHandler);
      }
    }
    this.shortcuts = this.shortcuts.filter(s => s.component !== component);
    if (this.shortcuts.length === 0) this.removeListener();
  }

  /** Clear all shortcuts. */
  clear(): void {
    for (const s of this.shortcuts) {
      if (s.element && (s as any).elementHandler) {
        s.element.removeEventListener("keydown", (s as any).elementHandler);
      }
    }
    this.shortcuts = [];
    this.trackedElements.clear();
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.removeListener();
  }

  private ensureListener(): void {
    // Collect all event types that need document-level listening
    const eventTypes = new Set<string>();
    for (const s of this.shortcuts) {
      if (!s.element) {
        eventTypes.add(s.event ?? "keydown");
      }
    }
    for (const type of eventTypes) {
      if (this.docListeners.has(type)) continue;
      const handler = (event: Event) => this.handleEvent(event);
      document.addEventListener(type, handler);
      this.docListeners.set(type, handler);
    }
  }

  private removeListener(): void {
    for (const [type, handler] of this.docListeners) {
      document.removeEventListener(type, handler);
    }
    this.docListeners.clear();
  }

  private handleEvent(event: Event): void {
    const eventType = event.type;
    const ke = event as KeyboardEvent;
    const matches = this.shortcuts
      .filter(s => {
        // Only match document-level shortcuts (no element binding)
        if (s.element) return false;
        // Match event type
        const sType = s.event ?? "keydown";
        if (sType !== eventType) return false;
        // Key matching only for keydown
        if (sType === "keydown" && s.key) {
          if (s.key !== ke.key) return false;
          if (s.ctrl && !ke.ctrlKey && !ke.metaKey) return false;
          if (s.meta && !ke.metaKey) return false;
          if (s.shift && !ke.shiftKey) return false;
          if (s.alt && !ke.altKey) return false;
        }
        // Container focus check
        if (s.container && !s.container.contains(document.activeElement)) return false;
        return true;
      })
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    if (matches.length === 0) return;

    const best = matches[0];
    event.preventDefault();
    event.stopPropagation();
    best.handler(event);
  }

  destroy(): void {
    this.clear();
    instances.delete(this.map);
  }
}
