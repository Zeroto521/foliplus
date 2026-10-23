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
import { isArealStyleLeaf } from "#core/layer/capability.js";
import { findLeaf, walkLeaf } from "#core/layer/walkLeaf.js";
import { throttleRaf } from "#common/throttle.js";
import type { LayerUI } from "../surface.js";

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

/** Which visibility bit a style face owns. `"fill"` and `"stroke"` are the
 *  Leaflet Path write faces — the option keys `setStyle` lights. Not the
 *  same vocabulary as `DIM` (that is dimension registry keys, where border
 *  is `"border"`): keep the two apart, one definition per vocabulary. */
type StyleFace = "fill" | "stroke";

/** The write faces, as a named vocabulary. Same convention as `INTENT` /
 *  `DIM`: callers pass `FACE.FILL` / `FACE.STROKE` / `FACE.SIZE`, never a
 *  bare literal, so the string cannot drift from the type.
 *
 *  `FILL` and `STROKE` are `setStyle` faces and so are members of
 *  `StyleFace`; `SIZE` is not — it is a direct `setRadius` walk. It lives in
 *  this table because it rides the same frame coalescer (see
 *  `SchedulerFace`), and one vocabulary for "what the coalescer keys on"
 *  keeps callers off bare literals. */
const FACE = {
  FILL: "fill",
  STROKE: "stroke",
  SIZE: "size",
} as const;

/** A frame-coalescing key face. Wider than `StyleFace` on purpose: the
 *  scheduler below is a plain "at most one trailing frame per
 *  (face, layerId)" queue that knows nothing about `setStyle`, so a walk
 *  that is not a styleBag slice can share it. `FACE.SIZE` is a direct
 *  `setRadius` walk rather than a `setStyle` face — without sharing the
 *  queue, a typing burst across the size field would write one radius per
 *  leaf per keystroke, and a bulk content change would walk per leaf. */
type SchedulerFace = StyleFace | "size";

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
 *  mouseout fires on the leaf paths, and the authored bag is per leaf.
 *  Recursion lives in `walkLeaf`; this helper is just the setStyle filter.
 *  It carries no geometry predicate, so it reaches line leaves too: callers
 *  that write a fill must use {@link walkFillLeaves} instead, or the carrier
 *  the capability probe answers for is not the carrier the write reaches. */
const walkStyleLeaves = (node: StyleCarrier, fn: (leaf: StyleSetter) => void): void => {
  walkLeaf(node, leaf => {
    if (isStyleSetter(leaf)) fn(leaf);
  });
};

/** Visit only the leaves that can carry a fill: a real `setStyle` plus an
 *  areal geometry. `isArealStyleLeaf` is the same predicate the capability
 *  probe walks, so a layer that answers "native" for fill reaches exactly the
 *  leaves this walk reaches.
 *
 *  Filtering on `setStyle` alone would admit line leaves. A fill commit to a
 *  Polyline is inert, its `fill` flag would drift from the author's, and its
 *  `feature` value would still enter a ramp's breaks and repaint every
 *  polygon in the group. */
