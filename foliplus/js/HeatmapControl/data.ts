// HeatmapControl data aggregation — pure functions for H3 binning, class
// breaks, color scales, and field extraction. No `this` dependency: every
// stateful value is passed in explicitly.
import { computeBreaks } from "#core/classify.js";
import { vertexMean } from "#core/geo/index.js";
import { autoLabelField, bareFieldName } from "#core/label/index.js";
import type { Logger } from "#common/type.js";
import * as CONST from "./const.js";
import type {
  AggregatedData,
  HeatmapPointMarker,
  HexCell,
  HexFeature,
  SelectedPoint,
} from "./type.js";

/** Resolve the H3 resolution for a map zoom level. */
const getH3Res = (zoom: number): number => {
  const entry = (CONST.H3.RES_MAP as Array<[number, number]>).find(([z]) => zoom <= z);
  return entry ? entry[1] : CONST.H3.RES_FALLBACK;
};

/** The field to use when the user has not picked one. The rule itself is
 *  shared with LayerControl's annotation labels (core/labelField): first
 *  numeric, else first. This layer's field contract is numeric-only by
 *  construction, so in practice this stays the first entry — but the
 *  fallback no longer lives in two places. */
const pickAutoField = (fields: string[] | null): string | null => {
  if (!fields || fields.length === 0) return null;
  return autoLabelField(fields.map(name => ({ name, numeric: true })));
};

/** Read a numeric field off a point marker (foliplus data contract).
 *  Supported field syntax: "value", "options.value", and a bare
 *  `feature.properties` key. A legacy `"properties.<key>"` id is accepted
 *  and stripped so older saved configs keep working. */
const readMarkerField = (
  marker: L.Marker | L.CircleMarker,
  field: string | null,
): number | undefined => {
  if (!field) return undefined;
  const extended = marker as HeatmapPointMarker;
  if (field === "value") return extended.value;
  if (field === "options.value") return extended.options?.value;
  const key = bareFieldName(field);
  return marker.feature?.properties?.[key];
};

/** Build a chroma color scale with `count` colors. Falls back to GRAY array
 *  when chroma is unavailable. */
const getColorScale = (name: string, count: number): string[] => {
  if (typeof chroma !== "undefined") {
    return chroma.scale(name).mode("lab").colors(count) as string[];
  }
  return Array(count).fill(CONST.GRAY);
};

/** Bin points by H3 resolution. Geometry only — the h3 call lives here and
 *  nowhere else. Returns a map from H3 index to the indices of points in
 *  that cell, so a filter change that only changes the *set* of points
 *  never touches the geometry. The wrapper `aggregateData` chains this
 *  with `aggregateBins`; consumers that want to keep the bin map across
 *  filter changes call this directly and hold the result in a cache. */
const binPoints = (
  pts: SelectedPoint[],
  res: number,
  log: Logger,
): Map<string, number[]> => {
  const bins = new Map<string, number[]>();
  pts.forEach((pt, i) => {
    try {
      const h3Idx = h3.latLngToCell(pt.lat, pt.lng, res);
      let idxs = bins.get(h3Idx);
      if (!idxs) {
        idxs = [];
        bins.set(h3Idx, idxs);
      }
      idxs.push(i);
    } catch (err) {
      log.warn("h3 cell conversion failed", pt.lat, pt.lng, err);
    }
  });
  return bins;
};

/** Aggregate the binned indices into sum/count/min/max cells. Pure
 *  arithmetic over the point array — no `h3` calls, so a filter change
 *  that keeps the geometry but changes the selected subset only runs
 *  this function. Cells with an empty index list are dropped so the
 *  unfiltered path is byte-identical to the pre-refactor output. The
 *  aggregation choice (`count | sum | avg | min | max`) is applied at
 *  the wrapper level via `getAggValue`, so this function always computes
 *  every statistic — a filter change never forces a re-computation. */
