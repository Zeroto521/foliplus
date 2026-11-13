// ui/labelClassName — single source for the label style class names.
//
// The shared label-style controls (core/label/labelControl) and LayerControl's
// style panel build the same DOM vocabulary: the section toggle, its body, the
// format row/select, the collide switch and the label color/size inputs. Two
// copies had already drifted once (the panel's change delegation keys on these
// names, the tests select by them, the CSS states them) — a class name is a
// contract. One spelling here; every consumer reads through it.
//
// Kept in ui/ (not a component const) because core/label/labelControl — the
// shared runtime renderer — may depend on ui but never on a component module,
// and LayerControl's panel imports the same names.
const LABEL_CLASS = {
  STYLE_TOGGLE_INPUT: "foliplus-style-toggle-input",
  STYLE_BODY: "foliplus-style-body",
  STYLE_FORMAT_ROW: "foliplus-style-format-row",
  STYLE_FORMAT_SELECT: "foliplus-style-format-select",
  STYLE_COLLIDE_INPUT: "foliplus-style-collide-input",
  STYLE_LABEL_COLOR_INPUT: "foliplus-style-label-color-input",
  STYLE_LABEL_SIZE_INPUT: "foliplus-style-label-size-input",
  CANVAS_LAYER: "foliplus-canvas-layer",
  CANVAS: "foliplus-label-canvas",
  PANE: "foliplus-label-pane",
} as const;

export { LABEL_CLASS };
