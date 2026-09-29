// styleBag — the shared write / snapshot contract for vector style dimensions
// (fill and border). One place owns the three invariants both faces need:
//
//   1. Write contract  — committing a value always lights that face's
//      visibility bit (`stroke: true` / `fill: true`). An author who
//      declared `stroke: false` / `fill: false` must not swallow the
//      user's style-panel write (quickstart Facility Points).
//   2. Snapshot contract — `captureStyleBag` records the author's FULL
//      style bag once per leaf (all six keys, including the false flags).
//      Reset replays that bag, so a forced-on bit goes back to the
//      author's own value instead of sticking.
//   3. Face scoping — fill and border each write / restore only their own
//      face keys, so one dimension's Reset never clobbers the other's
//      user value. The bag is whole; the faces are slices of it.
//
// A node with `setStyle` alone is not a carrier (L.GeoJSON owns one too),
// so walks below descend `eachLayer` first and treat a setter as a leaf.
import { throttleRaf } from "#common/throttle.js";

/** The author's full vector style bag. Every field is always populated on
 *  capture — nothing downstream can tell "the author declared nothing"
 *  apart from "the author's own value". */
type StyleBag = {
  color: string;
  weight: number;
  stroke: boolean;
  fillColor: string;
  fillOpacity: number;
  fill: boolean;
};

/** A node a style walk may reach. `setStyle` alone is not a leaf — groups
 *  (L.GeoJSON, L.FeatureGroup) own one too — so walks check `eachLayer`
 *  first. */
type StyleCarrier = L.Layer & {
  setStyle?: (style: Record<string, unknown>) => void;
  eachLayer?: (fn: (layer: L.Layer) => void) => void;
  options?: Partial<StyleBag>;
};

/** A leaf whose `setStyle` is there for real. The method must be invoked
 *  as a receiver method: Leaflet's `Path.setStyle` runs
 *  `setOptions(this, style)`. */
type StyleSetter = StyleCarrier & {
  setStyle: (style: Record<string, unknown>) => void;
};

/** Which visibility bit a style face owns. */
type StyleFace = "stroke" | "fill";

/** Leaflet Path defaults — folium's path_options fills most of these in,
 *  so the fallbacks only fire for a bare Leaflet layer. */
const STYLE_BAG_DEFAULTS: StyleBag = {
  color: "#3388ff",
  weight: 1,
  stroke: true,
  fillColor: "#3388ff",
  fillOpacity: 0.2,
  fill: true,
};

/** Author bags, keyed by leaf identity so a re-registration of the same
 *  layer id keeps its base. WeakMap so the entry disappears with the leaf. */
const authorStyleBase = new WeakMap<StyleCarrier, StyleBag>();

/** Whether the node owns a real `setStyle`. Accepts `unknown` so probes and
 *  pin can share one guard without a prior type assertion. */
const isStyleSetter = (node: unknown): node is StyleSetter =>
  node != null &&
  typeof (node as StyleCarrier).setStyle === "function" &&
  typeof node === "object";

/** Visit every leaf that exposes a runtime `setStyle`. Groups (LayerGroup,
 *  folium GeoJson) expose `setStyle` too, but they are walked down instead:
 *  mouseout fires on the leaf paths, and the authored bag is per leaf. */
const walkStyleLeaves = (node: StyleCarrier, fn: (leaf: StyleSetter) => void): void => {
  if (typeof node.eachLayer === "function") {
    node.eachLayer(child => walkStyleLeaves(child as StyleCarrier, fn));
    return;
  }
  if (isStyleSetter(node)) fn(node);
};

/** Capture the author's full style bag on the leaf's first style write.
 *  `setStyle` mutates `options` in place, so by reset time the bag is the
 *  only copy of the author's stroke / fill flags. */
const captureStyleBag = (node: StyleCarrier): StyleBag => {
  const existing = authorStyleBase.get(node);
  if (existing) return existing;
  const bag: StyleBag = {
    color: node.options?.color ?? STYLE_BAG_DEFAULTS.color,
    weight: node.options?.weight ?? STYLE_BAG_DEFAULTS.weight,
    stroke: node.options?.stroke ?? STYLE_BAG_DEFAULTS.stroke,
    fillColor: node.options?.fillColor ?? STYLE_BAG_DEFAULTS.fillColor,
    fillOpacity: node.options?.fillOpacity ?? STYLE_BAG_DEFAULTS.fillOpacity,
    fill: node.options?.fill ?? STYLE_BAG_DEFAULTS.fill,
  };
  authorStyleBase.set(node, bag);
  return bag;
};

/** The captured bag for a leaf, or undefined when the leaf was never
 *  written. Reset must not invent a style for an untouched leaf. */
const styleBagOf = (node: StyleCarrier): StyleBag | undefined =>
  authorStyleBase.get(node);

/** Build a write payload from the user's value keys, always lighting the
 *  face's visibility bit. Omit a value key to leave the author's default
 *  in force; the visibility bit is never omitted. */
