// The h3 surface the worker needs, imported from the npm `h3-js` package at
// build time rather than vendored as source in this repo.
//
// A worker's module graph must be self-contained — the bundle is inlined as a
// string (see `script/worker-inline-plugin.mjs`) and evaluated from a Blob URL
// — but that says nothing about *bundle time*: the import below is resolved by
// esbuild and the result ships inside the string, so no network fetch ever
// happens at runtime.
//
// `h3-js` ships four builds and only two are ESM:
//   - `h3-js:legacy` is CJS (`module.exports`), so it cannot bundle here;
//   - `h3-js/lib/h3core.js` is the Node entry, which `require`s a CJS file;
//   - `dist/h3-js.es.js` and `dist/browser/h3-js.es.js` are the same asm.js
//     core, and neither exports the `h3asm` core handle — only the named API
//     functions are public.  esbuild's `browser` field rewrites this file's
//     import to the `dist/browser/` build whether or not the path is spelled
//     out, so both spellings bundle identically and either is fine.
// The browser build is the one that lands: it detects no `document`, an
// inline asm.js memory initializer, and no `.wasm` fetch, so it starts up
// cleanly inside a dedicated worker.  It is exercised end-to-end in a real
// browser by the HeatmapControl browser tests.
//
// Upgrade path: bump `h3-js` in `package.json` *and* the `h3-js@4` CDN script
// the main-thread fallback reads (see `foliplus/cdn.json`) — independent
// copies of the same library.
//
// Plain `.js` (not `.ts`) because it carries no type syntax.  The
// `#core`/`#common` externaliser does not match this path, so the package is
// inlined into the worker bundle rather than read from `window.foliplus`.
import { cellToBoundary, cellToLatLng, latLngToCell } from "h3-js";

const h3 = { cellToBoundary, cellToLatLng, latLngToCell };
export { h3 };
