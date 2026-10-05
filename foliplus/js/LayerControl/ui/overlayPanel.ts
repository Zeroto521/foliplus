// LayerControl UI — OverlayPanel subsystem: floating panels, menu, rename.
//
// Owns the state of every surface that floats over a layer row: the ⋮ menu,
// the attributes panel, the inline rename input, and the delegated style
// panel. Mutual exclusion between these surfaces is handled by the
// OVERLAY_CLEAR event bus (see teardown.ts); this subsystem just tracks
// which surface is currently open.
//
// Signature contract: modules that exclusively touch overlay state (attr.ts,
// menu.ts, rename.ts, teardown.ts, and every file under style/) receive an
// OverlayPanel. Cross-subsystem code takes LayerUI and reaches into
// `ui.overlayPanel.*`.
/** Floating-surface state. Each `active*` field tracks the currently open
 *  panel of that kind, and each `*Unsubscribe` field is the bus
 *  subscription installed while that panel is open (so unbinding clears
 *  them in lockstep). */
class OverlayPanel {
  /** Layer id whose label is currently an inline rename input, or null. */
  activeRenameId: string | null = null;
  /** Currently visible overflow menu, or null. */
  activeMenu: {
    item: HTMLElement;
    menu: HTMLElement;
    layerId: string;
  } | null = null;
  /** Currently visible attributes panel, or null. */
  activeAttrsPanel: {
    item: HTMLElement;
    panel: HTMLElement;
    layerId: string;
  } | null = null;
  /** Document capture-phase mousedown used to dismiss the attrs panel.
   *  Capture is required because the layer control's
   *  `disableClickPropagation` stops bubble-phase events from ever reaching
   *  document. */
  attrsOutsideHandler: ((event: MouseEvent) => void) | null = null;
  /** Same capture-phase dismiss, for the style panel. */
  styleOutsideHandler: ((event: MouseEvent) => void) | null = null;
  /** Unsubscribe for LAYER_ITEM_COUNT_CHANGE while attrs panel is open. */
  attrsUnsubscribe: (() => void) | null = null;
  /** Unsubscribe for LAYER_STYLE_CHANGE while a delegated style panel is
   *  open. */
  styleUnsubscribe: (() => void) | null = null;
  /** Refresh function for the shared label controls (set by
   *  `renderDelegatedStylePanel`). */
  styleRefresh: (() => void) | null = null;
  /** Map zoomend handler for the open style panel's zoom-range row. */
  styleZoomEndHandler: (() => void) | null = null;
  /** Layer id whose annotation style panel is open, or null. */
  stylePanelLayerId: string | null = null;

  constructor() {}
}

export { OverlayPanel };
