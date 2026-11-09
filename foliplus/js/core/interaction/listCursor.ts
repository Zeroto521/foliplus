/** ListCursor — shared keyboard cursor for foliplus lists.
 *
 * Two focus models, one index:
 *
 * - `roving` (LayerControl): exactly one option is `tabindex=0` and holds
 *   DOM focus. Arrow keys move focus + tabindex. In-row controls must be
 *   `tabindex=-1` so Tab enters/exits the list in one step.
 * - `active-descendant` (SearchControl): DOM focus stays on the combobox
 *   input. The cursor only paints `activeClass` and `aria-activedescendant`
 *   on that element — the classic combobox pattern.
 *
 * ARIA: the root gets `role=listbox` (override via `roles.list`) and each
 * option `role=option` (override via `roles.item`). Option ids are
 * generated for `aria-activedescendant`.
 */
import { keyOwner, nativeConsumesKey } from "./inputOwnership.js";
import { ensureActiveVisible } from "#ui/index.js";

type ListCursorMode = "roving" | "active-descendant";
type ListCursorRoles = {
  /** Root role. Default `listbox`. */
  list?: string;
  /** Option role. Default `option`. */
  item?: string;
};

type ListCursorOptions = {
  /** Element that owns the options. */
  root: HTMLElement;
  /** Selector matching option elements under `root`. */
  itemSelector: string;
  /** Class painted on the active option. */
  activeClass: string;
  /** Focus model. Default `roving`. */
  mode?: ListCursorMode;
  /**
   * Combobox input for `active-descendant` mode (and optional in `roving`
   * so the input can announce the active option while focus is on a row).
   */
  input?: HTMLElement;
  roles?: ListCursorRoles;
  /** Wrap at the ends. Default false. */
  loop?: boolean;
  /** Grid columns. When set (>1) the cursor walks a 2D grid: ArrowLeft/
   *  Right move one column, ArrowUp/Down one row, Home/End the first/last
   *  cell. Omit (or 1) for the linear 1D walk — existing callers unchanged. */
  cols?: number;
  onMove?: (index: number, el: HTMLElement | null) => void;
  onActivate?: (index: number, el: HTMLElement) => void;
  /** Paint the option contract (role/aria-selected/id/tabindex) on rows.
   *  True by default for the shared roving/listbox cursor. Set false when
   *  the rows already carry the contract from a shared builder (SearchControl
   *  uses ui/optionRow) — the cursor then only paints activeClass and
   *  aria-activedescendant, never re-writing the row's role or selection. */
  paintOptionContract?: boolean;
};

/** Keep the active option visible inside its scroll container.
 *
 * The scroll semantics are deliberately "nearest": the element scrolls only
 * as far as needed to bring the active row into view (no centering), so a
 * long list does not jump the viewport on every keypress. Both focus models
 * go through this one primitive — the roving listbox engine (ui/listbox.ts
 * focusOption) and the active-descendant cursor (ListCursor.paint) must never
 * diverge on "what keeps the active row visible".
 */
let listCursorSeq = 0;

const nextId = (prefix: string) => `${prefix}-${++listCursorSeq}`;

class ListCursor {
  private root: HTMLElement;
  private itemSelector: string;
  private activeClass: string;
  private mode: ListCursorMode;
  private input: HTMLElement | null;
  private listRole: string;
  private itemRole: string;
  private loop: boolean;
  private cols: number;
  private onMove: ListCursorOptions["onMove"];
  private onActivate: ListCursorOptions["onActivate"];
  private paintOptionContract: boolean;
  private _index = -1;
  private bound: { target: HTMLElement; type: string; fn: EventListener }[] = [];

