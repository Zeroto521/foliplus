// ui/buttonClassName — single source for the shared button-look dot tokens.
//
// The dot look (`.foliplus-dot` / `-hollow` / `-solid`) lives in
// css/common/button.css and is shared by the measure nodes and the export
// crop-box anchors. Each token is declared once here; consumers join them
// with their local positioning hook at the call site, so the class-owner
// guard sees every token with exactly one owner.
//
// This module is pure data — no runtime import, no map, no DOM — so any
// layer may import it.
const BUTTON_CLASS = {
  DOT: "foliplus-dot",
  DOT_HOLLOW: "foliplus-dot-hollow",
  DOT_SOLID: "foliplus-dot-solid",
} as const;

export { BUTTON_CLASS };