const walkFillLeaves = (node: StyleCarrier, fn: (leaf: StyleSetter) => void): void => {
  walkLeaf(node, leaf => {
    if (isArealStyleLeaf(leaf)) fn(leaf as StyleSetter);
  });
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

/** The first leaf that matches `isMatch` — the row's initial value is read
 *  from it, so a swatch or a number field never shows a value the layer is not
 *  actually painting.
 *
 *  Groups are always descended, never returned. L.GeoJSON defines `setStyle`
 *  itself — it fans the style out to its features — so a setter-only check
 *  stops at the group and reads its own options, which hold only the style
 *  function: the panel then shows Leaflet's defaults instead of the author's
 *  paint, which is the paint the layer is actually rendering. */
const firstLeafWhere = (
  node: StyleCarrier,
  isMatch: (leaf: unknown) => boolean,
): StyleSetter | null =>
  findLeaf<StyleSetter>(node, leaf =>
    isStyleSetter(leaf) && isMatch(leaf) ? leaf : undefined,
  ) ?? null;

/** The first leaf that carries a real `setStyle` — the stroke row's carrier.
 *  Its predicate is the whole check: any `setStyle` is a stroke writer. */
const firstStyleLeaf = (node: StyleCarrier): StyleSetter | null =>
  firstLeafWhere(node, isStyleSetter);

/** The first leaf that can actually carry a fill — the same predicate the
 *  fill walk reaches, so the fill row reads the colour the layer paints.
 *  Reading the first `setStyle` leaf instead would hand a line-first mixed
 *  layer's line colour to the fill row: a line declares no fill, so its
 *  options are not the answer the polygon is answering for. */
const firstFillLeaf = (node: StyleCarrier): StyleSetter | null =>
  firstLeafWhere(node, isArealStyleLeaf);

/**
 * Coverage-write family reader — the single shared source for the "author's
 * declared style" of a vector layer, before any user write has mutated it.
 * Both faces walk the same shape - `findLayer` → that face's carrier → its
 * captured bag if any, else its live options, else the face's own default.
 * `bag ?? options ?? default` is the priority everywhere so the panel shows
 * the author's paint, not the last user drag that mutates `options` in place.
 *
 * The carriers deliberately differ: fill resolves the first areal leaf, stroke
 * the first setter, so a dimension never reads a value from a leaf its write
 * cannot reach - see `firstFillLeaf`.
 *
 * `fillOpacity` stays nullable: a layer that declares no fill opacity means
 * "the row shows what the layer is actually painting," which is
 * `VISIBLE_FILL_OPACITY` at the row layer, not `STYLE_BAG_DEFAULTS.fillOpacity`
 * (that constant is the bag's capture-time floor, not the display floor).
 *
 * Called through `ui.c.findLayer`, not `layerRegistry.get(id).layer` —
 * folium registers its layers before its map object is available, so the
 * registry's own reference can be stale for a just-attached control; the
 * controller's `findLayer` re-resolves against the live map. Same
 * late-binding defense used by `applyBorderToLayer` and
 * `FILL_DIMENSION.reset`.
 */
const styleBaseOf = (
  ui: LayerUI,
  layerId: string,
): {
  fillColor: string;
  fillOpacity: number | null;
  color: string;
  weight: number;
} => {
  const layer = ui.c.findLayer(layerId) as StyleCarrier | null;
  // Each face reads from the carrier its own write reaches - fill from the
  // first areal leaf, stroke from the first setter. One shared carrier made a
  // line-first mixed layer show the line's colour as its fill.
  const fillCarrier = layer ? firstFillLeaf(layer) : null;
  const strokeCarrier = layer ? firstStyleLeaf(layer) : null;
  const fillBag = fillCarrier ? styleBagOf(fillCarrier) : undefined;
  const strokeBag = strokeCarrier ? styleBagOf(strokeCarrier) : undefined;
  const fillOpts = (fillCarrier?.options ?? {}) as Partial<StyleBag>;
  const strokeOpts = (strokeCarrier?.options ?? {}) as Partial<StyleBag>;
  return {
    fillColor: fillBag?.fillColor ?? fillOpts.fillColor ?? STYLE_BAG_DEFAULTS.fillColor,
    fillOpacity: fillBag?.fillOpacity ?? fillOpts.fillOpacity ?? null,
    color: strokeBag?.color ?? strokeOpts.color ?? STYLE_BAG_DEFAULTS.color,
    weight: strokeBag?.weight ?? strokeOpts.weight ?? STYLE_BAG_DEFAULTS.weight,
  };
};

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
  face === FACE.STROKE
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

/** The author's keys for one face with the caller's value keys on top, the
 *  visibility bit set to `lightFace` - the record the restore-then-commit
 *  pair would have written in two `setStyle` calls, in one.
 *
 *  A key the caller does not name keeps the author's own value, so an
 *  opacity-only commit keeps the author's colour and a colour-only commit
 *  keeps the author's opacity. `undefined` values never override. The
 *  visibility bit always lands explicitly: `true` when the caller claims the
 *  face, the author's own flag when it does not. Re-reads the captured bag
 *  rather than taking it, so a highlight pin can re-derive the same answer
 *  folium's `resetStyle` just undid. */
const styleDimOverAuthor = (
  node: StyleSetter,
  values: Record<string, unknown>,
  face: StyleFace,
  lightFace: boolean,
): Record<string, unknown> => {
  const style: Record<string, unknown> = {
    ...faceSlice(captureStyleBag(node), face),
  };
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) style[key] = value;
  }
  if (lightFace) style[face] = true;
  return style;
};

