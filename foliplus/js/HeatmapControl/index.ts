import { defineControl } from "#core/defineControl.js";
import { ensureLayerAPI } from "#core/layer/index.js";
import { createPanelControl } from "#core/leaflet/index.js";
import { finalize } from "#common/finalize.js";
import * as CONST from "./const.js";
import * as SVGs from "./icon.js";
import { HeatmapManager } from "./manager.js";
import { bindControls, initScan, setupObserver } from "./ui.js";

class HeatmapControl extends defineControl({
  config: CONFIG,
  icon: SVGs.ICON_HEXAGON,
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
    return (this.manager ??= (() => {
      const m = new HeatmapManager(map, { T: this.T, log: this.log });
      m.init();
      return m;
    })());
  }

  buildDOM() {
    const { container, ctrl, panelContent, destroy } = createPanelControl({
      cssClass: CONST.CLASSES.HEATMAP_CTRL,
      toggleTitle: this.T("title"),
      toggleSvg: SVGs.ICON_HEXAGON,
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
    // Resolve and detach the manager first: `this.mgr` is lazy, so touching the
    // getter after the null assignment would build a second one.
    const mgr = this.mgr;
    this.manager = null;
    finalize(
      [
        ["detach-scan", () => this.initScanCleanup?.()],
        ["detach-scheme-bar", () => this.schemeBarCleanup?.()],
        // dropdownCleanup is optional: only the dropdown open/close cycle writes
        // it, and clearHeatmapCanvas already runs it. Running it here as well is
        // a no-op safety net so a handler can't survive the control — it
        // re-registers on the next dropdown open.
        ["detach-dropdown", () => this.dropdownCleanup?.()],
        ["detach-map-sync", () => mgr.mapCleanup?.()],
        [
          "detach-zoom-end",
          () => {
            mgr.onZoomEnd.cancel();
            mgr.map.off("zoomend", mgr.onZoomEnd);
          },
        ],
        [
          "detach-layer-change",
          () => {
            mgr.onLayerChange.cancel();
            mgr.removeLayerChangeListener();
          },
        ],
        ["detach-layer-deleted", () => mgr.removeLayerDeletedListener()],
        ["detach-export", () => mgr.removeExportListener()],
        ["disconnect-observer", () => this.observer?.disconnect()],
        // Flush any pending write so the last user-initiated change is durable
        // (write-through here, so the flush is a no-op safety net). A storage
        // error is already swallowed inside saveRecord.
        ["flush", () => mgr.flush()],
        // clearHeatmapCanvas retires the overlay entry and can raise; the
        // overlay's own destroy is queued after it so the canvas and pane are
        // released either way.
        ["clear-canvas", () => mgr.clearHeatmapCanvas()],
        ["destroy-overlay", () => mgr.overlay.destroy()],
      ],
      failure => this.log.warn(`destroy step "${failure.name}" threw`, failure.error),
    );
    // Resets, not steps: a removed control must end with no cleanup callbacks
    // and no observer even when one of the steps above threw.
    this.initScanCleanup = null;
    this.schemeBarCleanup = null;
    this.dropdownCleanup = null;
    this.observer = null;
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