  constructor(opts: ListCursorOptions) {
    this.root = opts.root;
    this.itemSelector = opts.itemSelector;
    this.activeClass = opts.activeClass;
    this.mode = opts.mode ?? "roving";
    this.input = opts.input ?? null;
    this.listRole = opts.roles?.list ?? "listbox";
    this.itemRole = opts.roles?.item ?? "option";
    this.loop = opts.loop ?? false;
    this.cols = opts.cols ?? 1;
    this.onMove = opts.onMove;
    this.onActivate = opts.onActivate;
    this.paintOptionContract = opts.paintOptionContract ?? true;

    this.root.setAttribute("role", this.listRole);
    this.applyRovingTabindex();
    this.paint();
  }

  get index(): number {
    return this._index;
  }

  get current(): HTMLElement | null {
    return this.items()[this._index] ?? null;
  }

  items(): HTMLElement[] {
    return Array.from(this.root.querySelectorAll<HTMLElement>(this.itemSelector));
  }

  /** Re-read items after a DOM rebuild; keeps the index if still valid. */
  refresh(): void {
    const n = this.items().length;
    if (this._index >= n) this._index = n - 1;
    this.applyRovingTabindex();
    this.paint();
  }

  set(index: number): void {
    const n = this.items().length;
    if (n === 0) {
      this._index = -1;
      this.paint();
      this.onMove?.(-1, null);
      return;
    }
    const i = Math.max(-1, Math.min(index, n - 1));
    this._index = i;
    this.applyRovingTabindex();
    this.paint();
    this.focusIfRoving();
    this.onMove?.(i, this.current);
  }

  /** Move by `delta` (typically ±1). Returns the new index. */
  move(delta: number): number {
    const n = this.items().length;
    if (n === 0) {
      this._index = -1;
      this.paint();
      return -1;
    }
    let next = this._index + delta;
    if (this.loop) next = ((next % n) + n) % n;
    else next = Math.max(0, Math.min(next, n - 1));
    // First move from "nothing" lands on the edge the arrow points to.
    if (this._index === -1 && !this.loop) next = delta >= 0 ? 0 : n - 1;
    this._index = next;
    this.applyRovingTabindex();
    this.paint();
    this.focusIfRoving();
    this.onMove?.(next, this.current);
    return next;
  }

  clear(): void {
    this._index = -1;
    this.paint();
    this.onMove?.(-1, null);
  }

  /** Set index + roving tabindex without touching the active class. */
  setIndex(index: number): void {
    const n = this.items().length;
    this._index = n === 0 ? -1 : Math.max(-1, Math.min(index, n - 1));
    this.applyRovingTabindex();
  }

  /** Activate the current option (Enter / Space). */
  activate(): boolean {
    const el = this.current;
    if (!el || this._index < 0) return false;
    this.onActivate?.(this._index, el);
    return true;
  }

