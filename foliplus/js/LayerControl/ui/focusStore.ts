// LayerControl UI — FocusStore: cross-layer focus transient state.
//
// The fs face of the phase-2 injection split (T270). Owns the focus overlay
// fields (mask/rect/renderer/restores) that used to ride LayerUI, so the
// focus module receives the store instead of reading naked instance fields.
class FocusStore {
  /** Temporary Rectangle overlay drawn while a focus is in progress. */
  focusRect: L.Layer | null = null;
  /** Layer id currently being focused, or null. */
  focusingLayerId: string | null = null;
  /** One-shot map move/zoom handler that auto-cancels focus when the user navigates. */
  onFocusMapMove: (() => void) | null = null;
  /** Inverse-mask polygon that dims everything outside the focused bounds. */
  focusMask: L.Polygon | null = null;
  /** SVG renderer hosting the focus overlay (mask + rectangle). */
  focusRenderer: L.SVG | null = null;
  /** Restore callbacks for pane z-indexes lifted to bring the focused layer
   *  to the front (cleared on cancel). */
  focusedPaneRestores: Array<() => void> = [];
}

export { FocusStore };
