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

/** Handle returned by bindNodeDrag — enable/disable + unbind a node drag. */
interface DragBind {
  setEnabled: (enabled: boolean) => void;
  cleanup: () => void;
}

export type { CollidableLabel, DragBind, ExportFormat };
