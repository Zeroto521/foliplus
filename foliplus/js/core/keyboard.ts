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

  constructor(map: L.Map) {
    this.map = map;
  }

  /**
   * Register one or more shortcuts for a component.
   * @param component - Component name
   * @param defs - Shortcut definitions
   * @param container - Optional default container applied to all shortcuts that don't specify their own container
   */
  register(component: string, defs: ShortcutDef[], container?: HTMLElement): void {
    for (const d of defs) {
      const def = { ...d, component };
      // Apply default container if not specified on the shortcut itself
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
      }
      this.shortcuts.push(def);
    }
    this.ensureListener();
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
