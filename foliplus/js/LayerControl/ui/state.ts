// LayerControl UI —Persisted user state (fold / hidden / names) apply + save.
import * as CONST from "../const.js";
import type { LayerOverride, PersistedLayerState } from "../persistence.js";
import { applyNameProjection } from "./context.js";
import type { LayerUI } from "./index.js";

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
 *  what turns an author's declared default into the user's own state. */
const markOverride = (ui: LayerUI, id: string, override: LayerOverride) => {
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
 * The sweep also prunes ids whose layers no longer exist so stale
 * persistence doesn't accumulate.
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
    if (!layerInfo) return; // stale id —pruned by persistence on save
    // Both projections are membership-guarded —this path runs for every
    // late registration, including layers the user never touched. A layer
    // that was never hidden must not be hidden, and a missing rename is a
    // no-op rather than a write of undefined over the registry's own name.
    if (ui.hiddenIds.has(id)) applyHiddenStateOne(ui, layerInfo);
    if (id in ui.renamedNames) {
      applyNameProjection(layerInfo, null, ui.renamedNames[id]);
    }
    if (id in ui.opacityMap) applyOpacityStateOne(ui, layerInfo, ui.opacityMap[id]);
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
      if (!layerInfo) continue; // stale id —pruned by persistence on save
      applyNameProjection(
        layerInfo,
        container?.querySelector(
          `[${CONST.DATA.LAYER_ID}="${CSS.escape(layerId)}"]`,
        ) as HTMLElement | null,
        ui.renamedNames[layerId],
      );
    }
    const layerInfo = registry.get(layerId);
    if (!layerInfo) continue; // stale id —pruned by persistence on save
    if (layerId in ui.opacityMap) {
      applyOpacityStateOne(ui, layerInfo, ui.opacityMap[layerId]);
    }
    if (ui.hiddenIds.has(layerId)) applyHiddenOne(ui, layerInfo, layerId);
    else if (ui.userOverrides[layerId]?.includes("visible")) {
      applyVisibleStateOne(ui, layerInfo);
    }
  }

  // Prune ids whose layers are gone for good, so the record cannot grow
  // without bound. Live means "in the registry or still queued in
  // pendingRegistrations" —attachUI drains that queue before this sweep, so
  // neither implies a layer that will come back. The cost is a third-party
  // layer hidden and re-registered on a later activation: it re-enters
  // visible rather than coming back hidden. Value and provenance are pruned in
  // one pass so the record never keeps an override for a layer it no longer
  // records a value for; the write can only drop ids that stopped resolving,
  // so nothing live is lost even though this runs before initLayerItem has
  // corrected any checkbox.
  const pending = new Set(ui.m.pendingRegistrations.map(li => li.id));
  const stillPresent = (layerId: string) =>
    registry.get(layerId) != null || pending.has(layerId);
  const gone = new Set(
    [
      ...ui.hiddenIds,
      ...Object.keys(ui.opacityMap),
      ...Object.keys(ui.zoomRangeMap),
      ...Object.keys(ui.userOverrides),
    ].filter(layerId => !stillPresent(layerId)),
  );
  if (gone.size > 0) {
    ui.hiddenIds = new Set([...ui.hiddenIds].filter(layerId => !gone.has(layerId)));
    for (const layerId of gone) {
      delete ui.opacityMap[layerId];
      delete ui.zoomRangeMap[layerId];
      delete ui.userOverrides[layerId];
    }
    saveState(ui);
  }
};

/**
 * Apply one hidden id: remove the layer from the map, fire the toggle
 * callback (so callback-only canvas/heatmap layers hide themselves), and
 * sync the row's checkbox and tooltip.
 */

