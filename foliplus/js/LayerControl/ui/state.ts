// LayerControl UI — persisted user state (fold / hidden / names) apply + save.
//
// The record ↔ UI assembly layer: `loadPersistedState` fills the shell from
// the persistence record, the save/build helpers project it back, and the
// override markers keep provenance in step. Storage I/O and the record
// schema live in ../persistence.ts — this file only routes through
// LayerPersistence and never touches localStorage itself.
//
// Intent load/build/mark/unmark/drop sink into `ui.intentStore`; the
// exported names stay as thin delegates so callers and test spies are
// unchanged.
import { createLogger } from "#common/log.js";
import * as CONST from "../const.js";
import type { LayerManager } from "../manager.js";
import type { LayerOverride } from "../type.js";
import { applyProjection, applyProjectionAll } from "./apply.js";
import { applyNameProjection } from "./context.js";
import type { LayerUI } from "./index.js";
import { INTENT, LIVE, getIntent } from "./intent.js";
import type { ListPanel } from "./listPanel.js";

// CONFIG is a free variable from the IIFE template wrapper (see BaseControl._template).
const log = createLogger(CONFIG.name);

/** Load every persisted dimension in one call. */
const loadPersistedState = (lp: ListPanel, ui: LayerUI) => {
  const state = ui.m.persistence.load();
  lp.foldedGroups = new Set(state.foldedGroups);
  // Intent values + provenance sink into the store. Read order is the compat
  // contract: the current `layers[id].annotation` key WINS, the legacy
  // top-level `annotations` segment is the fallback underneath (write-new /
  // read-old).
  ui.intentStore.loadFromPersisted({
    renamedNames: state.renamedNames,
    annotations: state.annotations,
    layers: state.layers,
  });
};

/** Save fold state to localStorage. */

const saveFoldState = (lp: ListPanel, ui: LayerUI) => {
  ui.m.persistence.schedule({ foldedGroups: () => [...lp.foldedGroups] });
};

/** Whether one dimension still holds a live value. An override with none means
 *  the user reset it, so the dimension drops back to the author's declared
 *  default instead of persisting an empty choice. Unknown overrides (future
 *  dimensions) are treated as live so markOverride never drops a new marker. */
const hasLiveValue = (ui: LayerUI, id: string, override: LayerOverride): boolean => {
  const live = LIVE[override];
  return live ? live(getIntent(ui, id, override)) : true;
};

/** Build the record's `layers` section from the live state: one entry per
 *  layer the user has actually touched, so an untouched layer keeps the
 *  author's declared default across a reload.
 *
 *  The label (annotation) config is the one rider that does not follow the
 *  touch rule: it is a style configuration with no override provenance, so
 *  every id the annotation manager holds a config for joins the walk — a
 *  layer configured *only* for labels still gets an entry (with an empty
 *  `overrides` array, which `parseLayerState` keeps for exactly this). */
const buildLayerStates = (ui: LayerUI) => {
  const annotations = Object.fromEntries(ui.m.annotation.configEntries());
  return ui.intentStore.toPersisted(annotations);
};

/** Save the per-layer intent -- visibility, opacity, zoom range and the
 *  label config -- coalescing rapid calls. */
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
/**
 * @internal Production write paths use LayerIntentStore.set (cohesive mark). Kept
 * as a thin delegate for test spies and the mark-without-set gate.
 */
const markOverride = (ui: LayerUI, id: string, override: LayerOverride) => {
  if (!hasLiveValue(ui, id, override)) {
    log.warn(
      `markOverride("${override}", "${id}"): no stored value for this dimension, ` +
        `marker not recorded — set the value before marking`,
    );
    return;
  }
  ui.intentStore.mark(id, override);
};

/** Drop one dimension's provenance -- the single rule a Reset button reduces to,
 *  sending the value back to the author's declared default. */
/**
 * @internal Production resets use LayerIntentStore.clear (cohesive unmark).
 */
const unmarkOverride = (ui: LayerUI, id: string, override: LayerOverride) => {
  ui.intentStore.unmark(id, override);
};

