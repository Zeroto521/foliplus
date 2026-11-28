// control/LayerControl/declared/declared-key — the declared-key vocabulary, JS side.
//
// The per-layer `foliplus={...}` namespace keys an author may declare are a
// CROSS-STACK vocabulary: the Python declaration side reads them off
// layer.options.foliplus (foliplus/_declaration/key.py), and the JS panel
// readers consume the same names. This module is the JS single source, so a
// reader never hand-writes a declaration key and the two stacks cannot drift.
//
// The values are snake_case, the spelling the Python declaration side declares
// under. The JS readers pass them to the shared readDeclaredKey skeleton, which
// translates the snake_case spelling to camelCase for a rendered map (see
// declared/key.ts). Every member mirrors one *_KEY constant in
// foliplus/_declaration/key.py — the cross-stack guard
// (test/js/guard/declared-key-sync.test.ts) asserts the two sets are equal, so
// adding a key on one side without the other fails loudly.
const DECLARED_KEY = {
  FILL: "fill",
  BORDER: "border",
  OPACITY: "opacity",
  LABEL: "label",
  FILTER: "filter",
  ICON: "icon",
  MARKER: "marker",
  ICON_SIZE: "icon_size",
  MARKER_COLOR: "marker_color",
  ZOOM_RANGE: "zoom_range",
  FOLDER: "folder",
} as const;

export { DECLARED_KEY };