const styleDimPayload = (
  values: Record<string, unknown>,
  face: StyleFace,
): Record<string, unknown> => {
  const payload: Record<string, unknown> = { [face]: true };
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) payload[key] = value;
  }
  return payload;
};

/** Write contract: commit the user's value keys to one leaf and light the
 *  face's visibility bit. Captures the author bag first so a later Reset
 *  can restore `stroke: false` / `fill: false`. */
const commitStyleDim = (
  node: StyleSetter,
  values: Record<string, unknown>,
  face: StyleFace,
): void => {
  captureStyleBag(node);
  node.setStyle(styleDimPayload(values, face));
};

/** The author's keys for one face, including that face's visibility flag. */
const faceSlice = (bag: StyleBag, face: StyleFace): Record<string, unknown> =>
  face === "stroke"
    ? { color: bag.color, weight: bag.weight, stroke: bag.stroke }
    : {
        fillColor: bag.fillColor,
        fillOpacity: bag.fillOpacity,
        fill: bag.fill,
      };

/** Restore one face from the captured bag. Writes only that face's keys so
 *  a border Reset never clobbers the user's fill (and vice versa). No-op
 *  for a leaf that was never written. */
const restoreStyleDim = (node: StyleSetter, face: StyleFace): void => {
  const bag = authorStyleBase.get(node);
  if (!bag) return;
  node.setStyle(faceSlice(bag, face));
};

// ── Shared apply scheduler (drag coalescing) ─────────────────────────────
//
// A style-panel drag fires an input event per step and each apply walk is a
// sweep over every leaf. Coalesce the walk to at most one per animation
// frame per (face, layerId); the intent write stays immediate so the frame
// that runs reads the latest value. `flush` on change / blur / panel close
// so the terminal value is never lost (throttleRaf is trailing). `cancel`
// on reset (a scheduled walk must not paint the user's value over the
// authored restore). `drop` on unregister so a churning map cannot
// accumulate boxes keyed by dead ids.

type ApplyBox = { run: () => void; raf: ReturnType<typeof throttleRaf> };
const applySchedulers = new Map<string, ApplyBox>();

const applyKey = (face: StyleFace, layerId: string): string => `${face}:${layerId}`;

/** Queue the apply walk for one face. Later calls in the same frame replace
 *  `run` and coalesce into the one pending frame — the walk always reads
 *  the latest intent. */
const scheduleStyleDimApply = (
  face: StyleFace,
  layerId: string,
  run: () => void,
): void => {
  const key = applyKey(face, layerId);
  let box = applySchedulers.get(key);
  if (!box) {
    const created: ApplyBox = { run, raf: undefined as never };
    created.raf = throttleRaf(() => created.run());
    box = created;
    applySchedulers.set(key, box);
  }
  box.run = run;
  box.raf();
};

/** Force a pending walk to run now. No-op when nothing is queued. */
const flushStyleDimApply = (face: StyleFace, layerId: string): void => {
  applySchedulers.get(applyKey(face, layerId))?.raf.flush();
};

/** Drop a pending walk without running it. Reset must not paint the user's
 *  value over the authored restore. */
const cancelStyleDimApply = (face: StyleFace, layerId: string): void => {
  applySchedulers.get(applyKey(face, layerId))?.raf.cancel();
};

/** Retire one face's scheduler entry (unregister / delete). Cancels any
 *  pending frame first so a queued walk cannot fire into a dead layer. */
const dropStyleDimApply = (face: StyleFace, layerId: string): void => {
  const key = applyKey(face, layerId);
  const box = applySchedulers.get(key);
  if (!box) return;
  box.raf.cancel();
  applySchedulers.delete(key);
};

/** Retire every face's scheduler entry for one layer id — the single
 *  unregister drop hook. Covers fill and border in one pass so the caller
 *  never holds two scattered teardowns. */
const dropStyleDimApplies = (layerId: string): void => {
  dropStyleDimApply("fill", layerId);
  dropStyleDimApply("stroke", layerId);
};

/** Flush every face's pending walk for one layer id — the panel-close
 *  commit boundary. Both faces must land: a dragged border left on a
 *  trailing frame would vanish when the panel disappears. */
const flushStyleDimApplies = (layerId: string): void => {
  flushStyleDimApply("fill", layerId);
  flushStyleDimApply("stroke", layerId);
};

/** Whether a scheduler entry is still held (tests pin the unregister drop). */
const hasStyleDimApply = (face: StyleFace, layerId: string): boolean =>
  applySchedulers.has(applyKey(face, layerId));

export {
  type StyleBag,
  type StyleCarrier,
  type StyleFace,
  type StyleSetter,
  STYLE_BAG_DEFAULTS,
  cancelStyleDimApply,
  captureStyleBag,
  commitStyleDim,
  dropStyleDimApply,
  dropStyleDimApplies,
  faceSlice,
  flushStyleDimApply,
  flushStyleDimApplies,
  hasStyleDimApply,
  isStyleSetter,
  restoreStyleDim,
  scheduleStyleDimApply,
  styleBagOf,
  styleDimPayload,
  walkStyleLeaves,
};
