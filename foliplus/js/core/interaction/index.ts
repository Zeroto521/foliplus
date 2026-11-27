// core/interaction — keyboard / input ownership / list navigation / exclusive map interaction.
export { ensureInteraction } from "./interactionManager.js";
export {
  OWNER_KEYS,
  claimKeys,
  isKeyClaimed,
  isNativeControl,
  keyOwner,
  nativeClass,
  nativeConsumesKey,
} from "./inputOwnership.js";
export { ListCursor } from "./listCursor.js";
export { suspendMapInteractions } from "./suspend.js";
