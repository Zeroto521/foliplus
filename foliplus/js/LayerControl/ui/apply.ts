// LayerControl UI — diff-driven projection executor.
//
// `applyProjection(ui, id)` reads the layer's projection from
// `store.ts`, diffs it against the last projection it wrote to the map
// (`ui.appliedState`), and calls `applyStateOp` only for the dimensions
// that actually moved. The old model — a sweep that re-read the whole
// registry per layer, walked `hiddenIds` / `opacityMap` / `zoomRangeMap`
// by id, and picked per-dimension helpers — is what made the three
// regressions structurally reachable (§22-9.1):
//
//   T46 (late-register replay): the sweep only ran on `applyUserState`
//     entry; a layer whose stored dimensions arrived after its own
//     registration was only picked up by the id-specified drain, so a
//     missed sweep silently meant a lost opacity / zoom range.
//   T50 (scrambled row lookup): row lookups inside the sweep keyed off
//     positional indices, which the stored-order replay could shift.
//   #329 (zoom write over intent): a policy sweep could reach
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
import { projectAll, projectLayer, type Projection } from "./store.js";
import type { LayerUI } from "./index.js";

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
const nativeBase = new WeakMap<L.Layer, number>();

const nativeBaseOf = (layer: L.Layer): number => {
  let base = nativeBase.get(layer);
  if (base === undefined) {
    const opts = (layer.options ?? {}) as L.LayerOptions & { opacity?: number };
    base = typeof opts.opacity === "number" ? opts.opacity : 1;
    nativeBase.set(layer, base);
  }
  return base;
};

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
 *  The "none" carrier check is the §6.2 rule: a slider that writes
 *  nothing must not persist — when the surface declares "none" we skip
 *  the write instead of faking one on a shared carrier.
 */
