// HeatmapControl data extraction — source scan, field resolution, point/value reads.
// Function expressions are installed on HeatmapManager.prototype so this is
// the manager and instance spies stay interceptable.
import * as CONST from "./const.js";
import { readMarkerField } from "./data.js";
import type { HeatmapManager } from "./manager.js";
import type { HeatmapPointMarker, SelectedPoint } from "./type.js";
import { snapshotFromPoints } from "#core/layer/index.js";
import { isInternalProperty } from "#core/value/index.js";

const scanMapLayers = function (this: HeatmapManager) {
  this.pointLayers = [];
  const pointLayersInfo = map.foliplus!.LayerAPI!.getLayersByType("point");
  if (!pointLayersInfo.length) return;

  const seenIds: Record<string, boolean> = {};
  for (const info of pointLayersInfo) {
    if (seenIds[info.id]) continue;
    seenIds[info.id] = true;

    const pts = map.foliplus!.LayerAPI!.extractPoints(info.id);
    if (pts.length === 0) continue;
    this.pointLayers.push({
      id: info.id,
      name: info.name,
      layer: info.layer,
      count: pts.length,
    });
  }
};

const collectFields = function (this: HeatmapManager, layers: Array<{ id: string }>) {
  const fields: string[] = [];
  const seen = new Set<string>();
  const api = map.foliplus!.LayerAPI!;
  // forEachPoint is the lazy twin of extractPoints: the scan only reads
  // markers, so it must not allocate a {lat, lng, marker} per point (or
  // call getLatLng) just to drop the coordinates again. An older common
  // bundle (or a test stub) may not expose it yet — fall back to the
  // extracting form there, keeping the scan correct if slower.
  const eachPoint = (id: string, fn: (marker: L.Marker | L.CircleMarker) => void) => {
    if (api.forEachPoint) api.forEachPoint(id, fn);
    else api.extractPoints(id).forEach(pt => fn(pt.marker));
  };
  layers.forEach(info => {
    eachPoint(info.id, marker => {
      const extended = marker as HeatmapPointMarker;
      if (typeof extended.value === "number" && !seen.has("value")) {
        seen.add("value");
        fields.push("value");
      }
      if (typeof extended.options?.value === "number" && !seen.has("options.value")) {
        seen.add("options.value");
        fields.push("options.value");
      }
      const props = marker.feature?.properties;
      if (!props) return;
      // `feature.properties` is the JSON-deserialized GeoJSON payload: a
      // plain object whose prototype has no enumerable keys, so `for...in`
      // visits exactly the own keys Object.keys would allocate an array for.
      // (A non-JSON carrier that injected enumerable prototype keys would
      // widen this — the field scan is fed by the GeoJSON reader, not by
      // arbitrary objects.)
      for (const fieldName in props) {
        if (isInternalProperty(fieldName)) continue;
        if (typeof props[fieldName] === "number" && !seen.has(fieldName)) {
          seen.add(fieldName);
          fields.push(fieldName);
        }
      }
    });
  });
  return fields;
};

const getSelectedPoints = function (this: HeatmapManager) {
  this.valueFallbackWarned = false;
  const key = `${this.selectedLayerId}|${this.agg}|${this.effectiveField()}`;
  if (this.cachedPoints?.key === key) {
    return this.cachedPoints.pts;
  }

  const pts: SelectedPoint[] = [];
  if (!this.selectedLayerId) return pts;
  const info = this.pointLayers.find(i => i.id === this.selectedLayerId);
  if (!info) return pts;

  const rawPts = map.foliplus!.LayerAPI!.extractPoints(info.id);
  rawPts.forEach(p => {
    pts.push({
      lat: p.lat,
      lng: p.lng,
      value: this.getPointValue(p.marker),
      marker: p.marker as L.Marker,
    });
  });
  this.cachedPoints = { key, pts };
  // Build/cache the snapshot from the already-extracted points — same
  // order as `pts`, so filter indices align. We do NOT walk the layer
  // tree (buildLayerSnapshot uses `instanceof L.Marker`, which fails
  // under vitest's plain-object mocks). Instead we extract fields
  // directly from each marker's folium contract.
  if (this.cachedSnapshotLayerId !== this.selectedLayerId) {
    this.cachedSnapshot = snapshotFromPoints(rawPts, this.log);
    this.cachedSnapshotLayerId = this.selectedLayerId;
  }
  return pts;
};

const getPointValue = function (
  this: HeatmapManager,
  marker: L.Marker | L.CircleMarker,
) {
  if (this.agg === CONST.AGG.COUNT) return 1;
  // Memoised: this runs once per feature (20k points on a large layer).
  const key = this.effectiveField();
  const val = readMarkerField(marker, key);
  if (val === undefined || isNaN(val)) {
    if (!this.valueFallbackWarned) {
      this.valueFallbackWarned = true;
      this.log.warn("value fallback to 1", key);
    }
    return 1;
  }
  return Number(val);
};

