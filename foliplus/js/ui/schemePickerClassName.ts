// ui/schemePickerClassName — the scheme-picker vocabulary: one owner for
// every class name the shared picker and the shared row builder spell.
//
// The picker has two shapes in the product: the full dropdown/inline picker
// (ui/schemePicker.ts) and the compact hidden select baked into the Field/
// Classes row (core/value/rampForm.ts). Both render the same CSS contract
// (common/scheme-picker.css), so the names belong to one list rather than
// one const in each caller — two spellings drift independently and the
// stylesheet only ever sees one of them. core cannot import a component
// const, so the list lives here (ui/), and both callers read it.
//
// Guard: script/check/core-class-literal.mjs fails when a
// `foliplus-scheme-picker-*` literal reappears in core production code.

/** The compact class-count select trigger hook: a thin class on top of the
 *  consumer's own trigger class so the shared CSS can find it. */
const SCHEME_PICKER_TRIGGER = "foliplus-scheme-picker-trigger";

/** The colour bar drawn inside the trigger (and inside each dropdown row).
 *  One recipe in common/scheme-picker.css. */
const SCHEME_PICKER_BAR = "foliplus-scheme-picker-bar";

/** The hidden `<select>` the row builder renders for form submission and
 *  aria wiring — visually gone, structurally present. */
const SCHEME_PICKER_HIDDEN = "foliplus-scheme-picker-hidden";

/** The dropdown surface when it is open. The engine toggles it. */
const SCHEME_PICKER_OPEN = "foliplus-scheme-picker-open";

/** The dropdown surface element itself (the listbox popup). */
const SCHEME_PICKER_DROPDOWN = "foliplus-scheme-picker-dropdown";

/** One selectable scheme row inside the dropdown. */
const SCHEME_PICKER_ITEM = "foliplus-scheme-picker-item";

/** The scheme-name block inside a row — swatch plus label. */
const SCHEME_PICKER_BLOCK = "foliplus-scheme-picker-block";

/** Extra class on a portaled dropdown only. A portaled dropdown lives outside
 *  the panel that opened it, so it has to paint above that panel — while an
 *  inline dropdown stays inside the trigger's own stacking context and needs no
 *  lift. The class is what the stylesheet keys the z band off, so the JS keeps
 *  its distance from z numbers. The engine's `classes.portal` slot carries it. */
const SCHEME_PICKER_PORTAL = "foliplus-scheme-picker-portal";

export {
  SCHEME_PICKER_TRIGGER,
  SCHEME_PICKER_BAR,
  SCHEME_PICKER_HIDDEN,
  SCHEME_PICKER_OPEN,
  SCHEME_PICKER_DROPDOWN,
  SCHEME_PICKER_ITEM,
  SCHEME_PICKER_BLOCK,
  SCHEME_PICKER_PORTAL,
};
