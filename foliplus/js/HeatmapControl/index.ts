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
  /** Backing store for the lazy `mgr` accessor. */
  private manager: HeatmapManager | null = null;
  schemeDropdown: HTMLElement | null;
  schemePicker: import("#common/schemePicker.js").SchemePicker | null;
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
  schemePickerOverlayUnregister: (() => void) | null = null;
  schemePickerCleanup: (() => void) | null = null;
  toggleDropdown: (() => void) | null = null;
  selectScheme: ((idx: number) => void) | null = null;

  constructor(options?: L.ControlOptions) {
    super(options);
    this.schemeDropdown = null;
    this.schemePicker = null;
    this.expandHookDone = false;
    this.schemeBarCleanup = null;
    this.schemePickerOverlayUnregister = null;
    this.schemePickerCleanup = null;
    this.toggleDropdown = null;
    this.selectScheme = null;
  }

  get mgr(): HeatmapManager {
    if (!this.manager) {
      const mgr = new HeatmapManager(map, { T: this.T, log: this.log });
      // Store before init: a throw leaves the partial manager reachable for
      // destroy(). It is reused, not retried; destroy() nulls it for a re-add.
      this.manager = mgr;
      mgr.init();
    }
    return this.manager;
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
   *  The scheme picker is created by bindControls and destroyed by
   *  destroy() (via schemePickerCleanup). */
  startScan() {
    this.initScanCleanup?.();
    this.initScanCleanup = initScan(this);
  }

  destroy() {
    // `this.mgr` is a lazy getter that constructs the manager AND runs init().
    // A throw there is exactly the half-mounted case teardown must survive, so
    // resolution is the first step — and it resolves into the owner field
    // (`manager`), not a second holder: one manager, one container. The steps
    // below read `this.manager` and tolerate null instead of being skipped
    // wholesale when init died halfway.
    finalize(
      [
        ["resolve-manager", () => void this.mgr],
        ["detach-scan", () => this.initScanCleanup?.()],
        // The shared scheme picker is destroyed here (permanent teardown);
        // schemeBarCleanup only closes the dropdown for data-clear reuse.
        ["detach-scheme-picker", () => this.schemePickerCleanup?.()],
        ["detach-map-sync", () => this.manager?.mapCleanup?.()],
        [
          "detach-zoom-end",
          () => {
            const mgr = this.manager;
            // `declare` hides the fields init() assigns, so a manager whose
            // init threw can reach here without them.
            if (!mgr?.onZoomEnd) return;
            mgr.onZoomEnd.cancel();
            mgr.map.off("zoomend", mgr.onZoomEnd);
          },
        ],
        [
          "detach-layer-change",
          () => {
            const mgr = this.manager;
            if (!mgr?.onLayerChange) return;
            mgr.onLayerChange.cancel();
            mgr.removeLayerChangeListener();
          },
        ],
        ["detach-layer-deleted", () => this.manager?.removeLayerDeletedListener()],
        ["detach-export", () => this.manager?.removeExportListener()],
        ["disconnect-observer", () => this.observer?.disconnect()],
        // Flush any pending write so the last user-initiated change is durable
        // (write-through here, so the flush is a no-op safety net). A storage
        // error is already swallowed inside saveRecord.
        ["flush", () => this.manager?.flush()],
        // clearHeatmapCanvas retires the overlay entry and can raise; the
        // overlay's own destroy is queued after it so the canvas and pane are
        // released either way. It also closes the picker's dropdown through
        // schemeBarCleanup — a no-op once the picker above was destroyed.
        ["clear-canvas", () => this.manager?.clearHeatmapCanvas()],
        ["destroy-overlay", () => this.manager?.overlay.destroy()],
      ],
      failure => this.log.warn(`destroy step "${failure.name}" threw`, failure.error),
    );
    // Resets, not steps: a removed control must end with no manager, cleanup
    // callbacks or observer even when one of the steps above threw.
    const mgr = this.manager;
    if (mgr) mgr.ui = null;
    // Branch-only listener: the filter panel adds the source-content debounce
    // and its subscription after main's finalize list was written, so cancel
    // them here while the manager is still reachable. Everything the finalize
    // steps already cover (map sync, zoom, layer change / delete, export,
    // observer) is not repeated.
    if (mgr?.onSourceContentChange) mgr.onSourceContentChange.cancel();
    mgr?.removeContentChangeListener?.();
    this.manager = null;
    this.initScanCleanup = null;
    this.schemeBarCleanup = null;
    this.schemePickerOverlayUnregister = null;
    this.schemePickerCleanup = null;
    this.observer = null;
    // Drop UI references to the removed DOM so a re-add starts clean.
    this.schemeDropdown = null;
    this.schemePicker = null;
    this.expandHookDone = false;
  }
}

// Instantiate control, then add to map. The initial layer scan runs inside
// buildDOM (startScan), so a destroy + re-add re-scans instead of stalling.
const heatmapCtrl = new HeatmapControl({ position: CONFIG.position });

heatmapCtrl.addTo(map);
