// common/rowA11y — the ARIA contract shared by every listbox/menu row.
//
// The dropdown (common/dropdown) and the scheme picker (common/schemePicker)
// historically painted almost the same trio (role/tabindex/aria-selected) on
// their option rows, and each hand-rolled it. This helper is the ONE place the
// option-row ARIA contract lives (the listbox engine calls it). The menu's
// row contract (role=menuitem) is added by S-D, which is why the general
// applyRowA11y form is not here yet.
//
// `applyOptionA11y` keeps the exact option-row trio the dropdown and picker
// painted for years (role=option, tabindex=-1, aria-selected), so existing
// call sites and tests are untouched.
const applyOptionA11y = (el: HTMLElement, opts: { selected: boolean }): void => {
  el.setAttribute("role", "option");
  el.setAttribute("tabindex", "-1");
  el.setAttribute("aria-selected", opts.selected ? "true" : "false");
};

export { applyOptionA11y };
