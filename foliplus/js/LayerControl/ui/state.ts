// LayerControl UI —Persisted user state (fold / hidden / names) apply + save.
import { resetGridLayerView } from "#core/leafletAdapter.js";
import { createLogger } from "#common/log.js";
import * as CONST from "../const.js";
import type { LayerManager } from "../manager.js";
import type { LayerOverride, PersistedLayerState } from "../persistence.js";
import { applyNameProjection } from "./context.js";
import type { LayerUI } from "./index.js";
import { applyRowView, buildRowCell, inZoomRange } from "./rowView.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).
const log = createLogger(CONF.name);

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

/** Load every persisted dimension in one call. */
const loadPersistedState = (ui: LayerUI) => {
  const state = ui.m.persistence.load();
  ui.foldedGroups = new Set(state.foldedGroups);
  ui.renamedNames = state.renamedNames;
  // Style (label) configs are stored on the UI shell and applied by
  // ui/style.ts once the layers resolve (deferred init passes).
  ui.labelConfigs = state.annotations;
  // Per-layer intent: the value lives in hiddenIds / opacityMap, `overrides`
  // records that the user set it. A layer with no entry keeps the author's
  // declared default -- there is no map-level "did the user choose at all" flag,
  // because the distinction is per layer.
  ui.hiddenIds = new Set();
  ui.opacityMap = {};
  ui.zoomRangeMap = {};
  ui.userOverrides = {};
  for (const [id, entry] of Object.entries(state.layers)) {
    ui.userOverrides[id] = [...entry.overrides];
    if (entry.overrides.includes("visible") && entry.visible === false) {
      ui.hiddenIds.add(id);
    }
    const opacity = entry.opacity;
    if (entry.overrides.includes("opacity") && typeof opacity === "number") {
      ui.opacityMap[id] = opacity;
    }
    // Value and provenance are validated together on read, so presence of the
    // provenance guarantees presence of the value.
    if (entry.overrides.includes("zoomRange") && entry.zoomRange) {
      ui.zoomRangeMap[id] = entry.zoomRange;
    }
  }
};

/** Save fold state to localStorage. */

const saveFoldState = (ui: LayerUI) => {
  ui.m.persistence.schedule({ foldedGroups: () => [...ui.foldedGroups] });
};

/** Whether one dimension still holds a live value. An override with none means
 *  the user reset it, so the dimension drops back to the author's declared
 *  default instead of persisting an empty choice. */
const hasLiveValue = (ui: LayerUI, id: string, override: LayerOverride): boolean => {
  if (override === "opacity") return typeof ui.opacityMap[id] === "number";
  if (override === "zoomRange") return Array.isArray(ui.zoomRangeMap[id]);
  return true;
};

/** Build the record's `layers` section from the live state: one entry per
 *  layer the user has actually touched, so an untouched layer keeps the
 *  author's declared default across a reload. */
const buildLayerStates = (ui: LayerUI): Record<string, PersistedLayerState> => {
  const states: Record<string, PersistedLayerState> = {};
  for (const [id, overrides] of Object.entries(ui.userOverrides)) {
    const declared = overrides.filter(override => hasLiveValue(ui, id, override));
    if (declared.length === 0) continue;
    const state: PersistedLayerState = { overrides: declared };
    if (declared.includes("visible")) state.visible = !ui.hiddenIds.has(id);
    const opacity = ui.opacityMap[id];
    if (declared.includes("opacity") && typeof opacity === "number") {
      state.opacity = opacity;
    }
    if (declared.includes("zoomRange")) state.zoomRange = ui.zoomRangeMap[id];
    states[id] = state;
  }
  return states;
};

/** Save the per-layer intent --visibility, opacity and zoom range--
 *  coalescing rapid calls. */
const saveState = (ui: LayerUI) => {
  ui.m.persistence.schedule({ layers: () => buildLayerStates(ui) });
};

