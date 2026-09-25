// HeatmapControl type definitions — shared data shapes consumed by manager,
// data aggregation, canvas rendering, and persistence modules.
import { type NumberStyle } from "#common/format.js";

/** A point marker carrying an optional numeric value (foliplus data contract). */
type HeatmapPointMarker = (L.Marker | L.CircleMarker) & {
  value?: number;
  options?: { value?: number };
};

/** A hexagon feature drawn on the heatmap canvas. */
interface HexFeature {
  type?: string;
  geometry: { type: string; coordinates: number[][][] };
  properties: {
    centroid: [number, number] | null;
    fillColor?: string;
    value?: number;
    classIdx?: number;
    [key: string]: unknown;
  };
}

/** Aggregated hex cell. */
interface HexCell {
  sum: number;
  count: number;
  min: number;
  max: number;
}

/** Aggregated data returned by aggregateData. */
interface AggregatedData {
  hexCells: Record<string, HexCell>;
  getAggValue: (cell: HexCell) => number;
  valueToClassIdx: (val: number) => number;
  classColors: string[];
}

/** A point layer collected from LayerControl. */
interface PointLayerInfo {
  id: string;
  name: string;
  layer: L.Layer | null;
  count: number;
}

/** A selected point with its aggregated value. */
interface SelectedPoint {
  lat: number;
  lng: number;
  value: number;
  marker: L.Marker;
}

/** Persisted heatmap configuration (survives page reload). */
interface SavedConfig {
  /** Shape version stamp (positive integer). Absent on records persisted
   * before the versioned format shipped; readers treat an absent or older
   * value the same way — the fields below are the source of truth, so a
   * legacy record without a version is applied as-is (no migration, no
   * bump-on-read). */
  version?: number;
  layerId?: string | null;
  agg?: string;
  method?: string;
  scheme?: string;
  numClasses?: number;
  borderWeight?: number;
  borderColor?: string;
  labelShow?: boolean;
  labelColor?: string;
  labelSize?: number;
  labelFormat?: NumberStyle;
  field?: string;
}

export type {
  AggregatedData,
  HexCell,
  HexFeature,
  HeatmapPointMarker,
  PointLayerInfo,
  SavedConfig,
  SelectedPoint,
};
