// LayerControl UI —Persisted user state (fold / hidden / names) apply + save.
import { createLogger } from "#common/log.js";
import * as CONST from "../const.js";
import type { LayerManager } from "../manager.js";
import type { LayerOverride, PersistedLayerState } from "../persistence.js";
import { applyProjection, applyProjectionAll } from "./apply.js";
import { applyNameProjection } from "./context.js";
import type { LayerUI } from "./index.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).
const log = createLogger(CONF.name);

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
  ui.fillColorMap = {};
  ui.fillOpacityMap = {};
  ui.borderColorMap = {};
  ui.borderWeightMap = {};
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
    if (entry.overrides.includes("fillColor") && entry.fillColor) {
      ui.fillColorMap[id] = entry.fillColor;
    }
    if (
      entry.overrides.includes("fillOpacity") &&
      typeof entry.fillOpacity === "number"
    ) {
      ui.fillOpacityMap[id] = entry.fillOpacity;
    }
    if (entry.overrides.includes("borderColor") && entry.borderColor) {
      ui.borderColorMap[id] = entry.borderColor;
    }
    if (
      entry.overrides.includes("borderWeight") &&
      typeof entry.borderWeight === "number"
    ) {
      ui.borderWeightMap[id] = entry.borderWeight;
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
  if (override === "fillColor") return typeof ui.fillColorMap[id] === "string";
  if (override === "fillOpacity") return typeof ui.fillOpacityMap[id] === "number";
  if (override === "borderColor") return typeof ui.borderColorMap[id] === "string";
  if (override === "borderWeight") return typeof ui.borderWeightMap[id] === "number";
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
    const fillColor = ui.fillColorMap[id];
    if (declared.includes("fillColor") && typeof fillColor === "string") {
      state.fillColor = fillColor;
    }
    const fillOpacity = ui.fillOpacityMap[id];
    if (declared.includes("fillOpacity") && typeof fillOpacity === "number") {
      state.fillOpacity = fillOpacity;
    }
    if (declared.includes("borderColor") && ui.borderColorMap[id]) {
      state.borderColor = ui.borderColorMap[id];
    }
    if (declared.includes("borderWeight") && ui.borderWeightMap[id] !== undefined) {
      state.borderWeight = ui.borderWeightMap[id];
    }
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

  // visible / opacity / zoomRange belong to the diff executor: one write per
  // dimension, diffed against the executor's own last write. Routing them
  // through `applyProjection` keeps exactly one writer of map membership and
  // of the `layerInfo.visible` mirror. The per-dimension helpers below were a
  // second writer, and the mirror drifted away from the checkbox whenever the
  // author's snapshot landed after the first projection — which is the normal
  // order on folium 0.20+, where a `show=False` layer is not on the map at
  // boot and the snapshot can only be taken once its JS global exists.
  if (id) {
    const layerInfo = registry.get(id);
    if (!layerInfo) return; // not registered yet —its stored state is kept
    // One id, one projection: a late registration replays every stored
    // dimension on the same pass — visibility, opacity and zoom range — so
    // nothing needs a per-caller replay path: a late arrival replays itself.
    applyProjection(ui, id);
    if (id in ui.renamedNames) {
      applyNameProjection(layerInfo, null, ui.renamedNames[id]);
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
  applyProjectionAll(ui);
  for (const layerId of Object.keys(ui.renamedNames)) {
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
  delete ui.opacityMap[id];
  delete ui.zoomRangeMap[id];
  delete ui.fillColorMap[id];
  delete ui.fillOpacityMap[id];
  delete ui.borderColorMap[id];
  delete ui.borderWeightMap[id];
  delete ui.userOverrides[id];
};

/**
 * Replay one layer's stored intent at the moment a carrier for it appears.
 *
 * An annotation pane is created lazily — when labels first turn on, which can
 * be long after the slider was last moved — and nothing writes to a pane that
 * does not exist yet, so the pane's appearance is its own replay point.
 *
 * Going through the diff executor rather than setting the style directly is
 * what keeps this honest: the executor resolves whichever write target is
 * right for this layer (a canvas-only layer keeps writing `canvas.style`
 * instead of picking up a second, multiplying write on a pane), and its
 * carrier identity already treats "the carrier set grew" as a change — so
 * the stored value lands on the new pane and nowhere else.
 *
 * Only stored values are replayed, so an untouched layer keeps the author's
 * declared default: the projection reads the per-dimension maps, which hold
 * nothing for a layer the user never touched.
 */
const replayLayerState = (ui: LayerUI, id: string) => {
  const layerInfo = ui.m.layerRegistry.get(id);
  if (!layerInfo) return; // not registered yet
  // Only a dimension the user actually set is replayed here. A bare stored
  // value is what `unmarkOverride` (Reset) leaves behind, and a marker with
  // no value is not a value to send — so neither is a replay. An untouched
  // layer keeps the author's declared default.
  const flagged = (ui.userOverrides?.[id] ?? []).includes("opacity");
  if (!flagged || typeof ui.opacityMap?.[id] !== "number") return;
  applyProjection(ui, id);
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
  replayLayerState,
  saveNamesState,
  syncHiddenId,
};