/** Record that the user has set a dimension for one layer. The first action is
 *  what turns an author's declared default into the user's own state.
 *
 *  Refuses a marker for a dimension that holds no live value: {@link buildLayerStates}
 *  filters such a marker out of the next write, so recording it here would mean the
 *  user's action is lost with nothing in the console. Failing loud at the one gate
 *  every caller passes through keeps that from being a silent failure. */
const markOverride = (ui: LayerUI, id: string, override: LayerOverride) => {
  if (!hasLiveValue(ui, id, override)) {
    log.warn(
      `markOverride("${override}", "${id}"): no stored value for this dimension, ` +
        `marker not recorded — set the value before marking`,
    );
    return;
  }
  const overrides = ui.userOverrides[id] ?? [];
  if (!overrides.includes(override)) overrides.push(override);
  ui.userOverrides[id] = overrides;
};

/** Drop one dimension's provenance -- the single rule a Reset button reduces to,
 *  sending the value back to the author's declared default. */
const unmarkOverride = (ui: LayerUI, id: string, override: LayerOverride) => {
  const overrides = (ui.userOverrides[id] ?? []).filter(entry => entry !== override);
  if (overrides.length > 0) ui.userOverrides[id] = overrides;
  else delete ui.userOverrides[id];
};

/**
 * Propagate the user's stored state —hidden visibility and renames — * into the registry and the rendered rows.
 *
 * `hiddenIds` and `renamedNames` are the source of truth; the registry's
 * `LayerInfo.visible` / `LayerInfo.name` and the row checkboxes / labels
 * are their projections, refreshed here whenever a row or the registry is
 * rebuilt from a third-party layer's own metadata. Hidden is a same-axis
 * overwrite of `visible`, so it writes straight through; name is a
 * cross-axis projection that must preserve the author's original name, so
 * it goes through `applyNameProjection`, which writes only where the
 * projection still differs —a repeated pass is therefore a no-op.
 *
 * The sweep is a pure projection: it never prunes and never writes back.
 * A persisted id with no registry entry is *ignored*, not treated as
 * evidence that its stored state should go. That distinction is the whole
 * point —HeatmapControl and MeasureControl register in their own
 * constructor, which runs after this UI has attached, so on the first
 * attach their ids are unresolvable. Deleting them there (and writing the
 * deletion back to storage) would discard the user's stored opacity, zoom
 * range, and visibility on every reload: the exact symptom of the layer
 * coming back at its author default after a refresh.
 *
 * Dropping a stored value is an explicit-user-action concern, and it is
 * {@link dropPersistedLayerState}: "delete this layer", or the per-dimension
 * reset that reduces to {@link unmarkOverride}. Nothing else calls it.
 *
 * @param {string} [id] Restrict to one layer id —a late-arriving row is
 *   already rendered with the right label, so it only needs its registry
 *   projection; a full sweep would re-rewrite every renamed row for no
 *   gain. Both projections are membership-guarded on this path: the drain
 *   runs for every late registration, so an unhidden layer must not be
 *   hidden and a missing rename must not write undefined.
 */

