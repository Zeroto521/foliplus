// Declarative zoom-range gate for a whole control (HeatmapControl /
// MeasureControl).
//
// A control's zoom_range={...} declaration is a visibility window over the
// map's zoom level: inside it the control is available, outside it the
// control is hidden (not disabled, so its state survives the trip). The layer
// declaration in LayerControl is the same shape and the same degrade rule;
// this module is the component-side counterpart because a control is not a
// managed layer and has no row to carry the policy.
//
// This is intentionally tiny and dependency-free: the caller passes the map,
// its own container and logger. It never writes Leaflet's native
// `minZoom/maxZoom`, exactly like the layer policy.
import type { Logger } from "./type.js";

/** The one shape carried from Python: both ends are integer zoom levels. */
interface DeclaredZoomRange {
  min: number;
  max: number;
}

/** The shared hidden state (common/reset.css). */
const HIDDEN_CLASS = "foliplus-hidden";

/** Whether `raw` is a usable declaration: both ends integer zoom levels, in
 *  order. The predicate is the JS half of the Python validation in
 *  `foliplus/_declaration.py` — `Number.isInteger`, not `Number.isFinite`,
 *  because a fractional bound is a payload Python would never have emitted and
 *  a range the map's integer levels cannot honour. */
const isZoomRange = (raw: unknown): raw is DeclaredZoomRange =>
  typeof raw === "object" &&
  raw !== null &&
  Number.isInteger((raw as DeclaredZoomRange).min) &&
  Number.isInteger((raw as DeclaredZoomRange).max) &&
  (raw as DeclaredZoomRange).min <= (raw as DeclaredZoomRange).max;

/** Whether the declaration can meet the map's own reachable range.
 *
 *  Leaflet reports an open rail as `Infinity`, which cannot rule a range out,
 *  so only two finite ends are judged. A declaration that cannot intersect is
 *  unusable on this map (it would hide the layer/control at every reachable
 *  level) and every read site degrades it to "undeclared" instead. */
const intersectsMapZoom = (
  range: DeclaredZoomRange,
  mapMin: number,
  mapMax: number,
): boolean =>
  !Number.isFinite(mapMin) ||
  !Number.isFinite(mapMax) ||
  (range.min <= mapMax && range.max >= mapMin);

/** The one wording for a payload that cannot be a range. */
const unusableZoomRange = (raw: unknown): string =>
  `declares an unusable zoom range (got ${JSON.stringify(raw)}); treating it as undeclared`;

/** The one wording for a range the map can never reach. */
const unreachableZoomRange = (range: DeclaredZoomRange): string =>
  `declares zoom range ${JSON.stringify(range)} outside the map's zoom range; treating it as undeclared`;

/** Both events can change the verdict: the current level (`zoomend`) and the
 *  map's own reachable range after a basemap switch (`zoomlevelschange`, which
 *  Leaflet fires when min/max zoom moves without a zoom change). */
const ZOOM_EVENTS = ["zoomend", "zoomlevelschange"] as const;

type ZoomRangeLogger = Pick<Logger, "warn">;

interface BindControlZoomRangeOptions {
  map: L.Map;
  /** The control's Leaflet container — the whole control is gated. */
  container: HTMLElement;
  /** CONFIG.zoomRange: the normalised declaration, or null/undefined. */
  range: unknown;
  /** The control's logger (its name is already in the prefix). */
  log: ZoomRangeLogger;
}

/** A finite, ordered range, else undefined.
 *
 *  Python normalises and validates the declaration before it reaches CONF, so
 *  this only covers hand-edited/older payloads. A malformed record warns once
 *  per mount and is treated exactly like "not declared": the control stays
 *  visible instead of disappearing on a payload the author never validated.
 */
const readZoomRange = (
  raw: unknown,
  log: ZoomRangeLogger,
  warned: { payload: boolean },
): DeclaredZoomRange | undefined => {
  if (raw == null) return undefined;
  if (!isZoomRange(raw)) {
    if (!warned.payload) {
      warned.payload = true;
      log.warn(unusableZoomRange(raw));
    }
    return undefined;
  }
  return raw;
};

/**
 * Keep `container` visible only while the map's zoom is inside `range`.
 *
 * The gate applies immediately and re-evaluates on `zoomend`. A declaration
 * that cannot intersect the map's own range (author [20, 30] on a map capped
 * at 18) would hide the control at every reachable level — a permanent
 * disappearance the author never asked for — so it degrades to "undeclared"
 * and warns once, matching the layer policy. A declaration that merely
 * narrows the map's range keeps its endpoints: `zoom >= min && zoom <= max`
 * already intersects the map without rewriting the author's values.
 *
 * An undeclared (or malformed) range is the common case, so it installs no
 * map listener at all: the control is visible and nothing can change that
 * verdict without a new mount.
 *
 * @returns a cleanup that detaches the map listener.
 */
const bindControlZoomRange = (opts: BindControlZoomRangeOptions): (() => void) => {
  const warned = { payload: false, degenerate: false };
  const range = readZoomRange(opts.range, opts.log, warned);
  if (!range) {
    opts.container.classList.remove(HIDDEN_CLASS);
    return () => undefined;
  }

  const apply = (): void => {
    const mapMin = opts.map.getMinZoom();
    const mapMax = opts.map.getMaxZoom();
    if (!intersectsMapZoom(range, mapMin, mapMax)) {
      if (!warned.degenerate) {
        warned.degenerate = true;
        opts.log.warn(unreachableZoomRange(range));
      }
      opts.container.classList.remove(HIDDEN_CLASS);
      return;
    }
    const zoom = opts.map.getZoom();
    opts.container.classList.toggle(
      HIDDEN_CLASS,
      !(zoom >= range.min && zoom <= range.max),
    );
  };

  apply();
  for (const event of ZOOM_EVENTS) opts.map.on(event, apply);
  return () => {
    for (const event of ZOOM_EVENTS) opts.map.off(event, apply);
  };
};

export {
  HIDDEN_CLASS,
  bindControlZoomRange,
  intersectsMapZoom,
  isZoomRange,
  readZoomRange,
  unreachableZoomRange,
  unusableZoomRange,
};
