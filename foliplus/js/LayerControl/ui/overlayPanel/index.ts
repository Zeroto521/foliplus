// LayerControl UI — OverlayPanel subsystem: floating panels, menu, rename.
//
// Owns the state of every surface that floats over a layer row: the ⋮ menu,
// the attributes panel, the inline rename input, and the delegated style
// panel. Mutual exclusion between these surfaces is handled by the
// OVERLAY_CLEAR event bus (see teardown.ts); this subsystem just tracks
// which surface is currently open.
//
// Callers all take LayerUI and reach into `ui.overlayPanel.*` directly; no
// module receives a bare OverlayPanel.
import { closeAttrsPanel, openAttrsPanel } from "./attr.js";
import { type FilterPanelState, closeFilterPanel, openFilterPanel } from "./filter.js";
import { activateDeleteItem, closeMoreMenu, openMoreMenu } from "./menu.js";
import { finishRename, renameLayer } from "./rename.js";

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
  /** Currently visible filter panel, or null. */
  activeFilterPanel: FilterPanelState | null = null;
  /** Document capture-phase mousedown used to dismiss the attrs panel.
   *  Capture is required because the layer control's
   *  `disableClickPropagation` stops bubble-phase events from ever reaching
   *  document. */
  attrsOutsideHandler: ((event: MouseEvent) => void) | null = null;
  /** Same capture-phase dismiss, for the filter panel. */
  filterOutsideHandler: ((event: MouseEvent) => void) | null = null;
  /** Unsubscribe for LAYER_FILTER_CHANGE / row-identity signals while the
   *  filter panel is open (external model changes and same-id replacement). */
  filterUnsubscribe: (() => void) | null = null;
  /** Same capture-phase dismiss, for the style panel. */
  styleOutsideHandler: ((event: MouseEvent) => void) | null = null;
  /** The live style-drawer element while one is open, or null. Kept on the
   *  overlay panel (not captured by each outside handler) so the dismiss
   *  predicate scopes to *this* control's drawer: a page with two maps has two
   *  drawers, and a document-wide query would scope the press to the first one
   *  in DOM order. */
  stylePanelEl: HTMLElement | null = null;
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
}

export { OverlayPanel };
export { closeAttrsPanel, openAttrsPanel };
export { closeFilterPanel, openFilterPanel };
export { activateDeleteItem, closeMoreMenu, openMoreMenu };
export { finishRename, renameLayer };