const applyHiddenOne = (ui: LayerUI, layerInfo: LayerInfo, id: string) => {
  const container = ui.uiContainer;
  const item = container
    ? container.querySelector(`[${CONST.DATA.LAYER_ID}="${CSS.escape(id)}"]`)
    : null;
  const checkbox = item?.querySelector(
    'input[type="checkbox"]',
  ) as HTMLInputElement | null;

  applyHiddenStateOne(ui, layerInfo);

  if (checkbox) {
    checkbox.checked = false;
    checkbox.title = ui.T("select_tooltip");
  }
  item?.classList.remove(CONST.CLASSES.ACTIVE);
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

const applyHiddenStateOne = (ui: LayerUI, layerInfo: LayerInfo) => {
  const layer = ui.m.findLayer(layerInfo);

  // Callback-only layers (canvas) have no Leaflet layer to remove —fire
  // the toggle callback so the canvas itself hides.
  if (!layer && layerInfo.onToggle) layerInfo.onToggle(false);
  else if (layer && ui.m.map.hasLayer(layer)) ui.m.map.removeLayer(layer);

  layerInfo.visible = false;
};

/**
 * Bring one layer back on to the map —the inverse of
 * {@link LayerUI.applyHiddenStateOne}.
 *
 * Needed because folium renders a `show=False` layer absent from the map
 * and nothing else ever puts it back. On reload such a layer is correctly
 * *absent* from `hiddenIds` (the user did not hide it), so the hide sweep
 * leaves it alone —and the map comes up with the author's default rather
 * than the user's last choice. This closes that half of the round trip.
 *
 * `addLayer` is a no-op when the layer is already on the map, so the sweep
 * can call this for every unhidden layer without re-adding the layers
 * folium already placed. Callback-only layers (canvas) have no Leaflet
 * layer to add, so they get the callback instead.
 */

const applyVisibleStateOne = (ui: LayerUI, layerInfo: LayerInfo) => {
  const layer = ui.m.findLayer(layerInfo);

  if (!layer && layerInfo.onToggle) layerInfo.onToggle(true);
  else if (layer && !ui.m.map.hasLayer(layer)) ui.m.map.addLayer(layer);

  layerInfo.visible = true;
};

/** The panes this layer alone renders into, or `[]` when it has none yet.
 *
 *  Ownership, not a list of Leaflet's shared pane names: a declared
 *  `subPanes` entry is component-owned, and the pane a `LayerSurface`
 *  synthesizes for a layer that declared none is named after the layer's stamp,
 *  so it holds that layer alone. A blocklist could not tell that apart from a
 *  pane a host deliberately shares between two layers, which must not be faded.
 *
 *  `registerLayer` materializes the surface before the layer joins the map, so
 *  the synthesized pane is the layer's real home from the start; the empty
 *  answer is for an entry whose live layer the registry has not resolved. */
const privatePanesOf = (ui: LayerUI, layerInfo: LayerInfo): string[] => {
  if (layerInfo.subPanes?.length > 0) return layerInfo.subPanes;
  const layer = layerInfo.layer;
  if (!layer) return [];
  const own = ui.m.fallbackPaneOf(layer);
  return own ? [own] : [];
};

/** Layers the per-feature walk has written to. The walk and the pane carrier
 *  are alternatives, never layers of one another: a plain folium layer joins the
 *  map through folium's own script, so it can be painted from a shared pane for
 *  the moment before the ordering pass gives it a surface — a layer can start on
 *  the walk and then resolve to a pane. */
const walkedLayers = new WeakSet<L.Layer>();

/**
 * Apply one layer's opacity to the registry entry and to the live rendering.
 *
 * The pane is the preferred carrier for every kind of layer: one style write
 * regardless of how many features the layer holds (a many-thousand-point
 * GeoJSON must not be swept on every slider step), CSS opacity multiplies with
 * each feature's own style instead of overwriting it, and it reaches paths,
 * markers and divIcons alike.
 *
 * `createCanvas` layers paint on a single element, which is the same deal.
 * Only a layer whose content is still in a pane it does not own falls back to
 * the per-feature walk — the window before `enforceOrder` has migrated it.
 */
const applyOpacityStateOne = (ui: LayerUI, layerInfo: LayerInfo, opacity: number) => {
  layerInfo.opacity = opacity;
  if (layerInfo.canvas) {
    layerInfo.canvas.style.opacity = String(opacity);
    return;
  }
  const layer = layerInfo.layer;
  const panes = privatePanesOf(ui, layerInfo);
  if (panes.length > 0) {
    // Undo any earlier walk before handing over to the pane, or the two would
    // stack: the walk's per-feature value times the pane's, so a layer asked
    // for 0.4 twice would render at 0.16.
    if (layer && walkedLayers.has(layer)) {
      applyLeafletOpacity(layer, 1);
      walkedLayers.delete(layer);
    }
    for (const name of panes) {
      const pane = ui.m.map.getPane(name);
      if (pane) pane.style.opacity = String(opacity);
    }
    return;
  }
  if (layer) walkedLayers.add(layer);
  applyLeafletOpacity(layer, opacity);
};

/** Each feature's own opacity, captured the first time it is touched.
 *
 *  Leaflet's `setStyle` / `setOpacity` are absolute, so writing the layer
 *  opacity straight in would destroy the feature's own value — a hollow
 *  polygon's `fillOpacity: 0` became 0.4 and its fill appeared instead of
 *  staying hollow. Storing the base once and always writing
 *  `base × layerOpacity` keeps the feature's own style intact and makes
 *  repeated passes idempotent (the base is read once, never from the value we
 *  just wrote). */
const baseOpacity = new WeakMap<L.Layer, { opacity: number; fillOpacity: number }>();

/** A leaf that can carry an opacity, plus the options the base is read from. */
type OpacityCapable = L.Layer & {
  options?: { opacity?: number; fillOpacity?: number };
  setStyle?: (style: { opacity: number; fillOpacity: number }) => void;
  eachLayer?: (fn: (l: L.Layer) => void) => void;
  setOpacity?: (v: number) => void;
};

const baseOpacityOf = (layer: OpacityCapable, fill: boolean) => {
  let base = baseOpacity.get(layer);
  if (!base) {
    const opts = layer.options ?? {};
    base = {
      opacity: typeof opts.opacity === "number" ? opts.opacity : 1,
      fillOpacity: fill && typeof opts.fillOpacity === "number" ? opts.fillOpacity : 1,
    };
    baseOpacity.set(layer, base);
  }
  return base;
};

/** Recursive opacity application over a Leaflet layer tree.
 *
 *  Groups are walked first, then leaves: a `L.GeoJSON` exposes `setStyle`, but
 *  Leaflet's implementation only forwards it to `Path` children, silently
 *  skipping `Marker`s — which is why a point layer (folium's marker / divIcon
 *  layers) ignored the opacity control. Descending through `eachLayer` reaches
 *  every leaf, and a leaf then gets whichever API it actually has. */
const applyLeafletOpacity = (layer: L.Layer | null, opacity: number): void => {
  if (!layer) return;
  const target = layer as OpacityCapable;
  if (typeof target.eachLayer === "function") {
    target.eachLayer(child => applyLeafletOpacity(child, opacity));
    return;
  }
  if (typeof target.setStyle === "function") {
    const base = baseOpacityOf(target, true);
    target.setStyle({
      opacity: base.opacity * opacity,
      fillOpacity: base.fillOpacity * opacity,
    });
    return;
  }
  if (typeof target.setOpacity === "function") {
    // Marker / ImageOverlay: opacity is a CSS value on their element, so it
    // multiplies with whatever the icon already carries.
    const base = baseOpacityOf(target, false);
    target.setOpacity(base.opacity * opacity);
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
  applyHiddenOne,
  applyHiddenStateOne,
  applyOpacityStateOne,
  applyVisibleStateOne,
  saveNamesState,
  syncHiddenId,
};
