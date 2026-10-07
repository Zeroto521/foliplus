import { defineControl } from "#core/defineControl.js";
import { ensureLayerAPI } from "#core/layer/index.js";
import { createPanelControl } from "#core/leaflet/index.js";
import * as CONST from "./const.js";
import * as SVGs from "./icon.js";
import { HeatmapManager } from "./manager.js";
import { bindControls, initScan, setupObserver } from "./ui.js";

class HeatmapControl extends defineControl({
  config: CONFIG,
  icon: SVGs.HEXAGON,
  setup: () => ensureLayerAPI(map),
}) {
  /** Backing store for the lazy `mgr` accessor; `destroy()` nulls it so a
   *  re-add rebuilds a fresh manager. */
  private manager: HeatmapManager | null = null;
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
  declare closeSchemeDropdown: (event: Event) => void;
  declare toggleSchemeDropdown: () => void;
  initScanCleanup: (() => void) | null = null;
  schemeBarCleanup: (() => void) | null = null;
  dropdownCleanup: (() => void) | null = null;
  toggleDropdown: (() => void) | null = null;
  selectScheme: ((idx: number) => void) | null = null;

  constructor(options?: L.ControlOptions) {
    super(options);
    this.schemeDropdown = null;
    this.expandHookDone = false;
    this.schemeBarCleanup = null;
    this.dropdownCleanup = null;
    this.toggleDropdown = null;
    this.selectScheme = null;
  }

  get mgr(): HeatmapManager {
    return (this.manager ??= new HeatmapManager(map, { T: this.T, log: this.log }));
  }

  buildDOM() {
    const { container, ctrl, panelContent, destroy } = createPanelControl({
      cssClass: CONST.CLASSES.HEATMAP_CTRL,
      toggleTitle: this.T("title"),
      toggleSvg: SVGs.HEXAGON,
      panelTitle: this.T("title"),
      closeTitle: this.T("close_title"),
      collapseOnOutside: this.config.collapse_on_outside,
    });
    // See LayerControl.buildDOM: keeps the factory's document-level listeners
    // from outliving a control that is removed but not garbage-collected.
    this.effect(() => destroy);
    this.ctrl = ctrl;
    this.mgr.ui = this;
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

    const mgr = this.mgr;
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
    mgr.removeLayerDeletedListener();
    mgr.removeExportListener();

    // Disconnect MutationObserver
    if (this.observer) this.observer.disconnect();
    this.observer = null;

    // Flush any pending write so the last user-initiated change is durable
    // (write-through here, so the flush is a no-op safety net).
    mgr.flush();

    mgr.clearHeatmapCanvas();
    mgr.overlay.destroy();
    mgr.ui = null;
    // Drop UI references to the removed DOM so a re-add starts clean.
    this.schemeDropdown = null;
    this.expandHookDone = false;
  }
}

// Instantiate control, then add to map. The initial layer scan runs inside
// buildDOM (startScan), so a destroy + re-add re-scans instead of stalling.
const heatmapCtrl = new HeatmapControl({ position: CONFIG.position });

heatmapCtrl.addTo(map);
