// ui/schemePickerClassName — the scheme-picker vocabulary: one owner for
// every class name the shared picker and the shared row builder spell.
//
// The picker has two shapes in the product: the full dropdown/inline picker
// (ui/schemePicker.ts) and the compact hidden select baked into the Field/
// Classes row (core/value/rampForm.ts). Both render the same CSS contract
// (common/scheme-picker.css), so the names belong to one list rather than
// one const in each caller — two spellings drift independently and the
// stylesheet only ever sees one of them. core cannot import a component
// const, so the list lives here (ui/), and both callers read it through
// the ui barrel (#ui/index.js) or the local module, depending on tier.
//
// Same shape as FORM_CLASS / LABEL_CLASS / PANEL_CLASS / SLIDER_CLASS: an
// `as const` object, one key per token, so `git grep SCHEME_PICKER_CLASS\.`
// shows the full consumer surface, and `Object.values(SCHEME_PICKER_CLASS)`
// is the token inventory for a future "every token is in the CSS and has
// exactly one owner" guard.
//
// Guard: script/check/core-class-literal.mjs fails when a
// `foliplus-scheme-picker-*` literal reappears in core production code.

/** The scheme-picker class vocabulary. See the file header for why these
 *  live together rather than per-caller. */
const SCHEME_PICKER_CLASS = {
  TRIGGER: "foliplus-scheme-picker-trigger",
  BAR: "foliplus-scheme-picker-bar",
  HIDDEN: "foliplus-scheme-picker-hidden",
  OPEN: "foliplus-scheme-picker-open",
  DROPDOWN: "foliplus-scheme-picker-dropdown",
  ITEM: "foliplus-scheme-picker-item",
  BLOCK: "foliplus-scheme-picker-block",
  PORTAL: "foliplus-scheme-picker-portal",
} as const;

export { SCHEME_PICKER_CLASS };
