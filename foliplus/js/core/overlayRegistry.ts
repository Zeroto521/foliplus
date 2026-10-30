// core/overlayRegistry — one dispatcher for the floating surfaces.
//
// Why this is split from core/overlay.ts: that module is the stable leaf
// predicate ("is this press inside my panel plus my portals") and already
// shared by every panel and the scheme picker. This module owns the mutable
// half — which surfaces exist, which are open, the two press phases and the
// document capture Escape dispatcher. Keeping them apart means a panel
// migration cannot accidentally change the containment rule, and the leaf
// predicate stays importable without pulling in listener lifetime, ordering
// tables or per-map singletons.
//
// A sibling file rather than a core/overlay/ subdirectory: the shared-registry
// generator derives the published namespace from the top-level core name, so a
// directory called "overlay" next to core/overlay.ts would emit the same
// coreoverlay symbol twice and fail the common bundle. Keeping the registry as
// core/overlayRegistry.ts preserves the split without touching the build's
// namespace model.
//
// Ownership is per-entry, never global: a press inside panel B still dismisses
// panel A, because A only knows its own DOM. The one ordered table here is
// ESC_PRIORITY (higher rank = closer to the top), used to pick the owning
// entry and as the deterministic fallback when two open entries contain the
// same target. Registration order is never the order surfaces are consulted.
import { isInsideOverlay } from "#core/overlay.js";
import { createLogger } from "#common/log.js";

const log = createLogger("Overlay");

type OverlayPhase = "mousedown" | "click";

/** Only one Escape scope exists today; kept explicit so the Export crop can
 *  join at M4 without changing the entry shape. */
type EscScope = "document";

/** One press, as seen by the predicates. `consume()` marks the press handled;
 *  the dispatcher then stops walking and the press keeps its native behaviour
 *  (both dispatchers are passive — they never call preventDefault). */
interface OverlayPress {
  phase: OverlayPhase;
  target: Node;
  reason: "outside" | "inside";
  consume(): void;
  readonly consumed: boolean;
}

interface OverlayEntry {
  /** Stable identity: the Escape order table is keyed by it ("layer.style",
   *  "picker.dropdown", …). A duplicate id is rejected, never merged. */
  id: string;
  /** Opening one entry closes the others in the group (top-layer exclusivity). */
  exclusiveGroup?: string;
  isOpen(): boolean;
  /** Close the surface. Returning `false` means "cannot close right now" (a
   *  read-only notice, a pending commit): the press/Escape is left unhandled
   *  and the surface stays open. */
  close(opts: { restoreFocus: boolean }): void | boolean;
  /** Live DOM, recomputed on every call: a rebuilt row invalidates the nodes
   *  captured by a previous press. */
  panels(): Element[];
  /** Phase this surface keeps. Row panels dismiss on capture-phase mousedown;
   *  the overflow menu and the picker close on the click bubble, after the
   *  target's own click handler ran. */
  dismissOn: OverlayPhase;
  /** Optional predicates; the defaults are outside → true, inside → false. */
  dismissOnOutside?(press: OverlayPress): boolean;
  /** Evaluated in the click phase only: a press inside the surface that still
   *  dismisses it (a menu item acting on the row, a picker row selecting a
   *  value). The capture phase never evaluates it, so it cannot steal a
   *  button's native activation or default focus movement. */
  dismissOnInside?(press: OverlayPress): boolean;
  /** Whether closing this surface also clears the row keyboard cursor. Row
   *  panels set it; picker/crop entries do not (their Escape must not move the
   *  LayerControl cursor). */
  clearsCursorOnClose?: boolean;
  /** Explicit press order: higher = inspected earlier. Never registration
   *  order, never DOM depth. */
  pressPriority: number;
  /** Consume a press before the close decision (a nested popup that handles
   *  the press without dismissing its host surface). */
  consumePress?(target: Element, press: OverlayPress): boolean;
  /** Escape scope; defaults to "document" — the dispatcher is document-level.
   *  The M1 dispatcher does not branch on it yet: it is reserved for the
   *  Export crop registration at M4, where the crop layer lives outside the
   *  component's container. */
  escScope?: EscScope;
  /** True when the surface hosts an editor whose own keydown must win Escape
   *  (inline rename). The dispatcher does not close it and lets the event
   *  continue to the editor. */
  escPassthroughOnEditable?: boolean;
}

/** Payload of every Escape the dispatcher finished with, handled or not. */
interface EscapeHandled {
  /** True when a surface was closed (or an editor passthrough took the key). */
  handled: boolean;
  /** The surface that owns the Escape, or null when nothing owned it. */
  entryId: string | null;
  /** The event target, kept so the cursor owner can tell a press inside its
   *  container from one in another component. Null for a non-Node target. */
  target: Node | null;
  origin: "capture";
  /** True when the closed surface owned the row keyboard cursor (row panels,
   *  menu, rename). The cursor owner clears it from this flag, so it does not
   *  need to keep a second entry-id table in sync with the registry. */
  clearsCursorOnClose?: boolean;
}

