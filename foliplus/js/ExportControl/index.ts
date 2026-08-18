import { requireLayerAPI } from "#core/layer/index.js";
import { BaseControl } from "#foliplus/BaseControl.js";
import { createControlEnv } from "#common/guard.js";
import { createFoldControl } from "#common/panel.js";
import * as SVGs from "./icon.js";
import { ExportManager } from "./manager.js";

const { _ } = createControlEnv(CONF, SVGs.CAMERA);
requireLayerAPI(CONF.name, _, map);

// ==================== CORS Pre-setup ====================
// Set crossOrigin on ALL existing TileLayers so tiles load with CORS
// from the start. This is THE KEY to avoiding canvas taint — if tiles
// are loaded without CORS, drawImage will taint the canvas and
// toBlob() will return null (blank image).
//
// We also intercept future layer additions to set crossOrigin.
map.eachLayer((layer: L.Layer) => {
  if (layer instanceof L.GridLayer) {
    const opts = layer.options as L.TileLayerOptions;
    if (!opts.crossOrigin) {
      opts.crossOrigin = "anonymous";
      if (map.hasLayer(layer)) {
        map.removeLayer(layer);
        map.addLayer(layer);
      }
    }
  }
});
map.on("layeradd", (event: L.LeafletEvent) => {
  const layer = (event as L.LayerEvent).layer;
  if (layer instanceof L.GridLayer) {
    const opts = layer.options as L.TileLayerOptions;
    if (!opts.crossOrigin) opts.crossOrigin = "anonymous";
  }
});

// ==================== Leaflet Control ====================
const exportManager = new ExportManager(map);

class ExportControl extends BaseControl {
  declare manager: ExportManager;

  constructor(options?: L.ControlOptions) {
    super(options);
    this.manager = exportManager;
  }

  /** Shorthand for manager */
  get m() {
    return this.manager;
  }

  buildDOM() {
    const { container, ctrl, toolBar, toggleBtn } = createFoldControl({
      cssClass: `foliplus-export-ctrl`,
      toggleTitle: _(`${CONF.name}.btn_title`),
      toggleSvg: SVGs.CAMERA,
      position: CONF.position,
    });
    this.m.attachUI(ctrl, toolBar);
    toggleBtn.onclick = () => {
      if (this.m.cropState) this.m.removeCropBox();
      else if (this.m.savedBounds) this.m.restoreFromSavedBounds();
      else this.m.showCropBox();
    };
    return container;
  }
  destroy() {
    if (this.m.cropState) this.m.removeCropBox();
    this.m.interactionCleanup?.();
    ensureInteraction(this.m.map).unregister(CONF.name + "-escape");
  }
}

new ExportControl({ position: CONF.position }).addTo(map);
