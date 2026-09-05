// HeatmapControl offscreen aggregation — pure compute: no DOM, no CONF, no
// window, no Leaflet.
//
// Runs inside the Web Worker built by ``heatmap.worker.ts``.  Kept free of
// ``#core``/``#common``/``window.foliplus`` references on purpose: a worker has
// none of the component bundle's globals, and the CDN dependencies (``h3``,
// ``ss``, ``chroma``) do not exist offscreen either.  Types come from
// ``types.ts``, the type-only seam shared with ``manager.ts``.
import type { AggregateMessage, H3Api, HexFeature, PointInput } from "./types.js";

/** Aggregated hex cell. */
interface HexCell {
  sum: number;
  count: number;
  min: number;
  max: number;
}

/** The simple-statistics surface (CDN ``ss``) consulted for breaks. */
interface BreakSs {
  ckmeans: (data: number[], n: number) => number[][];
  quantileSorted: (sorted: number[], p: number) => number;
}

/** h3 cell index → centroid + closed boundary ring in GeoJSON ``[lng, lat]``
 *  order.  Scoped to a single ``aggregate`` pass: it de-duplicates the two
 *  h3 calls each cell needs, and it is discarded when the pass ends so the
 *  cache cannot grow across renders (a long-lived worker otherwise keeps
 *  every zoom level's worth of cells). */
type CellGeom = { centroid: [number, number]; ring: number[][] };

const cellGeomOf = (h3api: H3Api) => {
  const cache = new Map<string, CellGeom>();
  return (h3Idx: string): CellGeom => {
    const hit = cache.get(h3Idx);
    if (hit) return hit;
    let centroid: [number, number] | null = null;
    try {
      const c = h3api.cellToLatLng(h3Idx);
      centroid = [c[0], c[1]];
    } catch (e) {
      /* fall back to the boundary average below */
    }
    const boundary = h3api.cellToBoundary(h3Idx);
    const ring = boundary.map(p => [p[1], p[0]]);
    ring.push(ring[0]);
    if (!centroid) {
      let cx = 0,
        cy = 0;
      for (let j = 0; j < ring.length - 1; j++) {
        cx += ring[j][0];
        cy += ring[j][1];
      }
      centroid = [cy / (ring.length - 1), cx / (ring.length - 1)];
    }
    const geom = { centroid, ring };
    cache.set(h3Idx, geom);
    return geom;
  };
};

/** Classify a value into a break interval. */
const valueToClassIdx = (val: number, breaks: number[]): number => {
  if (breaks.length < 2) return 0;
  for (let i = 1; i < breaks.length; i++) if (val <= breaks[i]) return i - 1;
  return breaks.length - 2;
};

/** Break intervals for ``nClasses`` classes from ``data``.  Mirrors the
 *  main-thread method on ``manager.ts``; ``ss`` is optional because the worker
 * cannot reach the page's CDN globals. */
const computeBreaks = (data: number[], nClasses: number, method: string) => {
  if (data.length === 0) return [];
  const sorted = data.slice().sort((a, b) => a - b);
  const n = sorted.length;
  if (n <= 2) return [sorted[0], sorted[n - 1]];
  const k = Math.max(3, Math.min(nClasses, n));

  const lo = sorted[0];
  const hi = sorted[n - 1];

  const ssGlobal = globalThis as { ss?: BreakSs };

  if (method === "jenks") {
    if (typeof ssGlobal.ss === "undefined") return [lo, hi];
    try {
      const clusters = ssGlobal.ss.ckmeans(data, k);
      const breaks: number[] = [clusters[0][0]];
      clusters.forEach(c => breaks.push(c[c.length - 1]));
      return breaks;
    } catch (e) {
      /* fall through to the plain range */
    }
    return [lo, hi];
  }
  if (method === "quantile") {
    const q = (p: number) => {
      try {
        return ssGlobal.ss!.quantileSorted(sorted, p);
      } catch (e) {
        return sorted[Math.min(Math.floor(p * (n - 1)), n - 1)];
      }
    };
    const b: number[] = [lo];
    for (let i = 1; i < k; i++) b.push(q(i / k));
    return b.concat(hi);
  }
  if (method === "heads") {
    const b: number[] = [lo];
    for (let i = 1; i < k; i++)
      b.push(sorted[Math.min(Math.floor((i * n) / k), n - 1)]);
    return b.concat(hi);
  }
  // "equal" — fixed-width intervals.
  const step = (hi - lo) / k;
  const b: number[] = [];
  for (let i = 0; i <= k; i++) b.push(lo + step * i);
  return b;
};

/** Full aggregate + classify + geometry pass.  Returns ``[]`` for empty
 *  input; the caller clears the canvas in that case. */
const aggregate = (msg: AggregateMessage, h3api: H3Api): HexFeature[] => {
  const { point, res, agg, method, classes, colors } = msg;
  const cellGeom = cellGeomOf(h3api);
  const hexCells: Record<string, HexCell> = {};
  for (const pt of point) {
    try {
      const h3Idx = h3api.latLngToCell(pt.lat, pt.lng, res);
      let cell = hexCells[h3Idx];
      if (!cell) {
        cell = { sum: 0, count: 0, min: Infinity, max: -Infinity };
        hexCells[h3Idx] = cell;
      }
      cell.sum += pt.value;
      cell.count += 1;
      if (pt.value < cell.min) cell.min = pt.value;
      if (pt.value > cell.max) cell.max = pt.value;
    } catch (e) {
      /* an unconvertible point is dropped, matching the main-thread path */
    }
  }

  const getAggValue = (cell: HexCell): number => {
    switch (agg) {
      case "sum":
        return cell.sum;
      case "avg":
        return cell.count > 0 ? cell.sum / cell.count : 0;
      case "min":
        return cell.min;
      case "max":
        return cell.max;
      default:
        return cell.count;
    }
  };

  const allVals = Object.values(hexCells).map(getAggValue);
  if (allVals.length === 0) return [];
  const breaks = computeBreaks(allVals, Math.min(classes, allVals.length), method);

  const features: HexFeature[] = [];
  let dropped = 0;
  for (const h3Idx of Object.keys(hexCells)) {
    const val = getAggValue(hexCells[h3Idx]);
    const classIdx = valueToClassIdx(val, breaks);
    let geom;
    try {
      geom = cellGeom(h3Idx);
    } catch (e) {
      /* boundary unavailable — the cell is dropped, not fatal */
      dropped += 1;
      continue;
    }
    features.push({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [geom.ring] },
      properties: {
        value: val,
        classIdx,
        fillColor: colors[classIdx] ?? "#999",
        h3: h3Idx,
        centroid: geom.centroid,
      },
    });
  }
  if (dropped)
    console.warn("h3 boundary conversion failed", `${dropped} cell(s) dropped`);
  return features;
};

export { type BreakSs, type HexCell, aggregate, computeBreaks };
