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
import { createLogger } from "#common/log.js";
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
 *  `DIM`: callers pass `FACE.FILL` / `FACE.STROKE` / `FACE.SIZE` /
 *  `FACE.LABEL`, never a bare literal, so the string cannot drift from the
 *  type.
 *
 *  `FILL` and `STROKE` are `setStyle` faces and so are members of
 *  `StyleFace`; `SIZE` (a direct `setRadius` walk) and `LABEL` (a full label
 *  rebuild) are not. They live in this table because they ride the same
 *  frame coalescer (see `SchedulerFace`), and one vocabulary for "what the
 *  coalescer keys on" keeps callers off bare literals. */
const FACE = {
  FILL: "fill",
  STROKE: "stroke",
  SIZE: "size",
  LABEL: "label",
} as const;

/** Every face the coalescer keys on, derived from `FACE` so a new member
 *  there cannot be missed by the per-id sweeps further down — a face the
 *  queue accepts but they cannot drop or flush would leak a task after
 *  unregister and drop a trailing write on panel close. */
const FACE_FACES: readonly SchedulerFace[] = Object.values(FACE);

/** A frame-coalescing key face. Wider than `StyleFace` on purpose: the
 *  scheduler below is a plain "at most one trailing frame per
 *  (face, layerId)" queue that knows nothing about `setStyle`, so a walk
 *  that is not a styleBag slice can share it. `FACE.SIZE` is a direct
 *  `setRadius` walk rather than a `setStyle` face — without sharing the
 *  queue, a typing burst across the size field would write one radius per
 *  leaf per keystroke, and a bulk content change would walk per leaf.
 *  `FACE.LABEL` is the same shape at a larger scale: a label rebuild walks
 *  the whole tree and repaints every label canvas, so a streamed addData
 *  must pay it once per frame, not once per feature.
 *
 *  Derived from `FACE` rather than spelled out: adding a member to `FACE`
 *  is enough to add a face, and the type cannot drift from it. */
type SchedulerFace = (typeof FACE)[keyof typeof FACE];

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
// accumulate boxes keyed by dead ids, and `dropAll` on UI teardown (scoped
// to the UI that owns the boxes — see Ownership below).
//
// A box lives exactly as long as its frame is pending: the wrapper reclaims
// the entry before the run, and `cancel` reclaims it immediately, so a held
// entry always means "a frame is still owed" — never an executed callback's
// closure parked in the Map. Reclamation-before-run is also what makes a
// re-entrant schedule safe: a run() that schedules the same key again gets
// a fresh box for the NEXT frame instead of mutating the one executing.
//
// The wrapper is the scheduler's async error boundary. The operation that
// scheduled a walk (a panel write, or the terminal LAYER_ITEM_COUNT_CHANGE
// whose replay this carries) has already returned by the time a trailing
// frame runs, so a throw can no longer ride that operation's error
// contract — it is recorded (diagnostic log + the map's onError hook, the
// same channel notification failures use) instead of escaping the frame.
//
// Ownership: every box — and the failure reporter it reports through —
// belongs to the LayerUI (the control instance) that scheduled it. The
// queue is keyed by that owner and every production call site names its
// ui; a UI's teardown releases only its own boxes, so two LayerControls on
// one page cannot cancel each other's trailing write or route one map's
// failure into the other's onError. This is the same per-instance rule the
// dimension registry documents (BaseControl renders each control as a
// fresh IIFE today), but ownership does not depend on that bundling
// detail — a shared module must still partition by owner.

const log = createLogger("LayerControl");

/** Diagnostic pseudo-event for applies scheduled by a panel write — the
 *  failure reporter's event key when no real event sourced the schedule. */
const STYLE_APPLY_SOURCE = "foliplus:style:apply";

/** One scheduled-apply failure, as the reporter receives it. */
type StyleApplyFailure = {
  face: SchedulerFace;
  layerId: string;
  source: string;
  error: unknown;
};

/** The UI/control scope that owns a scheduled apply. Production passes the
 *  LayerUI instance; owner-less calls (unit tests) share the module scope
 *  below. */
type StyleApplyOwner = object;

/** How a scheduled walk is attributed: which operation scheduled it and
 *  which UI owns the trailing frame. A bare string keeps the pre-owner call
 *  shape ("custom source, global owner"). */
type StyleApplySchedule = {
  source?: string;
  owner?: StyleApplyOwner;
};

