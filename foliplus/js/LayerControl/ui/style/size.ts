// LayerControl UI — per-layer size row: one layer's fixed pixel radius.
//
// A self-managed dimension, like fill and border: the value lives in
// `ui.intentStore` under `size`, is persisted under `layers[id].size`, and
// reaches the map by walking the layer tree and calling `setRadius` on every
// leaf that carries a pixel radius. It is not part of the executor's
// visible / opacity / zoomRange family — a radius write is a direct Leaflet
// call, not a projection of stored state.
//
// Registered in the dimension registry as `DIM.SIZE` so the panel discovers
// it like every other dimension. `DIM_ORDER` seats it right after fill,
// because a CircleMarker's fill and its radius are one idea: the row lands
// next to the fill row it belongs to with no special case in the panel, and
// `gatedRows` skips it for a Polygon or a metre-radius Circle exactly as it
// skips fill for a tile layer.
//
// Only `L.CircleMarker` qualifies. The carrier test is `isPixelRadiusLeaf` —
// `getRadius` plus a numeric `_radius`, no `_mRadius`, and a real
// `setRadius` — which `hasRadiusLeaf` runs across the whole tree, so a row
// that renders always has a leaf to write and never has a leaf it cannot
// write. `L.Circle` keeps its radius in metres (`_mRadius`) and never gets a
// row: one px field could not write both without inventing a unit for one of
// them.
//
// The authored radius is frozen, not read. `setRadius` writes the leaf's own
// `_radius`, so reading it back after a write would feed the leaf its own last
// write and every keystroke would compound. The author's value is captured
// once, per leaf, on the layer's first write — the same rule as
// `authorOpacityBase` / `authorZoomBounds` — and is what Reset restores from.
// Keyed by leaf so a tree that replaces its children (a re-rendering
// GeoJSON) recaptures honestly instead of restoring a freed radius.
//
// Every radius write rides the shared frame coalescer
// (`scheduleStyleDimApply(FACE.SIZE, ...)`). `FACE.SIZE` is not a `setStyle`
// face — a radius write is a direct `setRadius` — but it shares the queue, so
// a typing burst across the field lands one walk instead of one per leaf per
// keystroke, and a bulk add of leaves to one layer coalesces the same way.
import { CAP_TIER, DIM, findLeaf, walkLeaf } from "#core/layer/index.js";
import { type PixelRadiusLeaf, isPixelRadiusLeaf } from "#core/leafletAdapter.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import { bindLiveNumber, formRow, inlineControls, numberInput } from "#common/form.js";
import { INTENT, getIntent } from "../intent.js";
import type { LayerUI } from "../surface.js";
import { registerDimension, resetIntentKeys, writeIntentKeys } from "./registry.js";
import { FACE, cancelStyleDimApply, scheduleStyleDimApply } from "./styleBag.js";

/** The author's radius per leaf — captured on the layer's first write, and by
 *  reset time the only copy of it (`setRadius` mutates `_radius` in place).
 *  Keyed by leaf so a tree that replaces its children (a re-rendering GeoJSON)
 *  recaptures honestly instead of restoring a freed radius. */
const authorRadius = new WeakMap<PixelRadiusLeaf, number>();

/** Whether the layer's surface can honestly carry a radius write. The same
 *  two-layer gate every other dimension uses: the layer must be in the
 *  registry, then `capabilities.size === "native"`. */
const layerCanSize = (ui: LayerUI, layerId: string): boolean => {
  const layerInfo = ui.c.layerRegistry.get(layerId);
  if (!layerInfo) return false;
  return ui.c.surfaceFor(layerInfo).capabilities.size === CAP_TIER.NATIVE;
};

/** Apply the layer's stored size to every pixel-radius leaf, capturing each
 *  leaf's authored radius on first write. A missing intent is a no-op — a
 *  layer the user never touched keeps exactly what the author declared, and
 *  no authored value is captured to restore later.
 *
 *  A leaf already at the target radius is left alone: the walk is one sweep
 *  over the tree, and rewriting a value that is already there would churn the
 *  renderer for nothing. The authored capture stays first — a leaf that
 *  arrives already at the user's value still owns an authored radius, and
 *  reading it later would return the user's own choice.
 *
 *  Single writer of a radius: commits and the content replay only record or
 *  re-apply intent, they never write a leaf themselves. */
