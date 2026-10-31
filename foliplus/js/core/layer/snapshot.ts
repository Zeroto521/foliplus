// core/layer/snapshot — build a layer's point snapshot from `walkLeaf`.
//
// One layer's points are walked exactly once per invalidation: every
// leaf that is a Marker / CircleMarker is collected in walk order, its
// `feature.properties` numeric fields are normalised into a flat record
// alongside folium's explicit `value` / `options.value` contracts, and
// the numeric ranges are computed in the same pass so a filter only
// touches field values and never re-walks the tree.
//
// The builder is a pure function: it does not touch `LayerRuntimeStore`.
// The store owns the caching — its `snapshot?` axis holds the last
// built snapshot and `deleteSnapshot` invalidates it — so this module
// stays unit-testable without a runtime row. Callers that need "one
// snapshot per layer, ever" combine the two: read from the store, fall
// back to `buildLayerSnapshot`, and write back.
//
// Field normalisation resolves the three syntaxes a marker carries today:
// `value` (folium's documented contract), `options.value` (the same
// contract via Leaflet's options bag), and a bare
// `feature.properties.<key>` (GeoJSON's container). Priority is
// explicit-contract over `feature.properties`, so `properties.value`
// never silently shadows a `value` field. A same-key collision between
// an explicit contract and a numeric `properties` entry warns once per
// layer so a silently dropped value is not invisible.
import type { Logger } from "#common/type.js";
import type { LabelAwareLayer, LayerSnapshot, SnapshotPoint } from "./type.js";
import { walkLeaf } from "./walkLeaf.js";

/** Extended marker carrying the folium data contract. Mirrors
 *  `HeatmapPointMarker` on the component side; kept as its own type here
 *  so `core` never imports a component. */
type ExtendedMarker = (L.Marker | L.CircleMarker) & {
  value?: number;
  options?: { value?: number };
  feature?: { properties?: Record<string, unknown> };
};

/** Numeric values are strict and shared across the whole data layer: a
 *  predicate that reads the record never sees a sentinel value, so a
 *  NaN or ±Infinity in a source field never gets in. */
const isNumeric = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** Flat normalised numeric fields for one marker. Keys arrive in first-
 *  seen order across `value` → `options.value` → `feature.properties`.
 *  A same-key numeric `properties` entry that differs from an explicit
 *  contract's value does not overwrite it and fires one warning — the
 *  Set dedupes across points so a hot layer does not spam the console.
 */
const normalizeFields = (
  marker: ExtendedMarker,
  collisions: Set<string>,
  log: Logger,
): Record<string, number> => {
  const fields: Record<string, number> = {};
  if (isNumeric(marker.value)) fields["value"] = marker.value;
  else if (isNumeric(marker.options?.value)) fields["value"] = marker.options!.value;

  const props = marker.feature?.properties;
  if (!props) return fields;
  for (const [name, raw] of Object.entries(props)) {
    if (!isNumeric(raw)) continue;
    if (name in fields) {
      if (fields[name] !== raw && !collisions.has(name)) {
        collisions.add(name);
        log.warn(
          `field collision on "${name}": explicit contract holds ${fields[name]}, feature.properties.${name} holds ${raw}; the explicit value wins`,
        );
      }
      continue;
    }
    fields[name] = raw;
  }
  return fields;
};

/** One pass over the layer's leaves produces the snapshot — walk order
 *  is preserved, `L.stamp` dedupes, and `isLabel` leaves are skipped
 *  because they carry no `feature` and would otherwise contribute
 *  empty rows. `numericFields` is first-seen order; `ranges` is
 *  computed alongside `points`, not in a second walk. */
/** First-seen field order + extents from one pass over points. Both
 *  snapshot builders share it so "which fields exist" and "how wide is
 *  each field" have one implementation. */
const summarizePoints = (
  points: SnapshotPoint[],
): {
  numericFields: string[];
  ranges: Record<string, readonly [number, number]>;
} => {
  const numericFields: string[] = [];
  const ranges: Record<string, readonly [number, number]> = {};
  for (const pt of points) {
    for (const [key, v] of Object.entries(pt.fields)) {
      const entry = ranges[key];
      if (!entry) {
        numericFields.push(key);
        ranges[key] = [v, v];
      } else {
        const [lo, hi] = entry;
        if (v < lo) ranges[key] = [v, hi];
        else if (v > hi) ranges[key] = [lo, v];
      }
    }
  }
  return { numericFields, ranges };
};

/* v8 ignore next 5 -- a no-op logger for the optional-log callers; the
   warn path is covered through a real logger, the other levels are
   interface completeness and never invoked by the snapshot builders. */
const NO_LOGGER: Logger = {
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  msg: message => message,
};

const buildLayerSnapshot = (layer: L.Layer, log: Logger): LayerSnapshot => {
  const points: SnapshotPoint[] = [];
  const collisions = new Set<string>();
  const seenStamps = new Set<unknown>();

  walkLeaf(layer, leaf => {
    if ((leaf as LabelAwareLayer).isLabel) return;
    if (!(leaf instanceof L.Marker) && !(leaf instanceof L.CircleMarker)) return;
    const marker = leaf as ExtendedMarker;
    if (!marker.feature) return;
    const stamp = L.stamp(marker);
    if (seenStamps.has(stamp)) return;
    seenStamps.add(stamp);

    const ll = marker.getLatLng();
    if (!ll) return;
    const fields = normalizeFields(marker, collisions, log);
    points.push({
      lat: ll.lat,
      lng: ll.lng,
      marker: marker as L.Marker | L.CircleMarker,
      fields,
    });
  });

  return { points, ...summarizePoints(points) };
};

/** Normalised numeric fields for one marker, without a snapshot. The
 *  Heatmap's points-based path and the collision tests share this one
 *  normalisation, so a field cannot be read one way in a snapshot and
 *  another in a cache key. */
const extractMarkerFields = (
  marker: ExtendedMarker,
  log: Logger = NO_LOGGER,
): Record<string, number> => normalizeFields(marker, new Set<string>(), log);

/** Build a snapshot from already-extracted points. Components that own
 *  their own point extraction (HeatmapControl) use this instead of
 *  {@link buildLayerSnapshot}: it avoids the `instanceof L.Marker` walk
 *  that a mocked layer tree cannot satisfy, while sharing the field
 *  normalisation and range accumulation. Walk order is preserved, so a
 *  filter index lines up with the caller's point array. */
const snapshotFromPoints = (
  rawPts: Array<{
    lat: number;
    lng: number;
    marker: L.Marker | L.CircleMarker;
  }>,
  log: Logger = NO_LOGGER,
): LayerSnapshot => {
  const points: SnapshotPoint[] = rawPts.map(p => ({
    lat: p.lat,
    lng: p.lng,
    marker: p.marker,
    fields: extractMarkerFields(p.marker as ExtendedMarker, log),
  }));
  return { points, ...summarizePoints(points) };
};

export { buildLayerSnapshot, extractMarkerFields, snapshotFromPoints };