type ApplyBox = {
  run: () => void;
  face: SchedulerFace;
  layerId: string;
  source: string;
  raf: ReturnType<typeof throttleRaf>;
  owner: StyleApplyOwner;
};

/** Pending boxes, partitioned by the UI that scheduled them. Keyed by owner
 *  rather than one flat (face, id) map so a teardown is scoped: dropping
 *  this UI's frames must not cancel another map's same-id write. */
const applySchedulers = new Map<StyleApplyOwner, Map<string, ApplyBox>>();

/** Scope for owner-less calls — the unit-test facade, one UI per process. */
const GLOBAL_STYLE_OWNER: StyleApplyOwner = Object.freeze({});

/** Optional observer per owner — installed by each LayerUI constructor
 *  (wired to map.foliplus.onError) and released with that UI. */
const applyFailureReporters = new Map<
  StyleApplyOwner,
  (failure: StyleApplyFailure) => void
>();

/** The owner's box map, created on first schedule and dropped when empty. */
const boxesFor = (owner: StyleApplyOwner): Map<string, ApplyBox> => {
  let boxes = applySchedulers.get(owner);
  if (!boxes) {
    boxes = new Map();
    applySchedulers.set(owner, boxes);
  }
  return boxes;
};

/** The scopes a sweep addresses: one named owner, or every owner when the
 *  caller is the owner-less facade. */
const ownersToSweep = (owner?: StyleApplyOwner): StyleApplyOwner[] =>
  owner ? [owner] : [...applySchedulers.keys()];

/** Drop the owner entry once its last box is gone, so a torn-down UI leaves
 *  no scope behind. */
const compactOwner = (owner: StyleApplyOwner, boxes: Map<string, ApplyBox>): void => {
  if (boxes.size === 0) applySchedulers.delete(owner);
};

/** Install (or clear) the scheduled-apply failure observer for one owner.
 *  Owner-less installs target the global scope (tests). */
const setStyleApplyFailureReporter = (
  reporter: ((failure: StyleApplyFailure) => void) | null,
  owner: StyleApplyOwner = GLOBAL_STYLE_OWNER,
): void => {
  if (reporter) applyFailureReporters.set(owner, reporter);
  else applyFailureReporters.delete(owner);
};

const applyKey = (face: SchedulerFace, layerId: string): string => `${face}:${layerId}`;

/** Execute one box: reclaim the entry first, run inside the boundary
 *  second. The ordering is the whole contract — see the region header. The
 *  reporter is the box owner's, so a late failure reaches the map that
 *  scheduled it, never a neighbouring control's. */
const runBox = (
  owner: StyleApplyOwner,
  boxes: Map<string, ApplyBox>,
  key: string,
  box: ApplyBox,
): void => {
  boxes.delete(key);
  compactOwner(owner, boxes);
  try {
    box.run();
  } catch (error) {
    log.warn(
      `scheduled ${box.face} apply for "${box.layerId}" (${box.source}) failed — recorded, not raised:`,
      error,
    );
    try {
      applyFailureReporters.get(owner)?.({
        face: box.face,
        layerId: box.layerId,
        source: box.source,
        error,
      });
    } catch {
      // A broken diagnostic hook is worse than none.
    }
  }
};

/** Queue the apply walk for one face. Later calls in the same frame replace
 *  `run` and coalesce into the one pending frame — the walk always reads the
 *  latest intent. `source` names the operation that scheduled the walk and
 *  rides the box, so a failure on a late frame can still be attributed;
 *  `owner` names the UI whose teardown may reclaim it. */
const scheduleStyleDimApply = (
  face: SchedulerFace,
  layerId: string,
  run: () => void,
  schedule: string | StyleApplySchedule = {},
): void => {
  const opts: StyleApplySchedule =
    typeof schedule === "string" ? { source: schedule } : schedule;
  const owner = opts.owner ?? GLOBAL_STYLE_OWNER;
  const source = opts.source ?? STYLE_APPLY_SOURCE;
  const boxes = boxesFor(owner);
  const key = applyKey(face, layerId);
  let box = boxes.get(key);
  if (!box) {
    // Two-step init so the raf callback can close over the finished box:
    // `created.raf` is populated before throttleRaf's callback can run. The
    // single widening cast starts the object one field short; a double
    // assertion here would trip the narrow-cast guard (test/tsconfig).
    const created = { run, face, layerId, source, owner } as ApplyBox;
    created.raf = throttleRaf(() => runBox(owner, boxes, key, created));
    box = created;
    boxes.set(key, box);
  }
  box.run = run;
  box.source = source;
  box.raf();
};

