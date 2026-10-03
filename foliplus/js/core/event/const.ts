// core/events/const — semantic event names.
// Components subscribe/emit via `map.foliplus.events` instead of raw Leaflet
// map events, so unrelated map activity does not trigger work.
// The payload shapes these names carry live in ./type.ts.

// ── Event name dictionary (unified <namespace>:<component>:<action> naming) ──
const EVENTS = {
  /** The registry or map membership changed for one layer: registered,
   *  unregistered, reordered, toggled on/off, or re-attached. Carries the
   *  layer's id and kind so subscribers never re-query the registry. */
  LAYER_CHANGE: "foliplus:layer:change",
  /** A layer left the registry through the generic teardown
   *  (`unregisterLayer`): the id is gone from the registry but stays
   *  registerable — nothing about a teardown says the user's stored state is
   *  unwanted, so a component that empties itself re-registers cleanly. This
   *  is emitted by *every* unregister path, including a component's own
   *  empty-data self-unregister, so it must never be read as "the user
   *  deleted this". */
  LAYER_REMOVED: "foliplus:layer:removed",
  /** The user deleted a component-owned layer from the panel. Emitted only
   *  by `deleteLayer` for layers that own `styleSetters` — the id is not
   *  retired and the component owns the data wipe (Measure `clearAll`,
   *  Heatmap reset). Component-owned deletes never emit LAYER_REMOVED, and
   *  user-added layer deletes never emit this: the two channels are disjoint
   *  per deletion path. */
  LAYER_DELETED: "foliplus:layer:deleted",
  /** A component's active mode changed (measurement start/stop, search mode switch). */
  MODE_CHANGE: "foliplus:mode:change",
  /** Export process started (crop locked / download initiated). */
  BEFORE_EXPORT: "foliplus:export:before",
  /** Export completed (success / failure / abort). */
  AFTER_EXPORT: "foliplus:export:after",
  /** A layer's feature count changed (data update / feature add/remove). */
  LAYER_ITEM_COUNT_CHANGE: "foliplus:layer:item-count-change",
  /** A layer's style value changed — subscribers pull the fresh value from
   *  the layer's styleProvider (the event carries the id, never the value). */
  LAYER_STYLE_CHANGE: "foliplus:layer:style-change",
  /** A control finished attaching to the map (onAdd complete). Lets
   *  LayerControl run its init pass from a ready signal instead of a timer. */
  CONTROL_ATTACHED: "foliplus:control:attached",
  /** A new row entered the panel: the registry accepted a fresh id and the
   *  list needs to insert a row for it. Carries the id — subscribers that
   *  need the row's fields pull the LayerInfo from the registry (the id is
   *  the sole carrier; the event is a signal, not a data pipe). */
  LAYER_ITEM_ADDED: "foliplus:layer:item-added",
  /** An existing row was re-registered: its content or metadata changed and
   *  the row needs updating. Same "id-only" payload contract as LAYER_ITEM_ADDED. */
  LAYER_ITEM_UPDATED: "foliplus:layer:item-updated",
  /** A row left the panel through the generic teardown path (unregisterLayer)
   *  — a wider reach than LAYER_REMOVED for the UI subscribers: the fields
   *  cache, the style-dimension apply schedulers, and the group toggle-all
   *  must all reconcile. Kept disjoint from LAYER_REMOVED (registry contract)
   *  so the two channels stay separately subscribable. */
  LAYER_ITEM_REMOVED: "foliplus:layer:item-removed",
  /** The group's row count shifted (a row joined or left, the toggle-all
   *  checkbox tri-state may have changed) — the group's row-count summary
   *  needs recomputing. Fires with LAYER_ITEM_ADDED / LAYER_ITEM_UPDATED /
   *  LAYER_ITEM_REMOVED when the count is affected, and on its own after a
   *  user delete. */
  LAYER_GROUP_COUNT_CHANGED: "foliplus:layer:group-count-changed",
  /** The panel's row order changed and the whole list needs a full DOM
   *  rebuild + full type/visibility rescan: bringLayerToFront and the
   *  moveLayerUp/Down paths all route here (moveLayerUp/Down already called
   *  a full rebuild internally — the previous "reindexAfterMove" wrapper
   *  was its alias, kept for symmetry). */
  LAYER_LIST_REBUILD: "foliplus:layer:list-rebuild",
  /** The solid-color basemap row's state changed — the panel's no-basemap
   *  hint / row state needs recomputing. Only deleteLayer of the color id
   *  fires this in-tree today. */
  LAYER_NO_BASEMAP_CHANGED: "foliplus:layer:no-basemap-changed",
  /** A floating overlay is being opened — every peer overlay (menu, attrs,
   *  style, rename, focus, and Leaflet's popups) tears itself down. Each
   *  peer subscribes to this and decides for itself whether to close and
   *  how: the menu returns focus to its row, the panels don't, rename
   *  commits rather than cancels. The `reason` field is a hint for
   *  subsystems that care about *why* (today only "open" is emitted; the
   *  "destroy" arm is reserved for map teardown to distinguish a user-
   *  driven dismiss from a container being removed). */
  OVERLAY_CLEAR: "foliplus:layer:overlay-clear",
} as const;

export { EVENTS };