const applyUserState = (ui: LayerUI, id?: string) => {
  const registry = ui.m.layerRegistry;
  const container = ui.uiContainer;

  if (id) {
    const layerInfo = registry.get(id);
    if (!layerInfo) return; // not registered yet —its stored state is kept
    // Both projections are membership-guarded —this path runs for every
    // late registration, including layers the user never touched. A layer
    // that was never hidden must not be hidden, and a missing rename is a
    // no-op rather than a write of undefined over the registry's own name.
    if (ui.hiddenIds.has(id)) applyHiddenStateOne(ui, layerInfo);
    if (id in ui.renamedNames) {
      applyNameProjection(layerInfo, null, ui.renamedNames[id]);
    }
    if (id in ui.opacityMap) applyOpacityStateOne(ui, layerInfo, ui.opacityMap[id]);
    // A stored zoom range is applied on the same late-registration pass:
    // without it a layer that was out of range on the previous load would
    // come back on the map at its author default rather than staying hidden.
    if (id in ui.zoomRangeMap) {
      applyZoomRangeStateOne(ui, layerInfo, ui.zoomRangeMap[id]);
    }
    // The order dimension is replayed on the same pass: this path runs once per
    // late registration, so without it the layer would keep the slot it was
    // inserted into rather than the position the user already arranged.
    ui.m.replaySavedOrder(id);
    return;
  }

  // The registry is the sweep, not `hiddenIds`: a layer the user left
  // visible is absent from `hiddenIds` by design, so iterating that set
  // alone can never reach it and the hide half of the round trip has no
  // inverse. Walking the registry asserts every layer's map membership
  // against the persisted intent; the color basemap has no registry entry,
  // so its rename still comes from `renamedNames`.
  const ids = new Set([
    ...ui.m.layers.map(li => li.id),
    ...ui.hiddenIds,
    ...Object.keys(ui.renamedNames),
    ...Object.keys(ui.opacityMap),
    ...Object.keys(ui.zoomRangeMap),
  ]);
  for (const layerId of ids) {
    if (layerId in ui.renamedNames) {
      if (layerId === CONST.COLOR.MAP_ID) {
        // The color basemap has no registry entry —only its row label.
        applyNameProjection(
          null,
          container?.querySelector(
            `[${CONST.DATA.LAYER_ID}="${CSS.escape(layerId)}"]`,
          ) as HTMLElement | null,
          ui.renamedNames[layerId],
        );
        continue;
      }
      const layerInfo = registry.get(layerId);
      if (!layerInfo) continue; // not registered yet —its stored state is kept
      applyNameProjection(
        layerInfo,
        container?.querySelector(
          `[${CONST.DATA.LAYER_ID}="${CSS.escape(layerId)}"]`,
        ) as HTMLElement | null,
        ui.renamedNames[layerId],
      );
    }
    const layerInfo = registry.get(layerId);
    if (!layerInfo) continue; // not registered yet —its stored state is kept
    if (layerId in ui.opacityMap) {
      applyOpacityStateOne(ui, layerInfo, ui.opacityMap[layerId]);
    }
    if (ui.hiddenIds.has(layerId)) applyHiddenOne(ui, layerInfo, layerId);
    else if (ui.userOverrides[layerId]?.includes("visible")) {
      applyVisibleStateOne(ui, layerInfo);
    }
    // Zoom range is applied last: its effective-shown write depends on the
    // visibility intent just written, so it must run after the hidden /
    // visible branch. A hidden layer stays hidden regardless of zoom.
    if (layerId in ui.zoomRangeMap) {
      applyZoomRangeStateOne(ui, layerInfo, ui.zoomRangeMap[layerId]);
    }
  }

  // Deliberately no prune here. An unresolvable id is not proof of absence —
  // it may be a component that registers later, and the id space is bounded by
  // the layers an author ever declares, so the record cannot grow away.
  // Pruning was the one thing this sweep did that lost user work: the entry
  // went from memory *and* storage in the same pass, so a late-registered
  // layer (heatmap, measure) lost its stored opacity, zoom range, and
  // visibility on the first attach of every reload.

  // The order comes from the same read as the dimensions above, which lands
  // before late registrations -- so it is replayed across the registry that
  // exists now, and each later registration refines its own slot.
  ui.m.replaySavedOrder();
};

/**
 * Drop every persisted dimension for one layer —visibility, opacity, zoom
 * range, and the provenance that says the user set them.
 *
 * This is the only routine that erases a stored value, and it is reachable
 * from an explicit user action alone: "delete this layer". A layer that is
 * merely not registered right now must keep its stored state, because the
 * component that owns the id may register it later in this session or on the
 * next load —{@link applyUserState} projects it then, unchanged.
 *
 * The value and its provenance leave together: a provenance marker with no
 * value would be a record claiming the user chose something the record no
 * longer holds, and {@link markOverride} refuses that combination.
 */
