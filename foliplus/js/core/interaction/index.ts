// core/interaction — keyboard / input ownership / list navigation.
export { InteractionManager, ensureInteraction } from "./interaction.js";
export type { InteractionDef } from "./interaction.js";
export {
  OWNER_KEYS,
  isNativeControl,
  keyOwner,
  nativeClass,
  nativeConsumesKey,
} from "./inputOwnership.js";
export { ListCursor } from "./listCursor.js";
export type {
  ListCursorMode,
  ListCursorOptions,
  ListCursorRoles,
} from "./listCursor.js";
