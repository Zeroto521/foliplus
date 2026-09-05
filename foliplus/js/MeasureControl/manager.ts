// MeasureControl core manager — persistence, mode switching, layer management.
import { COMPONENTS, generateId } from "#core/component.js";
import { EVENTS, type EventHandler, ensureEvents } from "#core/event/index.js";
import { HINT_DURATION } from "#core/hint.js";
import { isLayerInPanes } from "#core/layer/index.js";
import { ensureModes, guardBlocked } from "#core/mode.js";
import { hideDelIcons } from "#common/delicon.js";
import { createScopedTranslator } from "#common/locale.js";
import { adjustPanelZIndex } from "#common/panel.js";
import { type CollidableLabel, mapProjector, placeLabels } from "./collision.js";
import * as CONST from "./const.js";
import * as Export from "./export.js";
import * as SVGs from "./icon.js";
import {
  registerActiveEscape,
  registerExportClick,
  registerInteractions,
} from "./interaction.js";
import { MODE_MAP, MeasureMode } from "./mode/index.js";
import { MeasureStore } from "./store.js";
import * as Util from "./util.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).
const foliplus = window.foliplus;
const T = createScopedTranslator(CONF);

/** In edit mode, suspend every layer except the measurement panes so nodes stay
 *  draggable and shapes clickable to reveal their ✕ handles. */
const skipMeasureLayers = isLayerInPanes([CONST.PANES.GRAPH, CONST.PANES.LABEL]);

/** Group key for edit registrations that carry no measurement id (tests,
 *  one-off call sites) — each such handle stays isolated. A string literal is
 *  valid as a Map key, unlike a Symbol. */
const ANON_HANDLE = " anon-edit-handle";

/** Per-measurement edit-mode resource bundle: the three things a finalized
 *  measurement registers with the manager — its dispose (unbinds drag binds,
 *  edit overlay and the drag toggle), the ✕ overlay close callback, and the
 *  node-drag toggle. Keyed by measurement id so delete drops one handle and
 *  setEditMode/clearAll/destroy each walk one collection. */
interface EditHandle {
  dispose: () => void;
  closeOverlay: () => void;
  toggleDrag: (enabled: boolean) => void;
}

/** Map events that change pixel geometry and therefore invalidate placements. */
const LABEL_MAP_EVENTS: Array<"moveend" | "zoomend" | "resize"> = [
  "moveend",
  "zoomend",
  "resize",
];

