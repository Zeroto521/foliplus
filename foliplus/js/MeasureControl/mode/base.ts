import { createTranslator } from "#common/locale.js";
import { createLogger } from "#common/log.js";
import * as CONST from "../const.js";
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

  /**
   * Track a preview layer (adds to layer group + tracks for cleanup).
   *
   * `paneName` is forwarded to `addLayer`; omit it for geometry, which lands
   * in the base pane. Labels must pass `CONST.PANES.LABEL` explicitly — an
   * omitted name silently defaults to the base pane, where a label competes
   * for SVG paint order with the geometry instead of sitting above it by pane
   * ordering.
   */
  addPreview<T extends L.Layer>(layer: T, paneName?: string): T {
    this.previewLayers.push(layer);
    this.layers.addLayer(layer, paneName);
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
   * Re-attach a preview layer so it becomes the newest sibling of the SVG
   * `_rootGroup` — i.e. it paints above everything else in the preview.
   *
   * Preview shapes update their coordinates with `setLatLngs`, which triggers
   * Leaflet's `_updatePath` → `setPane` and pushes that `<path>` to the tail
   * of `_rootGroup` every frame. Markers and circle markers moved with
   * `setLatLng` / `setRadius` do not participate in that re-sort, so they keep
   * the DOM position they were created at — and the preview line (or circle)
   * climbs over them after a few mousemoves. "Attach order == paint order"
   * therefore only holds at creation time; any preview node that must stay
   * above a live shape needs re-attaching on every frame.
   *
   * Remove + re-add is used rather than `bringToFront()` because the latter
   * reaches into Leaflet's private `_rootGroup`, while re-adding only relies
   * on the public layer-group contract.
   */
  pinToTop<T extends L.Layer>(layer: T, paneName?: string): T {
    this.removePreview(layer);
    return this.addPreview(layer, paneName);
  }

  /**
   * The transient hollow cursor dot shown while a preview shape is being
   * drawn — distance's trailing endpoint, polygon's next vertex, circle's
   * radius endpoint.
   *
   * Recreated on every call rather than moved with `setLatLng`, because the
   * position changes every frame anyway and the re-add doubles as the
   * re-order that `pinToTop` exists for.
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

  /**
   * Create or update a preview label in the label pane.
   *
   * Every preview mode (circle radius, distance segment, polygon edge) needs
   * a floating label that tracks a moving midpoint. This method owns the
   * full lifecycle so no mode can forget `setLatLng` (position), `pinToTop`
   * (paint order within the label pane), or the `CONST.PANES.LABEL` routing.
   *
   * @param label - Existing label to update, or `null` to create one.
   * @param latlng - New midpoint position.
   * @param text - New label text.
   * @param makeIcon - Factory for the DivIcon (caller picks anchor/class).
   * @returns The created or updated marker.
   */
  updateOrCreateLabel(
    label: L.Marker | null,
    latlng: L.LatLng,
    text: string,
    makeIcon: (text: string) => L.DivIcon,
  ): L.Marker {
    if (!label) {
      const el = L.marker(latlng, { icon: makeIcon(text), interactive: false });
      return this.addPreview(el, CONST.PANES.LABEL);
    }
    label.setLatLng(latlng);
    this.pinToTop(label, CONST.PANES.LABEL);
    Util.setLabelText(label, text);
    return label;
  }
}

export { MeasureMode, PreviewMode };
