// LayerControl UI — LayerAccess: the la face of the phase-2 injection split.
//
// The cross-module, cross-component base-layer access surface modules receive
// instead of the LayerUI whole package: the manager's base-layer members plus
// the two core row stores. Defined from what modules actually read — not a
// new whole-package — and injected uniformly as `fn(la, ps, fs)` so module
// signatures stay one shape (no per-module subsets).
import { type EventBus } from "#core/event/index.js";
import {
  type LayerInfo,
  type LayerInfoRegistry,
  LayerIntentStore,
  LayerRuntimeStore,
  type LayerSurface,
} from "#core/layer/index.js";
import type { AnnotationManager } from "../annotation/index.js";

/** The base-layer access a ui/ module reads (layer registry, intent/runtime
 *  stores, annotation manager, map + the manager's resolve helpers). */
interface LayerAccess {
  layerRegistry: LayerInfoRegistry;
  intentStore: LayerIntentStore;
  runtimeStore: LayerRuntimeStore;
  annotation: AnnotationManager;
  events: EventBus;
  map: L.Map;
  findLayer(info: LayerInfo): L.Layer | null;
  surfaceFor(info: LayerInfo): LayerSurface;
  getFeatureCount(id: string): number | null;
}

export type { LayerAccess };