// ==================== Core Manager ====================
/** Central manager for all measurements. */
class MeasureManager {
  map: L.Map;
  private interactionCleanup?: () => void;
  private measureEscapeCleanup?: () => void;
  private exportClickCleanup?: () => void;
  layers: CreateLayersAPI;
  currentMode: string | null;
  modeInstance: MeasureMode | null;
  toolBtns: HTMLElement[];
  /** Per-measurement edit handles, keyed by measurement id (see EditHandle).
   *  registerFinalized / registerEditOverlayCloser / registerEditDragToggle all
   *  merge into the one handle for their id. */
  private editHandles: Map<string, EditHandle> = new Map();
  /** Central store for measurement data + persistence + count emission. */
  readonly store: MeasureStore;
  /** Every rendered label chip, so collision detection plans all measurements
   *   together instead of one measurement at a time. */
  private collidableLabels: CollidableLabel[] = [];
  /** Deferred re-plan; coalesces bursts of label updates into one pass. */
  private labelPlanFrame: number | null = null;
  /** Bound map-move/zoom/resize listener that invalidates label placements. */
  private onLabelMapMove: (() => void) | null = null;
  ctrl: HTMLElement | null;
  /** Whether the edit overlay is active: ✕ handles and node-drag enabled. */
  isEditMode: boolean;
  /** Persistent coordinate readout element, or null when show_live_coords is off. */
  private coordReadoutEl: HTMLElement | null;
  /** The layer id used to register this manager's measure layer. */
  layerId: string;
  /** Event bus unsubscribe for EVENTS.LAYER_REMOVED. */
  private offLayerRemoved!: () => void;
  private onMapClick!: (event: L.LeafletMouseEvent) => void;
  onKeyDown!: (event: KeyboardEvent) => void;
  private onUnload!: () => void;

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
    this.store = new MeasureStore(this.map, this.layerId);
    this.layers = this.map.foliplus!.LayerAPI!.createLayers({
      id: this.layerId,
      name: T("tool_toggle"),
      graphPane: CONST.PANES.GRAPH,
      labelPane: CONST.PANES.LABEL,
      iconSvg: SVGs.RULER,
      featureCountProvider: () => this.store.count(),
    });
    this.currentMode = null;
    this.modeInstance = null;
    // When ExportControl enters crop interaction or export, interrupt the
    // active measurement so map clicks are not captured while exporting.
    ensureEvents(this.map).on(EVENTS.MODE_CHANGE, ({ component, mode }) => {
      if (component === COMPONENTS.ExportControl && mode !== null && this.currentMode) {
        this.clearActiveMode();
        map.foliplus?.showHint?.(CONF.name, T("export_paused"), HINT_DURATION.SHORT);
      }
    });
    this.toolBtns = [];
    this.ctrl = null;
    this.isEditMode = false;
    this.coordReadoutEl = CONF.show_live_coords
      ? Util.buildCoordReadout(mapInstance)
      : null;

