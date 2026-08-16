// MeasureControl core manager — persistence, mode switching, layer management.
import { COMPONENTS } from "#core/component.js";
import { MODE_CHANGE, LAYER_REMOVED, ensureEvents, type EventHandler } from "#core/event/index.js";
import { HINT_DURATION } from "#core/hint.js";
import { ensureModes } from "#core/mode.js";
import { hideDelIcons } from "#common/delicon.js";
import { createTranslator } from "#common/locale.js";
import { adjustPanelZIndex } from "#common/panel.js";
import * as Storage from "#common/storage.js";
import * as CONST from "./const.js";
import * as SVGs from "./icon.js";
import {
  CircleMode,
  DistanceMode,
  MODE_MAP,
  MarkerMode,
  MeasureMode,
  PolygonMode,
} from "./mode.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).
const foliplus = window.foliplus;
const _ = createTranslator(CONF);

// ==================== Core Manager ====================
/** Central manager for all measurements. */
class MeasureManager {
  map: L.Map;
  layers: CreateLayersAPI;
  currentMode: string | null;
  modeInstance: MeasureMode | null;
  isSuppressHideDel: boolean;
  toolBtns: HTMLElement[];
  finalizedClickHandlers: Array<(event: L.LeafletMouseEvent) => void>;
  measurements: MeasureData[];
  measurementIdCounter: number;
  ctrl: HTMLElement | null;
  /** The layer id used to register this manager's measure layer. */
  layerId: string;
  /** Event bus unsubscribe for LAYER_REMOVED. */
  offLayerRemoved!: () => void;
  onMapClick!: (event: L.LeafletMouseEvent) => void;
  onKeyDown!: (event: KeyboardEvent) => void;
  onUnload!: () => void;

  /**
   * @param mapInstance - Leaflet map instance.
   * @param opts - Optional configuration.
   * @param opts.id - Optional namespace for the layer ID. When provided,
   *   the layer is registered as "{ID}_{id}" to support multi-instance maps.
   */
  constructor(mapInstance: L.Map, opts?: { id?: string }) {
    this.map = mapInstance;
    this.layerId = CONST.generateId(opts?.id);
    this.layers = map.foliplus!.LayerAPI!.createLayers({
      id: this.layerId,
      name: _(`${CONF.name}.tool_toggle`),
      graphPane: CONST.PANES.GRAPH,
      labelPane: CONST.PANES.LABEL,
      iconSvg: SVGs.RULER,
    });
    this.currentMode = null;
    this.modeInstance = null;
    this.isSuppressHideDel = false;
    // When ExportControl enters crop interaction or export, interrupt the
    // active measurement so map clicks are not captured while exporting.
    ensureEvents(this.map).on(MODE_CHANGE, ({ component, mode }) => {
      if (component === COMPONENTS.ExportControl && mode !== null && this.currentMode) {
        this.clearActiveMode();
        map.foliplus?.showHint?.(
          CONF.name,
          _(`${CONF.name}.export_paused`),
          HINT_DURATION.SHORT,
        );
      }
    });
    this.toolBtns = [];
    this.finalizedClickHandlers = [];
    this.measurements = [];
    this.measurementIdCounter = 0;
    this.ctrl = null;

    this.bindGlobalEvents();
    this.restoreMeasurements();
    this.bindLayerRemoved();
  }

  // ── Persistence ──

  /** Persist all measurements to localStorage. */
  saveMeasurements() {
    Storage.save(CONST.STORAGE.KEY, this.measurements, CONF.name);
  }

  /** Load measurements from localStorage.
   *  @returns {Array} Restored measurements array. */
  loadMeasurements() {
    const data = Storage.load<MeasureData[]>(CONST.STORAGE.KEY, CONF.name);
    return Array.isArray(data) ? data : [];
  }