  /** Arrow key handler for `keydown` on `target`. Returns true if handled. */
  handleKey(event: KeyboardEvent): boolean {
    // The one ownership rule: a control that natively consumes the key keeps
    // it. Shared with the central dispatcher, so a new native control bound
    // into this list is let through without a per-cursor copy.
    // Grid mode is fully self-contained: the cells are the interactive
    // surface and the cursor owns every arrow / Home / End / Enter / Space
    // press (a focused cell is a button, but its Enter/Space activation is
    // the cursor's, not the browser's — the grid may host an input that must
    // keep its native keys, checked inside handleGridKey).
    if (this.cols > 1) return this.handleGridKey(event);
    if (nativeConsumesKey(keyOwner(event), event.key)) return false;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      this.move(1);
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      this.move(-1);
      return true;
    }
    if (event.key === "Home") {
      event.preventDefault();
      this.set(0);
      return true;
    }
    if (event.key === "End") {
      event.preventDefault();
      this.set(this.items().length - 1);
      return true;
    }
    if (event.key === "Enter" || event.key === " ") {
      if (!this.current) return false;
      event.preventDefault();
      return this.activate();
    }
    return false;
  }

  /** 2D grid walk (cols > 1). ArrowLeft/Right one column (clamped per row),
   *  ArrowUp/Down one row (clamped), Home/End the first/last cell. */
  private handleGridKey(event: KeyboardEvent): boolean {
    const items = this.items();
    const n = items.length;
    if (n === 0) return false;
    // A native control inside the grid keeps its keys (an input, a slider).
    // A focused cell is a button and the cursor owns its activation.
    if (
      nativeConsumesKey(keyOwner(event), event.key) &&
      keyOwner(event) !== null &&
      !items.includes(keyOwner(event) as HTMLElement)
    ) {
      return false;
    }
    // Sync with DOM focus: the user may have Tab'd to a cell without the
    // cursor knowing. A focused cell wins; otherwise fall back to the cursor
    // index (or 0 for the first move).
    const focused = items.indexOf(document.activeElement as HTMLElement);
    const index = focused >= 0 ? focused : this._index < 0 ? 0 : this._index;
    const row = Math.floor(index / this.cols);
    if (event.key === "ArrowRight") {
      event.preventDefault();
      this.set(Math.min(n - 1, index + 1));
      return true;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      this.set(Math.max(0, index - 1));
      return true;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      this.set(Math.min(n - 1, index + this.cols));
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (row > 0) this.set(index - this.cols);
      return true;
    }
    if (event.key === "Home") {
      event.preventDefault();
      this.set(0);
      return true;
    }
    if (event.key === "End") {
      event.preventDefault();
      this.set(n - 1);
      return true;
    }
    if (event.key === "Enter" || event.key === " ") {
      if (!this.current) return false;
      event.preventDefault();
      return this.activate();
    }
    return false;
  }

  /** Bind arrow/activate keys on `target`. Returns an unbind function. */
  bindKeys(target: HTMLElement): () => void {
    const fn = (event: Event) => {
      this.handleKey(event as KeyboardEvent);
    };
    target.addEventListener("keydown", fn);
    this.bound.push({ target, type: "keydown", fn });
    return () => target.removeEventListener("keydown", fn);
  }

  destroy(): void {
    for (const { target, type, fn } of this.bound) target.removeEventListener(type, fn);
    this.bound = [];
    this.clear();
  }

  private focusIfRoving(): void {
    if (this.mode !== "roving") return;
    this.current?.focus();
  }

  private applyRovingTabindex(): void {
    const list = this.items();
    list.forEach((el, i) => {
      if (this.paintOptionContract) {
        if (!el.id) el.id = nextId("foliplus-opt");
        el.setAttribute("role", this.itemRole);
      }
      if (this.mode === "roving") {
        el.tabIndex =
          this._index === -1 ? (i === 0 ? 0 : -1) : i === this._index ? 0 : -1;
      } else {
        el.tabIndex = -1;
      }
    });
  }

  private paint(): void {
    const list = this.items();
    list.forEach((el, i) => {
      const on = i === this._index;
      el.classList.toggle(this.activeClass, on);
      // aria-selected is the cursor's to own: the option-row builder paints
      // the contract once at build (role/tabindex/aria-selected=false), but a
      // row must flip to "true" when the cursor lands on it even when
      // paintOptionContract is false (SearchControl builds rows with the
      // shared builder, then sets paintOptionContract:false — without this
      // flip aria-selected would stay dead at "false" while activeClass and
      // aria-activedescendant move, diverging from the shared listbox rows
      // which do flip it). Grid cells (itemRole="gridcell") are excluded:
      // they carry aria-current, not aria-selected.
      if (this.itemRole === "option") {
        el.setAttribute("aria-selected", on ? "true" : "false");
      }
    });
    const active = this.current;
    if (this.input) {
      if (active) this.input.setAttribute("aria-activedescendant", active.id);
      else this.input.removeAttribute("aria-activedescendant");
    }
    // Keep the active row visible. Both focus models share this contract via
    // ensureActiveVisible (the roving engine calls it from focusOption).
    ensureActiveVisible(active);
  }
}

export { ListCursor };
