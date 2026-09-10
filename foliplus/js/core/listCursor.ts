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
  onMove?: (index: number, el: HTMLElement | null) => void;
  onActivate?: (index: number, el: HTMLElement) => void;
};

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
  private onMove: ListCursorOptions["onMove"];
  private onActivate: ListCursorOptions["onActivate"];
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
    this.onMove = opts.onMove;
    this.onActivate = opts.onActivate;

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

  /**
   * Re-home the index from a pointer click without painting the active
   * visual (class / aria-selected). Still applies roving tabindex so the
   * tab stop follows the keyboard target. Used by LayerControl: a click
   * must target Space/Enter but must not look like a focus arrival.
   */
  adopt(index: number): void {
    const n = this.items().length;
    this._index = n === 0 ? -1 : Math.max(-1, Math.min(index, n - 1));
    this.applyRovingTabindex();
    // Clear any stale active visual without painting a new one.
    for (const el of this.items()) {
      el.classList.remove(this.activeClass);
      if (this.itemRole === "option") el.setAttribute("aria-selected", "false");
    }
    if (this.input) this.input.removeAttribute("aria-activedescendant");
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
      if (!el.id) el.id = nextId("foliplus-opt");
      el.setAttribute("role", this.itemRole);
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
      if (this.itemRole === "option") {
        el.setAttribute("aria-selected", on ? "true" : "false");
      }
    });
    const active = this.current;
    if (this.input) {
      if (active) this.input.setAttribute("aria-activedescendant", active.id);
      else this.input.removeAttribute("aria-activedescendant");
    }
  }
}

export { ListCursor };
export type { ListCursorMode, ListCursorOptions, ListCursorRoles };