const applySizeToLayer = (ui: LayerUI, layerId: string): void => {
  const size = getIntent(ui, layerId, INTENT.SIZE);
  if (size === undefined) return;
  const layer = ui.c.findLayer(layerId);
  if (!layer) return;
  walkLeaf(layer, leaf => {
    if (!isPixelRadiusLeaf(leaf)) return;
    if (!authorRadius.has(leaf)) authorRadius.set(leaf, leaf.getRadius());
    if (leaf.getRadius() === size) return;
    leaf.setRadius(size);
  });
};

/** Re-apply the layer's stored size to whatever leaves it has *now*, through
 *  the shared frame coalescer. Every path that must reach the current leaves
 *  goes through here — the commit, the content-change replay, the panel flush
 *  — so the queue is the single place that decides when a walk runs.
 *
 *  No-op when the user never chose a size: `applySizeToLayer` reads the
 *  intent and bails, so a layer the author drew alone keeps its authored
 *  radii. */
const replaySizeIntent = (ui: LayerUI, layerId: string): void => {
  scheduleStyleDimApply(FACE.SIZE, layerId, () => applySizeToLayer(ui, layerId));
};

/** Commit the size field. Called from `bindLiveNumber`, which already clamps
 *  into the shared bounds. Only writes when the value moved — a drag revisits
 *  every step, and each pass is a sweep over the tree.
 *
 *  The value is rounded here as well as in the field's `normalize`: intent is
 *  never a fraction, so the stored value and the map agree before and after a
 *  reload. `parseSize` rounds on the read side for the same reason. */
const commitSize = (ui: LayerUI, layerId: string, px: number): void => {
  const size = Math.round(px);
  if (getIntent(ui, layerId, INTENT.SIZE) === size) return;
  writeIntentKeys(ui, layerId, [[INTENT.SIZE, size]]);
  replaySizeIntent(ui, layerId);
};

/** Reset the layer's radius to what the author drew and drop the persisted
 *  entry. The authored value comes from the WeakMap, never from a re-read — a
 *  re-read would restore the user's own choice, and a layer that never wrote
 *  has nothing to restore anyway.
 *
 *  The provenance drop runs before the restore walk so a reload does not
 *  re-apply a radius the layer no longer shows, and it happens either way:
 *  the reset is the intent, not the write. A walk queued by a trailing
 *  keystroke must not land after the restore, so it is cancelled before the
 *  leaves are touched — the same rule as `resetLayerFill`. */
const resetLayerSize = (ui: LayerUI, layerId: string): void => {
  if (!ui.c.layerRegistry.has(layerId)) return;
  resetIntentKeys(ui, layerId, [INTENT.SIZE]);
  cancelStyleDimApply(FACE.SIZE, layerId);
  const layer = ui.c.findLayer(layerId);
  if (!layer) return;
  walkLeaf(layer, leaf => {
    if (!isPixelRadiusLeaf(leaf)) return;
    const authored = authorRadius.get(leaf);
    if (authored !== undefined) leaf.setRadius(authored);
    authorRadius.delete(leaf);
  });
};

/** The radius the row should show before the user has chosen one: the first
 *  pixel-radius leaf's authored radius — from the WeakMap when a write already
 *  happened, straight off the leaf otherwise. */
const firstAuthorRadius = (ui: LayerUI, layerId: string): number => {
  const layer = ui.c.findLayer(layerId);
  if (!layer) return CONST.SIZE.DEFAULT;
  const leaf = findLeaf<PixelRadiusLeaf>(layer, candidate =>
    isPixelRadiusLeaf(candidate) ? candidate : undefined,
  );
  return leaf ? (authorRadius.get(leaf) ?? leaf.getRadius()) : CONST.SIZE.DEFAULT;
};

/** Build the size row, or `null` when the layer cannot carry a radius. The
 *  gate is checked here rather than at the call site: a fill row exists for
 *  Polygon and Circle too, both of which have no pixel-radius leaf, so the
 *  caller cannot decide on its own.
 *
 *  The initial value is the stored choice, else the authored radius — never a
 *  constant, so the row shows what the layer is actually painting on first
 *  open. An author-declared radius outside the bounds is shown as declared
 *  rather than clamped, so the field is never a lie about the map. */
