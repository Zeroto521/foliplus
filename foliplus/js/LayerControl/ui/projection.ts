// LayerControl UI — pure projection of intent + policy per layer.
//
// Every dimension the panel and the map care about is derived from one
// projection per layer. `buildRowCell` reads `effectiveShown` from here
// instead of recomputing the same expression as the state-side policy
// writer, so the formula has one home. The map-side executor
// (`./apply.ts`) diffs this projection against the last one it wrote,
// so a change on either input reaches the map through exactly one path.
//
// Nothing in this file touches the map, the registry, or storage.
import type { Projection } from "../type.js";
import type { LayerUI } from "./index.js";
import { inZoomRange } from "./rowView.js";

/** The user's own visibility choice, or the author's declared default
 *  (captured once at first sight by `snapshotAuthorVisible`) when the user
 *  never touched it. This is the single entry point other modules —
 *  `syncNoBasemap`, `rowView`, `snapshotAuthorVisible` itself, and the
 *  executor's baseline — read the intent through, so no mirror is stored on
 *  the layer record.
 *
 *  The user's choice is signalled by the dimension's `overrides` provenance
 *  marker *or* by membership in `hiddenLayerIds`. The two travel together out of
 *  `loadPersistedState` and `syncHiddenId`, so either alone still means "the
 *  user chose this" — a caller that records the value (a restored record, a
 *  test fixture, a re-registration replay) must not have it silently read
 *  back as the author's default. */
const intentVisibleOf = (ui: LayerUI, id: string): boolean => {
  const overrides = ui.intentProvenance?.[id];
  const hidden = ui.hiddenLayerIds?.has(id) ?? false;
  const hasVisible = overrides?.includes("visible") || hidden;
  const authorDefault = ui.authorVisible.get(id) ?? true;
  return hasVisible ? !hidden : authorDefault;
};

/** Build one layer's projection from the persisted intent and the current
 *  policy inputs (focus, map zoom). Read-only. */
const projectLayer = (ui: LayerUI, layerInfo: LayerInfo): Projection => {
  const id = layerInfo.id;
  // The author's default is the map state folium left at boot (see
  // `snapshotAuthorVisible`), captured before any policy moved layers.
  // Inline the intent logic here (instead of calling `intentVisibleOf`)
  // to avoid function-call overhead on the zoomend hot path — this runs
  // per layer per zoom, so the JIT benefits from seeing all lookups in
  // one scope.
  const overrides = ui.intentProvenance?.[id];
  const hidden = ui.hiddenLayerIds?.has(id) ?? false;
  const hasVisible = overrides?.includes("visible") || hidden;
  const authorDefault = ui.authorVisible.get(id) ?? true;
  const intent = hasVisible ? !hidden : authorDefault;

  // Policy is independent of intent: focus overrides range, range may
  // exclude, but neither touches the user's stored choice.
  const policy = ui.focusingLayerId != null ? true : inZoomRange(ui, layerInfo);
  const effectiveShown = intent && policy;

  // A dimension's value being present is what the sweep has always read as
  // the user's choice (a restored record, a late replay). The provenance
  // marker lives on `intentProvenance`, not on this projection.
  const opacity =
    typeof ui.opacityMap?.[id] === "number" ? ui.opacityMap[id] : undefined;

  const zoomRange = ui.zoomRangeMap?.[id]
    ? (ui.zoomRangeMap[id] as [number, number])
    : null;

  return { id, intent: { visible: intent }, effectiveShown, opacity, zoomRange };
};

/** Project every id the panel or the executor cares about. The set is the
 *  union `applyUserState` used to walk — the registry plus every id with a
 *  persisted dimension, so an id with stored state but no registry entry
 *  keeps flowing through instead of being pruned. Unresolvable ids are
 *  skipped: they may be a component that registers later, and the id space
 *  is bounded by the layers an author ever declares, so the record cannot
 *  grow away ("not in the registry" never means "gone"). */
const projectAll = (ui: LayerUI): Map<string, Projection> => {
  const ids = new Set([
    ...ui.m.layers.map(li => li.id),
    ...ui.hiddenLayerIds,
    ...Object.keys(ui.renamedNames),
    ...Object.keys(ui.opacityMap),
    ...Object.keys(ui.zoomRangeMap),
  ]);
  const result = new Map<string, Projection>();
  for (const id of ids) {
    const layerInfo = ui.m.layerRegistry.get(id);
    if (!layerInfo) continue;
    result.set(id, projectLayer(ui, layerInfo));
  }
  return result;
};

export { projectAll, projectLayer, intentVisibleOf };
