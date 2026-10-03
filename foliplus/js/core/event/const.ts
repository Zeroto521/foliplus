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
} as const;

export { EVENTS };
