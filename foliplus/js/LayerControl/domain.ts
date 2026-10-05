// LayerControl/domain — the domain orchestration layer for LayerControl.
//
// Owns the registry / order / persistence / surface / pane / factory
// coordination that registerLayer, unregisterLayer, deleteLayer, enforceOrder
// and friends need. Extracted from LayerController so the controller can stay
// thin: build store + build view + wire up.
//
// Lives beside LayerController (not in core/layer/) because it depends on
// LayerPersistence and AnnotationManager — both LayerControl-local.

import type { EventBus } from "#core/event/index.js";
import type { LayerFactory } from "#core/layer/LayerFactory.js";
import { LayerInfoRegistry } from "#core/layer/LayerInfoRegistry.js";
import type { LayerOrder } from "#core/layer/LayerOrder.js";
import type { LayerSurface } from "#core/layer/LayerSurface.js";
import { PaneManager } from "#core/layer/PaneManager.js";
import type { AnnotationManager } from "./annotation/index.js";
import type { LayerPersistence } from "./persistence.js";

class LayerOrchestration {
  private map: L.Map;
  private events: EventBus;
  private layerRegistry: LayerInfoRegistry;
  private panes: PaneManager;
  private factory: LayerFactory;
  private order: LayerOrder;
  private persistence: LayerPersistence;
  private annotation: AnnotationManager;
  private surfaces: Map<string, LayerSurface>;
  private surfacesByLayer: Map<number, LayerSurface>;

  constructor(deps: {
    map: L.Map;
    events: EventBus;
    layerRegistry: LayerInfoRegistry;
    panes: PaneManager;
    factory: LayerFactory;
    order: LayerOrder;
    persistence: LayerPersistence;
    annotation: AnnotationManager;
    surfaces: Map<string, LayerSurface>;
    surfacesByLayer: Map<number, LayerSurface>;
  }) {
    this.map = deps.map;
    this.events = deps.events;
    this.layerRegistry = deps.layerRegistry;
    this.panes = deps.panes;
    this.factory = deps.factory;
    this.order = deps.order;
    this.persistence = deps.persistence;
    this.annotation = deps.annotation;
    this.surfaces = deps.surfaces;
    this.surfacesByLayer = deps.surfacesByLayer;
  }
}

export { LayerOrchestration };
