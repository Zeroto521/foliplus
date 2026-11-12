// ui/panelClassName — single source for panel class names.
//
// These names are shared across the platform/ui/core layers (form rows are used
// by core/rampForm and core/label, affordances by the layer control panels and
// the heatmap panel template), so they live here in ui/ — a class name is a
// contract, and two copies have already drifted once (SearchControl's close
// button). One spelling here; every consumer reads through it.
//
// The keys mirror the DOM vocabulary: form-row/label/control/inline,
// toggle switch/slider, section divider, button row, panel button, read-only,
// hidden, and the panel header/close/title/icon chrome.
const PANEL_CLASS = {
  FORM_ROW: "foliplus-form-row",
  FORM_LABEL: "foliplus-form-label",
  FORM_CONTROL: "foliplus-form-control",
  FORM_INLINE: "foliplus-form-inline",
  TOGGLE_SWITCH: "foliplus-toggle-switch",
  TOGGLE_SLIDER: "foliplus-toggle-slider",
  SECTION_DIVIDER: "foliplus-section-divider",
  BTN_ROW: "foliplus-btn-row",
  PANEL_BTN: "foliplus-panel-btn",
  READONLY: "foliplus-readonly",
  HIDDEN: "foliplus-hidden",
  HEADER: "foliplus-panel-header",
  CLOSE_BTN: "foliplus-close-btn",
  TITLE: "foliplus-header-title",
  ICON: "foliplus-header-icon",
} as const;

export { PANEL_CLASS };
