import { createTranslator } from "#common/locale.js";
import { createLogger } from "#common/log.js";
import type { MeasureManager } from "../manager.js";
import * as Util from "../util.js";

// CONF is a free variable from the IIFE template wrapper (see global.d.ts).
// `getNameLabel` relies on identity comparison: when no locale table exists,
// `_(this.NAME_LABEL_KEY)` must return the exact same short key so the
// fallback to NAME_LABEL kicks in. createScopedTranslator prepends conf.name,
// breaking that comparison — so base.ts deliberately uses createTranslator.
const T = createTranslator(CONF);

const log = createLogger(CONF.name);

class MeasureMode {
  static TYPE: string = "";
  /** English display name — used in exported GeoJSON properties.name (data stays
   *  portable for external GIS tools). Subclasses override. */
  static NAME_LABEL: string = "";
  /** Locale key for the CSV display name (human-readable). Subclasses override. */
  static NAME_LABEL_KEY: string = "";
  /**
   * Human-readable label: the i18n translation of NAME_LABEL_KEY when the
   * locale table has it, otherwise the English NAME_LABEL fallback.
   * Shared by CSV export (getNameForType) and GeoJSON properties.name.
   */
  static getNameLabel(): string {
    const label = T(this.NAME_LABEL_KEY);
    return label === this.NAME_LABEL_KEY ? this.NAME_LABEL : label;
  }

  manager: MeasureManager;
  map: L.Map;
  layers: CreateLayersAPI;
  _cleanup: (() => void) | null;

  constructor(manager: MeasureManager) {
    this.manager = manager;
    this.map = manager.map;
    this.layers = manager.layers;
    this._cleanup = null;
  }

  /** Shorthand for manager */
  get m() {
    return this.manager;
  }

  /** Shorthand for mode type */
  get type(): string {
    return (this.constructor as typeof MeasureMode).TYPE;
  }

  /** Start the mode — bind events, create UI. Subclasses must override. */
  start(): void {
    throw new Error(log.msg(`start not implemented for ${this.type}`));
  }

  /** Cleanup — unbind events, remove temporary elements. */
  cleanup(): void {
    if (this._cleanup) {
      this._cleanup();
      this._cleanup = null;
    }
  }

  /** Generate a unique measurement ID with type prefix. */
  nextMeasurementId(): string {
    return this.m.nextMeasurementId(this.type);
  }

  /** Rebuild a persisted measurement from data.
   *  Subclasses override this to restore their specific visual elements.
   *  @param manager - MeasureManager instance.
   *  @param data - Persisted measurement data. */
  static restore(manager: MeasureManager, data: MeasureData): void {
    throw new Error(log.msg(`restore not implemented for ${this.TYPE}`));
  }

  /** Convert a persisted measurement to a GeoJSON Feature.
   *  Subclasses override this to return their specific geometry type. */
  static toGeoFeature(_data: MeasureData): GeoJSON.Feature {
    throw new Error(log.msg(`toGeoFeature not implemented for ${this.TYPE}`));
  }
}

// ==================== Preview Mode Base Class ====================
/**
 * Base class for modes with preview layers (distance, polygon, circle).
 * Tracks and cleans up preview artifacts.
 */
class PreviewMode extends MeasureMode {
  previewLayers: L.Layer[];
  isFinished: boolean;
  private cursorNode: L.CircleMarker | null;

  constructor(manager: MeasureManager) {
    super(manager);
    this.previewLayers = [];
    this.isFinished = false;
    this.cursorNode = null;
  }

  /** Track a preview layer (adds to layer group + tracks for cleanup). */
  addPreview<T extends L.Layer>(layer: T): T {
    this.previewLayers.push(layer);
    this.layers.addLayer(layer);
    return layer;
  }

  /** Remove a specific preview layer. */
  removePreview(layer: L.Layer): void {
    const idx = this.previewLayers.indexOf(layer);
    if (idx !== -1) this.previewLayers.splice(idx, 1);
    this.layers.removeLayer(layer);
  }

  /** Remove all tracked preview layers. */
  clearPreviews(): void {
    this.previewLayers.forEach(l => this.layers.removeLayer(l));
    this.previewLayers = [];
  }

  /**
   * The transient hollow cursor dot shown while a preview shape is being
   * drawn — distance's trailing endpoint, polygon's next vertex, circle's
   * radius endpoint.
   *
   * Recreated on every call rather than updated in place. Line and polygon
   * preview shapes update their coordinates via `setLatLngs`, which triggers
   * Leaflet's `_updatePath` → `setPane` and pushes the corresponding `<path>`
   * to the tail of the SVG `_rootGroup` every frame. A node moved with
   * `setLatLng` does not participate in that re-sort, so its DOM position
   * stays where it was created — and the live preview line climbs over it
   * after a few mousemoves. Removing and re-adding each frame keeps the
   * invariant explicit: the cursor node is always the newest sibling, so
   * paint order is attach order and nothing else matters.
   *
   * The `bringToFront` hack on individual calls (which the old circle
   * preview code needed) is gone for the same reason — the re-add already
   * puts the node at the SVG tail.
   */
  moveCursorNode(latlng: L.LatLng): L.CircleMarker {
    if (this.cursorNode) this.removePreview(this.cursorNode);
    this.cursorNode = this.addPreview(Util.makePreviewNode(latlng));
    return this.cursorNode;
  }

  /** Drop the cursor node when drawing ends or is cancelled. */
  clearCursorNode(): void {
    if (!this.cursorNode) return;
    this.removePreview(this.cursorNode);
    this.cursorNode = null;
  }
}

export { MeasureMode, PreviewMode };
