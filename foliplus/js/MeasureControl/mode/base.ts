import { createTranslator } from "#common/locale.js";
import type { MeasureManager } from "../manager.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).
const _ = createTranslator(CONF);

class MeasureMode {
  static TYPE: string = "";
  /** English display name — used in exported GeoJSON properties.name (data stays
   *  portable for external GIS tools). Subclasses override. */
  static NAME_LABEL: string = "";
  /** Locale key for the CSV display name (human-readable). Subclasses override. */
  static NAME_LABEL_KEY: string = "";
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
    throw new Error(`[${CONF.name}] start not implemented for ${this.type}`);
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
    throw new Error(`[${CONF.name}] restore not implemented for ${this.TYPE}`);
  }

  /** Convert a persisted measurement to a GeoJSON Feature.
   *  Subclasses override this to return their specific geometry type. */
  static toGeoFeature(_data: MeasureData): GeoJSON.Feature {
    throw new Error(`[${CONF.name}] toGeoFeature not implemented for ${this.TYPE}`);
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

  constructor(manager: MeasureManager) {
    super(manager);
    this.previewLayers = [];
    this.isFinished = false;
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
}

export { MeasureMode, PreviewMode };
