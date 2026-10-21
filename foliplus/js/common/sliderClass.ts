// common/sliderClass — the class names the slider primitive owns.
//
// Kept free of any foliplus runtime import: the primitive is usable without a
// map, so its vocabulary cannot live in LayerControl/const.ts (that module
// reads the map's container at import time). The primitive and its tests
// import this module directly.

const SLIDER = {
  ROOT: "foliplus-slider",
  TRACK: "foliplus-slider-track",
  RAIL: "foliplus-slider-rail",
  FILL: "foliplus-slider-fill",
  MARKS: "foliplus-slider-marks",
  DOT: "foliplus-slider-dot",
  DOT_CURRENT: "foliplus-slider-dot-current",
  DOT_COVERED: "foliplus-slider-dot-covered",
  THUMB: "foliplus-slider-thumb",
  VALUES: "foliplus-slider-values",
  VALUE_MIN: "foliplus-slider-value-min",
  VALUE_MAX: "foliplus-slider-value-max",
  VALUE_CURRENT: "foliplus-slider-value-current",
  BUBBLE: "foliplus-slider-bubble",
  LABEL_HIDDEN: "foliplus-slider-label-hidden",
  DRAGGING: "is-dragging",
  DISABLED: "is-disabled",
} as const;

export { SLIDER };
