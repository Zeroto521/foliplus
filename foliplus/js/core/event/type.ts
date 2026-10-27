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

/** The user's visibility choice moved. Payload carries the fresh intent
 *  so a subscriber that mirrors the choice (checkbox state, external
 *  slider, mode badge) does not have to round-trip through the registry
 *  to read what the user just set. Same id-only carrier shape as
 *  LAYER_CHANGE — this one additionally carries the resolved value. */
interface LayerIntentChangePayload {
  id: string;
  kind: LayerKind;
  intent: { visible: boolean };
}

/** A layer's filter moved (stage 2, component-internal). Id-only signal —
 *  the filter's owner (the component that declared `filterProvider`) has
 *  already applied and rendered the change when this publishes; observers
 *  that need the value pull it through the same `filterProvider`, never
 *  from the payload. Same carrier shape as LAYER_STYLE_CHANGE. */
interface LayerFilterChangePayload {
  id: string;
}

interface EventPayloadMap {
  [EVENTS.LAYER_CHANGE]: LayerChangePayload;
  [EVENTS.LAYER_INTENT_CHANGE]: LayerIntentChangePayload;
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
  [EVENTS.LAYER_CAPABILITY_CHANGED]: { id: string };
  [EVENTS.LAYER_ITEM_REMOVED]: { id: string };
  [EVENTS.LAYER_ROLE_COUNT_CHANGED]: { role: string };
  [EVENTS.LAYER_LIST_REBUILD]: void;
  [EVENTS.LAYER_NO_BASEMAP_CHANGED]: void;
  [EVENTS.OVERLAY_CLEAR]: void;
  [EVENTS.LAYER_FILTER_CHANGE]: LayerFilterChangePayload;
}

export type { EventPayloadMap };
