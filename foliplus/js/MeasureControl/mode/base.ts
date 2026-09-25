import { toggleDelIcon } from "#common/delicon.js";
import { mountDelIcon as mountDelIconShared } from "#common/deliconMount.js";
import { createTranslator } from "#common/locale.js";
import { createLogger } from "#common/log.js";
import * as CONST from "../const.js";
import { buildEditOverlay } from "../edit.js";
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
    // The preview is a drawing aid, not content: an export started mid-drawing
    // must not freeze it in the picture.  Every preview funnels through here —
    // pinToTop and moveCursorNode rebuild by remove + re-add, which is the same
    // call — so one stamp covers the rebuilds too.  Duck-checked rather than
    // instanceof: a non-element layer simply has no getElement and is skipped.
    const el = (layer as { getElement?: () => HTMLElement | null }).getElement?.();
    el?.classList.add(CONST.CLASSES.SKIP_EXPORT);
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
   * Re-attach a preview layer so it becomes the newest sibling in its pane —
   * i.e. it paints above earlier siblings within that pane.
   *
   * Preview shapes update their coordinates with `setLatLngs`, which triggers
   * Leaflet's `_updatePath` → `setPane` and pushes that `<path>` to the tail
   * of `_rootGroup` every frame. Markers moved with `setLatLng` do not
   * participate in that re-sort, so within the label pane the preview label
   * would drop under previously-confirmed labels after a few mousemoves.
   * Remove + re-add keeps the moving label the newest sibling.
   *
   * Pane-level z-order (graph < node < label) already keeps nodes above
   * shapes and labels above nodes — this only orders siblings *within* a pane.
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
   * Lives in the node pane (above the graph pane's shapes by z-order, below
   * the label pane). Recreated on every call rather than moved with
   * `setLatLng`, because the position changes every frame anyway and the
   * re-add keeps it the newest node sibling within the node pane.
   */
  moveCursorNode(latlng: L.LatLng): L.CircleMarker {
    if (this.cursorNode) this.removePreview(this.cursorNode);
    this.cursorNode = this.addPreview(Util.makePreviewNode(latlng), CONST.PANES.NODE);
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

// ==================== Finalized Lifecycle Hook ====================
/**
 * MeasureControl's delete-icon mount: the shared `mountDelIcon` pinned to the
 * node pane. Kept as a thin wrapper because its six call sites (distance,
 * polygon ×2, marker, circle ×2) pass the layers API first, while the shared
 * helper takes a mounter — that is the only difference between Measure and
 * Locate/Search.
 * `toggleDelIcon` and `layers.removeLayer` stay generic — callers use them
 * directly when toggling visibility or tearing down.
 */
const mountDelIcon = (
  layers: CreateLayersAPI,
  latlng: L.LatLngExpression,
  opts: { title?: string; iconAnchor?: [number, number] },
  /** Omit for pure create+mount (no click handler) — circle wires delete in
   *  attachCircleUI. Pass a thunk (or a createDeferredDelete onDelete) when
   *  the mount should own the ✕ click. */
  onDelete?: () => void,
): L.Marker =>
  mountDelIconShared(latlng, opts, m => layers.addLayer(m, CONST.PANES.NODE), onDelete);

/**
 * Deferred delete callback for `mountDelIcon`'s `onDelete` slot. The shared
 * mount binds the click handler at mount time, but the real delete thunk is
 * only available after `attachDelLifecycle` / `wireFinalized` runs. Capture
 * `onDelete` at mount, assign the real thunk later via `setDelete`.
 */
const createDeferredDelete = (): {
  onDelete: () => void;
  setDelete: (fn: () => void) => void;
} => {
  let deleteFn: (() => void) | null = null;
  return {
    onDelete: () => deleteFn?.(),
    setDelete: fn => {
      deleteFn = fn;
    },
  };
};

/**
 * Register a finalized cleanup and build the shared delete-then-teardown
 * path: unregister → teardown → removeLayers → business delete →
 * `layers.unregister`. Callers own what `teardown` / `removeLayers` /
 * `onDelete` do; this hook owns only the registerFinalized bookkeeping so
 * `attachDelLifecycle` and `MarkerMode.finalize` don't each re-implement it.
 *
 * `unregisterFinalized()` must run first: it de-registers the clearAll /
 * finalized path before any resource is torn down, so a concurrent clearAll
 * cannot invoke `teardown` a second time after delete already ran it.
 */
const wireFinalized = (
  mgr: { registerFinalized(teardown: () => void, id: string): () => void },
  layers: { unregister(): void },
  opts: {
    id: string;
    teardown: () => void;
    removeLayers: () => void;
    onDelete: () => void;
  },
): { delete: () => void } => {
  const unregisterFinalized = mgr.registerFinalized(opts.teardown, opts.id);
  return {
    delete: () => {
      unregisterFinalized();
      opts.teardown();
      opts.removeLayers();
      opts.onDelete();
      layers.unregister();
    },
  };
};

/**
 * Wire the finalized lifecycle shared by distance, polygon, and circle: the
 * edit overlay, its registerFinalized entry, and the delete-then-teardown
 * path. The caller owns resource teardown (drag handles, label registrations,
 * edit-drag toggle), layer removal, and the business-level delete; this hook
 * owns the overlay and the registerFinalized handle so the three attachXUI
 * builders don't each re-implement the same 5-line skeleton.
 *
 * `delMarkers` is the ✕ handle set the default onOpen/onEmpty toggle —
 * distance passes its nodeDelMarkers, circle passes a single-element array.
 * Callers needing side effects (e.g. polygon's centroid ✕, marker's popup
 * close) supply their own onOpen/onEmpty. DOM construction stays in the
 * caller — this hook only wires lifecycle.
 */
const attachDelLifecycle = (
  mgr: MeasureManager,
  layers: CreateLayersAPI,
  delMarkers: L.Marker[],
  opts: {
    id: string;
    dispose: () => void;
    removeLayers: () => void;
    onDelete: () => void;
    onOpen?: () => void;
    onEmpty?: () => void;
  },
): { open: (ev: L.LeafletMouseEvent) => void; delete: () => void } => {
  const onOpen = opts.onOpen ?? (() => delMarkers.forEach(m => toggleDelIcon(m, true)));
  const onEmpty =
    opts.onEmpty ?? (() => delMarkers.forEach(m => toggleDelIcon(m, false)));
  const overlay = buildEditOverlay(mgr, { onOpen, onEmpty, id: opts.id });

  const teardown = () => {
    opts.dispose();
    overlay.cleanup();
  };
  const { delete: deleteMeasurement } = wireFinalized(mgr, layers, {
    id: opts.id,
    teardown,
    removeLayers: opts.removeLayers,
    onDelete: opts.onDelete,
  });

  return {
    open: overlay.open,
    delete: deleteMeasurement,
  };
};

export {
  attachDelLifecycle,
  createDeferredDelete,
  mountDelIcon,
  wireFinalized,
  MeasureMode,
  PreviewMode,
};
