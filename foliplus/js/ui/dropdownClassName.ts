// ui/dropdownClassName — single source for the shared dropdown class names.
//
// The dropdown primitive's vocabulary was an inline object in dropdown.ts; the
// class-owner guard could not see it (dropdown.ts is not a *ClassName.ts owner
// file), so every token sat in the baseline as scanner-blind. Moving it here
// gives each token a declared owner the guard scans, and every consumer reads
// the one spelling.
//
// Pure data — no runtime import, no map, no DOM — so any layer may import it.
const DROPDOWN_CLASS = {
  WRAPPER: "foliplus-dropdown",
  TRIGGER: "foliplus-dropdown-trigger",
  LABEL: "foliplus-dropdown-label",
  PLACEHOLDER: "foliplus-dropdown-placeholder",
  LIST: "foliplus-dropdown-list",
  OPTION: "foliplus-dropdown-option",
  OPTION_LABEL: "foliplus-dropdown-option-label",
  /** The leading ✓ a single-mode dropdown paints on its selected row. The
   *  multiple-mode rows use the shared check slot (ui/checkSlot) instead. */
  LEAD: "foliplus-dropdown-lead",
  /** The in-row content wrapper: the flex child that lays the leading slot
   *  and the label out on one line. The row is a <button>, so the wrapper
   *  is itself an inline element by default; making it a flex container is
   *  what puts the slot and the label on one line (the #1224 layout bug:
   *  the row returned a bare inline span and the label wrapped under the
   *  leading slot, doubling the row height). The row only paints the
   *  selection bar. */
  ROW_CONTENT: "foliplus-dropdown-row-content",
  /** The per-row checkbox a multiple-mode dropdown paints on every option.
   *  It reuses the shared check-slot box skin (css/common/check-slot.css). */
  ROW_CHECKBOX: "foliplus-dropdown-checkbox",
  /** The built-in select-all row a multiple-mode dropdown paints above its
   *  options. Not an option: it acts on every item, so it sits in the listbox
   *  `head` slot and stays out of the keyboard walk. */
  SELECT_ALL_ROW: "foliplus-dropdown-select-all",
  /** Its label span, so the row can shrink like an option label. */
  SELECT_ALL_LABEL: "foliplus-dropdown-select-all-label",
  OPEN: "foliplus-dropdown-open",
  UP: "foliplus-dropdown-up",
  PORTAL: "foliplus-dropdown-portal",
  SELECTED: "foliplus-is-selected",
  NATIVE_HOST: "foliplus-dropdown-native-host",
} as const;

export { DROPDOWN_CLASS };
