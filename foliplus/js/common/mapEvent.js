// Map event binding helpers — bind a list of [eventName, handler] pairs at once.
// Imported statically by components (谁用谁 import). Replaces the repeated
// `map.on(...)` / `map.off(...)` 4-liner blocks (e.g. MeasureControl mode.js).
//
// Handlers are plain [event, fn] tuples; the same array can be passed to
// bindMapEvents and later to unbindMapEvents for symmetric cleanup.

/**
 * Bind multiple map event handlers at once.
 * @param {L.Map} map - Leaflet map.
 * @param {Array<[string, Function]>} handlers - Array of [eventName, handler] pairs.
 */
const bindMapEvents = (map, handlers) => {
  handlers.forEach(([ev, fn]) => map.on(ev, fn));
};

/**
 * Unbind multiple map event handlers at once.
 * @param {L.Map} map - Leaflet map.
 * @param {Array<[string, Function]>} handlers - Array of [eventName, handler] pairs.
 */
const unbindMapEvents = (map, handlers) => {
  handlers.forEach(([ev, fn]) => map.off(ev, fn));
};

export { bindMapEvents, unbindMapEvents };
