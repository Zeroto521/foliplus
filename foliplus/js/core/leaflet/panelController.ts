// core/leaflet/panelController — the shared floating-panel controller.
//
// This module owns the behaviour/ownership contract of a floating surface:
// its open/closed state, the dismissal sources (Escape, outside press,
// internal close button), its registry identity and rank, and its teardown
// order. It deliberately knows nothing about CSS classes, layout, header
// visuals, icons or focus rings — that is the shared ui toolbox. The one
// cross-boundary contract is that a panel's root() exposes
// `[data-foliplus-panel-close]` (the close affordance wired to
// closeFromClick) and `role="dialog"`.
//
// The component builds a PanelSpec (what the surface is and how it shows
// itself), `createPanel` wraps it into a PanelController, and
// `attachPanel` registers the controller's entry on the per-map overlay
// registry. The registry keeps the dispatch work (outside presses, Escape,
// ranking); the controller decides whether a close is actually allowed and
// swallows the close-button press so it never reaches the map (the #816-class
// bug this constructively seals).
import { type OverlayEntry, ensureOverlayRegistry } from "#core/overlay/index.js";

/** What dismisses the surface, decided by the registry's dispatcher. */
type Dismiss = {
  /** Registry Escape dispatch closes it; default true. Fold panels start
   *  false (behaviourally equivalent until a later migration re-enables it). */
  escape: boolean;
  /** Outside press closes it: "mousedown" (row panels) | "click" (menu,
   *  picker, fold panels) | false (no outside dismissal). */
  outsidePress: "mousedown" | "click" | false;
  /** Whether the surface provides a close button (the single entry point for
   *  closeFromClick); default true. */
  internalCloseClick: boolean;
};

/** What a component tells the controller about the surface. */
interface PanelSpec {
  /** Registry namespace: "layer" | "heatmap" | "measure" | "search". */
  owner: string;
  /** Registry local id, namespaced under owner (e.g. "style",
   *  "style.picker.dropdown"). */
  localId: string;
  /** entry.rank — the ordering number; the ESC_PRIORITY table owns the order. */
  rank: number;
  /** Opening one entry closes the others in the group (top-layer exclusivity). */
  exclusiveGroup?: string;
  /** Explicit press order; defaults to rank when omitted (the controller keeps the
   *  current value, does not reconcile it). */
  pressPriority?: number;
  /** Row panels set it: closing also clears the row keyboard cursor. */
  clearsCursorOnClose?: boolean;
  /** Dismiss overrides; unset members take the defaults. */
  dismiss?: Partial<Dismiss>;
  /** Live DOM, recomputed on every call (a rebuilt panel invalidates the nodes
   *  a previous press captured). */
  root(): HTMLElement | null;
  /** Build the DOM + fill content + show. The open state is owned by the
   *  controller (the attach/detach pair): the spec reports the surface's
   *  display content, never the open/closed verdict. */
  open(): void;
  /** Tear down. Returning false = cannot close right now (a pending commit, a
   *  read-only notice); the controller stays open (rollback). */
  close(opts: { restoreFocus: boolean }): boolean;
  onOpen?(): void;
  onClose?(): void;
}

/** The controller a component drives. */
interface PanelController {
  readonly owner: string;
  readonly localId: string;
  readonly rank: number;
  readonly dismiss: Readonly<Dismiss>;
  isOpen(): boolean;
  root(): HTMLElement | null;
  /** Already open = no-op (idempotent). */
  open(): void;
  /** Already closed = false (no-op). Returning false means "cannot close right
   *  now" and the state rolls back to open (pending-commit semantics). */
  close(opts?: { restoreFocus?: boolean }): boolean;
  /** The single entry point for the close button: swallows the press, then
   *  closes with focus restore. */
  closeFromClick(e: MouseEvent): void;
  /** Swallow a press without closing (a Reset-style control whose own action
   *  runs afterwards). */
  swallowClick(e: MouseEvent): void;
  /** Swallow a mousedown press without closing and without changing state: a
   *  raw event-swallow primitive for the row-panel mousedown handlers that
   *  must not leak to the map. stopPropagation only — do NOT preventDefault:
   *  native controls inside the panel (a <select>, an input, a text region)
   *  must keep focus and text selection. */
  swallowPress(e: MouseEvent): void;
  /** Silent close (if open) + unregister. Idempotent. */
  destroy(): void;
}

const DEFAULT_DISMISS: Dismiss = {
  escape: true,
  outsidePress: "mousedown",
  internalCloseClick: true,
};

/** Internal wiring set by attachPanel: the registry entry and the hooks the
 *  controller needs to close the exclusive group before it opens and to
 *  unregister on destroy. Kept off the public interface (module-private). */
interface ControllerWire {
  entry: OverlayEntry;
  groupOpen: () => void;
  detach: () => void;
}

/** Module-private per-controller config: the entry fields the public API does
 *  not expose (exclusiveGroup, pressPriority, clearsCursorOnClose) and the
 *  attachPanel wiring. A WeakMap keeps the public PanelController interface
 *  free of internal members. */
const internals = new WeakMap<
  PanelControllerImpl,
  {
    exclusiveGroup?: string;
    pressPriority?: number;
    clearsCursorOnClose?: boolean;
  }
>();

const wires = new WeakMap<PanelController, ControllerWire>();

/** Controllers that have been destroyed (terminal): attachPanel must reject
 *  them instead of silently registering a dead entry. Module-private so the
 *  check reads the same terminal flag the impl uses. */
const destroyed = new WeakSet<PanelControllerImpl>();

class PanelControllerImpl implements PanelController {
  readonly owner: string;
  readonly localId: string;
  readonly rank: number;
  readonly dismiss: Readonly<Dismiss>;

