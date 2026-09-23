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
 * Propagate the user's stored state —hidden visibility, opacity, zoom range,
 * renames, and the saved order—into the registry and the rendered rows.
 *
 * The executor owns the first three (visible / opacity / zoomRange): a diff
 * against its own last write, so a layer whose stored state arrived after
 * its own registration reaches the map on the same drain the sweep always
 * ran on. Before this refactor those dimensions lived in per-call helpers
 * walked by hand — the structural root of T46 and #329 (§22-9.1). Rename
 * and order are cross-axis projections that must preserve the author's
 * original name and the user's manual arrangement, so they ride here.
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
  applyProjectionAll(ui);

  const registry = ui.m.layerRegistry;
  const container = ui.uiContainer;
  if (id) {
    if (id in ui.renamedNames) {
      if (id === CONST.COLOR.MAP_ID) {
        applyNameProjection(
          null,
          container?.querySelector(
            `[${CONST.DATA.LAYER_ID}="${CSS.escape(id)}"]`,
          ) as HTMLElement | null,
          ui.renamedNames[id],
        );
      } else {
        const layerInfo = registry.get(id);
        if (layerInfo) {
          applyNameProjection(
            layerInfo,
            container?.querySelector(
              `[${CONST.DATA.LAYER_ID}="${CSS.escape(id)}"]`,
            ) as HTMLElement | null,
            ui.renamedNames[id],
          );
        }
      }
    }
    ui.m.replaySavedOrder(id);
    return;
  }

  for (const layerId of Object.keys(ui.renamedNames)) {
    if (layerId === CONST.COLOR.MAP_ID) {
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
    if (!layerInfo) continue;
    applyNameProjection(
      layerInfo,
      container?.querySelector(
        `[${CONST.DATA.LAYER_ID}="${CSS.escape(layerId)}"]`,
      ) as HTMLElement | null,
      ui.renamedNames[layerId],
    );
  }
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
  delete ui.userOverrides[id];
};

/**
 * Replay one layer's stored intent at the moment a carrier for it appears.
 *
 * An annotation pane is created lazily — when labels first turn on, which can
 * be long after the slider was last moved — and nothing writes to a pane that
 * does not exist yet, so the pane's appearance is its own replay point. Going
 * through the executor rather than setting the style directly means the
 * carrier dispatcher resolves whichever write target is honest for this
 * layer: a canvas-only layer keeps writing `canvas.style` instead of
 * picking up a second, multiplying write on a pane (§4.2).
 *
 * Only stored values are replayed, so an untouched layer keeps the
 * author's declared default.
 */
const replayLayerState = (ui: LayerUI, id: string) => {
  const layerInfo = ui.m.layerRegistry.get(id);
  if (!layerInfo) return; // not registered yet —its stored state is kept
  if (!(ui.userOverrides[id] ?? []).includes("opacity")) return;
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