const buildSizeRow = (ui: LayerUI, layerId: string): HTMLElement | null => {
  if (!layerCanSize(ui, layerId)) return null;
  const label = ui.T("style_size");
  return formRow(
    label,
    inlineControls(
      numberInput({
        value: getIntent(ui, layerId, INTENT.SIZE) ?? firstAuthorRadius(ui, layerId),
        min: CONST.SIZE.MIN,
        max: CONST.SIZE.MAX,
        step: CONST.SIZE.STEP,
        className: CONST.CLASSES.STYLE_SIZE_INPUT,
        ariaLabel: label,
      }),
    ),
    CONST.CLASSES.STYLE_SIZE_ROW,
  );
};

/** Wire the size field to its commit path. Called from `openStylePanel`. */
const bindSizeRow = (ui: LayerUI, layerId: string, row: HTMLElement): void => {
  const input = row.querySelector(
    `input.${CONST.CLASSES.STYLE_SIZE_INPUT}`,
  ) as HTMLInputElement | null;
  if (!input) return;
  bindLiveNumber(input, {
    min: CONST.SIZE.MIN,
    max: CONST.SIZE.MAX,
    fallback: CONST.SIZE.DEFAULT,
    // The size field accepts whole pixels only, and intent / storage round to
    // whole pixels too — normalize before the commit so a fraction typed
    // mid-way cannot reach the map or the save as anything but an integer.
    normalize: Math.round,
    onCommit: px => commitSize(ui, layerId, px),
  });
};

/** Register size as a per-layer dimension. Seated right after `fill` in
 *  `DIM_ORDER` — a CircleMarker's fill and its radius are one idea, and the
 *  row lands next to the fill row it belongs to with no special case in the
 *  panel builder.
 *
 *  The descriptor owns the intent+persist slots; `commitSize` /
 *  `resetLayerSize` stay as thin delegates so the direct callers (the panel
 *  reset footer, the content replay) keep one entry point.
 *
 *  Gate invariant: existence then `capabilities.size !== "none"`. */
const SIZE_DIMENSION = registerDimension<number>({
  key: DIM.SIZE,
  gate: layerCanSize,
  value: (ui, layerId) =>
    getIntent(ui, layerId, INTENT.SIZE) ?? firstAuthorRadius(ui, layerId),
  /** `gatedRows` only calls a descriptor's row after its gate passed, and the
   *  gate is `layerCanSize` — the same check `buildSizeRow` re-runs for its
   *  direct callers. So the `null` arm is unreachable on this path. */
  row: (ui, layerId) => buildSizeRow(ui, layerId) as HTMLElement,
  /** Cohesive user write: round to a whole pixel, skip an unchanged value,
   *  record intent + provenance, then replay the stored intent onto the
   *  layer's current leaves. */
  write: (ui, layerId, patch) => {
    const px = typeof patch === "number" ? patch : undefined;
    if (px === undefined) return;
    commitSize(ui, layerId, px);
  },
  /** Cohesive reset: clear the override, save, restore the authored radii. */
  reset: (ui, layerId) => resetLayerSize(ui, layerId),
  valueSource: (ui, layerId) => {
    if (!layerCanSize(ui, layerId)) return "none";
    return ui.intentStore.isUserSet(layerId, INTENT.SIZE) ? "user" : "author";
  },
  /** Content-change replay: a pixel radius chosen before a leaf landed
   *  reaches it — the when-gate bails when the user never chose a size,
   *  before any scheduler box is allocated, so an untouched layer keeps its
   *  authored radii. */
  contentChange: {
    kind: "frame",
    face: FACE.SIZE,
    when: (ui, layerId) => getIntent(ui, layerId, INTENT.SIZE) !== undefined,
    run: (ui, layerId) => applySizeToLayer(ui, layerId),
  },
});

export {
  SIZE_DIMENSION,
  applySizeToLayer,
  bindSizeRow,
  buildSizeRow,
  commitSize,
  layerCanSize,
  resetLayerSize,
};
