// LayerControl UI — diff-driven projection executor.
//
// `applyProjection(ui, id)` reads the layer's projection from
// `projection.ts`, diffs it against the last projection it wrote to the map
// (`ui.appliedState`), and calls `applyStateOp` only for the dimensions
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
import { resetGridLayerView } from "#core/leafletAdapter.js";
import { setLayerAlpha } from "#common/canvasAlpha.js";
import * as CONST from "../const.js";
import type { Projection, StateOp } from "../type.js";
import type { LayerUI } from "./index.js";
import { INTENT, getIntent } from "./intent.js";
import { intentVisibleOf, projectAll, projectLayer } from "./projection.js";

/** Cache the layer's original `options.opacity` so repeated slider drags
 *  don't compound. The base is captured on first write and never re-read;
 *  the slider value is a multiplier over the author's declared default. */
const authorOpacityBase = new WeakMap<L.Layer, number>();

const authorOpacityBaseOf = (layer: L.Layer): number => {
  let base = authorOpacityBase.get(layer);
  if (base === undefined) {
    // A Leaflet layer always has `options` — PaneManager already walks
    // `options.pane` for every layer before we get here.
    const opts = layer.options as L.LayerOptions & { opacity?: number };
    base = typeof opts.opacity === "number" ? opts.opacity : 1;
    authorOpacityBase.set(layer, base);
  }
  return base;
};