const aggregateBins = (
  bins: Map<string, number[]>,
  pts: SelectedPoint[],
  include?: Set<number>,
): Map<string, HexCell> => {
  const cells = new Map<string, HexCell>();
  for (const [h3Idx, idxs] of bins) {
    if (idxs.length === 0) continue;
    let sum = 0;
    let count = 0;
    let min = Infinity;
    let max = -Infinity;
    for (const i of idxs) {
      if (include && !include.has(i)) continue;
      const v = pts[i].value;
      sum += v;
      count += 1;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (count === 0) continue;
    cells.set(h3Idx, { sum, count, min, max });
  }
  return cells;
};

/** Aggregate selected points into H3 hex cells with sum/count/min/max.
 *  Thin wrapper over `binPoints` (geometry) and `aggregateBins` (pure
 *  arithmetic) so the pre-refactor call site is unchanged. The split
 *  is what lets a filter change re-run only the arithmetic half. */
const aggregateData = (
  pts: SelectedPoint[],
  res: number,
  agg: string,
  numClasses: number,
  method: string,
  scheme: string,
  onEmpty: () => void,
  log: Logger,
  include?: Set<number>,
  precomputedBins?: Map<string, number[]>,
): AggregatedData | null => {
  const bins = precomputedBins ?? binPoints(pts, res, log);
  const hexCells = aggregateBins(bins, pts, include);
  if (hexCells.size === 0) {
    onEmpty();
    return null;
  }

  const getAggValue = (cell: HexCell): number => {
    switch (agg) {
      case CONST.AGG.COUNT:
        return cell.count;
      case CONST.AGG.SUM:
        return cell.sum;
      case CONST.AGG.AVG:
        return cell.count > 0 ? cell.sum / cell.count : 0;
      case CONST.AGG.MIN:
        return cell.min;
      case CONST.AGG.MAX:
        return cell.max;
      default:
        return cell.count;
    }
  };

  const allVals = [...hexCells.values()].map(getAggValue);
  const numClassesCapped = Math.min(numClasses, allVals.length);
  const breaks = computeBreaks(allVals, numClassesCapped, method);
  const classColors = getColorScale(scheme, numClassesCapped);
  const valueToClassIdx = (val: number): number => {
    if (breaks.length < 2) return 0;
    for (let i = 1; i < breaks.length; i++) if (val <= breaks[i]) return i - 1;
    return breaks.length - 2;
  };
  return {
    hexCells: Object.fromEntries(hexCells),
    getAggValue,
    valueToClassIdx,
    classColors,
  };
};

/** Build GeoJSON features from aggregated hex cells. */
const buildFeatures = (
  { hexCells, getAggValue, valueToClassIdx, classColors }: AggregatedData,
  log: Logger,
): HexFeature[] => {
  const features: HexFeature[] = [];
  for (const [h3Idx, cell] of Object.entries(hexCells)) {
    const val = getAggValue(cell);
    const classIdx = valueToClassIdx(val);
    const fillColor = classColors[classIdx];
    let centroid: [number, number] | null = null;
    try {
      const pt = h3.cellToLatLng(h3Idx);
      centroid = [pt[0], pt[1]];
    } catch {
      /* fallback */
    }
    try {
      const boundary = h3.cellToBoundary(h3Idx);
      const coords = boundary.map(p => [p[1], p[0]]);
      coords.push(coords[0]);
      if (!centroid) {
        const mean = vertexMean(boundary.map(p => ({ lng: p[1], lat: p[0] })));
        centroid = [mean.lat, mean.lng];
      }
      features.push({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [coords] },
        properties: { value: val, classIdx, fillColor, h3: h3Idx, centroid },
      });
    } catch (err) {
      log.warn("h3 boundary conversion failed", h3Idx, err);
    }
  }
  return features;
};

export {
  aggregateBins,
  aggregateData,
  binPoints,
  buildFeatures,
  getColorScale,
  getH3Res,
  pickAutoField,
  readMarkerField,
};
