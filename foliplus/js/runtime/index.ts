/**
 * Shared runtime for foliplus map controls.
 * Provides the hint/toast system and the reverse-geocoding singleton — the
 * only modules with shared global state that must exist once per map.
 * Pure helpers (coord, dom, panel, util) live in common/ and are statically
 * imported by each component's own bundle.
 *
 * This is the ES module entry point. esbuild bundles it into
 * `dist/foliplus-common.min.js`, which BaseControl injects once per map
 * into the shared header. The stateful modules (hint, geocode) live in
 * core/ and are imported via the #core alias.
 */
import { reverseGeocode } from "#core/geocode.js";
import { hideHint, registerHintIcon, showHint } from "#core/hint.js";

// Ensure the global namespace object exists.
if (!window.foliplus || typeof window.foliplus !== "object")
  window.foliplus = {} as Foliplus;
const foliplus = window.foliplus;

// Bail out if the shared runtime has already been initialized (it is inlined
// once per map, but this guard keeps it idempotent across reloads/embeds).
if (!foliplus.isInitialized) {
  foliplus.isInitialized = true;

  // Use Object.assign with window.foliplus so esbuild's minifier does not
  // rename the property assignments (the local alias "foliplus" gets
  // shortened to "i", breaking tests that assert on "foliplus.xxx").
  Object.assign(window.foliplus, {
    // ==================== Hint / Toast System ====================
    registerHintIcon,
    showHint,
    hideHint,

    // ==================== Reverse Geocoding ====================
    reverseGeocode,
  });
}
