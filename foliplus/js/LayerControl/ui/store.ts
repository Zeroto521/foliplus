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
import type { LayerUI } from "./index.js";
import { inZoomRange } from "./rowView.js";

/** One layer's projection: intent (persisted) and the derived policy state
 *  together, so a diff sees both in one comparison.
 *
 *  `intent.visible` is what the checkbox shows — the user's choice when they
 *  made one, otherwise the author's declared default.
 *  `effectiveShown` is the composite `intent && policy` and is what the
 *  executor writes to map membership. Only `intent` may authorise display;
 *  `policy` (focus, zoom range) may only suppress it. That is the invariant
 *  that keeps a derived dimension from ever adding a layer back onto the
 *  map — the class of bug the quickstart regression records, and the structural root of the
 *  `rangeHiddenIds` one-way gate that used to live in state.ts.
 */
interface Projection {
  id: string;
  intent: { visible: boolean };
  effectiveShown: boolean;
  opacity: number | undefined;
  zoomRange: [number, number] | null;
}

/** The executor's projection snapshot: the pure projection plus the carrier
 *  identity the last write landed on. Recording carrier is what closes
 *  value-only diff misses writes when a carrier element is replaced (a
 *  re-registered canvas, a lazily-created annotation pane), because the
 *  stored numeric opacity matches but the DOM in front of it is new.
 *  The token is opaque: a canvas element, a pane-names array, or an
 *  `options` object reference. */
interface AppliedProjection extends Projection {
  carrier: unknown;
}

/** Build one layer's projection from the persisted intent and the current
 *  policy inputs (focus, map zoom). Read-only. */
const projectLayer = (ui: LayerUI, layerInfo: LayerInfo): Projection => {
  const id = layerInfo.id;
  const overrides = ui.userOverrides?.[id];
  // The user's own choice is signalled by the dimension's `overrides`
  // provenance marker *or* by the value being present. The two travel
  // together out of `loadPersistedState` and `syncHiddenId`, so either alone
  // still means "the user chose this" — a caller that records the value
  // (a restored record, a test fixture, a re-registration replay) must not
  // have it silently read back as the author's default. Absent both, the
  // author's declared default stands.
  const hidden = ui.hiddenIds?.has(id) ?? false;
  const hasVisible = overrides?.includes("visible") || hidden;
  // The author's default is the map state folium left at boot (see
  // `snapshotAuthorVisible`), captured before any policy moved layers.
  const authorDefault = ui.authorVisible.get(id) ?? true;
  const intent = hasVisible ? !hidden : authorDefault;

  // Policy is independent of intent: focus overrides range, range may
  // exclude, but neither touches the user's stored choice.
  const policy = ui.focusingLayerId != null ? true : inZoomRange(ui, layerInfo);
  const effectiveShown = intent && policy;

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
    ...ui.hiddenIds,
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

export { projectAll, projectLayer, type Projection, type AppliedProjection };