const dropPersistedLayerState = (ui: LayerUI, id: string) => {
  ui.hiddenIds.delete(id);
  ui.rangeHiddenIds.delete(id);
  delete ui.opacityMap[id];
  delete ui.zoomRangeMap[id];
  delete ui.userOverrides[id];
};

/**
 * Apply one hidden id: remove the layer from the map, fire the toggle
 * callback (so callback-only canvas/heatmap layers hide themselves), and
 * sync the row's checkbox and tooltip.
 */

const applyHiddenOne = (ui: LayerUI, layerInfo: LayerInfo, id: string) => {
  const item = ui.uiContainer?.querySelector(
    `[${CONST.DATA.LAYER_ID}="${CSS.escape(id)}"]`,
  ) as HTMLElement | null;

  applyHiddenStateOne(ui, layerInfo);

  // One cell, one painter: read the intent after the state write, so the box
  // and the highlight cannot disagree with the row that just hid.
  if (item) applyRowView(ui, item, buildRowCell(ui, layerInfo));
};

/**
 * Hide one layer without touching its row —the map removal, the callback
 * for canvas-only layers, and the registry's `visible` flag.
 *
 * Split from {@link LayerUI.applyHiddenOne} because the registry projection
 * must run before the row is rendered: a late registration gets its
 * projection via {@link LayerUI.applyUserState}(id) before its row lands in
 * the DOM, so a callback-only layer hidden that way would otherwise stay
 * "visible" until the next full sweep and re-enter the map.
 */

/**
 * Apply one layer's opacity to the registry entry and to the live rendering.
 *
 * One pipeline, one carrier — every kind of layer resolves to exactly one
 * write target (see `LayerSurface.capabilities.opacity`):
 *
 *   - canvas element (its own CSS opacity; the §4.2 ① carrier for heatmap /
 *     measure, which still bake alpha at draw time — R11 will switch them to ②)
 *   - its own pane (declared, sub, or synthesized) — one CSS write reaches
 *     paths, markers, divIcons and canvases alike; multiplicative over
 *     whatever each feature carries, unlike the old per-feature walk which
 *     overwrote a hollow polygon's `fillOpacity: 0` with the slider value.
 *   - the layer's native setter (`ImageOverlay.setOpacity`, `TileLayer.options
 *     .opacity`) for the two shapes that own their own paint path.
 *   - "none": MarkerCluster's cluster icons stay in the shared `markerPane`,
 *     where `eachLayer` cannot reach them (§25.3-3); no honest write exists,
 *     so the value is not stored — a slider that writes nothing must not
 *     persist (§6.2).
 *
 * Called from the style panel's slider and reset buttons and from the
 * count-change event (which re-fires the layer's stored opacity at the moment
 * the real geometry lands after the preview ends).
 *
 * Both writes (opacity + visibility) are idempotent — callers may re-apply the
 * current value as many times as they like (the count-change event re-applies
 * opacity on every refresh, the visibility sweep may revisit a layer across
 * `CONTROL_ATTACHED` passes) without compounding the write.
 *
 * @param patch.opacity  — 0..1 slider value; written to whichever carrier
 *   `surface.capabilities.opacity` names. When the carrier is "none" no honest
 *   write exists, so the value is not stored — a slider that writes nothing
 *   must not persist (§6.2).
 * @param patch.visible — map membership for Leaflet layers, `onToggle` for
 *   callback-only ones (canvas layers use the shared `HIDDEN` class in
 *   `LayerFactory`, not a pane write); the row's checkbox is touched by the
 *   caller, not here.
 */