/** Entry ids the Escape order table knows. A table id without a constant (or
 *  the reverse) is a contract break, so both live here and the test compares
 *  the two sets. */
const OVERLAY_IDS = {
  LAYER_RENAME: "layer.rename",
  PICKER_DROPDOWN: "picker.dropdown",
  LAYER_MENU: "layer.menu",
  LAYER_FILTER: "layer.filter",
  LAYER_ATTRS: "layer.attrs",
  LAYER_STYLE: "layer.style",
  LAYER_FOCUS: "layer.focus",
  EXPORT_CROP: "export.crop",
} as const;

type OverlayId = (typeof OVERLAY_IDS)[keyof typeof OVERLAY_IDS];

/** Escape order: higher rank = closer to the top. It decides which entry owns
 *  a target when several contain it; it is not a "close everything in order"
 *  list. `layer.cursor` is deliberately absent: the row cursor is not an
 *  overlay and stays an unconditional fallback driven by onEscapeHandled. */
const ESC_PRIORITY: Readonly<Record<OverlayId, number>> = {
  [OVERLAY_IDS.LAYER_RENAME]: 900,
  [OVERLAY_IDS.PICKER_DROPDOWN]: 850,
  [OVERLAY_IDS.LAYER_MENU]: 800,
  [OVERLAY_IDS.LAYER_FILTER]: 700,
  [OVERLAY_IDS.LAYER_ATTRS]: 600,
  [OVERLAY_IDS.LAYER_STYLE]: 500,
  [OVERLAY_IDS.LAYER_FOCUS]: 400,
  [OVERLAY_IDS.EXPORT_CROP]: 300,
};

/** Rank of an id, or -Infinity for an id the table does not know (sorts last). */
const orderOf = (id: string): number =>
  ESC_PRIORITY[id as OverlayId] ?? Number.NEGATIVE_INFINITY;

interface OverlayRegistry {
  /** Register one surface. Returns its unregister; calling it twice is a no-op
   *  and a stale unregister cannot remove a newer entry with the same id. A
   *  duplicate id is rejected with a warning (the Escape table is keyed by id,
   *  so two live entries could not be ordered). */
  register(entry: OverlayEntry): () => void;
  /** Close the open siblings of the entry's exclusive group before it opens. */
  open(entry: OverlayEntry): void;
  /** Per-entry containment: this entry's live panels + portals only. */
  contains(entry: OverlayEntry, target: EventTarget | null): boolean;
  /** The open entry that owns `target` (containment only, ESC_PRIORITY order).
   *  Null means "no overlay owns this target": the dispatcher leaves the event
   *  alone and still notifies subscribers with handled: false. */
  owningEntry(target: EventTarget | null): OverlayEntry | null;
  /** Highest-ranked open entry, or null. */
  topmost(): OverlayEntry | null;
  /** Whether the latest press landed inside any open surface. Overwritten on
   *  every press (not only on change), replacing the old shared boolean. */
  lastPressInside(): boolean;
  /** Subscribe to the outcome of every Escape. Called synchronously once per
   *  event, in registration order; a throwing subscriber is logged and the
   *  rest still run. */
  onEscapeHandled(cb: (payload: EscapeHandled) => void): () => void;
  /** Remove every listener this registry installed and drop the entries. */
  destroy(): void;
}

const nodeOf = (target: EventTarget | null): Node | null => {
  if (!target || typeof (target as Node).nodeType !== "number") return null;
  return target as Node;
};

const elementOf = (target: Node): Element | null =>
  target.nodeType === 1 ? (target as Element) : target.parentElement;

const isEditable = (target: Node): boolean => {
  const element = elementOf(target);
  // A target that owns an entry is an element or a text node with a parent, so
  // the null arm is unreachable through the dispatcher.
  /* v8 ignore next -- owning targets always resolve to an element */
  if (!element) return false;
  const tag = element.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return element instanceof HTMLElement && element.isContentEditable;
};

/** Containment is asked of the panels only. A node the surface portalled
 *  elsewhere is still inside it, because the panel that owns the trigger it was
 *  mounted for answers through common/portalRoot's ownership check — one
 *  mechanism instead of two lists that can disagree. */
const entryContains = (entry: OverlayEntry, target: EventTarget | null): boolean => {
  for (const panel of entry.panels()) {
    if (isInsideOverlay(target, panel)) return true;
  }
  return false;
};

