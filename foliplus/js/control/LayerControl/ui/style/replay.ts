// control/LayerControl/ui/style/replay — a neutral bridge that lets one style dimension
// schedule a re-apply of another dimension's face without importing the other
// dimension module. The style dimensions form a DAG (fill → border derives
// from the leaf's current fill); a direct fill ↔ border import would be a
// cycle. The bridge knows neither dimension: the face owner (border)
// registers its replay here, keyed by UI + face, and the writer (fill)
// asks for it by face. The callback takes the layerId the writer just
// committed, because a replay is only ever scheduled for one layer.
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
