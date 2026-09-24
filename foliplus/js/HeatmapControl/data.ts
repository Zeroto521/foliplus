// HeatmapControl data aggregation — pure functions for H3 binning, class
// breaks, color scales, and field extraction. No `this` dependency: every
// stateful value is passed in explicitly.
import { autoLabelField, bareFieldName } from "#core/labelField.js";
import { createLogger } from "#common/log.js";
import * as CONST from "./const.js";
import type {
  AggregatedData,
  HeatmapPointMarker,
  HexCell,
  HexFeature,
  SelectedPoint,
} from "./types.js";

const log = createLogger(CONF.name);

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

/** Build a chroma color scale with `n` colors. Falls back to GRAY array
 *  when chroma is unavailable. */
const getColorScale = (name: string, n: number): string[] => {
  if (typeof chroma !== "undefined") {
    return chroma.scale(name).mode("lab").colors(n) as string[];
  }
  return Array(n).fill(CONST.GRAY);
};

/** Compute class breaks for a set of values using the given method. */
const computeBreaks = (data: number[], nClasses: number, method: string): number[] => {
  if (data.length === 0) return [];
  const sorted = data.slice().sort((a, b) => a - b);
  const n = sorted.length;
  if (n <= 2) return [sorted[0], sorted[n - 1]];
  nClasses = Math.max(3, Math.min(nClasses, n));

  const lo = sorted[0];
  const hi = sorted[n - 1];

  if (method === CONST.METHOD.JENKS) {
    try {
      const clusters = ss.ckmeans(data, nClasses);
      const breaks: number[] = [clusters[0][0]];
      clusters.forEach(c => breaks.push(c[c.length - 1]));
      return breaks;
    } catch (e) {
      /* fall through */
    }
    return [lo, hi];
  } else if (method === CONST.METHOD.QUANTILE) {
    const b: number[] = [lo];
    for (let i = 1; i < nClasses; i++) {
      b.push(ss.quantileSorted(sorted, i / nClasses));
    }
    return b.concat(hi);
  } else if (method === CONST.METHOD.HEADS) {
    const b: number[] = [lo];
    for (let i = 1; i < nClasses; i++) {
      b.push(sorted[Math.min(Math.floor((i * n) / nClasses), n - 1)]);
    }
    return b.concat(hi);
  }
  const step = (hi - lo) / nClasses;
  const b: number[] = [];
  for (let i = 0; i <= nClasses; i++) b.push(lo + step * i);
  return b;
};

/** Aggregate selected points into H3 hex cells with sum/count/min/max. */
const aggregateData = (
  pts: SelectedPoint[],
  res: number,
  currentAgg: string,
  numClasses: number,
  currentMethod: string,
  currentScheme: string,
  onEmpty: () => void,
): AggregatedData | null => {
  const hexCells: Record<string, HexCell> = {};
  pts.forEach(pt => {
    try {
      const h3Idx = h3.latLngToCell(pt.lat, pt.lng, res);
      if (!hexCells[h3Idx]) {
        hexCells[h3Idx] = { sum: 0, count: 0, min: Infinity, max: -Infinity };
      }
      const cell = hexCells[h3Idx];
      cell.sum += pt.value;
      cell.count += 1;
      if (pt.value < cell.min) cell.min = pt.value;
      if (pt.value > cell.max) cell.max = pt.value;
    } catch (e) {
      log.warn("h3 cell conversion failed", pt.lat, pt.lng, e);
    }
  });

  const getAggValue = (cell: HexCell): number => {
    switch (currentAgg) {
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

  const allVals = Object.values(hexCells).map(getAggValue);
  if (allVals.length === 0) {
    onEmpty();
    return null;
  }

  const nClassesCapped = Math.min(numClasses, allVals.length);
  const breaks = computeBreaks(allVals, nClassesCapped, currentMethod);
  const classColors = getColorScale(currentScheme, nClassesCapped);
  const valueToClassIdx = (val: number): number => {
    if (breaks.length < 2) return 0;
    for (let i = 1; i < breaks.length; i++) if (val <= breaks[i]) return i - 1;
    return breaks.length - 2;
  };
  return { hexCells, getAggValue, valueToClassIdx, classColors };
};

/** Build GeoJSON features from aggregated hex cells. */
const buildFeatures = ({
  hexCells,
  getAggValue,
  valueToClassIdx,
  classColors,
}: AggregatedData): HexFeature[] => {
  const features: HexFeature[] = [];
  for (const [h3Idx, cell] of Object.entries(hexCells)) {
    const val = getAggValue(cell);
    const classIdx = valueToClassIdx(val);
    const fillColor = classColors[classIdx];
    let centroid: [number, number] | null = null;
    try {
      const c = h3.cellToLatLng(h3Idx);
      centroid = [c[0], c[1]];
    } catch (e) {
      /* fallback */
    }
    try {
      const boundary = h3.cellToBoundary(h3Idx);
      const coords = boundary.map(p => [p[1], p[0]]);
      coords.push(coords[0]);
      if (!centroid) {
        let cx = 0;
        let cy = 0;
        for (let j = 0; j < coords.length - 1; j++) {
          cx += coords[j][0];
          cy += coords[j][1];
        }
        centroid = [cy / (coords.length - 1), cx / (coords.length - 1)];
      }
      features.push({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [coords] },
        properties: { value: val, classIdx, fillColor, h3: h3Idx, centroid },
      });
    } catch (e) {
      log.warn("h3 boundary conversion failed", h3Idx, e);
    }
  }
  return features;
};

export {
  aggregateData,
  buildFeatures,
  computeBreaks,
  getColorScale,
  getH3Res,
  pickAutoField,
  readMarkerField,
};
