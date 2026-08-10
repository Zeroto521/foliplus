/**
 * Ambient declarations for globals injected at runtime by the foliplus
 * Python↔JS bridge (Leaflet, the foliplus runtime, per-control config).
 *
 * Kept intentionally loose (`any`) during the JS→TS migration; tighten as
 * modules are converted and real shared types emerge.
 */

declare const L: any;
declare const map: any;
declare const foliplus: any;
declare const CONF: any;
declare const CONFIG: any;
declare const turf: any;
declare const gcoord: any;

interface Window {
  /** foliplus runtime helpers injected by the Python wrapper. */
  foliplus: any;
  /** Per-component config injected as a Jinja IIFE global. */
  CONF: any;
  /** Optional aliased config (some components). */
  CONFIG?: any;
  /** Leaflet global. */
  L: any;
  /** Map instance global (used by some components/tests). */
  map: any;
}
