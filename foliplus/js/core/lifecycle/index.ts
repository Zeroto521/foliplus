// core/lifecycle/index — the lifecycle-domain barrel.
//
// The lifecycle modules (component, controlEnv, defineControl, guard,
// leafletAdapter, mapApi, mode, type) form the control-lifecycle subgraph:
// defineControl wraps component/controlEnv/guard, mode is the per-control
// mode state machine, leafletAdapter bridges the Leaflet privates. This
// barrel forwards their public names unchanged so a consumer may import
// #core/lifecycle/index.js instead of eight deep paths. The individual
// modules stay the source of truth; this file adds no names of its own.
export { COMPONENTS, assertComponentName, generateId } from "./component.js";
export { createControlEnv } from "./controlEnv.js";
export { defineControl } from "./defineControl.js";
export { requireFoliplus, requireRuntime } from "./guard.js";
export type { PixelRadiusLeaf } from "./leafletAdapter.js";
export {
  attributionEntries,
  destroyPane,
  getRendererContainer,
  getRendererFor,
  hasAttachedPath,
  internalLayers,
  isGroupLike,
  isPixelRadiusLeaf,
  layerElements,
  layerIcon,
  layerShadow,
  detachMarkerIcons,
  layerMap,
  layerUrl,
  primeControlMap,
  refreshAttributions,
  reinitInteraction,
  setPopupCloseTitle,
} from "./leafletAdapter.js";
export { ensureMapFoliplus } from "./mapApi.js";
export { ModeManager, ensureModes, guardBlocked } from "./mode.js";
export type { ControlEnv } from "./type.js";