const applyLayerState = (
  ui: LayerUI,
  layerInfo: LayerInfo,
  patch: { opacity?: number; visible?: boolean },
) => {
  if (patch.opacity !== undefined) {
    if (layerInfo.canvas) {
      // The canvas element's own CSS opacity — the §4.2 ① carrier for the
      // createCanvas shape (heatmap / measure). Kept as a distinct branch
      // from the pane write: the pane's opacity would compound with this one,
      // and a single knob must not be multiplied twice (§4.2 "别把两处相乘成
      // 0.16 的坑").
      layerInfo.canvas.style.opacity = String(patch.opacity);
      layerInfo.opacity = patch.opacity;
    } else {
      const surface = ui.m.surfaceFor(layerInfo);
      const carrier = surface.capabilities.opacity;
      if (carrier !== "none") {
        const layer = layerInfo.layer;
        if (carrier === "native" && layer) {
          // The layer paints through a setter of its own. `setOpacity`
          // (ImageOverlay) is immediate; `options.opacity` (GridLayer /
          // TileLayer) is honoured at the next tile cycle. The slider is a
          // multiplier over the author's declared default: reading the base
          // from the option rather than from a cache would compound on every
          // drag (0.5 → 0.25 → 0.125 …), so the base is captured once.
          const opts = (layer.options ?? {}) as L.LayerOptions & { opacity?: number };
          const base = nativeBaseOf(layer);
          const target = base * patch.opacity;
          if (typeof (layer as L.ImageOverlay).setOpacity === "function") {
            (layer as L.ImageOverlay).setOpacity(target);
          } else {
            layer.options = opts;
            opts.opacity = target;
          }
          layerInfo.opacity = patch.opacity;
        } else if (carrier === "pane") {
          // One CSS write per pane we own — declared, sub, synthesized, or the
          // layer's annotation pane. Multiplicative over each feature's own
          // style, so a hollow polygon (fillOpacity: 0) keeps its hole.
          const names = [...surface.paneNames];
          const annotationPane = ui.m.annotation?.paneNameFor(layerInfo.id);
          if (annotationPane) names.push(annotationPane);
          for (const name of names) {
            const pane = ui.m.map.getPane(name);
            if (pane) pane.style.opacity = String(patch.opacity);
          }
          layerInfo.opacity = patch.opacity;
        }
      }
    }
  }
  if (patch.visible !== undefined) {
    const layer = layerInfo.layer ?? ui.m.findLayer(layerInfo);
    if (layer) {
      // Map membership — the same add/remove the checkbox path used. `addLayer`
      // is a no-op when the layer is already on the map, so a sweep can
      // re-apply without re-adding what folium already placed.
      const has = ui.m.map.hasLayer(layer);
      if (patch.visible && !has) ui.m.map.addLayer(layer);
      else if (!patch.visible && has) ui.m.map.removeLayer(layer);
    } else if (layerInfo.onToggle) {
      // Callback-only layers (canvas) have no Leaflet layer to add/remove —
      // fire the toggle so the canvas toggles its own `HIDDEN` class.
      layerInfo.onToggle(patch.visible);
    }
    // layerInfo.visible is a real-time mirror of the map state; the user's
    // intent lives in hiddenIds (hidden) or overrides (shown). This field is
    // written by both applyLayerState (this path) and the visibility sweep
    // (visibility.ts) — they agree on the same value, so the dual-writer is
    // intentional, not a race.
    layerInfo.visible = patch.visible;
  }
};

const applyHiddenStateOne = (ui: LayerUI, layerInfo: LayerInfo) => {
  applyLayerState(ui, layerInfo, { visible: false });
};

