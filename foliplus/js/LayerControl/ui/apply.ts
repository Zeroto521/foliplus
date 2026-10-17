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
import { EVENTS } from "#core/event/index.js";
import { CAP_TIER, HIDDEN, PANE_ROLE } from "#core/layer/index.js";
import { getLayerAlpha, setLayerAlpha } from "#common/canvasAlpha.js";
import * as CONST from "../const.js";
import { INTENT, getIntent } from "./intent.js";
import { intentVisibleOf, projectAll, projectLayer } from "./projection.js";
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

/** The layer's own author-declared min/max, frozen on first write.
 *
 *  Frozen, not re-read: `dispatchStateOp` writes `options.minZoom/maxZoom` on
 *  every live drag, so reading them back next time would feed the slider
 *  its own last drag — a ratchet that shrinks the slider's range with
 *  every drag. The snapshot is captured in `dispatchStateOp` before the write,
 *  which is also what makes persistence-replay safe: on reload the state
 *  replay fires before the panel opens, so any snapshot that captures at
 *  first read would already see `options.maxZoom` set to the persisted
 *  value, freezing the slider at that last drag instead of at the author's
 *  declared range.
 *
 *  `layer.options.minZoom/maxZoom` fall back to the map's declared values
 *  when the layer declares none — a TileLayer without `options.maxZoom`
 *  means "whatever the map allows", not "Infinity". `map.getMaxZoom()`
 *  itself returns `Infinity` for a map without a declared max, so that
 *  path gets its own finite fallback: `CONST.AUTHOR_ZOOM_FALLBACK_MAX`, so
 *  the values row can never print the literal string "Infinity".
 *
 *  Min end is symmetric: dragging the left thumb writes `options.minZoom`,
 *  which would ratchet the slider's own min upward on the next build. */
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
 */
const dispatchStateOp = (
  ui: LayerUI,
  layerInfo: LayerInfo,
  op: StateOp,
  repaintMode: "debounce" | "none" = "none",
): void => {
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
          // Map membership is not registry state: this executor is the only
          // writer of the add/remove, so it is what puts the change on the bus.
          // The annotation manager repaints per id on this event, which is
          // where the native `layeradd`/`layerremove` used to reach it.
          ui.events.emit(EVENTS.LAYER_CHANGE, {
            id: layerInfo.id,
            kind: layerInfo.kind,
          });
        }
      }
    } else if (carrier === CAP_TIER.PANE) {
      // Canvas HIDDEN class — the carrier for canvas-only surfaces that have
      // no Leaflet layer to add/remove.
      const canvas = layerInfo.canvas;
      if (canvas) canvas.classList.toggle(HIDDEN, !op.value);
    }
    // "none" — no honest write exists; the UI hides the checkbox rather
    // than offering one that lies.
    return;
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
      return;
    }
    const carrier = ui.c.surfaceFor(layerInfo).capabilities.opacity;
    if (carrier === CAP_TIER.NONE) return; // no honest write exists
    // Snapshot-then-resolve: registry reference wins when populated, the
    // controller's findLayer re-resolves against the live map for a folium
    // layer whose registry reference is still null. Same late-binding
    // defense as the zoom-range and visible-write paths below.
    const layer = layerInfo.layer ?? ui.c.findLayer(layerInfo);
    if (!layer) return;
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
  }
};

/** Diff the current projection against the last one we wrote, and call
 *  `dispatchStateOp` only for the dimensions that moved.
 *
 *  Ordering: `visible (effective)` and `opacity` are independent of the
 *  projection's `zoomRange`, so they apply in either order. The zoomRange
 *  dimension itself is *not* dispatched here — it resolves through the
 *  `visible` op (the projection's `effectiveShown` already folds in the
 *  current range), so a zoomRange change flows through as a map-membership
 *  diff on `effectiveShown`, not as its own state op.
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
 */
const applyProjection = (
  ui: LayerUI,
  id: string,
  repaintMode: "debounce" | "none" = "none",
): void => {
  const layerInfo = ui.c.layerRegistry.get(id);
  if (!layerInfo) return;
  // A surface is mandatory for a write target (see `carrierOf` / `dispatchStateOp`
  // below) — the same defensive gate `hideOtherLayers` carries against a
  // missing surface. A layer whose surface could not be built (a late-
  // registered entry the ordering pass hasn't stamped yet, or a test
  // fixture that returns `null`) has nothing to write to, so skip it.
  if (!ui.c.surfaceFor(layerInfo)) return;
  const next = projectLayer(ui, layerInfo);
  let prev = ui.runtimeStore.getApplied(id);

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
      zoomRange: null,
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
  if (authorised && currentShown !== next.effectiveShown) {
    dispatchStateOp(
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

  ui.runtimeStore.setApplied(id, {
    ...next,
    effectiveShown: next.effectiveShown,
    carrier: carrierToken,
  });
};

/** Diff every layer's projection. Called on attach, on late
 *  registration (`applyUserState`), and on zoom-end / focus dismiss.
 *  Idempotent — a changeless call is a no-op because every diff misses. */
const applyProjectionAll = (
  ui: LayerUI,
  repaintMode: "debounce" | "none" = "none",
): void => {
  for (const [id] of projectAll(ui)) applyProjection(ui, id, repaintMode);
};

export {
  applyProjection,
  applyProjectionAll,
  dispatchStateOp,
  authorZoomBoundsForLayer,
};
