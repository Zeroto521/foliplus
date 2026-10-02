// LayerControl UI — PanelStore: control-side UI transient state.
//
// The ps face of the phase-2 injection split (T270). Owns the fold/drag/
// keyboard/menu/panel fields that used to ride LayerUI as naked instance
// fields, so the coordinator keeps only the composition root. Handler slots
// (DOM/map event closures) live here as a transition — phase 3 retires them
// into per-module dispose handles.
//
// The translators live here too, exposed as `ps.T` / `ps._` for the ui/*
// modules that render text (attr / style rows) — the same seam the old
// `ui.T` / `ui._` instance fields provided. The coordinator forwards its own
// translators through accessor properties, so a test injection into
// `ui.T` / `ui._` is visible to every module immediately.
import type { CreateColorAPI } from "#core/layer/index.js";
import type { ListCursor } from "#core/listCursor.js";
import { createScopedTranslator, createTranslator } from "#common/locale.js";

interface OpenMenu {
  item: HTMLElement;
  menu: HTMLElement;
  layerId: string;
}

interface OpenAttrsPanel {
  item: HTMLElement;
  panel: HTMLElement;
  layerId: string;
}

/** Per-group tri-state counts (see the LayerUI field comment — now store-owned). */
type GroupCount = { total: number; on: number };

class PanelStore {
  /** Folded group ids. */
  foldedGroups = new Set<string>();
  /** Per-group tri-state counts maintained incrementally. */
  checkedCount: Record<string, GroupCount> = {};
  /** Currently visible overflow menu (or null). */
  activeMenu: OpenMenu | null = null;
  /** Currently visible attributes panel (or null). */
  activeAttrsPanel: OpenAttrsPanel | null = null;
  /** Layer id whose annotation style panel is open, or null. */
  stylePanelLayerId: string | null = null;
  /** Layer id whose label is currently an inline rename input, or null. */
  activeRenameId: string | null = null;
  /** Drag-transient fields (dragIdx / hint / hover target / panel-press flag). */
  dragIdx: number | null = null;
  lastDragHintAt = 0;
  lastDragOverItem: HTMLElement | null = null;
  pressInPanel = false;
  /** Keyboard cursor fields. */
  activeIdx: number | null = null;
  listCursor: ListCursor | null = null;
  interactionCleanup: (() => void) | undefined = undefined;
  /** Current color-basemap colour (the control's declared default). */
  currentColor = "#cccccc";
  /** The attached panel container (set by the coordinator's attachUI). */
  uiContainer: HTMLElement | null = null;
  /** Lazy-created color basemap surface (see the LayerUI field comment —
   *  now store-owned). */
  colorSurface: CreateColorAPI | null = null;
  // ── handler slots (retired in phase 3 → dispose handles) ───────────
  onChange: ((event: Event) => void) | null = null;
  onInput: ((event: Event) => void) | null = null;
  onClick: ((event: Event) => void) | null = null;
  onFocusIn: ((event: FocusEvent) => void) | null = null;
  onFocusOut: ((event: FocusEvent) => void) | null = null;
  onDragStart: ((event: DragEvent) => void) | null = null;
  onDragOver: ((event: DragEvent) => void) | null = null;
  onDragLeave: ((event: DragEvent) => void) | null = null;
  onDragEnd: ((event: DragEvent) => void) | null = null;
  onDrop: ((event: DragEvent) => void) | null = null;
  onMoreClick: ((event: Event) => void) | null = null;
  onMoreMenuClick: ((event: Event) => void) | null = null;
  onMoreMapClick: ((event: L.LeafletEvent) => void) | null = null;
  onZoomEnd: (() => void) | null = null;
  unsubscribeCountChange: (() => void) | null = null;
  unsubscribeControlAttached: (() => void) | null = null;
  attrsOutsideHandler: ((event: MouseEvent) => void) | null = null;
  styleOutsideHandler: ((event: MouseEvent) => void) | null = null;
  attrsUnsubscribe: (() => void) | null = null;
  styleUnsubscribe: (() => void) | null = null;
  styleRefresh: (() => void) | null = null;
  styleZoomEndHandler: (() => void) | null = null;
  /** #548: cleanup handle for the geometry marquee's marching-ants loop. */
  geometryMarqueeCleanup: (() => void) | null = null;
  /** Component-scoped translator (auto-prepends the component name).
   *  Forwarded from the coordinator; a ui/* module reads text through this
   *  so a per-instance conf injection is honored (T270 kept the seam). */
  T: (key: string) => string = createScopedTranslator(CONF);
  /** Unscoped translator for the shared `foliplus.*` vocabulary. */
  _: (key: string) => string = createTranslator(CONF);
  /** The resolved locale code for Intl formatting (number/date), forwarded
   *  like T/_ so a per-instance conf injection wins. */
  localeCode: string = CONF.locale_code ?? "en";
}

export { PanelStore };
export type { GroupCount, OpenAttrsPanel, OpenMenu };
