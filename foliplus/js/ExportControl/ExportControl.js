import { requireLayerAPI, requireRuntime } from "../common/guard.js";
import { createTranslator } from "../common/locale.js";
import { createFoldControl } from "../common/panel.js";
import * as SVGs from "./ExportControl.icon.js";
import { ExportManager } from "./ExportControl.manager.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).
requireRuntime(CONF.name);

const foliplus = window.foliplus;
const _ = createTranslator(CONF);

foliplus.registerHintIcon(CONF.name, SVGs.CAMERA);

// ==================== Guard: LayerControl required ====================
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

class ExportControl extends L.Control {
  onAdd() {
    const { container, ctrl, toolBar, toggleBtn } = createFoldControl({
      cssClass: `foliplus-export-ctrl`,
      toggleTitle: _(`${CONF.name}.btn_title`),
      toggleSvg: SVGs.CAMERA,
      isLeft: CONF.position.indexOf("left") >= 0,
    });
    exportManager.attachUI(ctrl, toolBar);
    toggleBtn.onclick = () => {
      if (exportManager.cropState) exportManager.removeCropBox();
      else if (exportManager.savedBounds) exportManager.restoreFromSavedBounds();
      else exportManager.showCropBox();
    };
    return container;
  }
  onRemove() {
    if (exportManager.cropState) exportManager.removeCropBox();
    document.removeEventListener("keydown", exportManager.onKeyDown);
  }
}

new ExportControl({ position: CONF.position }).addTo(map);