/**
 * Bring one layer back on to the map — the inverse of
 * {@link LayerUI.applyHiddenStateOne}.
 *
 * Needed because folium renders a `show=False` layer absent from the map
 * and nothing else ever puts it back. On reload such a layer is correctly
 * *absent* from `hiddenIds` (the user did not hide it), so the hide sweep
 * leaves it alone — and the map comes up with the author's default rather
 * than the user's last choice. This closes that half of the round trip.
 *
 * Delegates to {@link applyLayerState} like the hide and opacity wrappers —
 * the add/remove decision and the callback fallback stay in one place. That
 * delegation also carries the "safe to call unconditionally" contract:
 * `addLayer` is a no-op on a layer already on the map, so the sweep may apply
 * this to every unhidden layer without re-adding the layers folium placed, and
 * a callback-only layer (canvas) has no Leaflet layer to add, so it gets the
 * callback instead.
 */
const applyVisibleStateOne = (ui: LayerUI, layerInfo: LayerInfo) => {
  applyLayerState(ui, layerInfo, { visible: true });
};

/** Apply one layer's opacity to the registry entry and to the live rendering.
 *
 *  Delegates to {@link applyLayerState} — the single write pipeline. The
 *  carrier decision (pane / native / none) is made by `LayerSurface` at
 *  materialize time, so this function no longer needs to walk features
 *  or synthesize panes on demand.
 */
const applyOpacityStateOne = (ui: LayerUI, layerInfo: LayerInfo, opacity: number) => {
  applyLayerState(ui, layerInfo, { opacity });
};

/**
 * Replay one layer's stored intent at the moment a carrier for it appears.
 *
 * An annotation pane is created lazily — when labels first turn on, which can be
 * long after the slider was last moved — and nothing writes to a pane that does
 * not exist yet, so the pane's appearance is its own replay point. It must go
 * through the one write pipeline rather than setting the style itself:
 * `applyLayerState` is what resolves the carrier, so a layer whose carrier is its
 * own canvas keeps writing `canvas.style` instead of picking up a second,
 * multiplying write on a pane (§4.2).
 *
 * The name names the trigger, not the dimension: `visible` rides on map
 * membership / `onToggle` and `zoomRange` is a declaration, so neither goes
 * through a pane, and one hook per dimension would be wrong. The patch is
 * derived from `userOverrides` instead, so this replays what the user stored for
 * the id. A pane carries only opacity today — a fact about panes, not about this
 * hook — and when one gains a dimension the derivation below is what changes.
 *
 * Only stored values are replayed, so an untouched layer keeps the author's
 * declared default.
 */
const replayLayerState = (ui: LayerUI, id: string) => {
  const layerInfo = ui.m.layerRegistry.get(id);
  if (!layerInfo) return; // not registered yet —its stored state is kept
  const stored = ui.userOverrides[id] ?? [];
  const patch: { opacity?: number } = {};
  if (stored.includes("opacity")) {
    const opacity = ui.opacityMap[id];
    if (typeof opacity === "number") patch.opacity = opacity;
  }
  if (patch.opacity === undefined) return; // nothing stored — nothing to replay
  applyLayerState(ui, layerInfo, patch);
};

/** Compute one layer's effective shown state.
 *
 *  `effectiveShown = intent && (focusActive ? true : inRange)`. Only the
 *  derived value: this never writes to `hiddenIds` or `overrides` (which
 *  would flip the checkbox and persist a policy write — the exact bug #329
 *  locks against). Focus overrides the range, because the focus action is
 *  precisely "show me this layer even if it's outside the current range";
 *  zoom alone never overrides intent, because the user's checkbox wins.
 */
const computeEffectiveShown = (
  ui: LayerUI,
  layerInfo: LayerInfo,
  focusActive: boolean,
): boolean => {
  if (ui.hiddenIds.has(layerInfo.id)) return false;
  if (focusActive) return true;
  return inZoomRange(ui, layerInfo);
};

