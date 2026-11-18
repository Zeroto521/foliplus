// core/event/type — payload contracts for the semantic event bus.
// Pure types: the shapes `EVENTS` names, keyed by the event constants so a
// payload and its event name cannot drift apart. Lives beside `const.ts`
// because the map is keyed by that dictionary's values.
import type { EVENTS } from "./const.js";
import type { LayerKind } from "#core/layer/index.js";

/** Who moved a layer's state, and by which route. Discriminated by `kind`
 *  so a subscriber can gate on the coarse class ("was this the user at all?")
 *  without naming a route, and on `via` when it must. The three kinds are
 *  the whole vocabulary — a new `kind` is a design change, not an addition.
 *
 *  This is the field that replaces the per-subscriber self-echo flags
 *  (`writing`, `panelIsSource`): those booleans were synchronous state that
 *  could not tell a delayed echo from a real change. */
type EventOrigin =
  | { readonly kind: "user"; readonly via: UserVia }
  | { readonly kind: "programmatic"; readonly via: ProgrammaticVia }
  | { readonly kind: "system"; readonly via: SystemVia };

/** A `user` route: how a person's intent reached the bus. */
type UserVia = "panel" | "api" | "keyboard" | "drag" | "url";

/** A `programmatic` route: the control driving its own state on the user's
 *  behalf (an init pass, a refresh, a scheduled task, or its own write). */
type ProgrammaticVia = "init" | "refresh" | "task" | "self";

/** A `system` route: the runtime's own bookkeeping (teardown, policy,
 *  reset). */
type SystemVia = "teardown" | "policy" | "reset";

/** The write token a panel filter write stamps onto the change it causes:
 *  the owning layer id plus a monotonically increasing sequence the filter
 *  store owns. The panel keeps its own last token and matches it against the
 *  payload to recognise its own echo — a synchronous boolean cannot, because
 *  the owner's publish may arrive after the write has already returned. */
type WriteToken = readonly [layerId: string, seq: number];

/** One layer's registry/membership change: who (`id`) and what it is
 *  (`kind`). Both fields are stamped by the emitter from the registry entry,
 *  so a subscriber that only cares about point sources, or about one id,
 *  filters on the payload instead of walking the registry. */
interface LayerChangePayload {
  id: string;
  kind: LayerKind;
  /** Who moved membership, and by which route. */
  readonly origin: EventOrigin;
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
  readonly origin: EventOrigin;
}

/** A layer's filter moved (stage 2, component-internal). Id-only signal —
 *  the filter's owner (the component that declared `filterProvider`) has
 *  already applied and rendered the change when this publishes; observers
 *  that need the value pull it through the same `filterProvider`, never
 *  from the payload. Same carrier shape as LAYER_STYLE_CHANGE. */
interface LayerFilterChangePayload {
  id: string;
  readonly origin: EventOrigin;
  /** The token of the panel write that caused this change, when there is
 *   *  one. The panel matches it against its own last token and skips the
 *   *  reconcile for its own echo; an event without a token is never its
 *   *  own, so it is always honoured. */
  writeToken?: WriteToken;
}

/** The payload every id-keyed layer event carries: which layer moved
 *  (`id`) and who moved it (`origin`). */
interface IdLayerPayload {
  id: string;
  readonly origin: EventOrigin;
}

interface EventPayloadMap {
  [EVENTS.LAYER_CHANGE]: LayerChangePayload;
  [EVENTS.LAYER_INTENT_CHANGE]: LayerIntentChangePayload;
  [EVENTS.LAYER_REMOVED]: IdLayerPayload;
  [EVENTS.LAYER_DELETED]: IdLayerPayload;
  [EVENTS.MODE_CHANGE]: { component: string; mode: string | null; readonly origin: EventOrigin };
  [EVENTS.BEFORE_EXPORT]: { component: string; readonly origin: EventOrigin };
  [EVENTS.AFTER_EXPORT]: { component: string; readonly origin: EventOrigin };
  [EVENTS.LAYER_ITEM_COUNT_CHANGE]: IdLayerPayload;
  [EVENTS.LAYER_STYLE_CHANGE]: IdLayerPayload;
  [EVENTS.CONTROL_ATTACHED]: { component: string };
  [EVENTS.LAYER_ITEM_ADDED]: IdLayerPayload;
  [EVENTS.LAYER_ITEM_UPDATED]: IdLayerPayload;
  [EVENTS.LAYER_ITEM_REFRESHED]: IdLayerPayload;
  [EVENTS.LAYER_CAPABILITY_CHANGED]: IdLayerPayload;
  [EVENTS.LAYER_ITEM_REMOVED]: IdLayerPayload;
  [EVENTS.LAYER_ROLE_COUNT_CHANGED]: { role: string };
  [EVENTS.LAYER_LIST_REBUILD]: void;
  [EVENTS.LAYER_NO_BASEMAP_CHANGED]: void;
  [EVENTS.OVERLAY_CLEAR]: void;
  [EVENTS.LAYER_FILTER_CHANGE]: LayerFilterChangePayload;
}

export type {
  EventOrigin,
  EventPayloadMap,
};
