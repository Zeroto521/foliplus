// control/LayerControl/ui/style/replay — a neutral bridge that lets one style dimension
// schedule a re-apply of another dimension's face without importing the other
// dimension module. The dimensions form a DAG (fill → border derives from the
// leaf's current fill); a direct fill ↔ border import would be a cycle. The
// face owner registers its replay here, and the writer asks for it by face.
// re-apply of another dimension's face WITHOUT importing the other dimension
// module. The layer control dimensions form a DAG (fill → border derives from
// the leaf's current fill), and a direct fill.ts ↔ border.ts import would be
// a cycle that breaks single-source layering. Instead the face owner (border)
// registers its replay callback here once, and the writer (fill) asks for it
// by face — the bridge knows neither dimension.
//
// The registration is keyed by UI + face because the callback closes over the
// owning dimension's per-UI apply function (e.g. border's applyBorderToLayer).
// A replay is only ever scheduled for a layerId the writer just committed, so
// the callback takes the layerId as its argument.
import type { LayerUI } from "../surface.js";
import { FACE, type SchedulerFace, scheduleStyleDimApply } from "./styleBag.js";

/** A replay callback: re-run the owning dimension's apply for one layer. */
type FaceReplay = (layerId: string) => void;

const replays = new Map<LayerUI, Map<SchedulerFace, FaceReplay>>();

/** Register (or replace) the replay callback for a UI + face. The caller is
 *  the face owner; it should register once per UI (idempotent — the last
 *  registration wins). */
export const registerFaceReplay = (
  ui: LayerUI,
  face: SchedulerFace,
  run: FaceReplay,
): void => {
  let byFace = replays.get(ui);
  if (!byFace) {
    byFace = new Map();
    replays.set(ui, byFace);
  }
  byFace.set(face, run);
};

/** Drop the replay callback for a UI + face. Called from the owning
 *  dimension's teardown so a destroyed UI does not keep a stale callback. */
export const unregisterFaceReplay = (ui: LayerUI, face: SchedulerFace): void => {
  replays.get(ui)?.delete(face);
};

/** Schedule a re-apply of a registered face for one layer. No-op when the
 *  face has no registered replay (nothing owns that face yet). */
export const replayFace = (ui: LayerUI, layerId: string, face: SchedulerFace): void => {
  const run = replays.get(ui)?.get(face);
  if (!run) return;
  scheduleStyleDimApply(face, layerId, () => run(layerId), { owner: ui });
};
