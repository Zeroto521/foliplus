// Vendored h3-js build for offscreen aggregation.
//
// ``h3.ts`` is h3-js@4.5.0's ``dist/browser/h3-js.es.js`` with one line appended
// (the ``export * as h3asm`` re-export at its tail).  It is the ENVIRONMENT=web
// asm.js build: a plain module (no ``this.h3 = {}`` self-assignment, unlike the
// UMD build) that needs no .wasm fetch at runtime.
//
// It lives here as source rather than as a bundled import so that the
// aggregation never depends on ``importScripts``/``fetch`` at worker start —
// scripts that are unreachable at load time (CSP, ``file://``, CDN outage)
// would otherwise leave ``h3`` undefined and take the whole heatmap down.  The
// page's CDN UMD build (``h3-js@4/dist/h3-js.umd.js``, see ``foliplus/cdn.json``)
// is a separate copy that the manager uses for its synchronous fallback, so
// ``h3.ts`` must be refreshed together with that entry if the version changes.
//
// Plain ``.js`` (not ``.ts``) because it carries no type syntax: esbuild treats
// ``.js`` as JS.  ``h3asm`` is the type-only import source for the ``H3Api``
// contract declared in ``types.ts``.
export { h3asm as h3 } from "./h3.js";