/** Apply the layer's stored zoom range to its carrier.
 *
 *  Dispatch by `capabilities.zoomRange` (§5.4-style capability-driven
 *  writer):
 *    - "native" — write `layer.options.minZoom/maxZoom` (only GridLayer
 *      honours min/maxZoom at runtime; ImageOverlay is "none").
 *    - "pane"   — write the effective shown state through the existing
 *      `applyLayerState` visible branch (map membership / `onToggle`).
 *    - "none"   — no honest carrier; the row is not rendered, so this
 *      is unreachable from the UI. Kept as a defensive no-op.
 *
 *  `null` clears the range: for "native" the options are deleted (back to
 *  the layer's declared default), for "pane" the effective shown is
 *  recomputed with no range (always in-range).
 */
const applyZoomRangeStateOne = (
  ui: LayerUI,
  layerInfo: LayerInfo,
  range: [number, number] | null,
  focusActive = false,
): void => {
  const caps = ui.m.surfaceFor(layerInfo).capabilities;
  if (caps.zoomRange === "native") {
    const layer = layerInfo.layer;
    if (!layer) return;
    const opts = layer.options as L.LayerOptions & {
      minZoom?: number;
      maxZoom?: number;
    };
    if (range) {
      opts.minZoom = range[0];
      opts.maxZoom = range[1];
    } else {
      delete opts.minZoom;
      delete opts.maxZoom;
    }
    // Leaflet does not self-apply options.minZoom/maxZoom: already-loaded
    // tiles stay until the level set is rebuilt. Without this call the range
    // would be silently stale — the user sets it and nothing changes on the
    // map (§6.2 "不得静默失效").
    resetGridLayerView(layer);
    return;
  }
  if (caps.zoomRange === "pane") {
    const shown = computeEffectiveShown(ui, layerInfo, focusActive);
    applyRangeVisible(ui, layerInfo, shown);
  }
  // "none": nothing to write.
};

/**
 * One-way gate for the zoom-range mechanism. The range never authorises
 * display on its own — it can only undo what it itself did:
 *
 *   - `shown === false` and the layer is on the map → remove it and record
 *     the id in `ui.rangeHiddenIds`.
 *   - `shown === true` and the id is in `ui.rangeHiddenIds` → the range
 *     itself took this layer off the map; restore it and drop the record.
 *   - Any other combination → leave the map alone.
 *
 * The last case is the fix for the quickstart regression: a folium
 * `show=False` layer has no entry in `hiddenIds` (the user did not hide it)
 * and no stored zoom range, so `computeEffectiveShown` returns `true` for
 * it and the old write put it back on the map on every zoomend — while the
 * checkbox stayed unchecked. That is not this mechanism's to decide; only
 * {@link applyUserState}'s unhide branch (a "visible" override present)
 * is authorised to re-add a layer the author left off the map.
 *
 * `layerInfo.visible` is written only when the map actually changes. The
 * registry field is a mirror of the map state, so writing it without a map
 * change would drift that mirror (and specifically would overwrite the
 * "author left it off the map" default with a policy assertion).
 */
const applyRangeVisible = (ui: LayerUI, layerInfo: LayerInfo, shown: boolean): void => {
  const layer = layerInfo.layer ?? ui.m.findLayer(layerInfo);
  if (layer) {
    const has = ui.m.map.hasLayer(layer);
    if (!shown && has) {
      ui.m.map.removeLayer(layer);
      ui.rangeHiddenIds.add(layerInfo.id);
      layerInfo.visible = false;
    } else if (shown && !has && ui.rangeHiddenIds.has(layerInfo.id)) {
      ui.m.map.addLayer(layer);
      ui.rangeHiddenIds.delete(layerInfo.id);
      layerInfo.visible = true;
    }
  } else if (layerInfo.onToggle) {
    // Callback-only (canvas) layers have no Leaflet layer to add/remove.
    // The sweep cannot reach them through `rangeHiddenIds` — it does not
    // record what it asks of a callback layer — so the write is one-shot:
    // `onToggle(shown)` and trust the layer's own `HIDDEN` class to be
    // idempotent (which it is: adding/removing a CSS class is a no-op).
    layerInfo.onToggle(shown);
  }
};

