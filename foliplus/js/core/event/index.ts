// core/event — cross-component event bus (per-map, singular dir).
export { ensureEvents } from "./EventBus.js";
export { subscribe, subscribeLayers } from "./subscription.js";
export { EVENTS, EVENT_POLICY, EVENT_POLICY_KIND } from "./const.js";
export type { EventPayloadMap, EventOrigin, EventMeta } from "./type.js";
export { EventBus, SettledOperation, publish } from "./EventBus.js";
export type { DispatchFailure, EventHandler, ListenerPhase } from "./EventBus.js";
