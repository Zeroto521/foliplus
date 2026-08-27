/**
 * Size Limit configuration — absolute per-bundle upper bounds.
 *
 * Each `.min.js` / `.min.css` in `foliplus/dist/` gets a limit set ~30%
 * above its current **brotli** size (size-limit's default compression). This
 * gives room for minor drift while still failing a PR when a bundle grows >25%.
 *
 * Usage:
 *   npm run build && npm run size:check   # build then check thresholds
 *
 * To update a limit: edit it here, then re-run `npm run size:check`.
 *
 * @see https://github.com/ai/size-limit
 */
export default [
  { path: "foliplus/dist/foliplus-common.min.js", limit: "17 KB" },
  { path: "foliplus/dist/foliplus-common.min.css", limit: "4 KB" },

  { path: "foliplus/dist/foliplus-LayerControl.min.js", limit: "12 KB" },
  { path: "foliplus/dist/foliplus-LayerControl.min.css", limit: "4 KB" },

  { path: "foliplus/dist/foliplus-MeasureControl.min.js", limit: "13 KB" },
  { path: "foliplus/dist/foliplus-MeasureControl.min.css", limit: "1.5 KB" },

  { path: "foliplus/dist/foliplus-HeatmapControl.min.js", limit: "10.5 KB" },
  { path: "foliplus/dist/foliplus-HeatmapControl.min.css", limit: "3 KB" },

  { path: "foliplus/dist/foliplus-ExportControl.min.js", limit: "14 KB" },
  { path: "foliplus/dist/foliplus-ExportControl.min.css", limit: "1.5 KB" },

  { path: "foliplus/dist/foliplus-SearchControl.min.js", limit: "6.5 KB" },
  { path: "foliplus/dist/foliplus-SearchControl.min.css", limit: "1.5 KB" },

  { path: "foliplus/dist/foliplus-FullscreenControl.min.js", limit: "2 KB" },
  { path: "foliplus/dist/foliplus-FullscreenControl.min.css", limit: "0.5 KB" },

  { path: "foliplus/dist/foliplus-LocateControl.min.js", limit: "2 KB" },

  { path: "foliplus/dist/foliplus-ScaleControl.min.js", limit: "1 KB" },
  { path: "foliplus/dist/foliplus-ScaleControl.min.css", limit: "0.5 KB" },
];
