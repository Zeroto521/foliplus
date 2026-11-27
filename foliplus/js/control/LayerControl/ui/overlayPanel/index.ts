// LayerControl UI — OverlayPanel subsystem: floating panels, menu, rename.
//
// Owns the state of every surface that floats over a layer row: the ⋮ menu,
// the attributes panel, the filter panel, the delegated style panel, and the
// inline rename input. There is exactly ONE stored answer to "what is open" —
// `surface` (see ./openSurface.ts). Everything else on this class is either a
// resource installed while a surface is open (subscription / registry detach /
// repositioner / controller / live element) or a derived getter that projects
// `surface` for readers.
//
// Mutual exclusion lives in the state machine, not here: `openSurface(ui, next)`
// closes the current surface before storing `next`. The OVERLAY_CLEAR bus still
// exists (teardown.ts publishes it for the focus spotlight and external
// observers) and now maps to a single `closeSurface(ui)` call in lifecycle.ts
// instead of one subscriber per surface.
import { closeAttrsPanel, openAttrsPanel } from "./attr.js";
import { type FilterPanelState, closeFilterPanel, openFilterPanel } from "./filter.js";
import {
  type PendingDelete,
  activateDeleteItem,
  closeMoreMenu,
  openMoreMenu,
} from "./menu.js";
import type { OpenSurface } from "./openSurface.js";
import { finishRename, renameLayer } from "./rename.js";
import type { PanelController } from "#core/leaflet/index.js";

type MenuSurface = Extract<OpenSurface, { kind: "menu" }>;
type AttrsSurface = Extract<OpenSurface, { kind: "attrs" }>;

/** Floating-surface state. `surface` is the single source for "which surface
 *  is open"; the `active*` / `stylePanelLayerId` getters below are read-only
 *  projections of it, and the resource fields are pipes installed by an open
 *  and released by its close. */
class OverlayPanel {
  /** THE open surface, or null. Written only by ./openSurface.ts helpers. */
  surface: OpenSurface | null = null;

  /** Currently visible overflow menu, or null. Projection of `surface`. */
  get activeMenu(): MenuSurface | null {
    const open = this.surface;
    return open?.kind === "menu" ? open : null;
  }

  /** Currently visible attributes panel, or null. Projection of `surface`. */
  get activeAttrsPanel(): AttrsSurface | null {
    const open = this.surface;
    return open?.kind === "attrs" ? open : null;
  }

  /** Currently visible filter panel, or null. Projection of `surface`. */
  get activeFilterPanel(): FilterPanelState | null {
    const open = this.surface;
    return open?.kind === "filter" ? open.state : null;
  }

  /** Layer id whose label is currently an inline rename input, or null. A
   *  folder rename has no layer id — the row below is the shared handle. */
  get activeRenameId(): string | null {
    const open = this.surface;
    return open?.kind === "rename" ? open.layerId : null;
  }

  /** The row whose label is currently an inline rename input, or null. Both
   *  rename kinds (layer and folder) set it, so one teardown serves both. */
  get activeRenameRow(): HTMLElement | null {
    const open = this.surface;
    return open?.kind === "rename" ? open.row : null;
  }

  /** Layer id whose label style panel is open, or null. Projection of
   *  `surface`; the live element and its controller are resources below. */
  get stylePanelLayerId(): string | null {
    const open = this.surface;
    return open?.kind === "style" ? open.layerId : null;
  }

  /** Unregister for the overflow menu's registry entry (installed while open). */
  menuOverlayUnregister: (() => void) | null = null;
  /** Release the menu's scroll/resize/row-count reposition pass (installed while open). */
  menuReposition: (() => void) | null = null;
  /** Anchor-teardown watch while the overflow menu is open: LAYER_REMOVED /
   *  LAYER_DELETED for the anchored layer close the menu. Installed by
   *  openMoreMenu, released by closeMoreMenu. */
  menuRemovedUnsub: (() => void) | null = null;
  /** The overflow-menu entry currently in its confirm (second-click) state,
   *  or null. Per-UI on purpose: each control confirms and cancels only its own
   *  entry, so a second map's menu cannot cancel a pending delete here. */
  pendingDelete: PendingDelete | null = null;
  /** Unregister for the attrs panel's registry entry (installed while open). */
  attrsOverlayUnregister: (() => void) | null = null;
  /** Unregister for the filter panel's registry entry (installed while open). */
  filterOverlayUnregister: (() => void) | null = null;
  /** Unsubscribe for LAYER_FILTER_CHANGE / row-identity signals while the
   *  filter panel is open (external model changes and same-id replacement). */
  filterUnsubscribe: (() => void) | null = null;
  /** Unregister for the style panel's registry entry (installed while open). */
  styleOverlayUnregister: (() => void) | null = null;
  /** The live style-drawer element while one is open, or null. Kept on the
   *  overlay panel (not captured by the registry entry) so a press predicate
   *  scopes to *this* control's drawer: a page with two maps has two drawers,
   *  and a document-wide query would scope the press to the first one in DOM
   *  order. A resource handle, not the open/closed state (`surface.kind`). */
  stylePanelEl: HTMLElement | null = null;
  /** Unsubscribe for LAYER_ITEM_COUNT_CHANGE while attrs panel is open. */
  attrsUnsubscribe: (() => void) | null = null;
  /** Unsubscribe for LAYER_REMOVED while attrs panel is open (external
   *  delete of the owned layer closes the panel). */
  attrsRemovedUnsub: (() => void) | null = null;
  /** Unsubscribe for LAYER_STYLE_CHANGE while a delegated style panel is
   *  open. */
  styleUnsubscribe: (() => void) | null = null;
  /** Unsubscribe for LAYER_REMOVED while the style panel is open (external
   *  delete of the owned layer closes the panel). */
  styleRemovedUnsub: (() => void) | null = null;
  /** Refresh function for the shared label controls (set by
   *  `renderDelegatedStylePanel`). */
  styleRefresh: (() => void) | null = null;
  /** Re-read the open style panel's Reset state. Zoom range is a
   *  map-membership dimension, so its commit deliberately does not broadcast
   *  LAYER_STYLE_CHANGE; it calls this hook instead so an open drawer still
   *  re-evaluates its Reset the moment the range is committed. */
  styleResetSync: (() => void) | null = null;
  /** Map zoomend handler for the open style panel's zoom-range row. */
  styleZoomEndHandler: (() => void) | null = null;
  /** Controller for the open style panel; an in-place refresh reuses it. */
  stylePanelController: PanelController | null = null;
  /** Unsubscribe for LAYER_REMOVED while a rename input is open (external
   *  delete cancels the in-flight rename without committing). */
  renameRemovedUnsub: (() => void) | null = null;
}

export { OverlayPanel };
export { closeAttrsPanel, openAttrsPanel };
export { closeFilterPanel, openFilterPanel };
export { activateDeleteItem, closeMoreMenu, openMoreMenu };
export { finishRename, renameLayer };
