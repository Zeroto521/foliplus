// core/lifecycle/index — the lifecycle-domain barrel.
//
// The lifecycle modules (component, controlEnv, defineControl, guard,
// mode, type) form the control-lifecycle subgraph: defineControl wraps
// component/controlEnv/guard; mode is the per-control mode state machine.
// (leafletAdapter + mapApi moved to core/ root — zero-dependency leaves.)
// barrel forwards their public names unchanged so a consumer may import
// #core/lifecycle/index.js instead of eight deep paths. The individual
// modules stay the source of truth; this file adds no names of its own.
export { COMPONENTS, assertComponentName, generateId } from "./component.js";
export { createControlEnv } from "./controlEnv.js";
export { defineControl } from "./defineControl.js";
export { requireFoliplus, requireRuntime } from "./guard.js";
export { ModeManager, ensureModes, guardBlocked } from "./mode.js";
export type { ControlEnv } from "./type.js";