/**
 * Propagate the user's stored state — hidden visibility and renames —
 * into the registry and the rendered rows.
 *
 * `ui.intentStore` (the visible / name dimensions) is the source of truth; the
 * registry's `LayerInfo.visible` / `LayerInfo.name` and the row checkboxes /
 * labels are their projections, refreshed here whenever a row or the registry
 * is rebuilt from a third-party layer's own metadata. Hidden is a same-axis
 * overwrite of `visible`, so it writes straight through; name is a
 * cross-axis projection that must preserve the author's original name, so
 * it goes through `applyNameProjection`, which writes only where the
 * projection still differs — a repeated pass is therefore a no-op.
 *
 * The sweep is a pure projection: it never prunes and never writes back.
 * A persisted id with no registry entry is *ignored*, not treated as
 * evidence that its stored state should go. That distinction is the whole
 * point — HeatmapControl and MeasureControl register in their own
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
 * @param {string} [id] Restrict to one layer id — a late-arriving row is
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
  // through `applyProjection` keeps exactly one writer of map membership. The
  // per-dimension helpers below were a second writer, and the state it wrote
  // drifted away from the checkbox whenever the author's snapshot landed after
  // the first projection — which is the normal order on folium 0.20+, where a
  // `show=False` layer is not on the map at boot and the snapshot can only be
  // taken once its JS global exists.
  if (id) {
    const layerInfo = registry.get(id);
    if (!layerInfo) return; // not registered yet — its stored state is kept
    // One id, one projection: a late registration replays every stored
    // dimension on the same pass — visibility, opacity and zoom range — so
    // nothing needs a per-caller replay path: a late arrival replays itself.
    applyProjection(ui, id, "none");
    const rename = getIntent(ui, id, INTENT.NAME);
    if (rename != null) {
      applyNameProjection(layerInfo, null, rename);
    }
    // The order dimension is replayed on the same pass: this path runs once per
    // late registration, so without it the layer would keep the slot it was
    // inserted into rather than the position the user already arranged.
    ui.m.replaySavedOrder(id);
    return;
  }

  // The registry is the sweep, not the intent store: a layer the user left
  // visible has no visible entry by design, so iterating the intent records
  // alone can never reach it and the hide half of the round trip has no
  // inverse. Walking the registry asserts every layer's map membership
  // against the persisted intent; the color basemap has no registry entry,
  // so its rename still comes from the store's name dimension.
  applyProjectionAll(ui, "none");
  for (const layerId of ui.intentStore.ids()) {
    const rename = getIntent(ui, layerId, INTENT.NAME);
    if (rename == null) continue;
    if (layerId === CONST.SOLID_BASEMAP_ID) {
      // The color basemap has no registry entry — only its row label.
      applyNameProjection(
        null,
        container?.querySelector(
          `[${CONST.DATA.LAYER_ID}="${CSS.escape(layerId)}"]`,
        ) as HTMLElement | null,
        rename,
      );
      continue;
    }
    const layerInfo = registry.get(layerId);
    if (!layerInfo) continue; // not registered yet — its stored state is kept
    applyNameProjection(
      layerInfo,
      container?.querySelector(
        `[${CONST.DATA.LAYER_ID}="${CSS.escape(layerId)}"]`,
      ) as HTMLElement | null,
      rename,
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
 * Drop every persisted dimension for one layer — visibility, opacity, zoom
 * range, and the provenance that says the user set them.
 *
 * This is the only routine that erases a stored value, and it is reachable
 * from an explicit user action alone — delete a layer from its menu, or clear
 * a component's data (Heatmap's panel Clear button, LayerControl's overflow
 * Clear Data). A layer that is merely not registered right now must keep its
 * stored state, because the component that owns the id may register it later
 * in this session or on the next load
 * —{@link applyUserState} projects it then, unchanged.
 *
 * The value and its provenance leave together: a provenance marker with no
 * value would be a record claiming the user chose something the record no
 * longer holds, and {@link markOverride} refuses that combination.
 *
 * @returns true if a row was dropped, false when nothing was stored for
 *   this id — a layer that never received a user value has nothing to erase.
 */
const dropPersistedLayerState = (ui: LayerUI, id: string): boolean => {
  // Style dimensions + their provenance. `name` / `annotation` are cleared
  // by their own callers (manager delete / annotation destroy).
  return ui.intentStore.dropRow(id);
};

/** Save user-assigned names, coalescing rapid calls. */

const saveNamesState = (ui: LayerUI) => {
  const names: Record<string, string> = {};
  for (const [id, name] of ui.intentStore.nameEntries()) {
    names[id] = name;
  }
  ui.m.persistence.schedule({ renamedNames: () => names });
};

/** Full re-scan of every row (used on attach/fold-toggle). Idempotent —
 *  re-run on each CONTROL_ATTACHED so late-registering components are
 *  folded in. Marks the panel ready for tests/consumers. */

/**
 * Record one layer's visibility as the user's own intent: write the value and
 * its provenance marker in the same call. This is the only writer of the
 * visible dimension — there is no second mirror to keep in step, so a toggle
 * can never desync the value from the provenance.
 * @param {boolean} persist - When false (bulk updates like toggleAll), the
 *   caller schedules a single save after the loop instead of resetting the
 *   debounce timer for every layer.
 */
const setVisible = (
  ui: LayerUI,
  id: string,
  visible: boolean,
  persist: boolean = true,
) => {
  // Cohesive write: value + provenance in one step. The user's explicit
  // action (either direction) supersedes any record the zoom-range mechanism
  // kept for this id: without the mark, a layer the sweep had removed would
  // be re-added by the sweep the moment the user checked it back on, because
  // the sweep's own record says "I removed this, so I'm allowed to put it
  // back". The first change is what turns the author's default into the
  // user's own state.
  ui.intentStore.set(id, INTENT.VISIBLE, visible);
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
  buildLayerStates,
  loadPersistedState,
  saveFoldState,
  saveState,
  markOverride,
  unmarkOverride,
  applyUserState,
  dropPersistedLayerState,
  saveNamesState,
  setVisible,
};
