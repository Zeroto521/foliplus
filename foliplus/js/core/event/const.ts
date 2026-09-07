// core/events/const — semantic event names and metadata registry.
// Components subscribe/emit via `map.foliplus.events` instead of raw Leaflet
// map events, so unrelated map activity does not trigger work.
import { COMPONENTS } from "#core/component.js";

// ── Event name dictionary (unified <namespace>:<component>:<action> naming) ──
const EVENTS = {
  /** Layer registry changed (registered / unregistered / reordered / toggled). */
  LAYER_CHANGE: "foliplus:layer:change",
  /** A layer was removed from the registry by an external caller (e.g. panel delete). */
  LAYER_REMOVED: "foliplus:layer:removed",
  /** A component's active mode changed (measurement start/stop, search mode switch). */
  MODE_CHANGE: "foliplus:mode:change",
  /** Export process started (crop locked / download initiated). */
  BEFORE_EXPORT: "foliplus:export:before",
  /** Export completed (success / failure / abort). */
  AFTER_EXPORT: "foliplus:export:after",
  /** A layer's feature count changed (data update / feature add/remove). */
  LAYER_ITEM_COUNT_CHANGE: "foliplus:layer:item-count-change",
} as const;

// ── Type-safe payload map ──

interface EventPayloadMap {
  [EVENTS.LAYER_CHANGE]: undefined;
  [EVENTS.LAYER_REMOVED]: { id: string };
  [EVENTS.MODE_CHANGE]: { component: string; mode: string | null };
  [EVENTS.BEFORE_EXPORT]: { component: string };
  [EVENTS.AFTER_EXPORT]: { component: string };
  [EVENTS.LAYER_ITEM_COUNT_CHANGE]: { id: string };
}

// ── Event metadata registry ──
interface EventMeta {
  description: string;
  publisher: string;
  subscribers: string[];
  payload: string;
}

const EVENT_REGISTRY: Record<string, EventMeta> = {
  [EVENTS.LAYER_CHANGE]: {
    description:
      "Layer registry changed (registered / unregistered / reordered / toggled)",
    publisher: COMPONENTS.LayerManager,
    subscribers: [COMPONENTS.HeatmapControl],
    payload: "undefined",
  },
  [EVENTS.LAYER_REMOVED]: {
    description:
      "A layer was removed from the registry by an external caller (e.g. panel delete)",
    publisher: COMPONENTS.LayerManager,
    subscribers: [COMPONENTS.MeasureControl],
    payload: "{ id: string }",
  },
  [EVENTS.MODE_CHANGE]: {
    description:
      "A component's active mode changed (measurement start/stop, search mode switch)",
    publisher: "ModeManager",
    subscribers: [COMPONENTS.MeasureControl],
    payload: "{ component: string; mode: string | null }",
  },
  [EVENTS.BEFORE_EXPORT]: {
    description: "Export process started — crop locked or download initiated",
    publisher: COMPONENTS.ExportControl,
    subscribers: [COMPONENTS.MeasureControl, COMPONENTS.LayerControl],
    payload: "{ component: string }",
  },
  [EVENTS.AFTER_EXPORT]: {
    description: "Export completed — success, failure, or abort",
    publisher: COMPONENTS.ExportControl,
    subscribers: [],
    payload: "{ component: string }",
  },
  [EVENTS.LAYER_ITEM_COUNT_CHANGE]: {
    description: "A layer's feature count changed (data update / feature add/remove)",
    publisher: "LayerManager",
    subscribers: [COMPONENTS.LayerControl],
    payload: "{ id: string }",
  },
};

export { type EventMeta, type EventPayloadMap, EVENTS, EVENT_REGISTRY };
