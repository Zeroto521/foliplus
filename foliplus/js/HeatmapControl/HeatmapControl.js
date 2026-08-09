import { requireRuntime } from "../common/guard.js";
import { createTranslator } from "../common/locale.js";
import { createPanelControl } from "../common/panel.js";
import * as CONST from "./HeatmapControl.const.js";
import * as SVGs from "./HeatmapControl.icon.js";
import { HeatmapManager } from "./HeatmapControl.logic.js";
import {
  buildDataSection,
  buildStyleSection,
  initScan,
  setupObserver,
} from "./HeatmapControl.ui.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).
requireRuntime(CONF.name);

const foliplus = window.foliplus;
const _ = createTranslator(CONF);

foliplus.registerHintIcon(CONF.name, SVGs.HEXAGON);

// ==================== Guard: LayerControl required ====================
if (!foliplus.LayerAPI) {
  const msg = _(`${CONF.name}.no_layercontrol`);
  foliplus.showHint(CONF.name, msg, foliplus.HINT_DURATION.PERSIST);
  throw new Error(`[${CONF.name}] ${msg}`);
}

// ==================== View & Control: HeatmapControl ====================
class HeatmapControl extends L.Control {
  constructor(options, manager) {
    super(options);
    this.manager = manager;
    this.m.ui = this;
    this.schemeDropdown = null;
    this.expandHookDone = false;
  }

  /** Alias for convenience */
  get m() {
    return this.manager;
  }

  onAdd() {
    const { container, ctrl, panelContent } = createPanelControl({
      cssClass: CONST.CLASSES.HEATMAP_CTRL,
      toggleTitle: _(`${CONF.name}.title`),
      toggleSvg: SVGs.HEXAGON,
      panelTitle: _(`${CONF.name}.title`),
      closeTitle: _(`${CONF.name}.close_title`),
    });
    this.container = ctrl;
    buildDataSection(this, panelContent);
    buildStyleSection(this);
    setupObserver(this);
    return container;
  }

  onRemove() {
    // Clean up map event listeners
    if (this.m.mapCleanup) this.m.mapCleanup();
    if (this.m.onZoomEnd) {
      this.m.onZoomEnd.cancel();
      this.m.map.off("zoomend", this.m.onZoomEnd);
    }
    if (this.m.onLayerChange) {
      this.m.onLayerChange.cancel();
      this.m.map.off("layeradd layerremove", this.m.onLayerChange);
    }

    // Disconnect MutationObserver
    if (this.observer) this.observer.disconnect();

    this.m.clearHeatmapCanvas();
    if (this.m.overlay) this.m.overlay.destroy();
    this.m.overlay = null;
    this.m.ui = null;
  }
}

// ==================== Instantiation ====================
// Instantiate manager and control, then add to map
const heatmapManager = new HeatmapManager(map);
const heatmapCtrl = new HeatmapControl({ position: CONF.position }, heatmapManager);

heatmapCtrl.addTo(map);
initScan(heatmapCtrl, CONST.TIMING.INIT_SCAN_ATTEMPTS);
