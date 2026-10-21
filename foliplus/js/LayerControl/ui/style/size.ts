// LayerControl UI — per-layer size row: one layer's fixed pixel radius.
//
// A self-managed dimension, like fill and border: the value lives in
// `ui.intentStore` under `size`, is persisted under `layers[id].size`, and
// reaches the map by walking the layer tree and calling `setRadius` on every
// leaf that carries a pixel radius. It is not part of the executor's
// visible / opacity / zoomRange family — a radius write is a direct Leaflet
// call, not a projection of stored state.
//
// Deliberately not registered in the dimension registry: no caller reads a
// descriptor `value` / `valueSource` for a radius (the panel's row list is the
// only consumer), so a descriptor would add two slots nobody consumes. It
// rides the fill row's panel position instead — `renderStylePanel` appends it
// right after the fill row it belongs to, and `openStylePanel` binds it.
//
// Only `L.CircleMarker` qualifies. The carrier test is `getRadius` plus a
// numeric `_radius` and no `_mRadius` — the same test the `size` capability
// probe runs
// (`hasRadiusLeaf`), so a row that renders always has a leaf to write and
// never has a leaf it cannot write. `L.Circle` keeps its radius in metres
// (`_mRadius`) and never gets a row: one px field could not write both
// without inventing a unit for one of them.
//
// The authored radius is frozen, not read. `setRadius` writes the leaf's own
// `_radius`, so reading it back after a write would feed the leaf its own last
// write and every keystroke would compound. The author's value is captured
// once, per leaf, on the layer's first write — the same rule as
// `authorOpacityBase` / `authorZoomBounds` — and is what Reset restores from.
// Keyed by leaf so a tree that replaces its children (a re-rendering
// GeoJSON) recaptures honestly instead of restoring a freed radius.
import { CAP_TIER, findLeaf, walkLeaf } from "#core/layer/index.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import { dom } from "#common/dom.js";
import { bindLiveNumber, formRow, inlineControls, numberInput } from "#common/form.js";
import { INTENT, getIntent } from "../intent.js";
import type { LayerUI } from "../surface.js";
import { resetIntentKeys, writeIntentKeys } from "./registry.js";

/** A leaf that carries a pixel radius — the only write target of this row. */
type RadiusLeaf = {
  getRadius(): number;
  setRadius(radius: number): unknown;
  _radius?: unknown;
};

/** The carrier test, inlined so the writer does not depend on the capability
 *  probe module. `getRadius` is shared by CircleMarker and Circle, and
 *  `L.Circle` ends up with a numeric `_radius` too (its `_project` derives a
 *  pixel value from the metre radius once it is attached), so `_mRadius` is
 *  what keeps the metre-radius circle out — the same three-feature test
 *  `hasRadiusLeaf` runs. */
const isRadiusLeaf = (node: unknown): node is RadiusLeaf => {
  const n = node as {
    getRadius?: unknown;
    _radius?: unknown;
    _mRadius?: unknown;
  };
  return (
    typeof n.getRadius === "function" &&
    typeof n._radius === "number" &&
    n._mRadius === undefined
  );
};

/** The author's radius per leaf — captured on the layer's first write, and by
 *  reset time the only copy of it (`setRadius` mutates `_radius` in place). */
const authorRadius = new WeakMap<RadiusLeaf, number>();

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
 *  Called from the commit path and from the applyUserState sweep, so the
 *  walk is the single writer of a radius: commits only record intent. */
const applySizeToLayer = (ui: LayerUI, layerId: string): void => {
  const size = getIntent(ui, layerId, INTENT.SIZE);
  if (size === undefined) return;
  const layer = ui.c.findLayer(layerId);
  if (!layer) return;
  walkLeaf(layer, leaf => {
    if (!isRadiusLeaf(leaf)) return;
    if (!authorRadius.has(leaf)) authorRadius.set(leaf, leaf.getRadius());
    leaf.setRadius(size);
  });
};

/** Commit the size field. Called from `bindLiveNumber`, which already clamps
 *  into the shared bounds. Only writes when the value moved — a color-picker
 *  style drag revisits every step, and each pass is a sweep over the tree. */
const commitSize = (ui: LayerUI, layerId: string, px: number): void => {
  if (getIntent(ui, layerId, INTENT.SIZE) === px) return;
  writeIntentKeys(ui, layerId, [[INTENT.SIZE, px]]);
  applySizeToLayer(ui, layerId);
};

/** Reset the layer's radius to what the author drew and drop the persisted
 *  entry. The authored value comes from the WeakMap, never from a re-read — a
 *  re-read would restore the user's own choice, and a layer that never wrote
 *  has nothing to restore anyway.
 *
 *  The provenance drop runs before the restore walk so a reload does not
 *  re-apply a radius the layer no longer shows, and it happens either way:
 *  the reset is the intent, not the write. */
const resetLayerSize = (ui: LayerUI, layerId: string): void => {
  if (!ui.c.layerRegistry.has(layerId)) return;
  resetIntentKeys(ui, layerId, [INTENT.SIZE]);
  const layer = ui.c.findLayer(layerId);
  if (!layer) return;
  walkLeaf(layer, leaf => {
    if (!isRadiusLeaf(leaf)) return;
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
  const leaf = findLeaf<RadiusLeaf>(layer, candidate =>
    isRadiusLeaf(candidate) ? candidate : undefined,
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
      dom.el("span", { class: "foliplus-form-unit" }, "px"),
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
    onCommit: px => commitSize(ui, layerId, px),
  });
};

export {
  applySizeToLayer,
  bindSizeRow,
  buildSizeRow,
  commitSize,
  layerCanSize,
  resetLayerSize,
};