/** Force a pending walk to run now — which also reclaims its entry. No-op
 *  when nothing is queued. An owner-less flush sweeps every scope (the test
 *  facade); production always names the UI that owns the frame. */
const flushStyleDimApply = (
  face: SchedulerFace,
  layerId: string,
  owner?: StyleApplyOwner,
): void => {
  const key = applyKey(face, layerId);
  for (const scope of ownersToSweep(owner)) {
    applySchedulers.get(scope)?.get(key)?.raf.flush();
  }
};

/** Drop a pending walk without running it, and reclaim its entry. Reset
 *  must not paint the user's value over the authored restore. */
const cancelStyleDimApply = (
  face: SchedulerFace,
  layerId: string,
  owner?: StyleApplyOwner,
): void => {
  const key = applyKey(face, layerId);
  for (const scope of ownersToSweep(owner)) {
    const boxes = applySchedulers.get(scope);
    const box = boxes?.get(key);
    if (!boxes || !box) continue;
    box.raf.cancel();
    boxes.delete(key);
    compactOwner(scope, boxes);
  }
};

/** Retire every face's scheduler entry for one layer id — the single
 *  unregister drop hook. Covers every face (fill / stroke / size / label) in
 *  one pass so the caller never holds scattered teardowns. */
const dropStyleDimApplies = (layerId: string, owner?: StyleApplyOwner): void => {
  for (const scope of ownersToSweep(owner)) {
    const boxes = applySchedulers.get(scope);
    if (!boxes) continue;
    for (const face of FACE_FACES) {
      const key = applyKey(face, layerId);
      const box = boxes.get(key);
      if (!box) continue;
      box.raf.cancel();
      boxes.delete(key);
    }
    compactOwner(scope, boxes);
  }
};

/** Flush every face's pending walk for one layer id — the panel-close
 *  commit boundary. Every face must land: a drag or a typing burst left on
 *  a trailing frame would vanish when the panel disappears. */
const flushStyleDimApplies = (layerId: string, owner?: StyleApplyOwner): void => {
  for (const face of FACE_FACES) {
    flushStyleDimApply(face, layerId, owner);
  }
};

/** Cancel and reclaim every pending box in one owner's scope — the UI
 *  teardown hook. A trailing frame must not outlive the UI whose schedule
 *  created it, and the scope must not take another UI's boxes with it. */
const dropAllStyleDimApplies = (owner: StyleApplyOwner = GLOBAL_STYLE_OWNER): void => {
  const boxes = applySchedulers.get(owner);
  if (!boxes) return;
  for (const box of boxes.values()) box.raf.cancel();
  applySchedulers.delete(owner);
};

/** Release everything one UI owns: pending frames cancelled and its failure
 *  reporter detached. Idempotent — the LayerUI calls it from its own
 *  teardown and the controller calls the same method before finalize. */
const releaseStyleApplyOwner = (owner: StyleApplyOwner): void => {
  dropAllStyleDimApplies(owner);
  applyFailureReporters.delete(owner);
};

/** Whether a scheduler entry is still held (tests pin the unregister drop).
 *  Owner-less reads answer across every scope — the test facade. */
const hasStyleDimApply = (
  face: SchedulerFace,
  layerId: string,
  owner?: StyleApplyOwner,
): boolean => {
  const key = applyKey(face, layerId);
  return owner
    ? (applySchedulers.get(owner)?.has(key) ?? false)
    : [...applySchedulers.values()].some(boxes => boxes.has(key));
};

export {
  type StyleCarrier,
  FACE,
  type SchedulerFace,
  type StyleApplyFailure,
  type StyleSetter,
  STYLE_APPLY_SOURCE,
  STYLE_BAG_DEFAULTS,
  cancelStyleDimApply,
  captureStyleBag,
  commitStyleDim,
  commitStyleDimMerged,
  dropAllStyleDimApplies,
  dropStyleDimApplies,
  faceSlice,
  flushStyleDimApply,
  flushStyleDimApplies,
  hasStyleDimApply,
  isStyleSetter,
  releaseStyleApplyOwner,
  restoreStyleDim,
  scheduleStyleDimApply,
  setStyleApplyFailureReporter,
  styleBagOf,
  styleBaseOf,
  styleDimOverAuthor,
  styleDimPayload,
  walkFillLeaves,
  walkStyleLeaves,
};
