# Changelog

## [Unreleased]

### Added

- `LayerControl`/`MeasureControl`/`HeatmapControl`: comprehensive layer management API overhaul — unified `createLayers`/`createCanvas` return surface ([#25](https://github.com/Zeroto521/foliplus/pull/25), [#35](https://github.com/Zeroto521/foliplus/pull/35), [#38](https://github.com/Zeroto521/foliplus/pull/38), [#39](https://github.com/Zeroto521/foliplus/pull/39), [#48](https://github.com/Zeroto521/foliplus/pull/48), [#53](https://github.com/Zeroto521/foliplus/pull/53), [#83](https://github.com/Zeroto521/foliplus/pull/83), [#91](https://github.com/Zeroto521/foliplus/pull/91), [#92](https://github.com/Zeroto521/foliplus/pull/92), [#92](https://github.com/Zeroto521/foliplus/pull/92))
- `MeasureControl`: added real-time distance preview during measurement ([#27](https://github.com/Zeroto521/foliplus/pull/27))
- `LayerControl`: added `EMPTY`, `UNKNOWN`, and `COLOR` SVG icons for layer type display ([#29](https://github.com/Zeroto521/foliplus/pull/29), [#35](https://github.com/Zeroto521/foliplus/pull/35), [#40](https://github.com/Zeroto521/foliplus/pull/40), [#61](https://github.com/Zeroto521/foliplus/pull/61), [#61](https://github.com/Zeroto521/foliplus/pull/61), [#101](https://github.com/Zeroto521/foliplus/pull/101))
- `FullscreenControl`: added `hide_others` parameter (default `true`) to hide all other map controls in fullscreen; icon now switches between maximize/minimize ([#33](https://github.com/Zeroto521/foliplus/pull/33), [#49](https://github.com/Zeroto521/foliplus/pull/49))
- `SearchControl`/`MeasureControl`: added separator between toggle button and toolbar in expanded mode ([#43](https://github.com/Zeroto521/foliplus/pull/43))
- `SearchControl`: keeping toggle button fixed on screen side when expanded ([#45](https://github.com/Zeroto521/foliplus/pull/45))
- `LayerControl`: added `toggleAll` / `syncToggleAll` for batch show/hide of overlay or base layers ([#47](https://github.com/Zeroto521/foliplus/pull/47), [#101](https://github.com/Zeroto521/foliplus/pull/101))
- `MeasureControl`: refactored HTML string concatenation to use `foliplus.dom.el` ([#47](https://github.com/Zeroto521/foliplus/pull/47), [#51](https://github.com/Zeroto521/foliplus/pull/51))
- `LayerControl`: added fold/unfold feature with toggle-all row, fold button per group, hover tooltip, and SVG icon switching ([#52](https://github.com/Zeroto521/foliplus/pull/52), [#55](https://github.com/Zeroto521/foliplus/pull/55))
- `SearchControl`: added address autocomplete suggestions with Nominatim integration ([#75](https://github.com/Zeroto521/foliplus/pull/75))
- `MeasureControl`: added measurement persistence via `localStorage` — markers, distances, and circles survive page refresh ([#83](https://github.com/Zeroto521/foliplus/pull/48))
- `LayerControl`: only shows the topmost visible base TileLayer's attribution to avoid clutter when multiple base layers overlap ([#83](https://github.com/Zeroto521/foliplus/pull/83))
- `ScaleControl`: added `unit` parameter (`"metric"` / `"imperial"`) to control the unit system of the scale bar ([#88]
(https://github.com/Zeroto521/foliplus/pull/88))
- `MeasureControl`: added per-node delete icons for distance measurement ([#97](https://github.com/Zeroto521/foliplus/pull/97))

### Changed

- `ScaleControl`: Fixed to `bottomleft` and aligned UI style with native Leaflet elements ([#23](https://github.com/Zeroto521/foliplus/pull/23), [#50](https://github.com/Zeroto521/foliplus/pull/50), [#85](https://github.com/Zeroto521/foliplus/pull/85))
- Unified control tokens and simplified shared styles ([#25](https://github.com/Zeroto521/foliplus/pull/25))
- `FullscreenControl`: replaced zoom +/- text with styled SVG icons matching foliplus design, unified fullscreen button and zoom controls with consistent hover/active effects ([#37](https://github.com/Zeroto521/foliplus/pull/37))
- `HeatmapControl`: migrated from `L.divIcon` based SVG hexagons to Canvas 2D rendering (`createCanvas` API). Significant performance improvement for large point datasets ([#38](https://github.com/Zeroto521/foliplus/pull/38), [#71](https://github.com/Zeroto521/foliplus/pull/71))
- Unified `HINT_DURATION` constants across all components: `SHORT` (1200ms), `MEDIUM` (2500ms), `LONG` (4000ms), `PERSIST` (0 — persistent); `HeatmapControl`/`MeasureControl`/`SearchControl` updated to use these tiers ([#41](https://github.com/Zeroto521/foliplus/pull/41))
- Unified button interaction system: `toggle-btn`, `tool-btn`, `search-mode-btn`, `ctrl-abs-btn` now share a single `:is()` rule in `common.css` for consistent hover (`scale(1.08)` + red accent) and active (`scale(0.92)`) effects ([#37](https://github.com/Zeroto521/foliplus/pull/37), [#56](https://github.com/Zeroto521/foliplus/pull/56), [#58](https://github.com/Zeroto521/foliplus/pull/58), [#63](https://github.com/Zeroto521/foliplus/pull/63))
- `FullscreenControl`: no external CDN dependencies, rewritten `FullscreenControl` ([#58](https://github.com/Zeroto521/foliplus/pull/58))
- Unify component naming with `Control` suffix: `Base` -> `BaseControl`, `FullscreenControl` -> `FullscreenControl` and `SearchControl` -> `SearchControl` ([#80](https://github.com/Zeroto521/foliplus/pull/80))
- UI polish: unified CSS design token system, optimized and consolidated styles, added keyboard accessibility and disabled state styling, improved checkbox/toggle/scheme dropdown interactions ([#62](https://github.com/Zeroto521/foliplus/pull/62), [#67](https://github.com/Zeroto521/foliplus/pull/67), [#68](https://github.com/Zeroto521/foliplus/pull/68), [#95](https://github.com/Zeroto521/foliplus/pull/95), [#96](https://github.com/Zeroto521/foliplus/pull/96), [#103](https://github.com/Zeroto521/foliplus/pull/103))

### Fixed

- `LayerControl`: restricted drag-and-drop reordering to within the same group (overlay ↔ overlay, base ↔ base) ([#25](https://github.com/Zeroto521/foliplus/pull/25))
- `HeatmapControl`: fixed `AUTO` field detection, including single-field cases ([#28](https://github.com/Zeroto521/foliplus/pull/28), [#89](https://github.com/Zeroto521/foliplus/pull/89), [#100](https://github.com/Zeroto521/foliplus/pull/100))
- `MeasureControl`: fixed distance mode points hidden behind the polyline when layer is hidden and re-shown ([#48](https://github.com/Zeroto521/foliplus/pull/48))
- `MeasureControl`: delete icons (✕) now correctly work after layer hide/show by using Leaflet marker events instead of `L.DomEvent.on` ([#48](https://github.com/Zeroto521/foliplus/pull/48))
- `LayerControl`: `handleDrop` now uses `data-layer-id` attribute instead of stale index to locate moved DOM element after splice ([#48](https://github.com/Zeroto521/foliplus/pull/48))

## [v0.2.0] (2026-07-01)

### Added

- `SearchControl`: add `mode` parameter to choose default search mode (`"coord"` or `"addr"`) ([#12](https://github.com/Zeroto521/foliplus/pull/12))
- Documentation is available at <https://foliplus.readthedocs.io> ([#19](https://github.com/Zeroto521/foliplus/pull/19))
- Added runtime guard (`console.error`) for all components when foliplus runtime is missing ([#26](https://github.com/Zeroto521/foliplus/pull/26))

### Changed

- Locale system overhaul: locale resolution is now fully browser-based (`navigator.language`). Removed Python-side `detect_language()`. `resolve_locale()` now validates inputs with `ValueError`/`TypeError`. ([#6](https://github.com/Zeroto521/foliplus/pull/6), [#11](https://github.com/Zeroto521/foliplus/pull/11))

### Fixed

- `LayerControl`/`HeatmapControl`/`MeasureControl`: fix multiple accumulated bugs ([#8](https://github.com/Zeroto521/foliplus/pull/8), [#9](https://github.com/Zeroto521/foliplus/pull/9), [#18](https://github.com/Zeroto521/foliplus/pull/18))
  - Heatmap labels now display on top of hexagons instead of being hidden behind them
  - Marker shadows no longer disappear when toggling layers
  - Map tiles no longer overlap markers after layer reordering
  - `MeasureControl`: cleaned up layer management, removed fragile workarounds
- `HeatmapControl`: add `onRemove()` cleanup, no-layer hint, always-visible UI, unify color bar rendering, fix dropdown color sync, move label to a single pane ([#14](https://github.com/Zeroto521/foliplus/pull/14), [#16](https://github.com/Zeroto521/foliplus/pull/16), [#17](https://github.com/Zeroto521/foliplus/pull/17))

## [v0.1.0] (2026-06-25)

### Features

- Add foliplus control plugins: `FullscreenControl`, `HeatmapControl`, `LayerControl`, `SearchControl`, `MeasureControl`, `ScaleControl`

[unreleased]: https://github.com/Zeroto521/foliplus/compare/v0.2.0...HEAD
[v0.2.0]: https://github.com/Zeroto521/foliplus/releases/tag/v0.2.0
[v0.1.0]: https://github.com/Zeroto521/foliplus/releases/tag/v0.1.0
