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
import { EVENTS } from "#core/event/index.js";
import { attributionEntries, refreshAttributions } from "#core/leafletAdapter.js";
import type { LayerFactory } from "#core/layer/LayerFactory.js";
import { LayerInfoRegistry } from "#core/layer/LayerInfoRegistry.js";
import { findLayer as findLayerUtil, GROUP, KIND } from "#core/layer/index.js";
import type { LayerKind } from "#core/layer/index.js";
import type { LayerOrder } from "#core/layer/LayerOrder.js";
import type { LayerSurface } from "#core/layer/LayerSurface.js";
import { PaneManager } from "#core/layer/PaneManager.js";
import type { LayerInfo } from "#core/layer/type.js";
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
  private lastAttribution: string | null;

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
    lastAttribution: string | null;
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
    this.lastAttribution = deps.lastAttribution;
  }

  /** Ordered layers (read-only view; always reflects the registry). */
  get layers(): readonly LayerInfo[] {
    return this.layerRegistry.layers;
  }

  findLayer(idOrInfo: string | LayerInfo): L.Layer | null {
    const layerInfo =
      typeof idOrInfo === "string" ? this.layerRegistry.get(idOrInfo) : idOrInfo;
    if (layerInfo?.layer) return layerInfo.layer;
    return findLayerUtil(
      this.map,
      typeof idOrInfo === "string" ? idOrInfo : (layerInfo?.id ?? ""),
    );
  }

  emitLayerChange(id: string, kind: LayerKind): void {
    this.events.emit(EVENTS.LAYER_CHANGE, { id, kind });
  }

  hasUnresolvedLayers(): boolean {
    for (const layerInfo of this.layers) {
      if (layerInfo.layer) continue;
      const kind = layerInfo.kind;
      if (kind === KIND.CANVAS || kind === KIND.SOLID || kind === KIND.CUSTOM) {
        continue;
      }
      return true;
    }
    return false;
  }

  canReorderBetween(fromIdx: number, toIdx: number): boolean {
    return this.layerRegistry.canReorderBetween(fromIdx, toIdx);
  }

  /** Syncs the attribution control to the top visible base tile.
   *  Returns the new attribution value ('' when none) so the controller can
   *  keep its public field in sync. */
  syncAttribution(): string {
    const attrCtrl = this.map.attributionControl;
    if (!attrCtrl) return this.lastAttribution ?? "";

    let topAttr = "";
    for (
      let i = this.layerRegistry.firstBaseIdx;
      i !== -1 && i < this.layers.length;
      i++
    ) {
      const layerInfo = this.layers[i];
      if (layerInfo.group !== GROUP.BASE) continue;
      const layer = this.findLayer(layerInfo);
      if (!(layer instanceof L.TileLayer) || !layer.options.attribution) continue;
      if (this.map.hasLayer(layer)) {
        topAttr = layer.options.attribution;
        break;
      }
    }

    if (topAttr === this.lastAttribution) return this.lastAttribution;

    const prev = this.lastAttribution;
    this.lastAttribution = topAttr;
    if (prev) {
      if (attrCtrl.removeAttribution) attrCtrl.removeAttribution(prev);
      else delete attributionEntries(attrCtrl)[prev];
    }
    if (topAttr) {
      if (attrCtrl.addAttribution) attrCtrl.addAttribution(topAttr);
      else attributionEntries(attrCtrl)[topAttr] = 1;
    }
    if (!attrCtrl.removeAttribution) refreshAttributions(attrCtrl);
    return this.lastAttribution;
  }
}

export { LayerOrchestration };
