// HeatmapControl extract — arrow functions that take the manager as their first argument.
// HeatmapManager's prototype methods delegate to them, so instance spies stay interceptable.
import * as CONST from "./const.js";
import { readMarkerField } from "./data.js";
import type { HeatmapManager } from "./manager.js";
import type { HeatmapPointMarker, SelectedPoint } from "./type.js";
import { snapshotFromPoints } from "#core/layer/index.js";
import { isInternalProperty } from "#core/value/index.js";

const scanMapLayers = (m: HeatmapManager) => {
  m.pointLayers = [];
  const pointLayersInfo = map.foliplus!.LayerAPI!.getLayersByType("point");
  if (!pointLayersInfo.length) return;

  const seenIds: Record<string, boolean> = {};
  for (const info of pointLayersInfo) {
    if (seenIds[info.id]) continue;
    seenIds[info.id] = true;

    const pts = map.foliplus!.LayerAPI!.extractPoints(info.id);
    if (pts.length === 0) continue;
    m.pointLayers.push({
      id: info.id,
      name: info.name,
      layer: info.layer,
      count: pts.length,
    });
  }
};

const collectFields = (m: HeatmapManager, layers: Array<{ id: string }>) => {
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

const getSelectedPoints = (m: HeatmapManager) => {
  m.valueFallbackWarned = false;
  const key = `${m.selectedLayerId}|${m.agg}|${m.effectiveField()}`;
  if (m.cachedPoints?.key === key) {
    return m.cachedPoints.pts;
  }

  const pts: SelectedPoint[] = [];
  if (!m.selectedLayerId) return pts;
  const info = m.pointLayers.find(i => i.id === m.selectedLayerId);
  if (!info) return pts;

  const rawPts = map.foliplus!.LayerAPI!.extractPoints(info.id);
  rawPts.forEach(p => {
    pts.push({
      lat: p.lat,
      lng: p.lng,
      value: m.getPointValue(p.marker),
      marker: p.marker as L.Marker,
    });
  });
  m.cachedPoints = { key, pts };
  // Build/cache the snapshot from the already-extracted points — same
  // order as `pts`, so filter indices align. We do NOT walk the layer
  // tree (buildLayerSnapshot uses `instanceof L.Marker`, which fails
  // under vitest's plain-object mocks). Instead we extract fields
  // directly from each marker's folium contract.
  if (m.cachedSnapshotLayerId !== m.selectedLayerId) {
    m.cachedSnapshot = snapshotFromPoints(rawPts, m.log);
    m.cachedSnapshotLayerId = m.selectedLayerId;
  }
  return pts;
};

const getPointValue = (m: HeatmapManager, marker: L.Marker | L.CircleMarker) => {
  if (m.agg === CONST.AGG.COUNT) return 1;
  // Memoised: this runs once per feature (20k points on a large layer).
  const key = m.effectiveField();
  const val = readMarkerField(marker, key);
  if (val === undefined || isNaN(val)) {
    if (!m.valueFallbackWarned) {
      m.valueFallbackWarned = true;
      m.log.warn("value fallback to 1", key);
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
const computeBounds = (m: HeatmapManager) => {
  const acc = L.latLngBounds([]);
  if (m.cachedFeatures?.length) {
    for (const feat of m.cachedFeatures) {
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
    for (const info of m.pointLayers) {
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
const resolveDeclaredLayer = (m: HeatmapManager) => {
  if (!m.declaredLayer || m.hasScanned) return null;
  const hit = m.pointLayers.find(info => info.name === m.declaredLayer);
  if (!hit) {
    m.warnDeclaration("layer", m.declaredLayer);
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
const resolveEffectiveField = (m: HeatmapManager, fields: readonly string[]) => {
  if (fields.length === 0) {
    // "" is "no user pick", not a pick: fall through to the declaration.
    // (?? would stop at the empty string and hide the declared field.)
    if (m.field !== "") return m.field;
    return m.declaredField ?? "";
  }
  if (m.field && fields.includes(m.field)) return m.field;
  if (m.declaredField) {
    if (fields.includes(m.declaredField)) return m.declaredField;
    m.warnDeclaration("field", m.declaredField);
  }
  return fields[0] ?? "";
};

/** The field the render actually aggregates by — see
 *  {@link resolveEffectiveField} for the precedence. Memoised because
 *  `getPointValue` runs once per feature: re-resolving a list scan for 20k
 *  points would cost more than the guess it replaces. */
const effectiveField = (m: HeatmapManager) => {
  return (m.effectiveFieldCache ??= m.resolveEffectiveField(m.availableFields));
};

/** Publish the fields the current scan offers and resolve the effective
 *  field once. Returns it so the panel can render the same value it just
 *  handed over (one resolver, no second opinion). */
const setAvailableFields = (m: HeatmapManager, fields: readonly string[]) => {
  m.availableFields = [...fields];
  m.effectiveFieldCache = m.resolveEffectiveField(m.availableFields);
  return m.effectiveFieldCache;
};

/** Drop the memoised field (next read re-resolves). Called wherever the
 *  inputs move: a new field list, a persistence write, Reset. */
const invalidateEffectiveField = (m: HeatmapManager) => {
  m.effectiveFieldCache = null;
};

/** One warning per missing declared name: the scan runs more than once on
 *  the way to the first render, and a per-rebuild warn would flood. */
const warnDeclaration = (m: HeatmapManager, kind: "layer" | "field", name: string) => {
  const key = `${kind}:${name}`;
  if (m.declarationWarned.has(key)) return;
  m.declarationWarned.add(key);
  m.log.warn(`declared ${kind} not found:`, name);
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
