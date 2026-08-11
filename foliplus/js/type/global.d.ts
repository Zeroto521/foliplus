/**
 * Ambient declarations for globals injected at runtime by the foliplus
 * Python↔JS bridge (Leaflet, the foliplus runtime, per-control config).
 *
 * Kept intentionally loose (`any`) during the JS→TS migration; tighten as
 * modules are converted and real shared types emerge.
 */
import type * as L from "leaflet";

declare global {
  /** Re-export instead of inline `import("leaflet")` everywhere. */
  type LMap = L.Map;
  type LMarker = L.Marker;
  type LPopup = L.Popup;

  const L: typeof L;
  const map: LMap;
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
    map: LMap;
  }
}

export {};
