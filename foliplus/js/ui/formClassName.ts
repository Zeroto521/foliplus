// ui/formClassName — single source for the shared form-input class names.
//
// These names are the skin/select chrome shared by every control panel row
// (HeatmapControl template, LayerControl style rows, core/label, and the ui
// primitives themselves). A class name is a contract, and two copies have
// already drifted once (SearchControl's close button); one spelling here,
// every consumer reads through it. The keys mirror the DOM vocabulary:
// input-skin (the shared input chrome) and form-select (the select chrome).
//
// This module is pure data — no runtime import, no map, no DOM — so any
// layer may import it.
const FORM_CLASS = {
  INPUT_SKIN: "foliplus-input-skin",
  INPUT: "foliplus-input",
  FORM_SELECT: "foliplus-form-select",
} as const;

export { FORM_CLASS };
