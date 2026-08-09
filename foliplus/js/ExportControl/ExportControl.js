import { BaseControl } from "../common/BaseControl.js";
import { createControlEnv, requireLayerAPI } from "../common/guard.js";
import { createFoldControl } from "../common/panel.js";
import * as SVGs from "./ExportControl.icon.js";
import { ExportManager } from "./ExportControl.manager.js";

const { _ } = createControlEnv(CONF, SVGs.CAMERA);
requireLayerAPI(CONF.name, _);

// ==================== CORS Pre-setup ====================
// Set crossOrigin on ALL existing TileLayers so tiles load with CORS
// from the start. This is THE KEY to avoiding canvas taint — if tiles
// are loaded without CORS, drawImage will taint the canvas and
// toBlob() will return null (blank image).
//
// We also intercept future layer additions to set crossOrigin.
map.eachLayer((layer) => {
  if (layer instanceof L.GridLayer && !layer.options.crossOrigin) {
    layer.options.crossOrigin = "anonymous";
    if (map.hasLayer(layer)) {
      map.removeLayer(layer);
      map.addLayer(layer);
    }
  }
});
map.on("layeradd", (e) => {
  if (e.layer instanceof L.GridLayer && !e.layer.options.crossOrigin) {
    e.layer.options.crossOrigin = "anonymous";
  }
});

// ==================== Leaflet Control ====================
const exportManager = new ExportManager(map);

class ExportControl extends BaseControl {
  constructor(options) {
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
    document.removeEventListener("keydown", this.m.onKeyDown);
  }
}

new ExportControl({ position: CONF.position }).addTo(map);