    this.bindGlobalEvents();
    this.restoreMeasurements();
    this.bindLayerRemoved();
  }

  // ── Persistence (compatibility shell over MeasureStore) ──
  // Browser tests and legacy call sites read `manager.measurements` /
  // call `saveMeasurements()` directly; new code should use `manager.store`.

  /** Live measurements array. Reads return the store's backing array; writes
   *  hydrate the store in place (used by tests + legacy seed paths). Mutating
   *  the returned array directly does NOT persist — use store.add/remove/update. */
  get measurements(): MeasureData[] {
    return this.store.all();
  }
  set measurements(data: MeasureData[]) {
    this.store.hydrate(data);
  }

  /** Persist all measurements to localStorage and refresh the count column. */
  saveMeasurements() {
    this.store.persist();
  }

  /** Generate a unique measurement id, e.g. "foliplus_measure_marker_1699..._1".
   * The id is persisted with the measurement and exported (CSV / GeoJSON). */
  nextMeasurementId(type: string): string {
    return this.store.nextId(type);
  }

  /** Restore all persisted measurements from localStorage and rebuild their UI. */
  restoreMeasurements() {
    this.store.hydrate(this.store.load());
    // Older persisted measurements may lack an `id`. Assign one before
    // rebuild so later onUpdate / onDelete paths (which match by id) resolve
    // to the right measurement and exports carry a stable id.
    const loaded = this.store.all();
    let stabilized = false;
    for (const m of loaded) {
      if (!m.id) {
        m.id = this.store.nextId(m.type);
        stabilized = true;
      }
    }
    if (stabilized) this.store.persist();
    loaded.forEach(m => {
      MODE_MAP[m.type as keyof typeof MODE_MAP]?.restore?.(this, m);
    });
    // Notify LayerControl to refresh the count column now that the
    // persisted measurements are back, so the count is correct on page load
    // rather than only after the next user action.
    this.store.emitCount();
  }

  /** Bind global map click, keydown, and unload events. */
  bindGlobalEvents() {
    this.onMapClick = (event: L.LeafletMouseEvent) => {
      const t = Util.getEventTarget(event);
      if (t?.closest?.(CONST.SEL.DEL_ICON)) return;
      // In edit mode, a click on empty map space is handled by each overlay's
      // own map-click handler (which closes it) — it does NOT exit edit mode.
      // Measurement-item clicks are intercepted by attach*UI handlers
      // (stopEvent) so they never reach here.
      if (this.isEditMode) return;
      hideDelIcons();
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
        this.disposeAllHandles();
      });
    this.map.on("unload", this.onUnload);
  }

  /** Activate a measurement mode, or toggle the edit / clear modes. */
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
      // Edit and drawing modes are mutually exclusive: cancel any active
      // drawing mode before entering edit.
      if (this.currentMode) this.clearActiveMode();
      // Nothing to edit yet — keep out of edit mode and explain instead of
      // entering a dead state with no clickable measurements.
      if (this.store.count() === 0) {
        this.map.foliplus!.showHint(
          CONF.name,
          T("hint_edit_empty"),
          HINT_DURATION.SHORT,
        );
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

    // Symmetric lock with the other interactive components (focus / export).
    if (
      guardBlocked(this.map, CONF.name, T("blocked"), [
        { blockedBy: COMPONENTS.ExportControl, text: T("blocked_export") },
        { blockedBy: COMPONENTS.LayerControl, text: T("blocked_layer") },
        { blockedBy: COMPONENTS.SearchControl, text: T("blocked_search") },
        { blockedBy: COMPONENTS.LocateControl, text: T("blocked_locate") },
      ])
    )
      return;

    this.layers.register();

    this.cleanMapEvents();
    this.currentMode = mode;
    // Registering a mode in the ModeManager also suspends map-layer interaction
    // while measuring (see core/mode syncInteractionLock), so clicks fall
    // through to the map for node placement instead of firing layer handlers.
    ensureModes(this.map).setMode(CONF.name, mode);

    this.toolBtns.forEach(btn =>
      btn.classList.toggle(CONST.CLASSES.ACTIVE, btn.dataset.mode === mode),
    );

    this.map.getContainer().classList.add(CONST.CLASSES.MEASURING);

    // Register a high-priority Escape so it wins over all container-bound
    // shortcuts (LayerControl/ExportControl) while a measurement is in
    // progress. priority=1 overrides the default 0 that those use.
    this.measureEscapeCleanup = registerActiveEscape(this);

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
  }

  /** Get-or-create the EditHandle for a measurement id. Three registrations for
   *  the same id (dispose + overlay close + drag toggle) merge into one handle,
   *  so delete drops one entry and clearAll/destroy walk one collection. */
  private handleFor(id: string): EditHandle {
    let handle = this.editHandles.get(id);
    if (!handle) {
      handle = {
        dispose: () => {},
        closeOverlay: () => {},
        toggleDrag: () => {},
      };
      this.editHandles.set(id, handle);
    }
    return handle;
  }

  /** Run every handle's dispose, then clear the map. Iterating a snapshot keeps
   *  handles that dispose() detaches from mid-walk from leaking. */
  private disposeAllHandles() {
    [...this.editHandles.values()].forEach(h => h.dispose());
    this.editHandles.clear();
  }

  /** Register an overlay close callback so setEditMode(false) can hide ✕.
   *  `id` groups the closer with the measurement's other edit registrations.
   *  Returns an unregister function so deleted measurements drop their entry. */
  registerEditOverlayCloser = (close: () => void, id?: string): (() => void) => {
    const key = id ?? ANON_HANDLE;
    this.handleFor(key).closeOverlay = close;
    return () => this.editHandles.delete(key);
  };

  /** Close every open edit overlay except the one keyed by `exceptId`, so
   *  selecting a new measurement hides the previously selected one's ✕. */
  closeOtherEditOverlays = (exceptId: string) => {
    this.editHandles.forEach((h, id) => {
      if (id !== exceptId) h.closeOverlay();
    });
  };

  /** Register a node-drag toggle so setEditMode toggles dragging directly.
   *  `id` groups the toggle with the measurement's other edit registrations.
   *  Returns an unregister function so deleted measurements drop their entry. */
  registerEditDragToggle = (
    toggle: (enabled: boolean) => void,
    id?: string,
  ): (() => void) => {
    const key = id ?? ANON_HANDLE;
    this.handleFor(key).toggleDrag = toggle;
    return () => this.editHandles.delete(key);
  };

  /** Register a finalized measurement's dispose so clearAll/destroy run it.
   *  `id` groups the dispose with the measurement's other edit registrations.
   *  Returns an unregister function so deleting one measurement drops its entry. */
  registerFinalized = (cleanup: () => void, id?: string): (() => void) => {
    const key = id ?? ANON_HANDLE;
    this.handleFor(key).dispose = cleanup;
    return () => this.editHandles.delete(key);
  };

  // ── Label collision detection ─────────────────────────────────

  /** True unless collision detection was switched off by the Python config. */
  get labelsCollide(): boolean {
    return CONF.collide_labels !== false;
  }

  /**
   * Register a label chip for collision detection. `priority` says how much
   * this label matters: the lowest values drop out first when two chips
   * overlap heavily. The chip is re-read on every plan, so a `setIcon` during
   * a drag cannot leave a stale element reference.
   *
   * Returns an unregister function; measurements call it when a label is
   * removed from the map.
   */
  registerLabel = (marker: L.Marker, priority: number): (() => void) => {
    const label: CollidableLabel = { marker, priority };
    this.collidableLabels.push(label);
    this.bindLabelMapEvents();
    this.scheduleLabelPlan();

    return () => {
      this.collidableLabels = this.collidableLabels.filter(l => l !== label);
      if (this.collidableLabels.length) {
        // A surviving label lost a competitor, so re-plan to possibly restore
        // a chip that was hidden because of this one.
        this.scheduleLabelPlan();
      } else {
        this.unbindLabelMapEvents();
      }
    };
  };

  /** Defer a collision re-plan to the next frame so a burst of label updates
   *  (a drag move, a node delete, a map move) runs one planner pass, not one
   *  per update. */
  private scheduleLabelPlan(): void {
    if (this.labelPlanFrame !== null) return;
    // Mark in-flight before the rAF call so the guard coalesces even when a
    // synchronous test stub returns 0 (falsy but not null).
    this.labelPlanFrame = 1;
    requestAnimationFrame(() => {
      this.labelPlanFrame = null;
      this.planLabels();
    });
  }

  /** Placement depends on pixel geometry, so a pan, zoom or resize makes the
   *  last plan stale. Bound lazily on the first label, released when the
   *  last one is removed. */
  private bindLabelMapEvents(): void {
    if (this.onLabelMapMove) return;
    const handler = () => this.scheduleLabelPlan();
    this.onLabelMapMove = handler;
    LABEL_MAP_EVENTS.forEach(ev => this.map.on(ev, handler));
  }

  private unbindLabelMapEvents(): void {
    if (!this.onLabelMapMove) return;
    const handler = this.onLabelMapMove;
    LABEL_MAP_EVENTS.forEach(ev => this.map.off(ev, handler));
    this.onLabelMapMove = null;
  }

  /** Re-plan every label placement. With collision off every chip simply
   *  returns to its anchor; labels themselves are hidden by the container
   *  class, which also keeps them out of PNG exports. */
  private planLabels(): void {
    if (this.collidableLabels.length === 0) return;
    placeLabels(
      this.collidableLabels,
      mapProjector(this.map),
      this.labelsCollide,
      Util.labelChipOf,
    );
  }

  /** Show or hide the live coordinate readout. No-op when disabled by config. */
  setCoordReadoutVisible(visible: boolean) {
    Util.setCoordReadoutVisible(this.coordReadoutEl, visible);
  }

  /** Update the readout with a map-display-coordinate point. The WGS84
   *  conversion lives inside coordText, so the readout always matches export. */
  setCoordReadout(pt: L.LatLng | { lat: number; lng: number }) {
    if (!this.coordReadoutEl) return;
    Util.setCoordReadout(this.coordReadoutEl, Util.coordText(this.map, pt));
  }

  /** Update the readout with an already-WGS84 point (persisted measurements). */
  setCoordReadoutWgs(lng: number, lat: number) {
    if (!this.coordReadoutEl) return;
    Util.setCoordReadout(this.coordReadoutEl, Util.formatLatLng(lng, lat));
  }

  /** Enable/disable the edit overlay: ✕ handles and node drag. */
  setEditMode(on: boolean) {
    if (this.isEditMode === on) return;
    this.isEditMode = on;
    // Edit mode owns the map like a drawing mode, but it edits the measurement
    // layers themselves — register it with a skip predicate so data layers are
    // suspended while the measure panes stay interactive.
    ensureModes(this.map).setMode(
      CONF.name,
      on ? CONST.MODE.EDIT : null,
      on ? skipMeasureLayers : undefined,
    );
    this.map.getContainer().classList.toggle(CONST.CLASSES.EDITING, on);
    this.toolBtns.forEach(btn => {
      if (btn.dataset.mode === CONST.MODE.EDIT)
        btn.classList.toggle(CONST.CLASSES.ACTIVE, on);
    });
    // Node drag is tied to edit mode (not the overlay): entering edit makes
    // nodes directly draggable, leaving disables them.
    this.editHandles.forEach(h => h.toggleDrag(on));
    if (on) {
      this.map.foliplus!.showHint(CONF.name, T("hint_edit"), HINT_DURATION.PERSIST);
    } else {
      this.map.foliplus!.hideHint(CONF.name);
      // Close any open overlays so ✕ handles don't linger after leaving edit
      // mode. Keep the handles registered so a later edit session can close
      // them again; each overlay unregisters itself on delete.
      this.editHandles.forEach(h => h.closeOverlay());
    }
  }

  /** Deactivate current mode, clean up events, and hide hints. */
  clearActiveMode() {
    if (this.isEditMode) this.setEditMode(false);
    this.currentMode = null;
    // Clearing the mode restores map-layer interaction (core/mode lock).
    ensureModes(this.map).setMode(CONF.name, null);
    this.toolBtns.forEach(btn => btn.classList.remove(CONST.CLASSES.ACTIVE));
    this.map.foliplus!.hideHint(CONF.name);
    this.map.getContainer().classList.remove(CONST.CLASSES.MEASURING);
    this.cleanMapEvents();
    // Unregister the high-priority Escape so container-bound shortcuts
    // (LayerControl/ExportControl) can respond again.
    this.measureEscapeCleanup?.();
    this.measureEscapeCleanup = undefined;
    // Stop tracking the cursor once a drawing session ends.
    this.setCoordReadoutVisible(false);
    // NOTE: the low-priority Escape (interactionCleanup) stays registered for
    // the manager's lifetime (unregistered only in destroy()); it also drives
    // edit-mode Escape, so unregistering here would break Escape after the
    // first measurement.
    this.layers.unregister();
  }

  /** Clear all measurements, layers, and persisted data. */
  clearAll() {
    this.layers.clearLayers();
    this.store.clear();
    this.clearActiveMode();
    // Run each handle's dispose to unbind its map-click listener; clearLayers
    // above removed the targets, so dangling listeners would otherwise persist.
    this.disposeAllHandles();
    // Safety net: each measurement's dispose (run above) drains its labels
    // through the unregister, but clearing the array here is O(1) insurance
    // against a measurement that skips its dispose, and unbinding the map
    // events guarantees no plan fires after clearAll.
    this.collidableLabels = [];
    this.unbindLabelMapEvents();
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
    this.coordReadoutEl?.remove();
    this.coordReadoutEl = null;
    this.interactionCleanup?.();
    this.exportClickCleanup?.();
    this.map.off("click", this.onMapClick);
    this.unbindLabelMapEvents();
    this.collidableLabels = [];
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