  /** Generate a unique measurement ID. */
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
  }

  /** Bind global map click, keydown, and unload events. */
  bindGlobalEvents() {
    this.onMapClick = (event: L.LeafletMouseEvent) => {
      if (this.isSuppressHideDel) return;
      const t = (event.originalEvent as MouseEvent)?.target as HTMLElement | null;
      if (t?.closest?.(CONST.SEL.DEL_ICON)) return;
      hideDelIcons();
    };
    this.map.on("click", this.onMapClick);

    this.onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && this.currentMode) this.clearActiveMode();
    };
    document.addEventListener("keydown", this.onKeyDown);

    // On map unload (page refresh/close), clear transient UI state but KEEP
    // persisted measurements. clearAll() would wipe localStorage, losing all
    // saved data on every reload.
    this.onUnload = () => {
      this.clearActiveMode();
      this.layers.clearLayers();
      this.finalizedClickHandlers.forEach(h => this.map.off("click", h));
      this.finalizedClickHandlers = [];
    };
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
    if (this.currentMode === mode) {
      this.clearActiveMode();
      return;
    }

    // Re-register the measure layer so it's visible and on top when the user
    // activates a measurement tool, even if the layer was previously
    // hidden or re-ordered in the LayerControl panel.
    this.layers.register();

    this.cleanMapEvents();
    this.currentMode = mode;
    ensureModes(this.map).setMode(CONF.name, mode);

    this.toolBtns.forEach(btn =>
      btn.classList.toggle(CONST.CLASSES.ACTIVE, btn.dataset.mode === mode),
    );

    this.map.getContainer().classList.add(CONST.CLASSES.MEASURING);

    if (mode === CONST.MODE.MARKER) {
      map.foliplus!.showHint(
        CONF.name,
        _(`${CONF.name}.hint_marker`),
        HINT_DURATION.PERSIST,
      );
      this.modeInstance = new MarkerMode(this);
      this.modeInstance.start();
    } else if (mode === CONST.MODE.DISTANCE) {
      map.foliplus!.showHint(
        CONF.name,
        _(`${CONF.name}.hint_dist_start`),
        HINT_DURATION.PERSIST,
      );
      this.modeInstance = new DistanceMode(this);
      this.modeInstance.start();
    } else if (mode === CONST.MODE.POLYGON) {
      map.foliplus!.showHint(
        CONF.name,
        _(`${CONF.name}.hint_polygon`),
        HINT_DURATION.PERSIST,
      );
      this.modeInstance = new PolygonMode(this);
      this.modeInstance.start();
    } else if (mode === CONST.MODE.CIRCLE) {
      map.foliplus!.showHint(
        CONF.name,
        _(`${CONF.name}.hint_circle_start`),
        HINT_DURATION.PERSIST,
      );
      this.modeInstance = new CircleMode(this);
      this.modeInstance.start();
    }
  }

  /** Deactivate current mode, clean up events, and hide hints. */
  clearActiveMode() {
    this.currentMode = null;
    ensureModes(this.map).setMode(CONF.name, null);
    this.toolBtns.forEach(btn => btn.classList.remove(CONST.CLASSES.ACTIVE));
    map.foliplus!.hideHint(CONF.name);
    this.map.getContainer().classList.remove(CONST.CLASSES.MEASURING);
    this.cleanMapEvents();
    // Unregister the measure layer if it has no content left (interrupted
    // preview with no persisted measurements). Safe: unregister() is a no-op
    // when there are still completed measurements in the layer.
    this.layers.unregister();
  }

  /** Clear all measurements, layers, and persisted data. */
  clearAll() {
    this.layers.clearLayers();
    this.measurements = [];
    this.saveMeasurements();
    this.clearActiveMode();
    // Unbind all finalized-circle map click handlers; clearLayers removed
    // their targets so they would otherwise dangle until destroy().
    this.finalizedClickHandlers.forEach(h => this.map.off("click", h));
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
    // Unsubscribe from LAYER_REMOVED first to prevent reacting to removals
    // triggered by our own clearAll() during destroy.
    if (this.offLayerRemoved) this.offLayerRemoved();
    // Unbind onUnload first to prevent theoretical recursion if clearAll triggers unload
    this.map.off("unload", this.onUnload);
    this.clearAll();
    this.map.off("click", this.onMapClick);
    document.removeEventListener("keydown", this.onKeyDown);
    this.finalizedClickHandlers.forEach(h => this.map.off("click", h));
    this.finalizedClickHandlers = [];
  }

  /**
   * Subscribe to LAYER_REMOVED so we can detect when the LayerControl panel
   * (or any external caller) deletes our measure layer. When that happens,
   * our active mode must be cleared — otherwise currentMode, hint, and the
   * "measuring" CSS class would remain stuck in an inconsistent state.
   */
  bindLayerRemoved() {
    this.offLayerRemoved = ensureEvents(this.map).on(LAYER_REMOVED, ((payload: {
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
    map.foliplus!.hideHint(CONF.name);
  }
}

export { MeasureManager };