class OverlayRegistryImpl implements OverlayRegistry {
  private readonly entries = new Map<string, OverlayEntry>();
  private readonly subscribers: ((payload: EscapeHandled) => void)[] = [];
  private readonly pressHandlers: {
    mousedown?: (event: MouseEvent) => void;
    click?: (event: MouseEvent) => void;
  } = {};
  private escapeHandler?: (event: KeyboardEvent) => void;
  private pressInside = false;
  private destroyed = false;

  register(entry: OverlayEntry): () => void {
    const existing = this.entries.get(entry.id);
    if (existing) {
      log.warn(
        `duplicate overlay id: ${entry.id}; keeping the already-registered entry`,
      );
      return () => undefined;
    }
    this.entries.set(entry.id, entry);
    this.syncListeners();
    return () => {
      if (this.entries.get(entry.id) !== entry) return;
      this.entries.delete(entry.id);
      this.syncListeners();
    };
  }

  open(entry: OverlayEntry): void {
    if (!entry.exclusiveGroup) return;
    for (const other of this.entries.values()) {
      if (other === entry || other.exclusiveGroup !== entry.exclusiveGroup) continue;
      // A sibling that cannot close right now stays open: the registry has no
      // way to force it, and the reason it refuses (a pending commit, a
      // read-only notice) decides when it goes away.
      if (other.isOpen()) other.close({ restoreFocus: false });
    }
  }

  contains(entry: OverlayEntry, target: EventTarget | null): boolean {
    return entryContains(entry, target);
  }

  owningEntry(target: EventTarget | null): OverlayEntry | null {
    const node = nodeOf(target);
    if (!node) return null;
    for (const entry of this.orderedOpenEntries()) {
      if (entryContains(entry, node)) return entry;
    }
    return null;
  }

  topmost(): OverlayEntry | null {
    return this.orderedOpenEntries()[0] ?? null;
  }

  lastPressInside(): boolean {
    return this.pressInside;
  }

  onEscapeHandled(cb: (payload: EscapeHandled) => void): () => void {
    this.subscribers.push(cb);
    return () => {
      const index = this.subscribers.indexOf(cb);
      if (index >= 0) this.subscribers.splice(index, 1);
    };
  }

  /** Whether destroy() already ran. The per-map factory uses it to hand out a
   *  fresh registry after a map unload instead of a dead one. */
  isDestroyed(): boolean {
    return this.destroyed;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.entries.clear();
    this.subscribers.length = 0;
    this.removePressListener("mousedown");
    this.removePressListener("click");
    this.removeEscapeListener();
  }

  /** Escape ownership order: the central rank table, never pressPriority. */
  private orderedOpenEntries(): OverlayEntry[] {
    return [...this.entries.values()]
      .filter(entry => entry.isOpen())
      .sort((a, b) => orderOf(b.id) - orderOf(a.id));
  }

  /** Press order: the entry's own pressPriority (higher first), independent of
   *  the Escape rank table. Registration order is never used as a tie-break by
   *  contract; a stable sort keeps the map's insertion order only for equal
   *  priorities, which two live entries cannot rely on. */
  private pressOrderedEntries(): OverlayEntry[] {
    return [...this.entries.values()]
      .filter(entry => entry.isOpen())
      .sort((a, b) => b.pressPriority - a.pressPriority);
  }

  private syncListeners(): void {
    if (this.destroyed) return;
    const wantsMouse = [...this.entries.values()].some(
      entry => entry.dismissOn === "mousedown",
    );
    const wantsClick = [...this.entries.values()].some(
      entry => entry.dismissOn === "click",
    );
    const wantsEscape = this.entries.size > 0;

    if (wantsMouse) this.installPressListener("mousedown");
    else this.removePressListener("mousedown");
    if (wantsClick) this.installPressListener("click");
    else this.removePressListener("click");
    if (wantsEscape) this.installEscapeListener();
    else this.removeEscapeListener();
  }

  private installPressListener(phase: OverlayPhase): void {
    if (this.pressHandlers[phase]) return;
    const handler = (event: MouseEvent): void => {
      const target = nodeOf(event.target);
      // A non-Node target (window, a Worker port) never yields a press: there
      // is no DOM subtree to classify and no entry can own it. DOM dispatch
      // cannot produce one, so this is a guard for direct/synthetic calls.
      /* v8 ignore next -- non-Node targets never reach a document listener */
      if (!target) return;
      this.dispatchPress(phase, target);
    };
    this.pressHandlers[phase] = handler;
    document.addEventListener(phase, handler, phase === "mousedown");
  }

  private removePressListener(phase: OverlayPhase): void {
    const handler = this.pressHandlers[phase];
    if (!handler) return;
    document.removeEventListener(phase, handler, phase === "mousedown");
    delete this.pressHandlers[phase];
  }

