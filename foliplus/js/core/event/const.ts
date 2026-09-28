// core/events/const — semantic event names.
// Components subscribe/emit via `map.foliplus.events` instead of raw Leaflet
// map events, so unrelated map activity does not trigger work.

// ── Event name dictionary (unified <namespace>:<component>:<action> naming) ──
const EVENTS = {
  /** Layer registry changed (registered / unregistered / reordered / toggled). */
  LAYER_CHANGE: "foliplus:layer:change",
  /** A layer was removed from the registry by an external caller (e.g. panel delete). */
  LAYER_REMOVED: "foliplus:layer:removed",
  /** A layer was deleted from the panel — component-owned layers clear their
   *  data instead of being marked permanently removed. */
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

// ── Type-safe payload map ──

interface EventPayloadMap {
  [EVENTS.LAYER_CHANGE]: undefined;
  [EVENTS.LAYER_REMOVED]: { id: string };
  [EVENTS.LAYER_DELETED]: { id: string };
  [EVENTS.MODE_CHANGE]: { component: string; mode: string | null };
  [EVENTS.BEFORE_EXPORT]: { component: string };
  [EVENTS.AFTER_EXPORT]: { component: string };
  [EVENTS.LAYER_ITEM_COUNT_CHANGE]: { id: string };
  [EVENTS.LAYER_STYLE_CHANGE]: { id: string };
  [EVENTS.CONTROL_ATTACHED]: { component: string };
}

export { EVENTS };
export type { EventPayloadMap };