/** Write the merged record: one `setStyle` per leaf instead of a restore
 *  followed by a commit. The walk is one either way; doubling the writes
 *  doubles the DOM and SVG attribute work on top of it. */
const commitStyleDimMerged = (
  node: StyleSetter,
  values: Record<string, unknown>,
  face: StyleFace,
  lightFace: boolean,
): void => {
  node.setStyle(styleDimOverAuthor(node, values, face, lightFace));
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

const applyKey = (face: SchedulerFace, layerId: string): string => `${face}:${layerId}`;

/** Queue the apply walk for one face. Later calls in the same frame replace
 *  `run` and coalesce into the one pending frame — the walk always reads
 *  the latest intent. */
const scheduleStyleDimApply = (
  face: SchedulerFace,
  layerId: string,
  run: () => void,
): void => {
  const key = applyKey(face, layerId);
  let box = applySchedulers.get(key);
  if (!box) {
    // Two-step init so the raf callback can read `created.run` (the box
    // entry) without a double assertion: the box exists before throttleRaf
    // closes over it.
    const created = { run, raf: throttleRaf(() => created.run()) };
    box = created;
    applySchedulers.set(key, box);
  }
  box.run = run;
  box.raf();
};

/** Force a pending walk to run now. No-op when nothing is queued. */
const flushStyleDimApply = (face: SchedulerFace, layerId: string): void => {
  applySchedulers.get(applyKey(face, layerId))?.raf.flush();
};

/** Drop a pending walk without running it. Reset must not paint the user's
 *  value over the authored restore. */
const cancelStyleDimApply = (face: SchedulerFace, layerId: string): void => {
  applySchedulers.get(applyKey(face, layerId))?.raf.cancel();
};

/** Retire every face's scheduler entry for one layer id — the single
 *  unregister drop hook. Covers all three faces in one pass so the caller
 *  never holds scattered teardowns. */
const dropStyleDimApplies = (layerId: string): void => {
  for (const face of [FACE.FILL, FACE.STROKE, FACE.SIZE]) {
    const key = applyKey(face, layerId);
    const box = applySchedulers.get(key);
    if (!box) continue;
    box.raf.cancel();
    applySchedulers.delete(key);
  }
};

/** Flush every face's pending walk for one layer id — the panel-close
 *  commit boundary. Every face must land: a drag or a typing burst left on
 *  a trailing frame would vanish when the panel disappears. */
const flushStyleDimApplies = (layerId: string): void => {
  for (const face of [FACE.FILL, FACE.STROKE, FACE.SIZE]) {
    flushStyleDimApply(face, layerId);
  }
};

/** Whether a scheduler entry is still held (tests pin the unregister drop). */
const hasStyleDimApply = (face: SchedulerFace, layerId: string): boolean =>
  applySchedulers.has(applyKey(face, layerId));

export {
  type StyleCarrier,
  FACE,
  type StyleSetter,
  STYLE_BAG_DEFAULTS,
  cancelStyleDimApply,
  captureStyleBag,
  commitStyleDim,
  commitStyleDimMerged,
  dropStyleDimApplies,
  faceSlice,
  flushStyleDimApply,
  flushStyleDimApplies,
  hasStyleDimApply,
  isStyleSetter,
  restoreStyleDim,
  scheduleStyleDimApply,
  styleBagOf,
  styleBaseOf,
  styleDimOverAuthor,
  styleDimPayload,
  walkFillLeaves,
  walkStyleLeaves,
};
