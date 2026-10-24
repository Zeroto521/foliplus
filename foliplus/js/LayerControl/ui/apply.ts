// LayerControl UI — diff-driven projection executor.
//
// `applyProjection(ui, id)` reads the layer's projection from
// `projection.ts`, diffs it against the last projection it wrote to the map
// `runtimeStore.getApplied(id)`), and calls `dispatchStateOp` only for the dimensions
// that actually moved. The old model — a sweep that re-read the whole
// registry per layer, walked `intents.visible` / `intents.opacity` / `intents.zoomRange`
// by id, and picked per-dimension helpers — is what made the three
// regressions structurally reachable:
//
//   - late-registration replay: the sweep only ran on `applyUserState`
//     entry; a layer whose stored dimensions arrived after its own
//     registration were only picked up by the id-specified drain, so a
//     missed sweep silently meant a lost opacity / zoom range.
//   - scrambled row lookup: row lookups inside the sweep keyed off
//     positional indices, which the stored-order replay could shift.
//   - a zoom sweep writing over intent (#329): a policy sweep could reach
//     `applyLayerState({visible})` on a stored intent it had not compared
//     against, and — if the row-paint rode the same path — repainted a
//     checkbox the user never touched.
//
// With one writer that diffs against its own last write, the "did we
// already have this" step is structural, not something each caller
// remembers to do.
//
// Naming: "state op" is the shape the carrier dispatcher accepts.
// "Projection" is what the diff compares — intent + policy together, so
// a change on either side produces an op.
import {
  type DispatchFailure,
  EVENTS,
  type SettledOperation,
} from "#core/event/index.js";
import { CAP_TIER, HIDDEN, PANE_ROLE } from "#core/layer/index.js";
import { getLayerAlpha, setLayerAlpha } from "#common/canvasAlpha.js";
import * as CONST from "../const.js";
import { INTENT, getIntent } from "./intent.js";
import { intentVisibleOf, projectLayer } from "./projection.js";
import type { LayerUI } from "./surface.js";

/** One write the carrier dispatcher accepts. `opacity` being
 *  `undefined` means "no user value" — a Reset back to the author's
 *  default — not "leave the carrier alone".
 *
 *  No `zoomRange` variant: zoomRange is carried by the `visible` op
 *  (`effectiveShown` change triggers map-membership diff). Writing
 *  `options.minZoom/maxZoom` would clamp GridLayer to the range rather
 *  than hide it, and only GridLayer honors those options — Path/GeoJSON/
 *  Marker silently ignore them. Two write sources for "why is this
 *  invisible" breaks the intent-only invariant. */
type StateOp =
  { type: "visible"; value: boolean } | { type: "opacity"; value: number | undefined };

/** Lazy-cached per-layer read for the multiplier-write family: freeze an
 *  author-declared value on first access, never re-read.
 *
 *  Shared by `authorOpacityBaseOf` and `authorZoomBoundsOf` below. Both
 *  freeze on first write and never re-read (the slider is a multiplier /
 *  bounds overlay on the author's declared value), but their read closures
 *  differ — opacity reads `options.opacity` and defaults to 1, while zoom
 *  bounds also folds in `map.getMinZoom/MaxZoom` and cannot collapse to a
 *  single constant fallback. What they share is the lazy-capture skeleton
 *  itself: one `WeakMap<L.Layer, T>` container, one key (`layer`), one
 *  closure (`read`). Keeping the skeleton in one place makes the two
 *  readers' cache discipline identical, so a new multiplier family adds a
 *  cache + closure, not another copy of the fetch-or-compute dance.
 *
 *  Uses `!== undefined` (not truthy) for the cache-hit test so a valid
 *  zero-valued opacity base is returned, not re-read. A null/undefined
 *  layer (a layer that hasn't materialized yet) writes no cache entry,
 *  so a later call with a live layer starts fresh. */
const memoizeLayer = <T>(
  cache: WeakMap<L.Layer, T>,
  layer: L.Layer | null | undefined,
  read: () => T,
): T => {
  const hit = layer ? cache.get(layer) : undefined;
  if (hit !== undefined) return hit;
  const value = read();
  if (layer) cache.set(layer, value);
  return value;
};

/** Cache the layer's original `options.opacity` so repeated slider drags
 *  don't compound. The base is captured on first write and never re-read;
 *  the slider value is a multiplier over the author's declared default. */
const authorOpacityBase = new WeakMap<L.Layer, number>();

const authorOpacityBaseOf = (layer: L.Layer): number =>
  memoizeLayer(authorOpacityBase, layer, () => {
    // A Leaflet layer always has `options` — PaneManager already walks
    // `options.pane` for every layer before we get here.
    const opts = layer.options as L.LayerOptions & { opacity?: number };
    return typeof opts.opacity === "number" ? opts.opacity : 1;
  });

