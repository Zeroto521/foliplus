// MeasureControl core manager — persistence, mode switching, layer management.
import { COMPONENTS, generateId } from "#core/component.js";
import { EVENTS, type EventHandler, ensureEvents } from "#core/event/index.js";
import { HINT_DURATION } from "#core/hint.js";
import { ensureModes } from "#core/mode.js";
import { hideDelIcons } from "#common/delicon.js";
import { createScopedTranslator } from "#common/locale.js";
import { adjustPanelZIndex } from "#common/panel.js";
import * as Storage from "#common/storage.js";
import * as CONST from "./const.js";
import * as Export from "./export.js";
import * as SVGs from "./icon.js";
import { registerExportClick, registerInteractions } from "./interaction.js";
import { MODE_MAP, MeasureMode } from "./mode/index.js";
import * as Util from "./util.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).
const foliplus = window.foliplus;
const T = createScopedTranslator(CONF);

// ==================== Core Manager ====================
/** Central manager for all measurements. */
class MeasureManager {
  map: L.Map;
  private interactionCleanup?: () => void;
  private exportClickCleanup?: () => void;
  layers: CreateLayersAPI;
  currentMode: string | null;
  modeInstance: MeasureMode | null;
  isSuppressHideDel: boolean;
  toolBtns: HTMLElement[];
  /** Cleanup callbacks for finalized measurement overlays (each removes its
   *   overlay's map-click listener and any associated drag bindings). */
  finalizedClickHandlers: Array<() => void>;
  measurements: MeasureData[];
  measurementIdCounter: number;
  ctrl: HTMLElement | null;
  /** Whether the edit overlay is active: ✕ handles and node-drag enabled. */
  isEditMode: boolean;
  /** The layer id used to register this manager's measure layer. */
  layerId: string;
  /** Event bus unsubscribe for EVENTS.LAYER_REMOVED. */
  offLayerRemoved!: () => void;
  onMapClick!: (event: L.LeafletMouseEvent) => void;
  onKeyDown!: (event: KeyboardEvent) => void;
  onUnload!: () => void;

  /** Handle export button click — delegates to the export module. */
  onExportClick(event: Event) {
    Export.handleExportClick(this)(event);
  }

  /** Register the export toolbar button click via the interaction manager. */
  bindExportClick(element: HTMLElement): void {
    this.exportClickCleanup = registerExportClick(this, element);
  }

  /**
   * @param mapInstance - Leaflet map instance.
   * @param opts - Optional configuration.
   * @param opts.id - Optional namespace for the layer ID. When provided,
   *   the layer is registered as "{ID}_{id}" to support multi-instance maps.
   */
  constructor(mapInstance: L.Map, opts?: { id?: string }) {
    this.map = mapInstance;
    this.layerId = generateId(CONST.ID, opts?.id);
    this.layers = this.map.foliplus!.LayerAPI!.createLayers({
      id: this.layerId,
      name: T("tool_toggle"),
      graphPane: CONST.PANES.GRAPH,
      labelPane: CONST.PANES.LABEL,
      iconSvg: SVGs.RULER,
      featureCountProvider: () => this.measurements.length,
    });
    this.currentMode = null;
    this.modeInstance = null;
    this.isSuppressHideDel = false;
    // When ExportControl enters crop interaction or export, interrupt the
    // active measurement so map clicks are not captured while exporting.
    ensureEvents(this.map).on(EVENTS.MODE_CHANGE, ({ component, mode }) => {
      if (component === COMPONENTS.ExportControl && mode !== null && this.currentMode) {
        this.clearActiveMode();
        map.foliplus?.showHint?.(CONF.name, T("export_paused"), HINT_DURATION.SHORT);
      }
    });
    this.toolBtns = [];
    this.finalizedClickHandlers = [];
    this.measurements = [];
    this.measurementIdCounter = 0;
    this.ctrl = null;
    this.isEditMode = false;

    this.bindGlobalEvents();
    this.restoreMeasurements();
    this.bindLayerRemoved();
  }

  // ── Persistence ──

