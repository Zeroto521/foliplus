// ui/checkboxClassName — single source for the tri-state checkbox class names.
//
// Kept free of any foliplus runtime import: the primitive is usable without a
// map, so its vocabulary cannot live in LayerControl/const.ts (that module
// reads the map's container at import time). The wrapper class matches the
// historical `foliplus-checkbox` the LayerControl rows/headers already carry
// (control.css / row.css style the wrapper for grid placement and center the
// native input inside it); the input class is new and marks the input the
// primitive owns so a consumer can target it without reaching into the wrapper.

const CHECKBOX_CLASS = {
  /** The layout wrapper: grid-area: check in a row, flex-centered in a header. */
  WRAPPER: "foliplus-checkbox",
  /** The native input the primitive owns (marks it as the primitive's, so a
   *  consumer can target the input without reaching into the wrapper). */
  INPUT: "foliplus-checkbox-input",
} as const;

export { CHECKBOX_CLASS };
