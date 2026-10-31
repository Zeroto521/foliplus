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
  if (
    typeof raw !== "object" ||
    !Number.isFinite((raw as DeclaredZoomRange).min) ||
    !Number.isFinite((raw as DeclaredZoomRange).max) ||
    (raw as DeclaredZoomRange).min > (raw as DeclaredZoomRange).max
  ) {
    if (!warned.payload) {
      warned.payload = true;
      log.warn(
        `declares an unusable zoom range (got ${JSON.stringify(raw)}); treating it as undeclared`,
      );
    }
    return undefined;
  }
  return raw as DeclaredZoomRange;
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
 * @returns a cleanup that detaches the map listener.
 */
const bindControlZoomRange = (opts: BindControlZoomRangeOptions): (() => void) => {
  const warned = { payload: false, degenerate: false };
  const range = readZoomRange(opts.range, opts.log, warned);

  const apply = (): void => {
    if (!range) {
      opts.container.classList.remove(HIDDEN_CLASS);
      return;
    }
    const mapMin = opts.map.getMinZoom();
    const mapMax = opts.map.getMaxZoom();
    if (
      Number.isFinite(mapMin) &&
      Number.isFinite(mapMax) &&
      (range.max < mapMin || range.min > mapMax)
    ) {
      if (!warned.degenerate) {
        warned.degenerate = true;
        opts.log.warn(
          `declares zoom range ${JSON.stringify(range)} outside the map's zoom range; treating it as undeclared`,
        );
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

export { HIDDEN_CLASS, bindControlZoomRange, readZoomRange };