  /** Persist all measurements to localStorage and refresh the count column. */
  saveMeasurements() {
    Storage.save(CONST.STORAGE.KEY, this.measurements, CONF.name);
    ensureEvents(this.map).emit(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: this.layerId });
  }

  /** Load measurements from localStorage.
   *  @returns {Array} Restored measurements array. */
  loadMeasurements() {
    const data = Storage.load<MeasureData[]>(CONST.STORAGE.KEY, CONF.name);
    return Array.isArray(data) ? data : [];
  }

  /** Generate a unique measurement ID. */
  /** Generate a unique measurement id, e.g. "foliplus_measure_marker_1699..._1".
   * The id is persisted with the measurement and exported (CSV / GeoJSON). */
  nextMeasurementId(type: string): string {
    this.measurementIdCounter += 1;
    return `${CONST.ID}_${type}_${Date.now()}_${this.measurementIdCounter}`;
  }

  /** Restore all persisted measurements from localStorage and rebuild their UI. */
  restoreMeasurements() {
    this.measurements = this.loadMeasurements();
    this.measurements.forEach(m => {
      MODE_MAP[m.type as keyof typeof MODE_MAP]?.restore?.(this, m);
    });
    // Notify LayerControl to refresh the count column now that the
    // persisted measurements are back, so the count is correct on page load
    // rather than only after the next user action.
    ensureEvents(this.map).emit(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: this.layerId });
  }

  /** Bind global map click, keydown, and unload events. */
  bindGlobalEvents() {
    this.onMapClick = (event: L.LeafletMouseEvent) => {
      const t = Util.getEventTarget(event);
      if (t?.closest?.(CONST.SEL.DEL_ICON)) return;
      // In edit mode, a click on empty map space only closes the overlay
      // (hides ✕, disables drag) via each overlay's own map-click handler —
      // it does NOT exit edit mode. Measurement-item clicks are intercepted
      // by attach*UI handlers (stopEvent) so they never reach here.
      if (this.isEditMode) {
        this.isSuppressHideDel = false;
      } else {
        if (this.isSuppressHideDel) return;
        hideDelIcons();
      }
    };
    this.map.on("click", this.onMapClick);

    this.onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (this.currentMode) this.clearActiveMode();
      else if (this.isEditMode) this.setEditMode(false);
    };
    this.interactionCleanup = registerInteractions(this);

    const cleanup =
      // On map unload (page refresh/close), clear transient UI state but KEEP
      // persisted measurements. clearAll() would wipe localStorage, losing all
      // saved data on every reload.
      (this.onUnload = () => {
        this.clearActiveMode();
        this.layers.clearLayers();
        this.finalizedClickHandlers.forEach(h => h());
        this.finalizedClickHandlers = [];
      });
    this.map.on("unload", this.onUnload);
  }

  /**
   * Attach toggle/delete UI to a completed distance measurement.
   * Shared by finishDist (DistanceMode) and restoreDistance (MeasureManager).
   * @param {Object} opts
   * @param {Object} opts.layers     - createLayers API object
   * @param {Object} opts.finalPoly  - L.Polyline
   * @param {Array}  opts.nodeMarkers - L.CircleMarker[]
   * @param {Array}  opts.segLabels   - Label L.Marker[]
   * @param {Array}  opts.points     - LatLng array
   * @param {Function} opts.onDelete - Called when user deletes the measurement
   * @param {Function} opts.onUpdate - Called when points are modified (node deletion)
   * @returns {Function} cleanup(mapClickHandler) to remove map click listener
   */
  setMode(mode: string | null) {
    if (mode === CONST.MODE.CLEAR) {
      this.clearAll();
      return;
    }
    if (mode === CONST.MODE.EDIT) {
      if (this.isEditMode) {
        this.setEditMode(false);
        return;
      }
      this.setEditMode(true);
      return;
    }
    if (this.currentMode === mode) {
      this.clearActiveMode();
      return;
    }
    if (!mode) return;

    // Starting a drawing mode exits edit mode so node handles / drag don't
    // coexist with the drawing cursor.
    if (this.isEditMode) this.setEditMode(false);

    this.layers.register();

    this.cleanMapEvents();
    this.currentMode = mode;
    ensureModes(this.map).setMode(CONF.name, mode);

    this.toolBtns.forEach(btn =>
      btn.classList.toggle(CONST.CLASSES.ACTIVE, btn.dataset.mode === mode),
    );

    this.map.getContainer().classList.add(CONST.CLASSES.MEASURING);

    const hintKey = {
      [CONST.MODE.MARKER]: T("hint_marker"),
      [CONST.MODE.DISTANCE]: T("hint_dist_start"),
      [CONST.MODE.POLYGON]: T("hint_polygon"),
      [CONST.MODE.CIRCLE]: T("hint_circle_start"),
    }[mode];

    if (hintKey) {
      this.map.foliplus!.showHint(CONF.name, hintKey, HINT_DURATION.PERSIST);
    }

    const ModeClass = MODE_MAP[mode as keyof typeof MODE_MAP];
    this.modeInstance = ModeClass ? new ModeClass(this) : null;
    this.modeInstance?.start();
    this.map.foliplus!.hideHint(CONF.name);
  }

  /** Enable/disable the edit overlay: ✕ handles and node drag. */
  setEditMode(on: boolean) {
    if (this.isEditMode === on) return;
    this.isEditMode = on;
    this.toolBtns.forEach(btn => {
      if (btn.dataset.mode === CONST.MODE.EDIT)
        btn.classList.toggle(CONST.CLASSES.ACTIVE, on);
    });
    if (on) {
      this.map.foliplus!.showHint(CONF.name, T("hint_edit"), HINT_DURATION.PERSIST);
    } else {
      this.map.foliplus!.hideHint(CONF.name);
    }
  }

  /** Deactivate current mode, clean up events, and hide hints. */
  clearActiveMode() {
    if (this.isEditMode) this.setEditMode(false);
    this.currentMode = null;
    ensureModes(this.map).setMode(CONF.name, null);
    this.toolBtns.forEach(btn => btn.classList.remove(CONST.CLASSES.ACTIVE));
    this.map.foliplus!.hideHint(CONF.name);
    this.map.getContainer().classList.remove(CONST.CLASSES.MEASURING);
    this.cleanMapEvents();
    this.interactionCleanup?.();
    this.layers.unregister();
  }

  /** Clear all measurements, layers, and persisted data. */
  clearAll() {
    this.layers.clearLayers();
    this.measurements = [];
    this.saveMeasurements();
    this.clearActiveMode();
    // Run each overlay's cleanup to unbind its map-click listener; clearLayers
    // above removed the targets, so dangling listeners would otherwise persist.
    this.finalizedClickHandlers.forEach(h => h());
    this.finalizedClickHandlers = [];
    // Collapse the panel after clearing all measurements
    if (this.ctrl) {
      this.ctrl.classList.remove(CONST.CLASSES.EXPANDED);
      this.ctrl.classList.add(CONST.CLASSES.COLLAPSED);
      adjustPanelZIndex({ container: this.ctrl, expanded: false });
    }
  }

  /** Full cleanup including global events. Called on control removal. */
  destroy() {
    if (this.offLayerRemoved) this.offLayerRemoved();
    this.map.off("unload", this.onUnload);
    this.clearAll();
    this.interactionCleanup?.();
    this.exportClickCleanup?.();
    this.map.off("click", this.onMapClick);
    this.finalizedClickHandlers.forEach(h => h());
    this.finalizedClickHandlers = [];
  }

  /**
   * Subscribe to EVENTS.LAYER_REMOVED so we can detect when the LayerControl panel
   * (or any external caller) deletes our measure layer. When that happens,
   * our active mode must be cleared — otherwise currentMode, hint, and the
   * "measuring" CSS class would remain stuck in an inconsistent state.
   */
  bindLayerRemoved() {
    this.offLayerRemoved = ensureEvents(this.map).on(EVENTS.LAYER_REMOVED, ((payload: {
      id?: string;
    }) => {
      if (payload?.id === this.layerId) {
        this.clearActiveMode();
      }
    }) as EventHandler);
  }

  /** Clean up current mode instance and hide hints. */
  cleanMapEvents() {
    if (this.modeInstance) {
      this.modeInstance.cleanup();
      this.modeInstance = null;
    }
    this.map.foliplus!.hideHint(CONF.name);
  }
}

export { MeasureManager };
