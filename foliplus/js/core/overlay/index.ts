// core/overlay/index — the overlay + Escape/press-ownership barrel.
//
// Three modules: pressInside (the pure "is this point inside an open surface"
// test), overlayRegistry (the ranked open-surface table and its Escape/press
// queries), and hint (the map hint chip). Consumers may import
// #core/overlay/index.js for the whole surface or a deep module path; the
// individual files stay the source of truth and this barrel adds no names.
export { isInsideOverlay } from "./pressInside.js";
export {
  ESC_PRIORITY,
  OVERLAY_ESCAPE_EXEMPTIONS,
  OVERLAY_IDS,
  ensureOverlayRegistry,
  orderOf,
} from "./overlayRegistry.js";
export type {
  EscapeHandled,
  OverlayEntry,
  OverlayPhase,
  OverlayPress,
  OverlayRegistry,
} from "./overlayRegistry.js";
export { ensureHint, HINT_DURATION, HintManager, registerHintIcon } from "./hint.js";