// --- Data Extraction ---

/** Geographic extent of the heatmap, so LayerControl can focus this canvas
 *  layer (it has no Leaflet layer to derive bounds from). Uses the hexagon
 *  polygon rings when rendered (exact, includes the hexagon radius that the
 *  centroid alone would omit); falls back to the source point layers. */
const computeBounds = function (this: HeatmapManager) {
  const acc = L.latLngBounds([]);
  if (this.cachedFeatures?.length) {
    for (const feat of this.cachedFeatures) {
      const ring = feat.geometry?.coordinates?.[0];
      if (ring?.length) {
        // GeoJSON order [lng, lat].
        for (const [lng, lat] of ring) acc.extend([lat, lng]);
      } else {
        const pt = feat.properties.centroid;
        if (pt) acc.extend([pt[0], pt[1]]);
      }
    }
  } else {
    for (const info of this.pointLayers) {
      const layer = info.layer as L.Layer & { getBounds?: () => L.LatLngBounds };
      const b = layer?.getBounds?.();
      if (b?.isValid()) acc.extend(b);
    }
  }
  return acc.isValid() ? acc : null;
};

/** Numeric property keys on the source points — bare `feature.properties`
 *  keys plus the two foliplus data-contract shapes (`value`, `options.value`).
 *  Same contract as LayerControl's label field picker for the bare keys. */
/** Resolve the Python-declared starting layer against the scanned point
 *  layers. Null when nothing was declared, when the name matches no point
 *  layer (warned once — the panel then falls back to its normal
 *  auto-selection), or after a persisted record consumed the guard. */
const resolveDeclaredLayer = function (this: HeatmapManager) {
  if (!this.declaredLayer || this.hasScanned) return null;
  const hit = this.pointLayers.find(info => info.name === this.declaredLayer);
  if (!hit) {
    this.warnDeclaration("layer", this.declaredLayer);
    return null;
  }
  return hit.id;
};

/** Resolve the aggregation field for `fields`, without touching the cache:
 *  the user's stored pick while the data still offers it, else the Python
 *  declaration, else the first numeric field. Pure — it never writes to
 *  {@link field}, so neither the guess nor the declaration can become a
 *  persisted record. Public so the cache test can count resolutions.
 *
 *  With no field list (before the first scan, or a caller driving the
 *  manager directly) the stored names are trusted as-is. */
const resolveEffectiveField = function (
  this: HeatmapManager,
  fields: readonly string[],
) {
  if (fields.length === 0) {
    // "" is "no user pick", not a pick: fall through to the declaration.
    // (?? would stop at the empty string and hide the declared field.)
    if (this.field !== "") return this.field;
    return this.declaredField ?? "";
  }
  if (this.field && fields.includes(this.field)) return this.field;
  if (this.declaredField) {
    if (fields.includes(this.declaredField)) return this.declaredField;
    this.warnDeclaration("field", this.declaredField);
  }
  return fields[0] ?? "";
};

/** The field the render actually aggregates by — see
 *  {@link resolveEffectiveField} for the precedence. Memoised because
 *  `getPointValue` runs once per feature: re-resolving a list scan for 20k
 *  points would cost more than the guess it replaces. */
const effectiveField = function (this: HeatmapManager) {
  return (this.effectiveFieldCache ??= this.resolveEffectiveField(
    this.availableFields,
  ));
};

/** Publish the fields the current scan offers and resolve the effective
 *  field once. Returns it so the panel can render the same value it just
 *  handed over (one resolver, no second opinion). */
const setAvailableFields = function (this: HeatmapManager, fields: readonly string[]) {
  this.availableFields = [...fields];
  this.effectiveFieldCache = this.resolveEffectiveField(this.availableFields);
  return this.effectiveFieldCache;
};

/** Drop the memoised field (next read re-resolves). Called wherever the
 *  inputs move: a new field list, a persistence write, Reset. */
const invalidateEffectiveField = function (this: HeatmapManager) {
  this.effectiveFieldCache = null;
};

/** One warning per missing declared name: the scan runs more than once on
 *  the way to the first render, and a per-rebuild warn would flood. */
const warnDeclaration = function (
  this: HeatmapManager,
  kind: "layer" | "field",
  name: string,
) {
  const key = `${kind}:${name}`;
  if (this.declarationWarned.has(key)) return;
  this.declarationWarned.add(key);
  this.log.warn(`declared ${kind} not found:`, name);
};

const extractMethods = {
  scanMapLayers,
  collectFields,
  getSelectedPoints,
  getPointValue,
  computeBounds,
  resolveDeclaredLayer,
  resolveEffectiveField,
  effectiveField,
  setAvailableFields,
  invalidateEffectiveField,
  warnDeclaration,
};

export { extractMethods };