  readonly #spec: PanelSpec;
  #open = false;
  #destroyed = false;

  constructor(spec: PanelSpec) {
    this.#spec = spec;
    this.owner = spec.owner;
    this.localId = spec.localId;
    this.rank = spec.rank;
    this.dismiss = {
      escape: spec.dismiss?.escape ?? DEFAULT_DISMISS.escape,
      outsidePress: spec.dismiss?.outsidePress ?? DEFAULT_DISMISS.outsidePress,
      internalCloseClick:
        spec.dismiss?.internalCloseClick ?? DEFAULT_DISMISS.internalCloseClick,
    };
    internals.set(this, {
      exclusiveGroup: spec.exclusiveGroup,
      pressPriority: spec.pressPriority,
      clearsCursorOnClose: spec.clearsCursorOnClose,
    });
  }

  isOpen(): boolean {
    return this.#open;
  }

  root(): HTMLElement | null {
    return this.#spec.root();
  }

  open(): void {
    if (this.#destroyed || this.#open) return;
    this.#open = true;
    try {
      // Opening one surface closes the open siblings of its exclusive group
      // (top-layer exclusivity). The hook is installed by attachPanel (which
      // owns the registry entry); before attach it is a no-op.
      wires.get(this)?.groupOpen();
      this.#spec.open();
    } catch (error) {
      // spec.open threw: roll back so the controller is not left "open but
      // with no DOM" (which would also make the idempotence guard swallow
      // every later open). Rethrow so the caller sees the failure.
      this.#open = false;
      throw error;
    }
    // onOpen is deliberately outside the try: a successful spec.open that
    // throws in onOpen must NOT roll the state back — the DOM is built and
    // visible, so the surface is genuinely open. The failure is the callback's
    // to handle (it already ran; the panel is on screen).
    this.#spec.onOpen?.();
  }

  close(opts?: { restoreFocus?: boolean }): boolean {
    if (!this.#open) return false;
    if (this.#spec.close({ restoreFocus: opts?.restoreFocus ?? false }) === false) {
      return false;
    }
    this.#open = false;
    this.#spec.onClose?.();
    return true;
  }

  closeFromClick(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    if (this.isOpen()) this.close({ restoreFocus: true });
  }

  swallowClick(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
  }

  swallowPress(e: MouseEvent): void {
    e.stopPropagation();
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    destroyed.add(this);
    if (this.#open) {
      // Best-effort teardown: destroy is terminal, so a "cannot close right
      // now" refusal is overridden (the surface is going away regardless).
      this.#spec.close({ restoreFocus: false });
      this.#open = false;
      this.#spec.onClose?.();
    }
    wires.get(this)?.detach();
    wires.delete(this);
    internals.delete(this);
  }
}

/** Per-map set of currently attached ids: the duplicate guard that the
 *  registry's warn-only register cannot provide (the contract wants a hard
 *  throw on a duplicate owner+localId). Cleaned by the detach (destroy) path,
 *  so removeControl + addControl on the same id does not throw. */
const attached = new WeakMap<L.Map, Set<string>>();

const createPanel = (spec: PanelSpec): PanelController => new PanelControllerImpl(spec);

/** Register the controller's surface on the map's overlay registry (once,
 *  persistent — registered even while closed; isOpen()=false just means it
 *  does not take part in dispatch). Returns the unregister; calling it twice
 *  is a no-op. A duplicate owner+localId (still attached) throws: the
 *  contract rejects duplicates instead of silently keeping the old entry. */
const attachPanel = (map: L.Map, controller: PanelController): (() => void) => {
  const impl = controller as PanelControllerImpl;
  if (destroyed.has(impl)) {
    throw new Error(
      `cannot attach a destroyed panel: ${controller.owner}.${controller.localId}`,
    );
  }
  const config = internals.get(impl);
  const id = `${controller.owner}.${controller.localId}`;
  const ids = attached.get(map) ?? new Set<string>();
  if (ids.has(id)) {
    throw new Error(`duplicate overlay: ${id}`);
  }

  const outsidePress = controller.dismiss.outsidePress;
  const dismissOn: "mousedown" | "click" =
    outsidePress === "click" ? "click" : "mousedown";

  const entry: OverlayEntry = {
    id,
    exclusiveGroup: config?.exclusiveGroup,
    isOpen: () => controller.isOpen(),
    close: opts => {
      // The registry's Escape dispatch and its press dispatch are the only two
      // callers of the entry close. Escape passes restoreFocus:true, press
      // restoreFocus:false. A fold panel with dismiss.escape=false must survive
      // a registry Escape, so refuse exactly that source here. closeFromClick
      // and destroy call controller.close directly and never reach this
      // wrapper, and group-open (registry.open) passes restoreFocus:false, so
      // those paths are not gated.
      if (controller.dismiss.escape === false && opts.restoreFocus === true) {
        return false;
      }
      return controller.close(opts);
    },
    panels: () => {
      const root = controller.root();
      return root ? [root] : [];
    },
    dismissOn,
    pressPriority: config?.pressPriority ?? controller.rank,
    clearsCursorOnClose: config?.clearsCursorOnClose,
    ...(outsidePress === false ? { dismissOnOutside: () => false } : {}),
  };

  const registry = ensureOverlayRegistry(map);
  const unregister = registry.register(entry);
  ids.add(id);
  attached.set(map, ids);

  let detached = false;
  const detach = (): void => {
    if (detached) return;
    detached = true;
    unregister();
    ids.delete(id);
  };

  wires.set(controller, {
    entry,
    groupOpen: () => registry.open(entry),
    detach,
  });
  return detach;
};

export { attachPanel, createPanel };
export type { Dismiss, PanelController, PanelSpec };
