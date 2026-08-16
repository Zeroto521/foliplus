// core/events/const — semantic event names and metadata registry.
// Components subscribe/emit via `map.foliplus.events` instead of raw Leaflet
// map events, so unrelated map activity does not trigger work.
import { COMPONENTS } from "#core/component.js";

// ── Event name dictionary (unified <namespace>:<component>:<action> naming) ──
export const EVENTS = {
  /** Layer registry changed (registered / unregistered / reordered / toggled). */
  LAYER_CHANGE: "foliplus:layer:change",
  /** A component's active mode changed (measurement start/stop, search mode switch, fullscreen toggle). */
  MODE_CHANGE: "foliplus:mode:change",
  /** Export process started (crop locked / download initiated). */
  BEFORE_EXPORT: "foliplus:export:before",
  /** Export completed (success / failure / abort). */
  AFTER_EXPORT: "foliplus:export:after",
} as const;

// Named re-exports for concise use in components.
export const { LAYER_CHANGE, MODE_CHANGE, BEFORE_EXPORT, AFTER_EXPORT } = EVENTS;

// ── Type-safe payload map ──

export interface EventPayloadMap {
  [EVENTS.LAYER_CHANGE]: undefined;
  [EVENTS.MODE_CHANGE]: { component: string; mode: string | null };
  [EVENTS.BEFORE_EXPORT]: { component: string };
  [EVENTS.AFTER_EXPORT]: { component: string };
}

// ── Event metadata registry ──
export interface EventMeta {
  description: string;
  publisher: string;
  subscribers: string[];
  payload: string;
}

export const EVENT_REGISTRY: Record<string, EventMeta> = {
  [EVENTS.LAYER_CHANGE]: {
    description:
      "Layer registry changed (registered / unregistered / reordered / toggled)",
    publisher: COMPONENTS.LayerManager,
    subscribers: [COMPONENTS.HeatmapControl],
    payload: "undefined",
  },
  [EVENTS.MODE_CHANGE]: {
    description:
      "A component's active mode changed (measurement start/stop, search mode switch, fullscreen toggle)",
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
};
