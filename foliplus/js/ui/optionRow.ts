// ui/optionRow — the ARIA contract shared by every option row.
//
// The listbox engine (buildRow) and SearchControl's result rows each paint
// their own option semantics, and each generated a row id from its own
// counter. That split is the drift this module removes: one helper sets the
// contract (role/tabindex/aria-selected), one id source feeds every
// aria-activedescendant reference.
//
// Contract: this helper ONLY sets ARIA. It never builds DOM, never assigns
// classes, never reads state — the caller owns those. It also never
// generates an id; the caller passes one when the surface needs a stable
// target for aria-activedescendant (a listbox-picker trigger or a
// SearchControl input).

type OptionRowA11y = {
  /** The row element to annotate. */
  el: HTMLElement;
  /** Whether this row is the selected one (aria-selected true/false). */
  selected: boolean;
  /** ARIA role. Default "option". */
  role?: string;
  /** Stable id for aria-activedescendant references. Omit when the surface
   *  does not track the focused row by id (a plain dropdown). */
  id?: string;
};

/** Paint the option contract: role, tabindex=-1, aria-selected. */
const applyOptionRowA11y = (opts: OptionRowA11y): void => {
  opts.el.setAttribute("role", opts.role ?? "option");
  opts.el.setAttribute("tabindex", "-1");
  opts.el.setAttribute("aria-selected", opts.selected ? "true" : "false");
  if (opts.id !== undefined) opts.el.setAttribute("id", opts.id);
};

/** The single id source for option rows that need an aria-activedescendant
 *  target. Prefix distinguishes surfaces (listbox picker rows vs
 *  SearchControl result rows) so ids stay unique per surface while flowing
 *  from one generator.
 *
 *  The counter is module-level and intentionally NEVER reset: ids must stay
 *  unique across every surface for the lifetime of the page, because
 *  aria-activedescendant points at a row by id and a recycled id could point
 *  at a stale row. Do not "fix" this into a per-surface counter - that would
 *  reintroduce the two-source id drift this module exists to remove. */
const nextOptionId = (prefix: string): string =>
  `foliplus-${prefix}-${String(++optionIdCounter)}`;

let optionIdCounter = 0;

export { applyOptionRowA11y, nextOptionId };
