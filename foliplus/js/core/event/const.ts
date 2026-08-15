// core/events/const — semantic event names for cross-component communication.
// Components subscribe/emit via `map.foliplus.events` instead of raw Leaflet
// map events, so unrelated map activity does not trigger work.

/** Layer registry changed (registered / unregistered / reordered / toggled). */
export const LAYER_CHANGE = "foliplus:layerchange";

/** Active mode changed (MeasureControl measurement mode, SearchControl mode, ...). */
export const MODE_CHANGE = "foliplus:modechange";
