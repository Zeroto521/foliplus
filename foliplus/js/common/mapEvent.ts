// Map event binding helpers — bind a list of [eventName, handler] pairs at once.
// Imported statically by components. Replaces the repeated
// `map.on(...)` / `map.off(...)` 4-liner blocks (e.g. MeasureControl mode.js).
//
// Handlers are plain [event, fn] tuples; the same array can be passed to
// bindMapEvents and later to unbindMapEvents for symmetric cleanup.

type MapHandler = (...args: any[]) => void;
type MapEventHandlers = Array<[string, MapHandler]>;

/**
 * Bind multiple map event handlers at once.
 * @param map - Leaflet map.
 * @param handlers - Array of [eventName, handler] pairs.
 */
const bindMapEvents = (map: L.Map, handlers: MapEventHandlers): void => {
  handlers.forEach(([event, fn]) => map.on(event, fn));
};

/**
 * Unbind multiple map event handlers at once.
 * @param map - Leaflet map.
 * @param handlers - Array of [eventName, handler] pairs.
 */
const unbindMapEvents = (map: L.Map, handlers: MapEventHandlers): void => {
  handlers.forEach(([event, fn]) => map.off(event, fn));
};

export { bindMapEvents, unbindMapEvents, type MapEventHandlers };
