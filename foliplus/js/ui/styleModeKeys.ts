// ui/styleModeKeys — single source of the style-mode locale keys.
//
// Panels that express a coloring source must reference the key constants here;
// no inline strings. The zh/en text lives only in foliplus/locale/<component>/<lang>.json.
// Guard tests assert: (1) styleModeKeys is ASCII-only (the user-visible key
// strings must never carry CJK — the zh/en text lives in the locale JSON),
// (2) every referenced t()/ui.T() locale key exists in both zh and en,
// (3) STYLE_MODE keys are defined and non-empty in both zh and en.
//
// Pure string constants, no foliplus runtime import (same tier as sliderKeys).

const STYLE_MODE = {
  ORIGINAL: "style_mode_original",
  SINGLE: "style_mode_single",
  BY_VALUE: "style_mode_by_value",
} as const;

// The mode values a style panel may carry (border/fill row values).
const STYLE_MODES = ["original", "single", "by_value"] as const;

export { STYLE_MODE, STYLE_MODES };
