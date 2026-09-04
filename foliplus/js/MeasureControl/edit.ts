// MeasureControl edit utilities — shared ✕ overlay + node drag for finalized
// measurements (distance / polygon / circle / marker). Extracted from util.ts
// for readability; kept as pure helpers, not a manager class, because edit-mode
// lifecycle (isEditMode toggle, ModeManager lock, Escape priority) lives in
// MeasureManager and can't be cleanly delegated to a separate controller.

/** Input the overlay expects from its host — a subset of MeasureManager. */
interface EditOverlayHost {
  isEditMode: boolean;
  map: L.Map;
  registerEditOverlayCloser?: (close: () => void) => () => void;
  closeOtherEditOverlays?: (except: () => void) => void;
}

/** Per-node drag options wired by bindNodeDrag. */
interface NodeDragHandlers {
  onDrag?: (latlng: L.LatLng) => void;
  onEnd?: (latlng: L.LatLng) => void;
}

/** Per-node drag handle returned by bindNodeDrag. */
interface NodeDragHandle {
  setEnabled: (enabled: boolean) => void;
  cleanup: () => void;
}

/** Public surface of the shared ✕ overlay returned by buildEditOverlay. */
interface EditOverlay {
  open: (ev: L.LeafletMouseEvent) => void;
  close: () => void;
  cleanup: () => void;
}

/** Minimum container-point movement (px) to count as a drag rather than a tap. */
const DRAG_THRESHOLD = 4;

/**
 * Build the shared edit overlay for a finalized measurement (distance,
 * polygon, circle, or pin). The caller wires `result.open(ev)` onto each of
 * the measure's clickable layers; clicking empty map space closes the overlay
 * (the manager's global click handler stops propagation for item clicks, so
 * only empty-space clicks reach here).
 */
const buildEditOverlay = (
  host: EditOverlayHost,
  opts: { onOpen: () => void; onEmpty?: () => void },
): EditOverlay => {
  let isOpen = false;
  const { onOpen, onEmpty } = opts;

  const close = () => {
    if (!isOpen) return;
    isOpen = false;
    onEmpty?.();
  };

  const onMapClick = () => {
    if (isDragSyntheticClick()) return;
    close();
  };
  host.map.on("click", onMapClick);
  const unregister = host.registerEditOverlayCloser?.(close);

  const open = (ev: L.LeafletMouseEvent) => {
    if (!host.isEditMode) return;
    if (isOpen) return;
    if (isDragSyntheticClick()) return;
    // Only one measurement shows ✕ at a time: close any other open overlay.
    host.closeOtherEditOverlays?.(close);
    // Stop Leaflet's layer→map propagation (sets originalEvent._stopped) so
    // the map-level click handlers — including this overlay's own onMapClick
    // which closes it — don't immediately undo the open.
    L.DomEvent.stopPropagation(ev);
    isOpen = true;
    onOpen();
  };

  return {
    open,
    close,
    cleanup: () => {
      host.map.off("click", onMapClick);
      unregister?.();
    },
  };
};

/**
 * Bind manual drag to a finalized node marker (L.CircleMarker or L.Marker).
 * Nodes have no built-in dragging, so we drive it from mousedown/move/up,
 * disabling the map's own dragging while we hold, and moving a paired ✕
 * icon along. Works for both SVG circleMarkers and div-based pin markers.
 *
 * Returns { setEnabled, cleanup }: the caller enables the binding on edit-mode
 * enter (via the manager's edit drag toggles) and cleans it up on delete.
 */
const bindNodeDrag = (
  node: L.Layer,
  delMarker: L.Layer | null,
  map: L.Map,
  handlers: NodeDragHandlers,
): NodeDragHandle => {
  let enabled = false;
  let dragging = false;
  let moved = false;
  let startPt: { x: number; y: number } | null = null;

  // Query the element fresh each time: resortLayers() removes/re-adds nodes,
  // which re-creates their SVG path, so a captured element reference would go
  // stale and the `move` cursor would silently stop applying.
  const setCursor = (cursor: string) => {
    const el = ((node as L.Marker).getElement?.() as HTMLElement | null) ?? null;
    if (el) el.style.cursor = cursor;
  };

  const onDown = (ev: L.LeafletMouseEvent) => {
    if (!enabled) return;
    const raw = (ev.originalEvent as MouseEvent | undefined) ?? undefined;
    if (!raw) return;
    startPt = map.mouseEventToContainerPoint(raw);
    dragging = true;
    moved = false;
    setCursor("move");
    map.dragging.disable();
  };
  const onMove = (ev: L.LeafletMouseEvent) => {
    if (!dragging || !startPt) return;
    const raw = (ev.originalEvent as MouseEvent | undefined) ?? undefined;
    if (!raw) return;
    const pt = map.mouseEventToContainerPoint(raw);
    if (
      !moved &&
      Math.abs(pt.x - startPt.x) + Math.abs(pt.y - startPt.y) < DRAG_THRESHOLD
    )
      return;
    moved = true;
    // Notify handlers BEFORE repositioning the node so handlers that locate
    // the node by its current latlng (distance/polygon `findPtIdx`) can still
    // find the original point before it moves.
    handlers.onDrag?.(ev.latlng);
    (node as L.Marker).setLatLng(ev.latlng);
    if (delMarker) (delMarker as L.Marker).setLatLng(ev.latlng);
  };
  const onUp = (ev: L.LeafletMouseEvent) => {
    if (!dragging) return;
    dragging = false;
    setCursor(enabled ? "move" : "");
    map.dragging.enable();
    if (moved) handlers.onEnd?.(ev.latlng);
  };
  const onNodeUp = (ev: L.LeafletMouseEvent) => {
    onUp(ev);
  };

  node.on("mousedown", onDown);
  node.on("mouseup", onNodeUp);
  map.on("mousemove", onMove);
  map.on("mouseup", onUp);

  const setEnabled = (v: boolean) => {
    enabled = v;
    setCursor(v ? "move" : "");
  };
  const cleanup = () => {
    node.off("mousedown", onDown);
    node.off("mouseup", onNodeUp);
    map.off("mousemove", onMove);
    map.off("mouseup", onUp);
  };
  return { setEnabled, cleanup };
};

/**
 * Mark a click as drag-synthetic so the ensuing click (a drag ends with
 * mouseup, which also fires a click) doesn't reopen or close an overlay.
 */
const markDragSyntheticClick = () => {
  (
    window as unknown as { __foliplus_measure_drag_click: boolean }
  ).__foliplus_measure_drag_click = true;
};

const isDragSyntheticClick = (): boolean => {
  const w = window as unknown as { __foliplus_measure_drag_click: boolean };
  // Coalesce the absent flag to false so the return value matches the declared
  // boolean type even on the first read (before any drag has marked a click).
  const v = w.__foliplus_measure_drag_click ?? false;
  w.__foliplus_measure_drag_click = false;
  return v;
};

export {
  bindNodeDrag,
  buildEditOverlay,
  isDragSyntheticClick,
  markDragSyntheticClick,
  type EditOverlay,
  type EditOverlayHost,
  type NodeDragHandle,
  type NodeDragHandlers,
};
