// core/event/type — payload contracts for the semantic event bus.
// Pure types: the shapes `EVENTS` names, keyed by the event constants so a
// payload and its event name cannot drift apart. Lives beside `const.ts`
// because the map is keyed by that dictionary's values.
import type { LayerKind } from "#core/layer/index.js";
import type { EVENTS } from "./const.js";

/** One layer's registry/membership change: who (`id`) and what it is (`kind`).
 *  Both fields are stamped by the emitter from the registry entry, so a
 *  subscriber that only cares about point sources, or about one id, filters
 *  on the payload instead of walking the registry. */
interface LayerChangePayload {
  id: string;
  kind: LayerKind;
}

interface EventPayloadMap {
  [EVENTS.LAYER_CHANGE]: LayerChangePayload;
  [EVENTS.LAYER_REMOVED]: { id: string };
  [EVENTS.LAYER_DELETED]: { id: string };
  [EVENTS.MODE_CHANGE]: { component: string; mode: string | null };
  [EVENTS.BEFORE_EXPORT]: { component: string };
  [EVENTS.AFTER_EXPORT]: { component: string };
  [EVENTS.LAYER_ITEM_COUNT_CHANGE]: { id: string };
  [EVENTS.LAYER_STYLE_CHANGE]: { id: string };
  [EVENTS.CONTROL_ATTACHED]: { component: string };
  [EVENTS.LAYER_ITEM_ADDED]: { id: string };
  [EVENTS.LAYER_ITEM_UPDATED]: { id: string };
  [EVENTS.LAYER_ITEM_REFRESHED]: { id: string };
  [EVENTS.LAYER_ITEM_REMOVED]: { id: string };
  [EVENTS.LAYER_GROUP_COUNT_CHANGED]: { group: string };
  [EVENTS.LAYER_LIST_REBUILD]: void;
  [EVENTS.LAYER_NO_BASEMAP_CHANGED]: void;
  [EVENTS.OVERLAY_CLEAR]: void;
}

export type { EventPayloadMap, LayerChangePayload };
