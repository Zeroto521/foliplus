// core/interaction — keyboard / input ownership / list navigation.
export { InteractionManager, ensureInteraction } from "./interactionManager.js";
export type { InteractionDef } from "./interactionManager.js";
export {
  OWNER_KEYS,
  isNativeControl,
  keyOwner,
  nativeClass,
  nativeConsumesKey,
} from "./inputOwnership.js";
export { ListCursor } from "./listCursor.js";
