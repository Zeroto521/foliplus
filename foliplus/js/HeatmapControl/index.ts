import { createControlEnv } from "#core/controlEnv.js";
import { ensureLayerAPI } from "#core/layer/index.js";
import { BaseControl } from "#foliplus/BaseControl.js";
import { createScopedTranslator } from "#common/locale.js";
import { createPanelControl } from "#common/panel.js";
import * as CONST from "./const.js";
import * as SVGs from "./icon.js";
import { HeatmapManager } from "./manager.js";
import { bindControls, initScan, setupObserver } from "./ui.js";

createControlEnv(CONF, SVGs.HEXAGON);
const T = createScopedTranslator(CONF);
ensureLayerAPI(map);

// ==================== View & Control: HeatmapControl ====================
class HeatmapControl extends BaseControl {
  manager: HeatmapManager | null = null;
  declare conf: ComponentConfig;
  declare T: (key: string) => string;
  schemeDropdown: HTMLElement | null;
  expandHookDone: boolean;
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
  declare labelColorInput: HTMLInputElement;
  declare labelSizeInput: HTMLInputElement;
  declare labelFormatSelect: HTMLSelectElement;
  declare closeSchemeDropdown: (event: MouseEvent) => void;
  declare toggleSchemeDropdown: () => void;
  initScanCleanup: (() => void) | null = null;
  schemeBarCleanup: (() => void) | null = null;
  dropdownCleanup: (() => void) | null = null;
  toggleDropdown: (() => void) | null = null;
  selectScheme: ((idx: number) => void) | null = null;

  constructor(options?: L.ControlOptions) {
    super(options);
    this.conf = CONF;
    this.T = T;
    this.schemeDropdown = null;
    this.expandHookDone = false;
    this.schemeBarCleanup = null;
    this.dropdownCleanup = null;
    this.toggleDropdown = null;
    this.selectScheme = null;
  }

  /** Alias for convenience (creates the manager on first access). */
  get m(): HeatmapManager {
    return (this.manager ??= new HeatmapManager(map));
  }

  buildDOM() {
    const { container, ctrl, panelContent, destroy } = createPanelControl({
      cssClass: CONST.CLASSES.HEATMAP_CTRL,
      toggleTitle: T("title"),
      toggleSvg: SVGs.HEXAGON,
      panelTitle: T("title"),
      closeTitle: T("close_title"),
    });
    // See LayerControl.buildDOM: keeps the factory's document-level listeners
    // from outliving a control that is removed but not garbage-collected.
    this.trackCleanup(destroy);
    this.ctrl = ctrl;
    this.m.ui = this;
    bindControls(this, panelContent);
    setupObserver(this);
    this.startScan();
    return container;
  }

  /** (Re)start the initial layer scan. Runs on every add, so the control
   *  recovers after removeControl + addControl (destroy cancels the old scan).
   *  The scheme-bar handler is only ever (re)bound by bindControls, which
   *  itself guards the double-registration case. */
  startScan() {
    this.initScanCleanup?.();
    this.initScanCleanup = initScan(this);
  }

  /** Never touch `this.m` here: destroy() must not re-create the manager. */
  destroy() {
    // Clean up map event listeners
    this.initScanCleanup?.();
    this.initScanCleanup = null;
    this.schemeBarCleanup?.();
    this.schemeBarCleanup = null;
    // dropdownCleanup is optional: only the dropdown open/close cycle writes
    // it, and clearHeatmapCanvas already runs it. Null it here so a handler
    // can't survive the control — it re-registers on the next dropdown open.
    this.dropdownCleanup?.();
    this.dropdownCleanup = null;

    const mgr = this.manager;
    this.manager = null;
    if (!mgr) return;
    if (mgr.mapCleanup) mgr.mapCleanup();
    if (mgr.onZoomEnd) {
      mgr.onZoomEnd.cancel();
      mgr.map.off("zoomend", mgr.onZoomEnd);
    }
    if (mgr.onLayerChange) {
      mgr.onLayerChange.cancel();
      mgr.removeLayerChangeListener();
    }
    mgr.removeExportListener();

    // Disconnect MutationObserver
    if (this.observer) this.observer.disconnect();
    this.observer = null;

    mgr.clearHeatmapCanvas();
    mgr.overlay.destroy();
    mgr.ui = null;
    // Drop UI references to the removed DOM so a re-add starts clean.
    this.schemeDropdown = null;
    this.expandHookDone = false;
  }
}

// ==================== Instantiation ====================
// Instantiate control, then add to map. The initial layer scan runs inside
// buildDOM (startScan), so a destroy + re-add re-scans instead of stalling.
const heatmapCtrl = new HeatmapControl({ position: CONF.position });

heatmapCtrl.addTo(map);