/** The layer's own author-declared min/max, frozen on first write.
 *
 *  Frozen, not re-read: `applyStateOp` writes `options.minZoom/maxZoom` on
 *  every live drag, so reading them back next time would feed the slider
 *  its own last drag — a ratchet that shrinks the slider's range with
 *  every drag. The snapshot is captured in `applyStateOp` before the write,
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
): [number, number] => {
  const stored = layer ? authorZoomBounds.get(layer) : undefined;
  if (stored) return stored;
  const opts = (layer?.options ?? {}) as L.LayerOptions & {
    minZoom?: number;
    maxZoom?: number;
  };
  const mapMin = finiteOr(ui.m.map.getMinZoom(), 0);
  const mapMax = finiteOr(ui.m.map.getMaxZoom(), CONST.AUTHOR_ZOOM_FALLBACK_MAX);
  const bounds: [number, number] = [
    finiteOr(opts.minZoom, mapMin),
    finiteOr(opts.maxZoom, mapMax),
  ];
  if (layer) authorZoomBounds.set(layer, bounds);
  return bounds;
};

/** Same lookup keyed by layer id — the panel code has only the id in hand. */
const authorZoomBoundsForLayer = (ui: LayerUI, layerId: string): [number, number] =>
  authorZoomBoundsOf(ui, ui.m.layerRegistry.get(layerId)?.layer);

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
  const surface = ui.m.surfaceFor(layerInfo);
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
const applyStateOp = (ui: LayerUI, layerInfo: LayerInfo, op: StateOp): void => {
  if (op.type === "visible") {
    const carrier = ui.m.surfaceFor(layerInfo).capabilities.visibility;
    if (carrier === CAP_TIER.NATIVE) {
      const layer = layerInfo.layer ?? ui.m.findLayer(layerInfo);
      if (layer) {
        // Map membership. Written only when it differs from what is there —
        // `addLayer` on a live layer is a no-op at best and re-orders the
        // stacking at worst, so both halves collapse to one condition.
        const has = ui.m.map.hasLayer(layer);
        if (op.value !== has) {
          if (op.value) ui.m.map.addLayer(layer);
          else ui.m.map.removeLayer(layer);
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
        // Live CSS arm. The drawer's next paint reads getLayerAlpha and
        // bakes the same value, then clears this CSS (see HeatmapManager.
        // redrawHeatmap) so the two never compound.
        layerInfo.canvas.style.opacity = String(value);
      }
      layerInfo.opacity = value;
      return;
    }
    const carrier = ui.m.surfaceFor(layerInfo).capabilities.opacity;
    if (carrier === CAP_TIER.NONE) return; // no honest write exists
    const layer = layerInfo.layer;
    if (!layer) return;
    if (carrier === CAP_TIER.NATIVE) {
      // The layer paints through a setter of its own. `setOpacity`
      // (ImageOverlay) is immediate; `options.opacity` (GridLayer /
      // TileLayer) is honoured at the next tile cycle. The slider is a
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
      const surface = ui.m.surfaceFor(layerInfo);
      for (const pane of surface.panes) {
        if (pane.role === PANE_ROLE.ANNOTATION) continue;
        const el = ui.m.map.getPane(pane.name);
        if (el) el.style.opacity = String(value);
      }
      ui.m.annotation.applyLayerAlpha(layerInfo.id, value);
      layerInfo.opacity = value;
    }
  }
};

/** Diff the current projection against the last one we wrote, and call
 *  `applyStateOp` only for the dimensions that moved.
 *
 *  Ordering: `visible (effective)` and `opacity` are independent of the
 *  projection's `zoomRange`, so they apply in either order. `zoomRange`
 *  applies last because the `pane` carrier's effective-shown recalculation
 *  needs the new range in effect before it decides whether the layer stays
 *  on the map — doing it in the other order would write an effective-shown
 *  computed off the old range. The `effectiveShown` write that follows a
 *  `zoomRange` change is therefore computed from the projection's new
 *  `zoomRange`, not from the executor's current state (the projection
 *  has already seen the new range).
 *
 *  `ui.appliedState` records what was written so the next call is a
 *  diff, not a full write. The map is keyed by id (not by `layerInfo`
 *  identity) so a re-registration of the same id keeps its projection
 *  across the swap.
 *
 *  This is the invariant the executor is built around: the only field that
 *  writes map membership is `effectiveShown`, and `effectiveShown = intent
 *  && policy` — a derived dimension (focus, zoom range) can only pull a
 *  layer off the map, never push one onto it. That is why this executor is
 *  the only write path for map membership and why `intent.visible` is no
 *  longer diffed separately: any change that would authorise an add goes
 *  through `intent`, so the effective value already reflects the user's
 *  authorisation. The one-way gate is now the shape of this diff.
 */
const applyProjection = (ui: LayerUI, id: string): void => {
  const layerInfo = ui.m.layerRegistry.get(id);
  if (!layerInfo) return;
  const next = projectLayer(ui, layerInfo);
  let prev = ui.appliedState.get(id);

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
    // real visible→hidden transition.
    // Late-binding fallback via manager.findLayer — the single resolve point
    // (folium may emit the TileLayer var after this control's IIFE).
    const layer = layerInfo.layer ?? ui.m.findLayer(layerInfo);
    const baselineVisible = layer ? ui.m.map.hasLayer(layer) : intentVisibleOf(ui, id);
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
  //    here: nothing authorises an add unless `intent` does, so a derived
  //    dimension can only remove, never restore on its own.
  const layer = layerInfo.layer ?? ui.m.findLayer(layerInfo);
  // Whether anything authorises a map write at all. Only the user's
  // own choice or an *observed* author snapshot decides membership. A layer
  // whose author default has not been observed yet (its JS global is not
  // linked) and that the user never touched is not this executor's to
  // decide — writing `effectiveShown` for it would turn a guess into an add.
  const hasUserIntent =
    ui.intentStore.isUserSet(id, INTENT.VISIBLE) ||
    typeof getIntent(ui, id, INTENT.VISIBLE) === "boolean";
  const authorised = hasUserIntent || ui.authorVisible.has(id);
  // Current visibility, read from the carrier the write would land on.
  // "native" — the map's own membership flag; "pane" — the canvas's
  // HIDDEN class; "none" — no carrier at all, so no meaningful "shown".
  // Reading the carrier (not the last value we wrote) makes the executor
  // converge on `effectiveShown` no matter who moved the layer in between.
  const visibility = ui.m.surfaceFor(layerInfo).capabilities.visibility;
  const currentShown =
    visibility === CAP_TIER.NATIVE
      ? layer
        ? ui.m.map.hasLayer(layer)
        : false
      : visibility === CAP_TIER.PANE
        ? layerInfo.canvas
          ? !layerInfo.canvas.classList.contains(HIDDEN)
          : false
        : false;
  if (authorised && currentShown !== next.effectiveShown) {
    applyStateOp(ui, layerInfo, { type: "visible", value: next.effectiveShown });
  }
  // 2. Opacity — independent of zoom/focus. Rewritten whenever the carrier
  //    has moved, not just when the value has.
  if (prev.opacity !== next.opacity || !sameCarrier(prev.carrier, carrierToken)) {
    applyStateOp(ui, layerInfo, { type: "opacity", value: next.opacity });
  }
  // 3. Zoom range — last, because the pane carrier's effective-shown
  //    recalculation in step 1 reads the range as of the projection
  //    (the new one), not the executor's previous write.
  if (prev.zoomRange !== next.zoomRange) {
    applyStateOp(ui, layerInfo, { type: "zoomRange", value: next.zoomRange });
  }

  ui.appliedState.set(id, {
    ...next,
    effectiveShown: next.effectiveShown,
    carrier: carrierToken,
  });
};

/** Diff every layer's projection. Called on attach, on late
 *  registration (`applyUserState`), and on zoom-end / focus dismiss.
 *  Idempotent — a changeless call is a no-op because every diff misses. */
const applyProjectionAll = (ui: LayerUI): void => {
  for (const [id] of projectAll(ui)) applyProjection(ui, id);
};

export { applyProjection, applyProjectionAll, applyStateOp, authorZoomBoundsForLayer };
