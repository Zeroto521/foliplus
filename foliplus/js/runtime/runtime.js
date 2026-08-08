/**
 * Shared utility namespace for all foliplus map controls.
 * Provides SVG icons, hint system, coordinate transformation, geocoding,
 * and common UI helpers.
 *
 * This is the ES module entry point. esbuild bundles it (along with all
 * `runtime/*.js` submodules) into `dist/runtime.min.js`, which BaseControl
 * injects once per map into the shared header.
 */
import { fromWgs84, getMapCrsType, toWgs84 } from "./runtime.coord.js";
import { buildPopupHtml, createLocationMarker, foliplusDom } from "./runtime.dom.js";
import {
  formatAddress,
  NOMINATIM,
  nominatimUrl,
  reverseGeocode,
} from "./runtime.geocode.js";
import { hideHint, HINT_DURATION, registerHintIcon, showHint } from "./runtime.hint.js";
import * as SVGs from "./runtime.icon.js";
import { resolveLocale } from "./runtime.locale.js";
import {
  adjustPanelZIndex,
  bindMapSync,
  bindOutsideCollapse,
  bindPanelToggle,
  createFoldControl,
  createPanelControl,
} from "./runtime.panel.js";
import { cssVar, debounce, formatNumber, storage } from "./runtime.util.js";

// Ensure the global namespace object exists.
if (!window.foliplus || typeof window.foliplus !== "object") window.foliplus = {};
const foliplus = window.foliplus;

// Bail out if the shared runtime has already been initialized (it is inlined
// once per map, but this guard keeps it idempotent across reloads/embeds).
if (!foliplus.isInitialized) {
  foliplus.isInitialized = true;

  // Use Object.assign with window.foliplus so esbuild's minifier does not
  // rename the property assignments (the local alias "foliplus" gets
  // shortened to "i", breaking tests that assert on "foliplus.xxx").
  Object.assign(window.foliplus, {
    // ==================== Icons ====================
    SVGs,

    // ==================== Constants ====================
    HINT_DURATION,
    NOMINATIM,

    // ==================== Hint / Toast System ====================
    registerHintIcon,
    showHint,
    hideHint,

    // ==================== Coordinate Transformation ====================
    getMapCrsType,
    toWgs84,
    fromWgs84,

    // ==================== Reverse Geocoding ====================
    nominatimUrl,
    formatAddress,
    reverseGeocode,

    // ==================== DOM Helpers ====================
    dom: foliplusDom,
    buildPopupHtml,
    createLocationMarker,

    // ==================== Panel UI ====================
    adjustPanelZIndex,
    bindPanelToggle,
    bindOutsideCollapse,
    createFoldControl,
    bindMapSync,
    createPanelControl,

    // ==================== Number Formatting ====================
    cssVar,
    formatNumber,
    debounce,
    storage,

    // ==================== Locale resolution ====================
    resolveLocale,
  });
}