/** Re-evaluate every layer's effective shown state after a zoom change or
 *  a focus transition.
 *
 *  Only layers that can honestly carry a zoomRange write are touched:
 *  callback-only canvas layers (heatmap / measure) and basemaps are
 *  skipped because they have no range UI (§31.4-3), and `zoomRange: "none"`
 *  surfaces (MarkerCluster) are skipped because there is no carrier to
 *  write to (§6.2 "不得静默失效").
 *
 *  The sweep writes through {@link applyRangeVisible} — the one-way gate
 *  that keeps this mechanism from ever adding a layer to the map unless
 *  it removed that layer itself (see `rangeHiddenIds`). It therefore never
 *  touches `hiddenIds` or `overrides` either (the #329 lock).
 */
const refreshZoomEffectiveShown = (ui: LayerUI): void => {
  const focusActive = ui.focusingLayerId != null;
  for (const layerInfo of ui.m.layers) {
    if (layerInfo.isBase) continue;
    if (layerInfo.canvas) continue; // callback-only canvas: no zoom row
    const caps = ui.m.surfaceFor(layerInfo).capabilities;
    if (caps.zoomRange === "none") continue;
    if (caps.zoomRange === "native") continue; // Leaflet handles it
    const shown = computeEffectiveShown(ui, layerInfo, focusActive);
    applyRangeVisible(ui, layerInfo, shown);
  }
};

/** Save user-assigned names, coalescing rapid calls. */

const saveNamesState = (ui: LayerUI) => {
  ui.m.persistence.schedule({ renamedNames: () => ({ ...ui.renamedNames }) });
};

/** Full re-scan of every row (used on attach/fold-toggle). Idempotent — *  re-run on each CONTROL_ATTACHED so late-registering components are
 *  folded in. Marks the panel ready for tests/consumers. */

/**
 * Update the persisted hidden set for a layer toggle.
 * @param {boolean} persist - When false (bulk updates like toggleAll), the
 *   caller schedules a single save after the loop instead of resetting the
 *   debounce timer for every layer.
 */
const syncHiddenId = (
  ui: LayerUI,
  id: string,
  hidden: boolean,
  persist: boolean = true,
) => {
  if (hidden) ui.hiddenIds.add(id);
  else ui.hiddenIds.delete(id);
  // The user's explicit action (either direction) supersedes any record the
  // zoom-range mechanism kept for this id: without this line, a layer the
  // sweep had removed would be re-added by the sweep the moment the user
  // checked it back on, because the sweep's own record says "I removed
  // this, so I'm allowed to put it back".
  ui.rangeHiddenIds.delete(id);
  // The first change is what turns the author's default into the user's own
  // state: until it has happened the layer has no entry in `layers` at all, so
  // the unhide half of the sweep must leave it alone or an empty choice would
  // override the author's `show=False` on the next load.
  markOverride(ui, id, "visible");
  if (persist) saveState(ui);
};

/** Get all keyboard-navigable rows: layer items and toggle-all rows, in DOM
 *  order. The color item is excluded (it is a picker, not a layer).
 *
 *  Enumerates the row elements themselves, not their checkboxes. The old
 *  checkbox-first traversal silently dropped any row without a checkbox, so
 *  arrow-key navigation and Tab order could disagree about which rows exist.
 *  Rows are selected by class rather than `[tabindex]` because the inline
 *  rename input is also `tabindex=0` and is not a navigable row. */

export {
  loadPersistedState,
  saveFoldState,
  saveState,
  markOverride,
  unmarkOverride,
  applyUserState,
  dropPersistedLayerState,
  applyHiddenOne,
  applyHiddenStateOne,
  applyOpacityStateOne,
  replayLayerState,
  applyVisibleStateOne,
  applyZoomRangeStateOne,
  applyRangeVisible,
  computeEffectiveShown,
  refreshZoomEffectiveShown,
  saveNamesState,
  syncHiddenId,
};
