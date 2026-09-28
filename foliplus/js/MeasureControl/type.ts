// MeasureControl shared type definitions — export format key, collision planner
// inputs, edit-overlay contracts, and node drag handles. Pure types: everything
// here is erased at build, so sub-modules can import without pulling value code.
import type { EXPORT_FORMAT } from "./const.js";

type ExportFormat = (typeof EXPORT_FORMAT)[keyof typeof EXPORT_FORMAT];

/** A label eligible for collision hiding. */
interface CollidableLabel {
  /** Marker that owns the chip; the chip is re-resolved every plan so a
   *  `setIcon` during a drag never leaves a stale element reference. */
  marker: L.Marker;
  /** 0–100; the lowest values drop out first when two chips overlap heavily. */
  priority: number;
}

/** Result of a placement pass — how many chips were hidden and which ones, so
 *  callers (export, telemetry, other controls) can reason about the outcome. */
interface PlanResult {
  hidden: number;
  elements: Set<HTMLElement>;
}

/** Input the overlay expects from its host — a subset of MeasureManager. */
interface EditOverlayHost {
  isEditMode: boolean;
  map: L.Map;
  registerEditOverlayCloser?: (close: () => void, id?: string) => () => void;
  closeOtherEditOverlays?: (exceptId: string) => void;
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

/** Handle returned by bindNodeDrag — enable/disable + unbind a node drag. */
interface DragBind {
  setEnabled: (enabled: boolean) => void;
  cleanup: () => void;
}

export type {
  CollidableLabel,
  DragBind,
  EditOverlay,
  EditOverlayHost,
  ExportFormat,
  NodeDragHandle,
  NodeDragHandlers,
  PlanResult,
};