  private dispatchPress(phase: OverlayPhase, target: Node): void {
    const open = this.pressOrderedEntries().map(entry => ({
      entry,
      inside: entryContains(entry, target),
    }));
    // Every press overwrites the flag, so a stale "inside" cannot leak into
    // the drag path. It reports whether the press landed on any open surface,
    // which is exactly what the old pressInPanel boolean answered.
    this.pressInside = open.some(item => item.inside);

    const state = { consumed: false };
    const press: OverlayPress = {
      phase,
      target,
      reason: "outside",
      consume: () => {
        state.consumed = true;
      },
      get consumed() {
        return state.consumed;
      },
    };

    for (const { entry, inside: isInside } of open) {
      if (!entry.isOpen()) continue;
      // Each dispatcher owns one phase: the mousedown-capture walk must not
      // close a surface that dismisses on the click bubble (and vice versa).
      if (entry.dismissOn !== phase) continue;
      if (phase === "mousedown") {
        // The capture phase decides outside dismissal only — an inside press
        // must keep its native behaviour (button activation, focus move).
        if (isInside) continue;
        press.reason = "outside";
        if (entry.dismissOnOutside && !entry.dismissOnOutside(press)) continue;
      } else {
        press.reason = isInside ? "inside" : "outside";
        const wantsDismiss = isInside
          ? (entry.dismissOnInside?.(press) ?? false)
          : (entry.dismissOnOutside?.(press) ?? true);
        if (!wantsDismiss) continue;
      }
      const element = elementOf(target);
      if (element && entry.consumePress?.(element, press)) {
        press.consume();
        return;
      }
      if (entry.close({ restoreFocus: false }) === false) continue;
      press.consume();
      return;
    }
  }

  private installEscapeListener(): void {
    if (this.escapeHandler) return;
    this.escapeHandler = (event: KeyboardEvent): void => {
      this.dispatchEscape(event);
    };
    document.addEventListener("keydown", this.escapeHandler, true);
  }

  private removeEscapeListener(): void {
    if (!this.escapeHandler) return;
    document.removeEventListener("keydown", this.escapeHandler, true);
    this.escapeHandler = undefined;
  }

  private dispatchEscape(event: KeyboardEvent): void {
    // An earlier deliberate handler already decided this key: leave it alone.
    if (event.key !== "Escape" || event.defaultPrevented) return;
    const target = nodeOf(event.target);
    /* v8 ignore start -- non-Node targets never reach a document listener */
    if (!target) {
      this.notifyEscape({
        handled: false,
        entryId: null,
        target: null,
        origin: "capture",
      });
      return;
    }
    /* v8 ignore stop */
    // Escape is a layer-stack key, not a target-owned key: close exactly the
    // highest-ranked open surface, even when focus sits in a lower panel. The
    // owner-by-target rule would close the style panel while its picker popup
    // is open (one Escape tearing down two layers); the ESC_PRIORITY table is
    // the one ordering contract, so use it here too.
    const top = this.topmost();
    if (!top) {
      this.notifyEscape({ handled: false, entryId: null, target, origin: "capture" });
      return;
    }
    if (top.escPassthroughOnEditable && isEditable(target)) {
      // The editor keeps Escape (commit/cancel) and the dispatch consumes
      // nothing; the row cursor still hears today's outcome — a handled close
      // for cursor purposes — exactly once.
      this.notifyEscape({
        handled: true,
        entryId: top.id,
        target,
        origin: "capture",
        ...(top.clearsCursorOnClose ? { clearsCursorOnClose: true } : {}),
      });
      return;
    }
    const closed = top.close({ restoreFocus: true }) !== false;
    if (closed) {
      event.preventDefault();
      event.stopPropagation();
    }
    this.notifyEscape({
      handled: closed,
      entryId: top.id,
      target,
      origin: "capture",
      ...(top.clearsCursorOnClose ? { clearsCursorOnClose: true } : {}),
    });
  }

  private notifyEscape(payload: EscapeHandled): void {
    for (const cb of [...this.subscribers]) {
      try {
        cb(payload);
      } catch (error) {
        log.error("escape handler threw", error);
      }
    }
  }
}

/** Per-map singleton: components share one dispatcher per map, so a second
 *  owner (Export) can register without re-installing listeners. */
const instances = new WeakMap<L.Map, OverlayRegistryImpl>();

const ensureOverlayRegistry = (map: L.Map): OverlayRegistry => {
  const existing = instances.get(map);
  if (existing && !existing.isDestroyed()) return existing;
  const registry = new OverlayRegistryImpl();
  instances.set(map, registry);
  map.on("unload", () => registry.destroy());
  return registry;
};

export { ESC_PRIORITY, OVERLAY_IDS, ensureOverlayRegistry, orderOf };
export type {
  EscapeHandled,
  OverlayEntry,
  OverlayPhase,
  OverlayPress,
  OverlayRegistry,
};
