// LayerControl UI — FocusController subsystem: focus spotlight + inverse mask.
//
// Owns the transient map-level overlay state that "focus a layer" produces:
// the inverse-mask polygon that dims everything outside the focused bounds,
// the temporary rectangle drawn while a focus is in flight, the SVG renderer
// that hosts both, and the pane z-index restores collected while lifting the
// focused layer to the front.
//
// Signature contract: modules that exclusively touch focus state (focus.ts,
// focusMarquee.ts) receive a FocusController. Cross-subsystem code takes
// LayerUI and reaches into `ui.focusController.*`.
class FocusController {
  /** Temporary rectangle overlay drawn while a focus is in progress. */
  focusRect: L.Layer | null = null;
  /** Layer id currently being focused, or null. */
  focusingLayerId: string | null = null;
  /** One-shot map move/zoom handler that auto-cancels focus when the user
   *  navigates. Installed on focus start; uninstalled on cancel. */
  onFocusMapMove: (() => void) | null = null;
  /** Inverse-mask polygon that dims everything outside the focused bounds.
   *  The polygon is a world envelope minus the focus bounds, so panning
   *  off-screen does not leave a stale ring (see #605). */
  focusMask: L.Polygon | null = null;
  /** SVG renderer hosting the focus overlay (mask + rectangle). */
  focusRenderer: L.SVG | null = null;
  /** Restore callbacks for pane z-indexes lifted to bring the focused layer
   *  to the front (cleared on cancel). */
  focusedPaneRestores: Array<() => void> = [];

  constructor() {}
}

export { FocusController };