/** The layer's own author-declared min/max, frozen on first access.
 *
 *  #709 deleted the `zoomRange` state op, so nothing in foliplus writes
 *  `layer.options.minZoom/maxZoom` anymore — the slider commits to the
 *  intent store instead. The freeze survives for persistence-replay safety:
 *  on reload the state replay fires before the panel opens, so a snapshot at
 *  first read sees the pre-replay map state, not a drifted live re-read.
 *
 *  `layer.options.minZoom/maxZoom` fall back to the map's declared values
 *  when the layer declares none — a TileLayer without `options.maxZoom`
 *  means "whatever the map allows", not "Infinity". `map.getMaxZoom()`
 *  returns `Infinity` for a map without a declared max, so that path gets
 *  its own finite fallback: `CONST.AUTHOR_ZOOM_FALLBACK_MAX`. This is a
 *  display-only guard — the values row must not print the literal string
 *  "Infinity" — and is decoupled from the map's actual zoom ceiling, which
 *  Leaflet now derives on its own from layers actually on the map. */
const authorZoomBounds = new WeakMap<L.Layer, [number, number]>();

const finiteOr = (v: number | undefined, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

/** Snapshot the layer's declared zoom bounds on first access. Callers must
 *  call this before any write to `options.minZoom/maxZoom`, so the value
 *  is the author's declaration and not our own previous write. */
const authorZoomBoundsOf = (
  ui: LayerUI,
  layer: L.Layer | null | undefined,
): [number, number] =>
  memoizeLayer(authorZoomBounds, layer, () => {
    const opts = (layer?.options ?? {}) as L.LayerOptions & {
      minZoom?: number;
      maxZoom?: number;
    };
    const mapMin = finiteOr(ui.c.map.getMinZoom(), 0);
    const mapMax = finiteOr(ui.c.map.getMaxZoom(), CONST.AUTHOR_ZOOM_FALLBACK_MAX);
    return [finiteOr(opts.minZoom, mapMin), finiteOr(opts.maxZoom, mapMax)];
  });

/** Same lookup keyed by layer id — the panel code has only the id in hand. */
const authorZoomBoundsForLayer = (ui: LayerUI, layerId: string): [number, number] =>
  authorZoomBoundsOf(ui, ui.c.layerRegistry.get(layerId)?.layer);

/** The redraw arm does not clear CSS opacity on the write itself: the drawer
 *  that owns the face reads layerAlpha off the canvas and repaints there,
 *  then drops the CSS so the two carriers never compound. Because a full
 *  repaint can be expensive (see the R11 measurement note in the redraw
 *  arm), a continuous slider drag must not repaint on every input.
 *
 *  So: coalesce repaints with a short debounce. Each new commit within
 *  the window replaces the pending one, so a drag produces many O(1)
 *  CSS writes but a repaint only after the user pauses. Debounce is
 *  chosen over rAF because rAF still fires every frame during a drag
 *  and a 5k-cell heatmap takes 30-320ms to repaint — repainting per
 *  frame would drop frames. Debouncing past a couple of frames keeps
 *  the drag frame-rate clean; the 60ms window is ~3 frames at 60fps,
 *  invisible to the eye but enough to settle a drag. At repaint time
 *  the drawer reads the latest layerAlpha off its canvas (see the
 *  redraw arm and HeatmapManager.redrawHeatmap), so the pixel state
 *  converges to the slider's terminal position — no more waiting
 *  for pan/zoom. */
const OPACITY_REPAINT_DEBOUNCE_MS = 60;
const pendingRedraws = new WeakMap<LayerInfo, number>();
const scheduleOpacityRedraw = (
  layerInfo: LayerInfo,
  mode: "debounce" | "none" = "none",
): void => {
  if (mode === "none") return;
  const prev = pendingRedraws.get(layerInfo);
  if (prev !== undefined) clearTimeout(prev);
  pendingRedraws.set(
    layerInfo,
    setTimeout(() => {
      pendingRedraws.delete(layerInfo);
      layerInfo.onOpacity?.(getLayerAlpha(layerInfo.canvas));
    }, OPACITY_REPAINT_DEBOUNCE_MS),
  );
};

/** Carrier identity the executor's last write landed on.
 *
 *  The projection's numeric diff is not enough for carriers that can be
 *  replaced underneath the executor: a re-registered canvas element starts
 *  opaque, so the executor's `prev.opacity` can match `next.opacity` while
 *  the DOM in front of it is fresh. The fix is to record which DOM element
 *  we last wrote to, and force a rewrite when the carrier has moved.
 *
 *  The token is opaque to callers: it's just enough identity to say "the
 *  thing I wrote to before is not the thing in front of me now". A
 *  canvas-only layer is one DOM element; a pane carrier is the surface's
 *  own pane set — which, since the label pane is a declared `role:
 *  "annotation"` PaneSpec, already includes it with no side channel (the
 *  pane exists from surface construction, so there is no late carrier to
 *  splice in). Anything else (native `options.opacity`) is keyed by the
 *  layer's own `options` object, which is the actual write target.
 */
const carrierOf = (ui: LayerUI, layerInfo: LayerInfo): unknown => {
  if (layerInfo.canvas) return layerInfo.canvas;
  const surface = ui.c.surfaceFor(layerInfo);
  if (surface.capabilities.opacity === CAP_TIER.PANE) {
    // A stable key, not an array: `sameCarrier` compares with `===`, so a
    // freshly built array would never match and every pane layer would
    // rewrite on every call. Sorted, so the order the pane specs happen to
    // arrive in cannot register as "the carrier moved".
    return [...surface.paneNames].sort().join("|");
  }
  return (layerInfo.layer?.options ?? null) as object | null;
};

/** Whether the executor's last write reached the same carrier as the one
 *  in front of it now. `undefined` at the call site means "no record yet"
 *  — first write always goes through, so the answer is trivially false. */
const sameCarrier = (prev: unknown, curr: unknown): boolean =>
  prev !== undefined && prev === curr;

/** The single write pipeline: dispatch one op onto its carrier.
 *
 *  Every layer resolves to exactly one write target per dimension (see
 *  `LayerSurface.capabilities.*`):
 *
 *    visible  — map membership ("native") for real L.Layers including
 *               MarkerCluster, canvas HIDDEN class ("pane") for canvas-only
 *               surfaces (heatmap / measure / color face), "none" is a
 *               no-op — no honest write exists, the UI hides the checkbox.
 *    opacity  — canvas element / own pane / native setter / "none"
 *    zoomRange — resolved through the `visible` op for all carriers.
 *               Writing `options.minZoom/maxZoom` would pollute
 *               `map.getMaxZoom()` (Leaflet derives map zoom from
 *               layer options), locking the map's +/- controls.
 *
 *  The "none" carrier check is the rule that a slider that writes
 *  nothing must not persist — when the surface declares "none" we skip
 *  the write instead of faking one on a shared carrier.
 *
 *  Return value: whether a real state write landed on the carrier. The
 *  caller (`applyProjection`) gates `LAYER_CHANGE` on this through the
 *  projection delta, so a write that could not land (no layer object, no canvas
 *  element, value already matching the carrier) never manufactures a
 *  change notification. `LAYER_CHANGE` is the semantic replacement for
 *  Leaflet's native `layeradd`/`layerremove` — canvas-only surfaces
 *  have no native counterpart, so the executor's write is what puts
 *  them on the bus alongside native layers.
 */
const dispatchStateOp = (
  ui: LayerUI,
  layerInfo: LayerInfo,
  op: StateOp,
  repaintMode: "debounce" | "none" = "none",
): boolean => {
  if (op.type === "visible") {
    const carrier = ui.c.surfaceFor(layerInfo).capabilities.visibility;
    if (carrier === CAP_TIER.NATIVE) {
      const layer = layerInfo.layer ?? ui.c.findLayer(layerInfo);
      if (layer) {
        // Map membership. Written only when it differs from what is there —
        // `addLayer` on a live layer is a no-op at best and re-orders the
        // stacking at worst, so both halves collapse to one condition.
        const has = ui.c.map.hasLayer(layer);
        if (op.value !== has) {
          if (op.value) ui.c.map.addLayer(layer);
          else ui.c.map.removeLayer(layer);
          return true;
        }
      }
    } else if (carrier === CAP_TIER.PANE) {
      // Canvas HIDDEN class — the carrier for canvas-only surfaces that have
      // no Leaflet layer to add/remove. The class flip is the write; only a
      // flip counts as one (a no-op toggle is not a change), which matches
      // the NATIVE branch's "only write when the value differs" rule.
      const canvas = layerInfo.canvas;
      if (canvas) {
        const wasHidden = canvas.classList.contains(HIDDEN);
        canvas.classList.toggle(HIDDEN, !op.value);
        return wasHidden === op.value;
      }
    }
    // "none" — no honest write exists; the UI hides the checkbox rather
    // than offering one that lies.
    return false;
  }
  if (op.type === "opacity") {
    if (layerInfo.canvas) {
      // R11: layer alpha for self-drawn canvases. Two arms, one helper
      // (`#common/canvasAlpha`), switched by `opacityBake`:
      //
      //   "commit"  — bake layerAlpha and redraw on the slider commit.
      //               Cheap for a one-rect color face or a label pass.
      //   "redraw"  — slider commit keeps CSS `opacity` (O(1), live
      //               feedback); the next pan/zoom redraw bakes and drops
      //               the CSS. Default. Heatmap ≥5k takes this arm because
      //               a full hexagon redraw per commit is jank (measured
      //               8ms warm / 30-320ms under load on a stub ctx @5k —
      //               over a 16ms frame; real rasterization is slower).
      //
      // `capabilities.opacity` still reports `"pane"` — the write target is
      // the canvas face. The bake-vs-CSS mechanism tier ("baked"/"redraw")
      // is owned by T222; `"pane"` stays the honest "we own this face"
      // answer and this comment is what stops it from lying.
      const value = op.value ?? 1;
      // Registry fills `opacityBake` (default "redraw"); treat unset as
      // "redraw" via the else arm so there is no second default to drift.
      const bake = layerInfo.opacityBake;
      setLayerAlpha(layerInfo.canvas, value);
      if (bake === "commit") {
        layerInfo.canvas.style.opacity = "";
        layerInfo.onOpacity?.(value);
      } else {
        // Live CSS arm: the value lands on the canvas face as CSS opacity
        // (O(1) per drag event). We do NOT defer the bake to the next
        // pan/zoom — that would leave canvas pixels showing a stale
        // alpha × the new CSS opacity, i.e. a compounded wrong value,
        // and the drag wouldn't self-correct until the user happened to
        // move the map. Instead we coalesce repaints via a short
        // debounce (see scheduleOpacityRedraw), so a continuous drag
        // runs many CSS writes but repaints only after the user pauses.
        // At repaint time the drawer reads the latest layerAlpha off its
        // canvas and repaints, then clears the CSS so the two never
        // compound.
        layerInfo.canvas.style.opacity = String(value);
        scheduleOpacityRedraw(layerInfo, repaintMode);
      }
      layerInfo.opacity = value;
      return false;
    }
    const carrier = ui.c.surfaceFor(layerInfo).capabilities.opacity;
    if (carrier === CAP_TIER.NONE) return false; // no honest write exists
    // Snapshot-then-resolve: registry reference wins when populated, the
    // controller's findLayer re-resolves against the live map for a folium
    // layer whose registry reference is still null. Same late-binding
    // defense as the visible-write path above.
    const layer = layerInfo.layer ?? ui.c.findLayer(layerInfo);
    if (!layer) return false;
    if (carrier === CAP_TIER.NATIVE) {
      // The layer paints through a setter of its own. `setOpacity`
      // (ImageOverlay) is immediate; `options.opacity` (GridLayer /
      // TileLayer) is honored at the next tile cycle. The slider is a
      // multiplier over the author's declared default, so the base is
      // captured once.
      const opts = layer.options as L.LayerOptions & { opacity?: number };
      const base = authorOpacityBaseOf(layer);
      const target = base * (op.value ?? 1);
      if (typeof (layer as L.ImageOverlay).setOpacity === "function") {
        (layer as L.ImageOverlay).setOpacity(target);
      } else {
        opts.opacity = target;
      }
      layerInfo.opacity = op.value ?? 1;
    } else {
      // One CSS write per pane the surface owns — declared, sub, or
      // synthesized. Multiplicative over each feature's own style, so a
      // hollow polygon keeps its hole.
      //
      // The `role: "annotation"` label pane is deliberately excluded: its
      // canvas bakes layerAlpha into the label draws (R11). Writing CSS
      // here as well would double-compound. Mixed layers therefore take
      // CSS on the vector data panes and bake on the label canvas — both
      // sides land at the same visual opacity.
      const value = op.value ?? 1;
      const surface = ui.c.surfaceFor(layerInfo);
      for (const pane of surface.panes) {
        if (pane.role === PANE_ROLE.ANNOTATION) continue;
        const el = ui.c.map.getPane(pane.name);
        if (el) el.style.opacity = String(value);
      }
      ui.c.annotation.applyLayerAlpha(layerInfo.id, value);
      layerInfo.opacity = value;
    }
    return false;
  }
  // `StateOp` is closed, so reaching this line means a new variant was added
  // to the union without extending this dispatcher. Throwing — rather than
  // returning a silent `false` — is what a maintainer wants in that case:
  // the missing branch is loud, not lost.
  const exhaustive: never = op;
  throw ui.log.msg(`unreachable dispatchStateOp type: ${JSON.stringify(exhaustive)}`);
};

/** What one projection pass actually moved. The operation that ran the
 *  pass owns the bus notification and emits on this — not on the pass
 *  itself (see the contract note on `applyProjection` below). */
type ProjectionDelta = {
  wroteVisible: boolean;
  intentMoved: boolean;
};

const NO_DELTA: ProjectionDelta = { wroteVisible: false, intentMoved: false };

/** One layer's share of a round. Callers that build a round incrementally
 *  (focus, bulk toggle) collect these; `ProjectionBatch` is the read-only view
 *  they hand to `notifyDeltas`. */
type ProjectionDeltaItem = {
  id: string;
  delta: ProjectionDelta;
  entry: LayerInfo;
};

/** The layers a pass moved, paired with what each one moved — the work a caller
 *  queues until its own side effects have settled, then publishes as one round
 *  through `notifyDeltas`. Every projection entry point returns one of these,
 *  including the single-id one: an id that did not move contributes an empty
 *  delta, an id with no entry contributes nothing at all. One shape means one
 *  handling path, and no caller has to ask which of three return values it
 *  got.
 *
 *  Each item stamps the registry entry the delta was computed against, because
 *  a delta belongs to the instance that produced it: a subscriber that retires
 *  the entry during an earlier delivery of the same round skips it at delivery
 *  time, and a lookup by id alone would happily deliver the retired layer's
 *  delta to the replacement now holding that id. Read-only — a caller hands the
 *  round off, it does not trim it. */
type ProjectionBatch = ReadonlyArray<ProjectionDeltaItem>;

/** Diff one entry's current projection against the last one we wrote, and call
 *  `dispatchStateOp` only for the dimensions that moved.
 *
 *  Takes the entry rather than its id so a delta and the entry it was computed
 *  against can never disagree: a sweep stamps its round with the entries it
 *  snapshotted, and a lookup by id inside this pass could resolve a different
 *  instance by the time the round is delivered.
 *
 *  Ordering: `visible (effective)` and `opacity` are independent of each
 *  other, so they apply in either order. The zoomRange dimension itself is
 *  *not* dispatched here — it resolves through the `visible` op (the
 *  projection's `effectiveShown` already folds in the current range), so a
 *  zoomRange change flows through as a map-membership diff on
 *  `effectiveShown`, not as its own state op.
 *
 *  `ui.runtimeStore.setApplied` records what was written so the next call is a
 *  diff, not a full write. The map is keyed by id (not by `layerInfo`
 *  identity) so a re-registration of the same id keeps its projection
 *  across the swap.
 *
 *  This is the invariant the executor is built around: the only field that
 *  writes map membership is `effectiveShown`, and `effectiveShown = intent
 *  && policy` — a derived dimension (focus, zoom range) can only pull a
 *  layer off the map, never push one onto it. That is why this executor is
 *  the only write path for map membership and why `intent.visible` is no
 *  longer diffed separately: any change that would authorize an add goes
 *  through `intent`, so the effective value already reflects the user's
 *  authorization. The one-way gate is now the shape of this diff.
 *
 *  This pass never emits. It returns a `ProjectionDelta` and its caller —
 *  the operation layer that owns the user action — announces through
 *  `notifyDelta` / `notifyDeltas` once every side effect of that operation has
 *  landed (row paint, tri-state count, basemap hatch, attribution). A notify fired
 *  mid-operation would hand a subscriber a partially-updated UI: a
 *  re-entrant subscriber re-projects against a stale row, a group count
 *  delta is computed from pre-update state, and a subscriber that throws
 *  or tears the map down leaves the operation's own paint behind.
 */
const projectEntry = (
  ui: LayerUI,
  layerInfo: LayerInfo,
  repaintMode: "debounce" | "none" = "none",
): ProjectionDelta => {
  const id = layerInfo.id;
  // A surface is mandatory for a write target (see `carrierOf` / `dispatchStateOp`
  // below) — the same defensive gate `hideOtherLayers` carries against a
  // missing surface. A layer whose surface could not be built (a late-
  // registered entry the ordering pass hasn't stamped yet, or a test
  // fixture that returns `null`) has nothing to write to, so skip it.
  if (!ui.c.surfaceFor(layerInfo)) return NO_DELTA;
  const next = projectLayer(ui, layerInfo);
  let prev = ui.runtimeStore.getApplied(id);

  // Whether this call is the first projection for this id. Recorded from the
  // pre-init state of `prev`, because `applyProjection` seeds a baseline
  // projection into `runtimeStore` on its first run — subsequent calls then
  // diff against that baseline (see below).
  const isFirstPass = !prev;

  if (!prev) {
    // First pass — the baseline is what the map currently shows, not the
    // author's declared default. A layer that hasn't been added to the map
    // yet (a test fixture that constructs the manager without adding layers,
    // or a late-registered layer whose author default is visible) would
    // otherwise diff against `visible: true` and miss the add. The fix
    // is that this baseline is read from the live map state, so a late
    // registration still has its stored state applied on the first call.
    // Canvas-only layers have no Leaflet layer, so the author's default is
    // the ground truth — `hasLayer` would always return false and mask a
    // real visible → hidden transition.
    // Late-binding fallback via manager.findLayer — the single resolve point
    // (folium may emit the TileLayer var after this control's IIFE).
    const layer = layerInfo.layer ?? ui.c.findLayer(layerInfo);
    const baselineVisible = layer ? ui.c.map.hasLayer(layer) : intentVisibleOf(ui, id);
    prev = {
      id,
      intent: { visible: baselineVisible },
      effectiveShown: baselineVisible,
      opacity: undefined,
      carrier: null,
    };
  }

  // Carrier identity for this write. A changed carrier forces a rewrite
  // even when the numeric value is unchanged — a re-registered canvas
  // element or a lazily-appearing annotation pane needs the stored
  // opacity applied to the new DOM, not to whatever the last write hit.
  const carrierToken = carrierOf(ui, layerInfo);

  // 1. Effective-shown — the composite `intent && policy`. Diffed against
  //    what the map actually holds, not against the last value we remember
  //    writing. Folium emits a layer's JS global after this control's IIFE
  //    and (depending on version) may or may not have put a `show=False`
  //    layer on the map, so "what we last wrote" and "what is on the map"
  //    can disagree through no write of ours. Reading the map back makes the
  //    executor converge on `effectiveShown` no matter who moved the layer in
  //    between — and it is what keeps a write that could not land (no layer
  //    object yet) from being recorded as done. The invariant lives
  //    here: nothing authorizes an add unless `intent` does, so a derived
  //    dimension can only remove, never restore on its own.
  const layer = layerInfo.layer ?? ui.c.findLayer(layerInfo);
  // Whether anything authorizes a map write at all. Only the user's
  // own choice or an *observed* author snapshot decides membership. A layer
  // whose author default has not been observed yet (its JS global is not
  // linked) and that the user never touched is not this executor's to
  // decide — writing `effectiveShown` for it would turn a guess into an add.
  const hasUserIntent =
    ui.intentStore.isUserSet(id, INTENT.VISIBLE) ||
    typeof getIntent(ui, id, INTENT.VISIBLE) === "boolean";
  const authorised = hasUserIntent || ui.runtimeStore.hasAuthorVisible(id);
  // Current visibility, read from the carrier the write would land on.
  // "native" — the map's own membership flag; "pane" — the canvas's
  // HIDDEN class; "none" — no carrier at all, so no meaningful "shown".
  // Reading the carrier (not the last value we wrote) makes the executor
  // converge on `effectiveShown` no matter who moved the layer in between.
  const visibility = ui.c.surfaceFor(layerInfo).capabilities.visibility;
  const currentShown =
    visibility === CAP_TIER.NATIVE
      ? layer
        ? ui.c.map.hasLayer(layer)
        : false
      : visibility === CAP_TIER.PANE
        ? layerInfo.canvas
          ? !layerInfo.canvas.classList.contains(HIDDEN)
          : false
        : false;
  // 1. Effective-shown — the composite `intent && policy`. Written only
  //    when the value actually differs from what is on the carrier.
  //    `dispatchStateOp` returns whether a real write landed; we keep
  //    that answer on `wroteVisible` because it is what gates the
  //    `LAYER_CHANGE` bus notification the caller emits on this delta —
  //    a late-bound layer reference whose `findLayer` still returns null
  //    must not manufacture a change event nobody can observe.
  let wroteVisible = false;
  if (authorised && currentShown !== next.effectiveShown) {
    wroteVisible = dispatchStateOp(
      ui,
      layerInfo,
      { type: "visible", value: next.effectiveShown },
      repaintMode,
    );
  }

  // 2. Opacity — independent of zoom/focus. Rewritten whenever the carrier
  //    has moved, not just when the value has.
  if (prev.opacity !== next.opacity || !sameCarrier(prev.carrier, carrierToken)) {
    dispatchStateOp(
      ui,
      layerInfo,
      { type: "opacity", value: next.opacity },
      repaintMode,
    );
  }

  // 3. Intent — diff against the *last applied intent*, not the map state.
  //    `LAYER_CHANGE` rides `effectiveShown = intent && policy`, so a user
  //    who checks a box for a layer whose zoom range excludes the current
  //    zoom changes nothing observable on the map — no CHANGE event.
  //    `LAYER_INTENT_CHANGE` is the separate channel for that user-only
  //    signal: subscribers that mirror the user's checkbox state in their
  //    own UI (an external toggle, a mode badge, a slider) listen to it
  //    rather than re-reading the registry after every interaction.
  //
  //    First pass is skipped (no `prev` to diff against, and a first paint
  //    is not a user action). `prev.intent.visible` is the value we last
  //    recorded — updated by the `setApplied` write below — so a repeated
  //    call with the same intent is a no-op.
  const intentMoved = !isFirstPass && prev.intent?.visible !== next.intent.visible;

  // 4. Submit the new baseline *before* returning. Reentrant callers — an
  //    operation layer that re-projects inside its own notify, or the next
  //    call after this one — diff against the value they read from
  //    `runtimeStore.getApplied`, and that value is already fresh by the
  //    time they look, so a same-value write-back cannot re-trigger the
  //    same notification, and a reverse correction lands its own baseline
  //    without being clobbered by an outer commit after it returns. There
  //    is no second `setApplied` at the bottom of this function.
  ui.runtimeStore.setApplied(id, {
    ...next,
    effectiveShown: next.effectiveShown,
    carrier: carrierToken,
  });

  return { wroteVisible, intentMoved };
};

/** Project one registered layer. The id-resolving entry point for callers that
 *  hold an id rather than an entry; a sweep goes straight to `projectEntry` so
 *  its stamp and its work stay on the same instance. */
const applyProjection = (
  ui: LayerUI,
  id: string,
  repaintMode: "debounce" | "none" = "none",
): ProjectionDelta => {
  const layerInfo = ui.c.layerRegistry.get(id);
  return layerInfo ? projectEntry(ui, layerInfo, repaintMode) : NO_DELTA;
};

/** The single bus notification point for a projection pass: `LAYER_CHANGE`
 *  (the map-facing flip subscribers most often react to) first, then
 *  `LAYER_INTENT_CHANGE` (the user-only channel for policy-gated intent
 *  movements). Every operation layer routes its notify through here, so the
 *  two-order rule has one home and a new caller cannot drift from it.
 *
 *  `LAYER_CHANGE` is gated on `wroteVisible` — not on the pre-notify
 *  `currentShown !== next.effectiveShown` diff — which is what keeps a
 *  missing layer reference or a value that did not actually flip from
 *  manufacturing a change event nobody can observe. The intent payload carries
 *  the committed value through `intentVisibleOf`, read at emit time — a frozen
 *  snapshot, so a handler that stores the payload can rely on it later.
 *  Reentrant correction is handled at two levels. The same-event half is the
 *  superseding delivery the two halves go out through: a newer write for the
 *  same layer stops the older delivery at the reentry point, so no subscriber
 *  sees a value the correction already replaced. The cross-event half is the
 *  intent revision claimed before the CHANGE: a rewrite that happens inside
 *  the CHANGE delivery emits its own INTENT, and this round's INTENT is
 *  dropped when it would duplicate that newer write's final state.
 *
 *  Delivery is identity-checked against the live registry twice — before the
 *  first half goes out, and again before the second. A delta is the record of
 *  one entry's operation, so it can only be delivered for the entry that ran
 *  the pass: a subscriber that retires that entry — destroying the control,
 *  unregistering the layer, or re-registering the same id to a new instance —
 *  has already announced the retirement, and a lookup by id alone would hand
 *  the flip to whoever holds the id now, which never produced it. The first
 *  check catches the retire that lands between rounds of a batch; the second
 *  the one that lands inside this round's own CHANGE.
 *
 *  `layerInfo` may be undefined on a batch path that looked the entry up
 *  before its own pass ran. No-delivery, not a throw: the delta was real,
 *  the recipient is simply gone. */

/** Whether the entry that ran a pass is still the one registered under its id.
 *  A view without a controller has no registry to retire anything against, so
 *  it cannot retire the entry either — that is the "still registered" answer,
 *  not a suppression. */
const entryStillRegistered = (ui: LayerUI, entry: LayerInfo): boolean =>
  !ui.c || ui.c.layerRegistry.get(entry.id) === entry;

const emitDelta = (
  ui: LayerUI,
  layerInfo: LayerInfo | undefined,
  delta: ProjectionDelta,
): DispatchFailure | undefined => {
  if (!layerInfo || !entryStillRegistered(ui, layerInfo)) return undefined;
  // Claim the intent revision before the CHANGE goes out. A subscriber that
  // rewrites this layer's intent inside the CHANGE delivery emits its own
  // round — CHANGE and INTENT — while this round is still between its two
  // halves; the superseding delivery handles same-event reentry, but the
  // INTENT of a *different* event cannot be stopped by a CHANGE token. The
  // revision is the cross-event gate: if a newer INTENT for this id went out
  // while the CHANGE was delivered, this round's INTENT would duplicate the
  // final state, so it is dropped.
  const intentRevision = delta.intentMoved ? nextIntentRevision(layerInfo) : null;
  // Both halves deliver settled: a consumer that throws is recorded and the
  // round continues to the consumers behind it, so one broken subscriber
  // cannot steal the flip from the others — nor, below, the intent half from
  // the layer it belongs to. The failure travels back to the caller, which
  // raises it once the whole operation has been announced.
  let failure: DispatchFailure | undefined;
  if (delta.wroteVisible) {
    failure = ui.events.emitSupersedingSettled(EVENTS.LAYER_CHANGE, layerInfo.id, {
      id: layerInfo.id,
      kind: layerInfo.kind,
    });
  }
  if (delta.intentMoved) {
    if (!entryStillRegistered(ui, layerInfo)) return failure;
    if (!isCurrentIntentRevision(layerInfo, intentRevision)) return failure;
    // Superseding, not plain emit: a subscriber that corrects the intent
    // inside this notify fires a reentrant round for the same id, and the
    // outer delivery would otherwise continue handing the subscribers behind
    // it a value the correction has already replaced — final state correct,
    // last payload stale. The round emitted after the reentry wins, and this
    // delivery stops where it was superseded.
    const intentFailure = ui.events.emitSupersedingSettled(
      EVENTS.LAYER_INTENT_CHANGE,
      layerInfo.id,
      {
        id: layerInfo.id,
        kind: layerInfo.kind,
        intent: { visible: intentVisibleOf(ui, layerInfo.id) },
      },
    );
    // The CHANGE half's failure is the one to surface: it happened first, and
    // an INTENT that never ran because the CHANGE consumer threw is exactly
    // what this ordering is meant to report once.
    failure ??= intentFailure;
  }
  return failure;
};

/** Announce one layer's delta, raising a consumer failure once the layer's own
 *  fan-out is finished. The single-entry counterpart of `notifyDeltas`: a caller
 *  announcing one layer has no wider operation left to finish, so the failure
 *  goes out here. Callers that own a batch (a sweep, or an own layer plus its
 *  sweep) collect through `notifyDeltas` instead, which raises only after the
 *  last item. */
const notifyDelta = (
  ui: LayerUI,
  layerInfo: LayerInfo | undefined,
  delta: ProjectionDelta,
): void => {
  const failure = emitDelta(ui, layerInfo, delta);
  if (failure) throw failure.error;
};

/** One monotonically increasing counter per registry entry, bumped each time an
 *  INTENT for that entry is emitted. It answers "did a newer intent write
 *  happen while this round was between its CHANGE and its INTENT?" — the
 *  cross-event half of the reentrancy contract that same-event superseding
 *  cannot cover.
 *
 *  Stored on the entry itself: the counter shares the entry's lifetime, so a
 *  long-lived map cannot accumulate a row per dynamic id. Unregister, delete,
 *  and same-id replacement need no cleanup — the retired entry loses its
 *  business reachability and the WeakMap lets it go, and a replacement under
 *  the same id starts at its own revision instead of inheriting the old one. */
const intentRevisions = new WeakMap<LayerInfo, number>();

const nextIntentRevision = (entry: LayerInfo): number => {
  const next = (intentRevisions.get(entry) ?? 0) + 1;
  intentRevisions.set(entry, next);
  return next;
};

const isCurrentIntentRevision = (entry: LayerInfo, revision: number | null): boolean =>
  revision !== null && intentRevisions.get(entry) === revision;

/** Notify a batch of passes in the order they were swept, without
 *  interleaving. Each item's entry travels with its delta and `emitDelta`
 *  re-checks it against the live registry, so an entry a subscriber retired
 *  during an earlier delivery of this same round — the control destroyed, the
 *  layer unregistered, or the id re-registered to a different instance —
 *  delivers nothing rather than announcing on behalf of the entry that now
 *  holds the id. The test is identity, not presence: a live entry under the
 *  same id is still the wrong recipient.
 *
 *  A layer whose consumers include a throwing one does not end the round: the
 *  sweep announced every layer before it raised, and each layer's own half is
 *  settled too, so the failure is collected and re-raised once here. The
 *  alternative — stopping at the first throw — silently drops the notifications
 *  for every layer behind it, and those are unrecoverable: the state was
 *  committed before the notify, so a retry finds nothing left to move.
 *
 *  A sequence of passes is one operation too: pass the whole sequence (an
 *  operation's own layer followed by its sweep, for example) in one call, so
 *  every item is attempted before the first failure is raised. */
const notifyDeltas = (ui: LayerUI, deltas: ProjectionBatch): void => {
  let failure: DispatchFailure | undefined;
  for (const { entry, delta } of deltas) {
    // Every item must be attempted even after one failed: `??=` on the call
    // would skip the rest of the batch, which is the truncation this loop
    // exists to prevent.
    const observed = emitDelta(ui, entry, delta);
    failure ??= observed;
  }
  if (failure) throw failure.error;
};

/** Announce a batch into a wider operation instead of raising here. The
 *  caller's `SettledOperation` owns the error boundary, so the registration
 *  change (or removal event) behind the projection round is still attempted
 *  when a projection consumer throws. */
const collectDeltas = (
  ui: LayerUI,
  deltas: ProjectionBatch,
  operation: SettledOperation,
): void => {
  for (const { entry, delta } of deltas) {
    operation.absorb(emitDelta(ui, entry, delta));
  }
};

/** Diff every layer's projection. Called on attach, on late
 *  registration (`applyUserState`), and on zoom-end / focus dismiss.
 *  Idempotent — a changeless call is a no-op because every diff misses.
 *
 *  When the zoom sweep finishes, every layer's `effectiveShown` may have
 *  changed — a basemap that was the sole visible base can drop out of its
 *  stored zoom range. `syncNoBasemap` reconciles the hatch and the group
 *  label from the fresh projection, so the sweep must call it at the end.
 *  Goes through the `ui.syncNoBasemap` delegate to avoid a cross-module
 *  import back into `listPanel/visibility.js` (which already imports
 *  `apply.js` — a direct import here would close the cycle).
 *
 *  Returns only the layers that actually moved, in sweep order — the sweep
 *  is registry order, and an id that has stored dimensions but never
 *  registered is skipped rather than dropped: its record stays in the intent
 *  store and is projected when the component that owns the id registers.
 *  The caller announces through `notifyDeltas` after its own
 *  reconcile steps, so a batch goes out as one settled round instead of a
 *  mid-sweep spray. */
const applyProjectionAll = (
  ui: LayerUI,
  repaintMode: "debounce" | "none" = "none",
): ProjectionBatch => {
  const deltas: ProjectionDeltaItem[] = [];
  // The registry, snapshotted as entries before the first write: a projection
  // that brings a layer onto the map mid-sweep must not widen the set this
  // pass walks, and a mid-sweep replacement stays out of the round this sweep
  // started so the caller can still tell the two apart at delivery. Each entry
  // is projected *as itself* — the delta and the stamp it travels with are the
  // same instance by construction, not by a lookup that happened to agree.
  for (const entry of [...ui.c.layers]) {
    const delta = projectEntry(ui, entry, repaintMode);
    if (delta.wroteVisible || delta.intentMoved) {
      deltas.push({ id: entry.id, delta, entry });
    }
  }
  ui.syncNoBasemap();
  return deltas;
};

export type { ProjectionDelta, ProjectionBatch, ProjectionDeltaItem };

export {
  applyProjection,
  applyProjectionAll,
  dispatchStateOp,
  notifyDeltas,
  notifyDelta,
  collectDeltas,
  authorZoomBoundsForLayer,
  NO_DELTA,
};
