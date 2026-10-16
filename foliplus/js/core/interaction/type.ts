// core/interaction/type — caller-facing and internal shortcut definitions.
// Pure types: the shape `InteractionManager.register()` accepts, plus the
// manager-internal bookkeeping fields it stamps on each entry. Kept apart
// from `interactionManager.ts` so the class file can focus on dispatch and
// ordering without dragging its own input schema around.
/**
 * A shortcut definition as accepted by `register()` (the caller-facing part).
 * Entries held in `InteractionManager.shortcuts` additionally carry the
 * bookkeeping fields that the manager itself writes (`elementHandler`,
 * `elementType`, `order`) — see {@link InteractionEntry}.
 */
interface InteractionDef {
  /** Event type: "keydown" (default), "mousedown", "mousemove", "mouseup", etc. */
  event?: string;
  /** Key to match (event.key) for keydown/keyup. If omitted, matches any key. */
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
  /** If set, the shortcut only fires when the container (or a child) has
   *  focus **and that focus is not held by a control that natively consumes
   *  the key** — the ownership half is decided once by the manager before
   *  dispatch, not re-checked by the handler. */
  container?: HTMLElement;
  /** If set, binds keydown directly to this element instead of the document.
   *  Only fires when this element has focus (native behavior). */
  element?: HTMLElement;
  /** If true, the listener is automatically removed after the first trigger. */
  once?: boolean;
  /** Whether a matched event is swallowed via preventDefault + stopPropagation
   *  (default true, the shortcut semantics). Set false for observers that must
   *  not disturb the event — e.g. a pointer handler that only watches for
   *  presses outside a panel while the press keeps its native behavior
   *  (focus move, drag start, text selection). */
  preventDefault?: boolean;
  /** Component name for debugging */
  component?: string;
}

/**
 * A stored shortcut: the caller-facing definition plus the bookkeeping the
 * manager writes when it binds and orders the entry. Kept separate from
 * {@link InteractionDef} so `register()`'s public signature does not expose
 * manager internals — the fields are assigned internally only.
 */
interface InteractionEntry extends InteractionDef {
  /** The listener attached to `element` (needs the exact closure to remove it). */
  elementHandler?: (event: Event) => void;
  /** Event type the element listener was registered under. */
  elementType?: string;
  /** Registration sequence; breaks ties between same-priority shortcuts. */
  order: number;
}

export type { InteractionDef, InteractionEntry };
