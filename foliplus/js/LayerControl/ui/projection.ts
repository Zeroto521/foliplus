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
import type { LayerAccess } from "./access.js";
import type { FocusStore } from "./focusStore.js";
import { INTENT, getIntent } from "./intent.js";
import type { PanelStore } from "./panelStore.js";
import { inZoomRange } from "./rowView.js";

/** The user's own visibility choice, or the author's declared default
 *  (captured once at first sight by `snapshotAuthorVisible`) when the user
 *  never touched it. This is the single entry point other modules —
 *  `syncNoBasemap`, `rowView`, `snapshotAuthorVisible` itself, and the
 *  executor's baseline — read the intent through, so no mirror is stored on
 *  the layer record.
 *
 *  The user's choice is signalled by the dimension's `overrides` provenance
 *  marker *or* by the value being present on the intent record. The two travel
 *  together out of `loadPersistedState` and `setVisible`, so either alone still
 *  means "the user chose this" — a caller that records the value (a restored
 *  record, a test fixture, a re-registration replay) must not have it silently
 *  read back as the author's default. */
const intentVisibleOf = (
  la: LayerAccess,
  ps: PanelStore,
  fs: FocusStore,
  id: string,
): boolean => {
  const visible = getIntent(la, id, INTENT.VISIBLE);
  const hasVisible =
    la.intentStore.isUserSet(id, INTENT.VISIBLE) || typeof visible === "boolean";
  const authorDefault = la.runtimeStore.getAuthorVisible(id) ?? true;
  return hasVisible ? (visible ?? true) : authorDefault;
};

/** Build one layer's projection from the persisted intent and the current
 *  policy inputs (focus, map zoom). Read-only. */
const projectLayer = (
  la: LayerAccess,
  ps: PanelStore,
  fs: FocusStore,
  layerInfo: LayerInfo,
): Projection => {
  const id = layerInfo.id;
  // The author's default is the map state folium left at boot (see
  // `snapshotAuthorVisible`), captured before any policy moved layers.
  const intent = intentVisibleOf(la, ps, fs, id);

  // Policy is independent of intent: focus overrides range, range may
  // exclude, but neither touches the user's stored choice.
  const policy = fs.focusingLayerId != null ? true : inZoomRange(la, ps, fs, layerInfo);
  const effectiveShown = intent && policy;

  // A dimension's value being present is what the sweep has always read as
  // the user's choice (a restored record, a late replay). The provenance
  // marker lives on `IntentRow.provenance`, not on this projection.
  const opacity = getIntent(la, id, INTENT.OPACITY);
  const zoomRange = getIntent(la, id, INTENT.ZOOM_RANGE) ?? null;

  return { id, intent: { visible: intent }, effectiveShown, opacity, zoomRange };
};

/** Project every id the panel or the executor cares about. The set is the
 *  union `applyUserState` used to walk — the registry plus every id with a
 *  persisted dimension, so an id with stored state but no registry entry
 *  keeps flowing through instead of being pruned. Unresolvable ids are
 *  skipped: they may be a component that registers later, and the id space
 *  is bounded by the layers an author ever declares, so the record cannot
 *  grow away ("not in the registry" never means "gone"). */
const projectAll = (
  la: LayerAccess,
  ps: PanelStore,
  fs: FocusStore,
): Map<string, Projection> => {
  const ids = new Set([
    ...la.layerRegistry.layers.map(li => li.id),
    ...la.intentStore.ids(),
  ]);
  const result = new Map<string, Projection>();
  for (const id of ids) {
    const layerInfo = la.layerRegistry.get(id);
    if (!layerInfo) continue;
    result.set(id, projectLayer(la, ps, fs, layerInfo));
  }
  return result;
};

export { projectAll, projectLayer, intentVisibleOf };
