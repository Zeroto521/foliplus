// core/leaflet/type — shared Leaflet-adapter type definitions.

type MapHandler = L.LeafletEventHandlerFn;
type MapEventHandlers = Array<[string, MapHandler]>;

export type { MapEventHandlers, MapHandler };
