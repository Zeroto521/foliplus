import { createControlEnv } from "#common/guard.js";
import { createPanelControl } from "#common/panel.js";
import { ensureLayerAPI } from "#core/layer/index.js";
import { BaseControl } from "#foliplus/BaseControl.js";
import * as CONST from "./const.js";
import * as SVGs from "./icon.js";
import { HeatmapManager } from "./logic.js";
import { buildDataSection, buildStyleSection, initScan, setupObserver } from "./ui.js";

const { _ } = createControlEnv(CONF, SVGs.HEXAGON);
ensureLayerAPI(map);

const heatmapManager = new HeatmapManager(map);

// ==================== View & Control: HeatmapControl ====================
class HeatmapControl extends BaseControl {
  declare manager: HeatmapManager;
  declare schemeDropdown: HTMLElement | null;
  declare expandHookDone: boolean;
  declare ctrl: HTMLElement;
  declare observer: MutationObserver | null;
  declare layerSelect: HTMLSelectElement;
  declare extraBody: HTMLElement;
  declare aggSelect: HTMLSelectElement;
  declare fieldWrap: HTMLElement;
  declare fieldSelect: HTMLSelectElement;
  declare methodSelect: HTMLSelectElement;
  declare classSelect: HTMLSelectElement;
  declare schemeControlWrap: HTMLElement;
  declare schemeBar: HTMLElement;
  declare schemeBarInner: HTMLElement;
  declare schemeSelectHidden: HTMLSelectElement;
  declare borderColorInput: HTMLInputElement;
  declare borderWeightInput: HTMLInputElement;
  declare labelChk: HTMLInputElement;
  declare closeSchemeDropdown: (event: MouseEvent) => void;
  declare toggleSchemeDropdown: () => void;

  constructor(options?: L.ControlOptions) {
    super(options);
    this.manager = heatmapManager;
    this.m.ui = this;
    this.schemeDropdown = null;
    this.expandHookDone = false;
  }

  /** Alias for convenience */
  get m() {
    return this.manager;
  }

  buildDOM() {
    const { container, ctrl, panelContent } = createPanelControl({
      cssClass: CONST.CLASSES.HEATMAP_CTRL,
      toggleTitle: _(`${CONF.name}.title`),
      toggleSvg: SVGs.HEXAGON,
      panelTitle: _(`${CONF.name}.title`),
      closeTitle: _(`${CONF.name}.close_title`),
    });
    this.ctrl = ctrl;
    buildDataSection(this, panelContent);
    buildStyleSection(this);
    setupObserver(this);
    return container;
  }

  destroy() {
    // Clean up map event listeners
    if (this.m.mapCleanup) this.m.mapCleanup();
    if (this.m.onZoomEnd) {
      this.m.onZoomEnd.cancel();
      this.m.map.off("zoomend", this.m.onZoomEnd);
    }
    if (this.m.onLayerChange) {
      this.m.onLayerChange.cancel();
      if (this.m.removeLayerChangeListener) this.m.removeLayerChangeListener();
    }

    // Disconnect MutationObserver
    if (this.observer) this.observer.disconnect();

    this.m.clearHeatmapCanvas();
    if (this.m.overlay) this.m.overlay.destroy();
    this.m.ui = null;
  }
}

// ==================== Instantiation ====================
// Instantiate control, then add to map
const heatmapCtrl = new HeatmapControl({ position: CONF.position });

heatmapCtrl.addTo(map);
initScan(heatmapCtrl, CONST.TIMING.INIT_SCAN_ATTEMPTS);
