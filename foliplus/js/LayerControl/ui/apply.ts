// LayerControl UI — diff-driven projection executor.
//
// `applyProjection(ui, id)` reads the layer's projection from
// `store.ts`, diffs it against the last projection it wrote to the map
// (`ui.appliedState`), and calls `applyStateOp` only for the dimensions
// that actually moved. The old model — a sweep that re-read the whole
// registry per layer, walked `hiddenIds` / `opacityMap` / `zoomRangeMap`
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
import { resetGridLayerView } from "#core/leafletAdapter.js";
import type { LayerUI } from "./index.js";
import { type Projection, projectAll, projectLayer } from "./store.js";

/** One write the carrier dispatcher accepts. `opacity` and `zoomRange`
 *  being `undefined` mean "no user value" — a Reset back to the author's
 *  default — not "leave the carrier alone". */
type StateOp =
  | { type: "visible"; value: boolean }
  | { type: "opacity"; value: number | undefined }
  | { type: "zoomRange"; value: [number, number] | null };

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

/** Carrier identity the executor's last write landed on.
 *
 *  The projection's numeric diff is not enough for carriers that can be
 *  replaced underneath the executor: a re-registered canvas element starts
 *  opaque, an annotation pane is created lazily long after the slider was
 *  last moved. In both cases the executor's `prev.opacity` matches
 *  `next.opacity`, so a value-only diff misses the write — the
 *  late-carrier regression this file exists to close. The fix is to record which DOM element we last
 *  wrote to, and force a rewrite when the carrier has moved.
 *
 *  The token is opaque to callers: it's just enough identity to say "the
 *  thing I wrote to before is not the thing in front of me now". A
 *  canvas-only layer is one DOM element; a pane carrier is a set of pane
 *  names. Anything else (native `options.opacity`) is keyed by the
 *  layer's own `options` object, which is the actual write target.
 */
