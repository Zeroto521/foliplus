// core/keyboard — per-map keyboard shortcut manager.
// Provides a central document-level keydown listener that dispatches to
// registered shortcuts by priority, avoiding duplicate listeners across
// components and resolving key conflicts.

export interface ShortcutDef {
  /** Key to match (event.key), e.g. "Escape", "ArrowUp", "z" */
  key: string;
  /** Require Ctrl (or Cmd on macOS) */
  ctrl?: boolean;
  /** Require Shift */
  shift?: boolean;
  /** Require Alt */
  alt?: boolean;
  /** Require Meta (Cmd on macOS) */
  meta?: boolean;
  /** Handler called when the shortcut matches */
  handler: () => void;
  /** Higher priority wins when multiple shortcuts match the same key.
   *  Default 0. Negative values are allowed for fallback handlers. */
  priority?: number;
  /** If set, the shortcut only fires when the container (or a child) has focus.
   *  Uses document-level listener with focus check. */
  container?: HTMLElement;
  /** If set, binds keydown directly to this element instead of the document.
   *  Only fires when this element has focus (native behavior). */
  element?: HTMLElement;
  /** Component name for debugging */
  component?: string;
}

// Per-map instance storage
const instances = new WeakMap<L.Map, KeyboardManager>();

/** Ensure map.foliplus.keyboard has a per-map KeyboardManager. Idempotent. */
export const ensureKeyboard = (map: L.Map): KeyboardManager => {
  const existing = instances.get(map);
  if (existing) return existing;
  const km = new KeyboardManager(map);
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
export class KeyboardManager {
  private map: L.Map;
  private shortcuts: ShortcutDef[] = [];
  private boundHandler: ((event: KeyboardEvent) => void) | null = null;
  private observer: MutationObserver | null = null;
  private trackedElements: Map<HTMLElement, Set<string>> = new Map();

  constructor(map: L.Map) {
    this.map = map;
    map.on("unload" as any, () => this.clear());
  }

  /** Start observing DOM for element/container removal to auto-cleanup. */
  private ensureObserver(): void {
    if (this.observer) return;
    this.observer = new MutationObserver((mutations) => {
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
    defs: ShortcutDef[],
    container?: HTMLElement,
  ): () => void {
    for (const d of defs) {
      const def = { ...d, component };
      if (container && !def.container && !def.element) {
        def.container = container;
      }
      if (def.element) {
        const handler = (event: Event) => {
          const ke = event as KeyboardEvent;
          if (def.key !== ke.key) return;
          if (def.ctrl && !ke.ctrlKey && !ke.metaKey) return;
          if (def.meta && !ke.metaKey) return;
          if (def.shift && !ke.shiftKey) return;
          if (def.alt && !ke.altKey) return;
          ke.preventDefault();
          ke.stopPropagation();
          def.handler();
        };
        def.element.addEventListener("keydown", handler);
        (def as any)._elementHandler = handler;
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
      if (s.element && (s as any)._elementHandler) {
        s.element.removeEventListener("keydown", (s as any)._elementHandler);
      }
    }
    this.shortcuts = this.shortcuts.filter(s => s.component !== component);
    if (this.shortcuts.length === 0) this.removeListener();
  }

  /** Clear all shortcuts. */
  clear(): void {
    for (const s of this.shortcuts) {
      if (s.element && (s as any)._elementHandler) {
        s.element.removeEventListener("keydown", (s as any)._elementHandler);
      }
    }
    this.shortcuts = [];
    this.trackedElements.clear();
    if (this.observer) { this.observer.disconnect(); this.observer = null; }
    this.removeListener();
  }

  private ensureListener(): void {
    if (this.boundHandler) return;
    this.boundHandler = (event: KeyboardEvent) => this.handleKeyDown(event);
    document.addEventListener("keydown", this.boundHandler);
  }

  private removeListener(): void {
    if (!this.boundHandler) return;
    document.removeEventListener("keydown", this.boundHandler);
    this.boundHandler = null;
  }

  private handleKeyDown(event: KeyboardEvent): void {
    // Find matching shortcuts sorted by priority (descending)
    const matches = this.shortcuts
      .filter(s => {
        if (s.key !== event.key) return false;
        if (s.ctrl && !event.ctrlKey && !event.metaKey) return false;
        if (s.meta && !event.metaKey) return false;
        if (s.shift && !event.shiftKey) return false;
        if (s.alt && !event.altKey) return false;
        // If container is specified, only respond when focus is inside it
        if (s.container && !s.container.contains(document.activeElement)) return false;
        return true;
      })
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    if (matches.length === 0) return;

    const best = matches[0];
    event.preventDefault();
    event.stopPropagation();
    best.handler();
  }

  destroy(): void {
    this.clear();
    instances.delete(this.map);
  }
}
