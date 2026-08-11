/**
 * Ambient declarations for globals injected at runtime by the foliplus
 * Python↔JS bridge (Leaflet, the foliplus runtime, per-control config).
 *
 * Kept intentionally loose (`any`) during the JS→TS migration; tighten as
 * modules are converted and real shared types emerge.
 */
import type * as L from "leaflet";

declare global {
  const L: typeof L;
  namespace L {
    type ControlOptions = L.ControlOptions;
    type Map = L.Map;
    type Marker = L.Marker;
    type Popup = L.Popup;
    type LeafletEvent = L.LeafletEvent;
    type LeafletMouseEvent = L.LeafletMouseEvent;
    type PointExpression = L.PointExpression;
  }

const map: L.Map;
  const foliplus: any;
  const CONF: any;
  const CONFIG: any;
  const turf: any;
  const gcoord: any;
  const chroma: any;
  const ss: any;
  const h3: any;

  interface Window {
    /** foliplus runtime helpers injected by the Python wrapper. */
    foliplus: any;
    /** Per-component config injected as a Jinja IIFE global. */
    CONF: any;
    /** Optional aliased config (some components). */
    CONFIG?: any;
    /** Leaflet global. */
    L: typeof L;
    /** Map instance global (used by some components/tests). */
    map: L.Map;
  }
}

export {};
