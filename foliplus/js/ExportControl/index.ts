import { createControlEnv } from "#core/controlEnv.js";
import { requireLayerAPI } from "#core/layer/index.js";
import { BaseControl } from "#foliplus/BaseControl.js";
import { createScopedTranslator } from "#common/locale.js";
import { createFoldControl } from "#common/panel.js";
import * as SVGs from "./icon.js";
import { ExportManager } from "./manager.js";

createControlEnv(CONF, SVGs.CAMERA);
const T = createScopedTranslator(CONF);
requireLayerAPI(CONF.name, T, map);

// ==================== CORS Pre-setup ====================
// Set crossOrigin on ALL existing TileLayers so tiles load with CORS
// from the start. This is THE KEY to avoiding canvas taint — if tiles
// are loaded without CORS, drawImage will taint the canvas and
// toBlob() will return null (blank image).
//
// We also intercept future layer additions to set crossOrigin.
// Deliberately module-level (not instance-level): these bindings hang off
// the map, so `map.removeControl()` must NOT tear them down — exporting
// must keep working after the control is re-added.
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
// Manager creation is lazy so destroy() + re-add re-creates a fresh manager.
// Browser tests inject a synchronous scheduler on window before instantiation
// to make rafLoop deterministic (see TestExportControlBrowser._make_page).
const createExportManager = (): ExportManager =>
  new ExportManager(map, window.__foliplusExportScheduler ?? setTimeout);

class ExportControl extends BaseControl {
  manager: ExportManager | null = null;

  constructor(options?: L.ControlOptions) {
    super(options);
  }

  /** Shorthand for manager (creates it on first access). */
  get m(): ExportManager {
    return (this.manager ??= createExportManager());
  }

  buildDOM() {
    const { container, ctrl, toolBar, toggleBtn } = createFoldControl({
      cssClass: `foliplus-export-ctrl`,
      toggleTitle: T("btn_title"),
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

  /** Never touch `this.m` here: destroy() must not re-create the manager. */
  destroy() {
    if (this.manager?.cropState) this.manager.removeCropBox();
    this.manager?.unregisterShortcuts();
    this.manager = null;
  }
}

new ExportControl({ position: CONF.position }).addTo(map);
