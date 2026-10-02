// LayerControl UI — LayerAccess: the la face of the phase-2 injection split.
//
// The cross-module, cross-component base-layer access surface modules receive
// instead of the LayerUI whole package. Defined from what modules actually
// read (surveyed per module, T270): the manager's base-layer members — data
// (registry/stores/annotation/events/map/layers/panes/persistence) and the
// resolve/order operations modules drive — injected uniformly as
// `fn(la, ps, fs)` so module signatures stay one shape (no per-module
// subsets). Implemented by the coordinator from the manager + stores.
import { type EventBus } from "#core/event/index.js";
import {
  type CreateColorAPI,
  type CreateColorOpts,
  type LayerInfo,
  type LayerInfoRegistry,
  LayerIntentStore,
  LayerRuntimeStore,
  type LayerSurface,
  type PaneManager,
} from "#core/layer/index.js";
import { type Debounced } from "#common/debounce.js";
import type { AnnotationManager } from "../annotation/index.js";
import type { LayerPersistence } from "../persistence.js";

/** The base-layer access a ui/ module reads (manager base-layer members plus
 *  the two core row stores). */
interface LayerAccess {
  layerRegistry: LayerInfoRegistry;
  intentStore: LayerIntentStore;
  runtimeStore: LayerRuntimeStore;
  annotation: AnnotationManager;
  events: EventBus;
  map: L.Map;
  /** Live layer list (read-only view of the registry). */
  layers: readonly LayerInfo[];
  /** The control's attached panel container (manager-owned; null pre-attach). */
  uiContainer: HTMLElement | null;
  panes: PaneManager;
  /** Registrations queued before the control attached. */
  pendingRegistrations: LayerInfo[];
  persistence: LayerPersistence;
  debouncedEnforce: Debounced;
  findLayer(idOrInfo: string | LayerInfo): L.Layer | null;
  surfaceFor(info: LayerInfo): LayerSurface;
  getFeatureCount(id: string): number | null;
  getLayerPanes(layer: L.Layer): string[];
  canReorderBetween(fromIdx: number, toIdx: number): boolean;
  enforceOrder(): void;
  saveOrder(): void;
  deleteLayer(id: string): boolean;
  moveLayerUp(id: string): boolean;
  moveLayerDown(id: string): boolean;
  replaySavedOrder(id?: string): void;
  createColor(opts: CreateColorOpts): CreateColorAPI;
}

export type { LayerAccess };