const carrierOf = (ui: LayerUI, layerInfo: LayerInfo): unknown => {
  if (layerInfo.canvas) return layerInfo.canvas;
  const surface = ui.m.surfaceFor(layerInfo);
  if (surface.capabilities.opacity === "pane") {
    // A stable key, not an array: `sameCarrier` compares with `===`, so a
    // freshly built array would never match and every pane layer would
    // rewrite on every call. Sorted, so the order the pane specs happen to
    // arrive in cannot register as "the carrier moved".
    const names = [...surface.paneNames];
    const annotationPane = ui.m.annotation?.paneNameFor(layerInfo.id);
    if (annotationPane) names.push(annotationPane);
    return names.sort().join("|");
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
 *  `LayerSurface.capabilities.opacity` / `.zoomRange`):
 *
 *    visible  — map membership for Leaflet layers, `onToggle` for
 *               callback-only canvas layers (heatmap / measure)
 *    opacity  — canvas element / own pane / native setter / "none"
 *    zoomRange — native `options.minZoom/maxZoom` / "none" (the `pane`
 *               carrier resolves through the `visible` op in the
 *               executor, not here)
 *
 *  The "none" carrier check is the rule that a slider that writes
 *  nothing must not persist — when the surface declares "none" we skip
 *  the write instead of faking one on a shared carrier.
 */
const applyStateOp = (ui: LayerUI, layerInfo: LayerInfo, op: StateOp): void => {
  if (op.type === "visible") {
    const layer = layerInfo.layer ?? ui.m.findLayer(layerInfo);
    if (layer) {
      // Map membership. Written only when it differs from what is there —
      // `addLayer` on a live layer is a no-op at best and re-orders the
      // stacking at worst, so both halves collapse to one condition.
      const has = ui.m.map.hasLayer(layer);
      if (op.value !== has) {
        if (op.value) ui.m.map.addLayer(layer);
        else ui.m.map.removeLayer(layer);
      }
    }
    // `onToggle` is the callback for canvas-only layers (heatmap / measure)
    // that have no Leaflet layer to add/remove — it fires the toggle so the
    // canvas toggles its own `HIDDEN` class. A layer that has both a Leaflet
    // layer AND an `onToggle` (a hybrid) fires both: the map membership and
    // the callback each carry a distinct piece of state.
    if (layerInfo.onToggle) layerInfo.onToggle(op.value);
    // `layerInfo.visible` is a real-time mirror of the map state; the
    // user's intent lives in `hiddenIds` / `userOverrides`. This is
    // now the only writer of this field — the visibility sweep's mirror
    // write is gone.
    layerInfo.visible = op.value;
    return;
  }
  if (op.type === "opacity") {
    if (layerInfo.canvas) {
      // Canvas element's own CSS opacity — the carrier for
      // heatmap / measure. Kept separate from the pane write: the pane's
      // opacity would compound with this one, and a single knob must not
      // be multiplied twice.
      const value = op.value ?? 1;
      layerInfo.canvas.style.opacity = String(value);
      layerInfo.opacity = value;
      return;
    }
    const carrier = ui.m.surfaceFor(layerInfo).capabilities.opacity;
    if (carrier === "none") return; // no honest write exists
    const layer = layerInfo.layer;
    if (!layer) return;
    if (carrier === "native") {
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
      // One CSS write per pane we own — declared, sub, synthesized, or
      // the layer's annotation pane. Multiplicative over each feature's
      // own style, so a hollow polygon keeps its hole.
      const value = op.value ?? 1;
      const names = [...ui.m.surfaceFor(layerInfo).paneNames];
      const annotationPane = ui.m.annotation?.paneNameFor(layerInfo.id);
      if (annotationPane) names.push(annotationPane);
      for (const name of names) {
        const pane = ui.m.map.getPane(name);
        if (pane) pane.style.opacity = String(value);
      }
      layerInfo.opacity = value;
    }
    return;
  }
  // zoomRange — the `pane` carrier resolves through the visible op in
  // the executor, so nothing to write here for pane.
  const caps = ui.m.surfaceFor(layerInfo).capabilities;
  if (caps.zoomRange === "native") {
    const layer = layerInfo.layer;
    if (!layer) return;
    const opts = layer.options as L.LayerOptions & {
      minZoom?: number;
      maxZoom?: number;
    };
    if (op.value) {
      opts.minZoom = op.value[0];
      opts.maxZoom = op.value[1];
    } else {
      delete opts.minZoom;
      delete opts.maxZoom;
    }
    // Leaflet does not self-apply options.minZoom/maxZoom: already-loaded
    // tiles stay until the level set is rebuilt. Without this the range
    // would be silently stale — the user sets it and nothing changes on
    // the map.
    resetGridLayerView(layer);
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
 *  writes `layerInfo.visible`
 *  and `ui.m.map.addLayer` / `removeLayer` is `effectiveShown`, and
 *  `effectiveShown = intent && policy` — a derived dimension (focus, zoom
 *  range) can only pull a layer off the map, never push one onto it. That
 *  is why this executor is the only write path for map membership and why
 *  `intent.visible` is no longer diffed separately: any change that would
 *  authorise an add goes through `intent`, so the effective value already
 *  reflects the user's authorisation. The one-way gate that used to live in
 *  `rangeHiddenIds` is now the shape of this diff.
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
    const layer = layerInfo.layer ?? ui.m.findLayer(layerInfo);
    const baselineVisible = layer
      ? ui.m.map.hasLayer(layer)
      : layerInfo.visible !== false;
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
    (ui.userOverrides?.[id]?.includes("visible") ?? false) ||
    (ui.hiddenIds?.has(id) ?? false);
  const authorised = hasUserIntent || ui.authorVisible.has(id);
  // A callback-only layer has no map to read and its registry flag is the
  // declaration, not "what we last told it", so the first call must always
  // fire the callback once.
  const currentShown = layer
    ? ui.m.map.hasLayer(layer)
    : layerInfo.onToggle
      ? ui.appliedState.has(id)
        ? prev.effectiveShown
        : !next.effectiveShown
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

  // The mirror field is the panel's "is this on the map" fact, and the
  // executor is its only writer. It records what the write *achieved*: the
  // projection's answer when the op had a carrier to land on, `false` when
  // the layer is not linked yet and there was nothing to write to. Recording
  // an unlandable write as done is what made `checked`, `visible` and map
  // membership disagree on reload — the op is skipped and the next
  // `applyProjection`, once the layer is linked, still sees the difference.
  const canWriteVisible = Boolean(layer) || Boolean(layerInfo.onToggle);
  layerInfo.visible = !authorised
    ? layerInfo.visible // unauthorised — the declaration stands
    : canWriteVisible
      ? next.effectiveShown
      : false;

  ui.appliedState.set(id, {
    ...next,
    effectiveShown: layerInfo.visible,
    carrier: carrierToken,
  });
};

/** Diff every layer's projection. Called on attach, on late
 *  registration (`applyUserState`), and on zoom-end / focus dismiss.
 *  Idempotent — a changeless call is a no-op because every diff misses. */
const applyProjectionAll = (ui: LayerUI): void => {
  for (const [id] of projectAll(ui)) applyProjection(ui, id);
};

export { applyProjection, applyProjectionAll, applyStateOp, type StateOp };
