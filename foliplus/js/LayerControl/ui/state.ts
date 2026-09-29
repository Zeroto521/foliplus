// LayerControl UI — persisted user state (fold / hidden / names) apply + save.
//
// The record ↔ UI assembly layer: `loadPersistedState` fills the shell from
// the persistence record, the save/build helpers project it back, and the
// override markers keep provenance in step. Storage I/O and the record
// schema live in ../persistence.ts — this file only routes through
// LayerPersistence and never touches localStorage itself.
import { createLogger } from "#common/log.js";
import * as CONST from "../const.js";
import type { LayerManager } from "../manager.js";
import type { LayerIntent, LayerOverride, PersistedLayerState } from "../type.js";
import { applyProjection, applyProjectionAll } from "./apply.js";
import { applyNameProjection } from "./context.js";
import type { LayerUI } from "./index.js";
import { dropIntent, getIntent, hasIntentValue, setIntent } from "./intent.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).
const log = createLogger(CONF.name);

/** Load every persisted dimension in one call. */
const loadPersistedState = (ui: LayerUI) => {
  const state = ui.m.persistence.load();
  ui.foldedGroups = new Set(state.foldedGroups);
  // `ui.intents` is the single per-layer record. Name rides the same record
  // (`name`); disk shape stays `renamedNames` / `layers[id]`.
  ui.intents = {};
  for (const [id, name] of Object.entries(state.renamedNames)) {
    setIntent(ui, id, "name", name);
  }
  // Style (label) configs are applied by ui/style.ts once the layers resolve
  // (deferred init passes). Read order is the compat contract: the current
  // `layers[id].annotation` key WINS, the legacy top-level `annotations`
  // segment is the fallback underneath (write-new / read-old).
  for (const [id, raw] of Object.entries(state.annotations)) {
    if (raw != null) setIntent(ui, id, "annotation", raw as NonNullable<LayerIntent["annotation"]>);
  }
  // Per-layer intent: the value lives on `ui.intents[id]`, `overrides`
  // records that the user set it. A layer with no entry keeps the author's
  // declared default. Absent dimension means "the user never chose", not
  // "visible": the default visible is decided by `authorVisible` at the
  // projection sites.
  ui.intentProvenance = {};
  for (const [id, entry] of Object.entries(state.layers)) {
    // New-key label config overrides the legacy-segment fallback above.
    if (entry.annotation) setIntent(ui, id, "annotation", entry.annotation);
    ui.intentProvenance[id] = [...entry.overrides];
    if (entry.overrides.includes("visible") && typeof entry.visible === "boolean") {
      setIntent(ui, id, "visible", entry.visible);
    }
    if (entry.overrides.includes("fillColor") && entry.fillColor) {
      setIntent(ui, id, "fillColor", entry.fillColor);
    }
    if (
      entry.overrides.includes("fillOpacity") &&
      typeof entry.fillOpacity === "number"
    ) {
      setIntent(ui, id, "fillOpacity", entry.fillOpacity);
    }
    if (entry.overrides.includes("borderColor") && entry.borderColor) {
      setIntent(ui, id, "borderColor", entry.borderColor);
    }
    if (
      entry.overrides.includes("borderWeight") &&
      typeof entry.borderWeight === "number"
    ) {
      setIntent(ui, id, "borderWeight", entry.borderWeight);
    }
    const opacity = entry.opacity;
    if (entry.overrides.includes("opacity") && typeof opacity === "number") {
      setIntent(ui, id, "opacity", opacity);
    }
    // Value and provenance are validated together on read, so presence of the
    // provenance guarantees presence of the value.
    if (entry.overrides.includes("zoomRange") && entry.zoomRange) {
      setIntent(ui, id, "zoomRange", entry.zoomRange);
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
  switch (override) {
    case "visible":
      return hasIntentValue(ui, id, "visible");
    case "fillColor":
      return hasIntentValue(ui, id, "fillColor");
    case "fillOpacity":
      return hasIntentValue(ui, id, "fillOpacity");
    case "borderColor":
      return hasIntentValue(ui, id, "borderColor");
    case "borderWeight":
      return hasIntentValue(ui, id, "borderWeight");
    case "opacity":
      return hasIntentValue(ui, id, "opacity");
    case "zoomRange":
      return hasIntentValue(ui, id, "zoomRange");
    default:
      return true;
  }
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
const buildLayerStates = (ui: LayerUI): Record<string, PersistedLayerState> => {
  const states: Record<string, PersistedLayerState> = {};
  const annotations = Object.fromEntries(ui.m.annotation.configEntries());
  const ids = new Set([
    ...Object.keys(ui.intentProvenance ?? {}),
    ...Object.keys(annotations),
    ...Object.keys(ui.intents ?? {}),
  ]);
  for (const id of ids) {
    const declared = (ui.intentProvenance[id] ?? []).filter(override =>
      hasLiveValue(ui, id, override),
    );
    const annotation = annotations[id];
    if (declared.length === 0 && !annotation) continue;
    const state: PersistedLayerState = { overrides: declared };
    if (declared.includes("visible")) state.visible = getIntent(ui, id, "visible");
    const fillColor = getIntent(ui, id, "fillColor");
    if (declared.includes("fillColor") && typeof fillColor === "string") {
      state.fillColor = fillColor;
    }
    const fillOpacity = getIntent(ui, id, "fillOpacity");
    if (declared.includes("fillOpacity") && typeof fillOpacity === "number") {
      state.fillOpacity = fillOpacity;
    }
    const borderColor = getIntent(ui, id, "borderColor");
    if (declared.includes("borderColor") && typeof borderColor === "string") {
      state.borderColor = borderColor;
    }
    const borderWeight = getIntent(ui, id, "borderWeight");
    if (declared.includes("borderWeight") && typeof borderWeight === "number") {
      state.borderWeight = borderWeight;
    }
    const opacity = getIntent(ui, id, "opacity");
    if (declared.includes("opacity") && typeof opacity === "number") {
      state.opacity = opacity;
    }
    if (declared.includes("zoomRange")) {
      state.zoomRange = getIntent(ui, id, "zoomRange");
    }
    if (annotation) state.annotation = annotation;
    states[id] = state;
  }
  return states;
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
const markOverride = (ui: LayerUI, id: string, override: LayerOverride) => {
  if (!hasLiveValue(ui, id, override)) {
    log.warn(
      `markOverride("${override}", "${id}"): no stored value for this dimension, ` +
        `marker not recorded — set the value before marking`,
    );
    return;
  }
  const overrides = ui.intentProvenance[id] ?? [];
  if (!overrides.includes(override)) overrides.push(override);
  ui.intentProvenance[id] = overrides;
};

/** Drop one dimension's provenance -- the single rule a Reset button reduces to,
 *  sending the value back to the author's declared default. */
const unmarkOverride = (ui: LayerUI, id: string, override: LayerOverride) => {
  const overrides = (ui.intentProvenance[id] ?? []).filter(entry => entry !== override);
  if (overrides.length > 0) ui.intentProvenance[id] = overrides;
  else delete ui.intentProvenance[id];
};

/**
 * Propagate the user's stored state —hidden visibility and renames —
 * into the registry and the rendered rows.
 *
 * `intents.visible` and `renamedNames` are the source of truth; the registry's
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
  // through `applyProjection` keeps exactly one writer of map membership. The
  // per-dimension helpers below were a second writer, and the state it wrote
  // drifted away from the checkbox whenever the author's snapshot landed after
  // the first projection — which is the normal order on folium 0.20+, where a
  // `show=False` layer is not on the map at boot and the snapshot can only be
  // taken once its JS global exists.
  if (id) {
    const layerInfo = registry.get(id);
    if (!layerInfo) return; // not registered yet —its stored state is kept
    // One id, one projection: a late registration replays every stored
    // dimension on the same pass — visibility, opacity and zoom range — so
    // nothing needs a per-caller replay path: a late arrival replays itself.
    applyProjection(ui, id);
    const rename = getIntent(ui, id, "name");
    if (rename != null) {
      applyNameProjection(layerInfo, null, rename);
    }
    // The order dimension is replayed on the same pass: this path runs once per
    // late registration, so without it the layer would keep the slot it was
    // inserted into rather than the position the user already arranged.
    ui.m.replaySavedOrder(id);
    return;
  }

  // The registry is the sweep, not `intents.visible`: a layer the user left
  // visible is absent from `intents.visible` by design, so iterating that map
  // alone can never reach it and the hide half of the round trip has no
  // inverse. Walking the registry asserts every layer's map membership
  // against the persisted intent; the color basemap has no registry entry,
  // so its rename still comes from `renamedNames`.
  applyProjectionAll(ui);
  for (const layerId of Object.keys(ui.intents ?? {})) {
    const rename = getIntent(ui, layerId, "name");
    if (rename == null) continue;
    if (layerId === CONST.SOLID_BASEMAP_ID) {
      // The color basemap has no registry entry —only its row label.
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
    if (!layerInfo) continue; // not registered yet —its stored state is kept
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
  // Style dimensions + their provenance. `name` / `annotation` are cleared
  // by their own callers (manager delete / annotation destroy).
  dropIntent(ui, id);
  delete ui.intentProvenance[id];
};

/** Save user-assigned names, coalescing rapid calls. */

const saveNamesState = (ui: LayerUI) => {
  const names: Record<string, string> = {};
  for (const [id, intent] of Object.entries(ui.intents ?? {})) {
    if (typeof intent.name === "string") names[id] = intent.name;
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
  setIntent(ui, id, "visible", visible);
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
  saveNamesState,
  setVisible,
};