const applyStateOp = (
  ui: LayerUI,
  layerInfo: LayerInfo,
  op: StateOp,
): void => {
  if (op.type === "visible") {
    const layer = layerInfo.layer ?? ui.m.findLayer(layerInfo);
    if (layer) {
      // Map membership. `addLayer` is a no-op on an already-present
      // layer, so a caller may safely re-apply the same value.
      const has = ui.m.map.hasLayer(layer);
      if (op.value && !has) ui.m.map.addLayer(layer);
      else if (!op.value && has) ui.m.map.removeLayer(layer);
    } else if (layerInfo.onToggle) {
      // Callback-only layers have no Leaflet layer to add/remove — fire
      // the toggle so the canvas toggles its own `HIDDEN` class.
      layerInfo.onToggle(op.value);
    }
    // `layerInfo.visible` is a real-time mirror of the map state; the
    // user's intent lives in `hiddenIds` / `userOverrides`. This is
    // now the only writer of this field — the visibility sweep's mirror
    // write is gone (§22-9.1 step 3).
    layerInfo.visible = op.value;
    return;
  }
  if (op.type === "opacity") {
    if (layerInfo.canvas) {
      // Canvas element's own CSS opacity — the §4.2 ① carrier for
      // heatmap / measure. Kept separate from the pane write: the pane's
      // opacity would compound with this one, and a single knob must not
      // be multiplied twice.
      const value = op.value ?? 1;
      layerInfo.canvas.style.opacity = String(value);
      layerInfo.opacity = value;
      return;
    }
    const carrier = ui.m.surfaceFor(layerInfo).capabilities.opacity;
    if (carrier === "none") return; // no honest write exists — §6.2
    const layer = layerInfo.layer;
    if (!layer) return;
    if (carrier === "native") {
      // The layer paints through a setter of its own. `setOpacity`
      // (ImageOverlay) is immediate; `options.opacity` (GridLayer /
      // TileLayer) is honoured at the next tile cycle. The slider is a
      // multiplier over the author's declared default, so the base is
      // captured once.
      const opts = (layer.options ?? {}) as L.LayerOptions & { opacity?: number };
      const base = nativeBaseOf(layer);
      const target = base * (op.value ?? 1);
      if (typeof (layer as L.ImageOverlay).setOpacity === "function") {
        (layer as L.ImageOverlay).setOpacity(target);
      } else {
        layer.options = opts;
        opts.opacity = target;
      }
      layerInfo.opacity = op.value ?? 1;
    } else if (carrier === "pane") {
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
    // the map (§6.2).
    resetGridLayerView(layer);
  }
};

/** Diff the current projection against the last one we wrote, and call
 *  `applyStateOp` only for the dimensions that moved.
 *
 *  Ordering: `visible (intent)` and `opacity` are independent of the
 *  projection's `zoomRange`, so they apply as-is. `zoomRange` applies
 *  last because the `pane` carrier's effective-shown recalculation needs
 *  the new range in effect before it decides whether the layer stays on
 *  the map — doing it in the other order would write an effective-shown
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
 *  This is the #329 fix: the executor is the only path that writes
 *  `layerInfo.visible` and `ui.m.map.addLayer/removeLayer`. It never
 *  touches `hiddenIds` or `userOverrides`, so a policy write — a zoom
 *  outside the stored range, a focus dismiss — cannot flip a checkbox
 *  the user never moved.
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
    // otherwise diff against `visible: true` and miss the add. The T46 fix
    // is that this baseline is read from the live map state, so a late
    // registration still has its stored state applied on the first call.
    // Canvas-only layers have no Leaflet layer, so the author's default is
    // the ground truth — `hasLayer` would always return false and mask a
    // real visible→hidden transition.
    const layer = layerInfo.layer ?? ui.m.findLayer(layerInfo);
    const baselineVisible = layer
      ? ui.m.map.hasLayer(layer)
      : ui.authorVisible.get(id) ?? true;
    prev = {
      id,
      intent: { visible: baselineVisible },
      effectiveShown: baselineVisible,
      opacity: undefined,
      zoomRange: null,
    };
  }

  // 1. Explicit intent (user toggled the checkbox).
  let lastVisibleWrite: boolean | undefined;
  if (prev.intent.visible !== next.intent.visible) {
    applyStateOp(ui, layerInfo, { type: "visible", value: next.intent.visible });
    lastVisibleWrite = next.intent.visible;
  }
  // 2. Opacity — independent of zoom/focus.
  if (prev.opacity !== next.opacity) {
    applyStateOp(ui, layerInfo, { type: "opacity", value: next.opacity });
  }
  // 3. Effective-shown BEFORE any zoomRange write, so a policy-side
  //    change (zoom moved, focus dismissed) fires first. When the user
  //    explicitly un-hides a layer while its range excludes the current
  //    zoom, this fires a brief remove that matches the old code's
  //    "add-then-immediately-remove" behavior. Skip if step 1 already
  //    wrote the same value — a canvas-only layer's `onToggle` is not
  //    idempotent, so a double-fire would be observable.
  if (prev.effectiveShown !== next.effectiveShown && next.effectiveShown !== lastVisibleWrite) {
    applyStateOp(ui, layerInfo, { type: "visible", value: next.effectiveShown });
  }
  // 4. Zoom range — last, because the pane carrier's effective-shown
  //    recalculation in step 3 reads the range as of the projection
  //    (the new one), not the executor's previous write.
  if (prev.zoomRange !== next.zoomRange) {
    applyStateOp(ui, layerInfo, { type: "zoomRange", value: next.zoomRange });
  }

  ui.appliedState.set(id, next);
};

/** Diff every layer's projection. Called on attach, on late
 *  registration (`applyUserState`), and on zoom-end / focus dismiss.
 *  Idempotent — a changeless call is a no-op because every diff misses. */
const applyProjectionAll = (ui: LayerUI): void => {
  for (const [id] of projectAll(ui)) applyProjection(ui, id);
};

export { applyProjection, applyProjectionAll, applyStateOp, type StateOp };
