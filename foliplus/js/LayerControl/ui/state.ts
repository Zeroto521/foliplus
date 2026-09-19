// LayerControl UI —Persisted user state (fold / hidden / names) apply + save.
import { type Debounced, debounce } from "#common/debounce.js";
import * as CONST from "../const.js";
import { applyNameProjection } from "./context.js";
import type { LayerUI } from "./index.js";

/** Load every persisted dimension in one call. */
const loadPersistedState = (ui: LayerUI) => {
  const state = ui.m.persistence.load();
  ui.foldedGroups = state.foldedGroups;
  ui.hiddenIds = state.hiddenIds;
  ui.renamedNames = state.names;
  ui.hiddenHasState = state.hiddenHasState;
  // Style (label) configs are stored on the UI shell and applied by
  // ui/style.ts once the layers resolve (deferred init passes).
  ui.labelConfigs = state.annotations;
  ui.opacityMap = state.opacity;
};

/** Save fold state to localStorage. */

const saveFoldState = (ui: LayerUI) => {
  ui.m.persistence.saveFoldedGroups(ui.foldedGroups);
};

/** Save hidden-layer ids to localStorage, coalescing rapid calls. */

const saveHiddenIds = (ui: LayerUI) => {
  ui.m.persistence.saveHiddenIds(() => ui.hiddenIds);
};

/** Save per-layer opacity map to localStorage, coalescing rapid calls. */
const saveOpacityMap = (ui: LayerUI) => {
  ui.m.persistence.saveOpacity(() => ui.opacityMap);
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
    else if (ui.hiddenHasState) applyVisibleStateOne(ui, layerInfo);
  }

  // Prune ids whose layers are gone for good, so stale persistence does not
  // accumulate. Live means "in the registry or still queued in
  // pendingRegistrations" —attachUI drains that queue before this sweep, so
  // neither implies a layer that will come back. The cost is a third-party
  // layer hidden and re-registered on a later activation: it re-enters
  // visible rather than coming back hidden. Keeping such ids would make the
  // prune a no-op and let the set grow without bound.
  //
  // Persisted, because only the live ids are written back: the write can
  // never drop an id that still resolves to a layer, so nothing is lost even
  // though this runs before initLayerItem has corrected any checkbox.
  const pending = new Set(ui.m.pendingRegistrations.map(li => li.id));
  const stillPresent = (layerId: string) =>
    registry.get(layerId) != null || pending.has(layerId);
  const gone = [...ui.hiddenIds].filter(layerId => !stillPresent(layerId));
  if (gone.length > 0) {
    ui.hiddenIds = new Set([...ui.hiddenIds].filter(layerId => stillPresent(layerId)));
    ui.hiddenHasState = true;
    saveHiddenIds(ui);
  }
  // Opacity is the same absolute-map shape as names: a stale id that no
  // longer resolves to a layer must not accumulate. Unlike hidden ids there
  // is no "absent key" semantics to preserve — a missing entry simply means
  // fully opaque — so pruning on every sweep is safe.
  const goneOpacity = Object.keys(ui.opacityMap).filter(id => !stillPresent(id));
  if (goneOpacity.length > 0) {
    for (const id of goneOpacity) delete ui.opacityMap[id];
    saveOpacityMap(ui);
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
 *  `paneSpecs` entry is component-owned, and the pane a `LayerSurface`
 *  synthesizes for a layer that declared none is named after the layer's stamp,
 *  so it holds that layer alone. A blocklist could not tell that apart from a
 *  pane a host deliberately shares between two layers, which must not be faded.
 *
 *  `registerLayer` materializes the surface before the layer joins the map, so
 *  the synthesized pane is the layer's real home from the start; the empty
 *  answer is for an entry whose live layer the registry has not resolved. */
const privatePanesOf = (ui: LayerUI, layerInfo: LayerInfo): string[] => {
  const specs = layerInfo.paneSpecs ?? [];
  if (specs.length > 0) return specs.map(s => s.name);
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

/**
 * Rebuild {@link LayerUI.hiddenIds} from the rendered rows, making the set
 * absolute instead of "ids the user toggled".
 *
 * A layer the author declared `show=False` is off the map and absent from
 * `hiddenIds`, so checking it on calls `hiddenIds.delete(id)` on an id that
 * was never added and leaves the set unchanged. Every subsequent toggle then
 * differs from the author's defaults by zero entries, so the saved set cannot
 * distinguish "user hid this" from "author hid this" and a reload restores the
 * author's `show=False` instead of the user's choice. Reading the rows closes
 * that gap.
 *
 * Runs once, straight after the first
 * {@link LayerUI.initTypesAndVisibility} pass has corrected every checkbox
 * from `map.hasLayer()`. That pass repeats on fold-toggle, and only ids
 * already in the registry are considered, so the set never acquires a stale
 * id and no later pass writes again.
 *
 * It writes only when the set actually changed. On an unchanged load -- the
 * common case, where the user comes back and sees the author's defaults -- a
 * write would replace a previously saved set with the current one, which
 * still holds ids this map no longer registers. Those ids had been pruned
 * before the rows rendered, so this would be a write that drops saved state
 * the user made. Skipping keeps the load read-only.
 */

const reconcileHiddenIds = (ui: LayerUI) => {
  const container = ui.uiContainer;
  if (!container) return;

  // Additions only. A row can read as checked while its id sits in hiddenIds
  // -- initLayerItem derives the checkbox from map.hasLayer(), so any map
  // that still reports membership (stale state, a stub in tests) makes the
  // row disagree with the set applyUserState() just built. Deleting here
  // would then discard state the user persisted, so the disagreement is
  // trusted in one direction only. Removal belongs to the change paths, where
  // a user actually acted: handleChange, syncAllChecked, deselectAllBaseMaps.
  let changed = false;
  for (const li of ui.m.layers) {
    const item = container.querySelector(
      `[${CONST.DATA.LAYER_ID}="${CSS.escape(li.id)}"]`,
    ) as HTMLElement | null;
    const checkbox = item?.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement | null;
    if (!checkbox || checkbox.checked || ui.hiddenIds.has(li.id)) continue;
    ui.hiddenIds.add(li.id);
    changed = true;
  }
  if (changed) {
    ui.hiddenHasState = true;
    saveHiddenIds(ui);
  }
};

/** Save user-assigned names, coalescing rapid calls. */

const saveNamesState = (ui: LayerUI) => {
  ui.m.persistence.saveNames(() => ui.renamedNames);
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
  // The first change is what turns author defaults into the user's state.
  // Until it has happened the visibility key does not exist, so the unhide
  // half of the sweep must stay off or an empty saved set would override the
  // author's `show=False` on the next load.
  ui.hiddenHasState = true;
  if (persist) saveHiddenIds(ui);
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
  saveHiddenIds,
  saveOpacityMap,
  applyUserState,
  applyHiddenOne,
  applyHiddenStateOne,
  applyOpacityStateOne,
  applyVisibleStateOne,
  reconcileHiddenIds,
  saveNamesState,
  syncHiddenId,
};
