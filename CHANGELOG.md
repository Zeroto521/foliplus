# Changelog

## [Unreleased] (2026-08-07)

## [v0.3.0]

### Added

- `LayerControl`: `createLayers`/`createCanvas` managed layer APIs for programmatic use ([#25](https://github.com/Zeroto521/foliplus/pull/25), [#39](https://github.com/Zeroto521/foliplus/pull/39), [#53](https://github.com/Zeroto521/foliplus/pull/53), [#91](https://github.com/Zeroto521/foliplus/pull/91), [#92](https://github.com/Zeroto521/foliplus/pull/92), [#104](https://github.com/Zeroto521/foliplus/pull/104))
- `MeasureControl`: real-time distance preview during measurement ([#27](https://github.com/Zeroto521/foliplus/pull/27))
- `LayerControl`: `EMPTY`, `UNKNOWN`, and `COLOR` SVG icons for layer type display ([#29](https://github.com/Zeroto521/foliplus/pull/29), [#35](https://github.com/Zeroto521/foliplus/pull/35), [#40](https://github.com/Zeroto521/foliplus/pull/40), [#61](https://github.com/Zeroto521/foliplus/pull/61), [#76](https://github.com/Zeroto521/foliplus/pull/76), [#101](https://github.com/Zeroto521/foliplus/pull/101))
- `FullscreenControl`: `hide_others` parameter (default `true`) to hide all other map controls in fullscreen; icon switches between maximize/minimize ([#33](https://github.com/Zeroto521/foliplus/pull/33), [#49](https://github.com/Zeroto521/foliplus/pull/49))
- `SearchControl`/`MeasureControl`: separator between toggle button and toolbar in expanded mode ([#43](https://github.com/Zeroto521/foliplus/pull/43))
- `SearchControl`: toggle button stays fixed on screen side when expanded ([#45](https://github.com/Zeroto521/foliplus/pull/45))
- `LayerControl`: batch show/hide of all overlay or base layers via toggle-all checkbox ([#47](https://github.com/Zeroto521/foliplus/pull/47), [#101](https://github.com/Zeroto521/foliplus/pull/101))
- `MeasureControl`: measurement persistence via `localStorage` — markers, distances, and circles survive page refresh ([#48](https://github.com/Zeroto521/foliplus/pull/48), [#83](https://github.com/Zeroto521/foliplus/pull/83))
- `LayerControl`: fold/unfold toggle-all rows for overlay and base groups ([#52](https://github.com/Zeroto521/foliplus/pull/52), [#55](https://github.com/Zeroto521/foliplus/pull/55))
- `SearchControl`: address autocomplete suggestions with Nominatim integration ([#75](https://github.com/Zeroto521/foliplus/pull/75))
- `ScaleControl`: `unit` parameter (`"metric"` / `"imperial"`) to control scale bar unit system ([#88](https://github.com/Zeroto521/foliplus/pull/88))
- `MeasureControl`: per-node delete icons for distance measurement ([#97](https://github.com/Zeroto521/foliplus/pull/97))

### Changed

- `ScaleControl`: default position changed to `bottomleft`; UI aligned with native Leaflet style ([#23](https://github.com/Zeroto521/foliplus/pull/23), [#50](https://github.com/Zeroto521/foliplus/pull/50), [#85](https://github.com/Zeroto521/foliplus/pull/85))
- Unified button interaction system: `toggle-btn`, `tool-btn`, `search-mode-btn`, `ctrl-abs-btn` share hover and active effects via a single `:is()` rule ([#37](https://github.com/Zeroto521/foliplus/pull/37), [#56](https://github.com/Zeroto521/foliplus/pull/56), [#58](https://github.com/Zeroto521/foliplus/pull/58), [#63](https://github.com/Zeroto521/foliplus/pull/63))
- `FullscreenControl`: rewritten without external CDN dependencies; zoom +/- replaced with styled SVG icons ([#37](https://github.com/Zeroto521/foliplus/pull/37), [#58](https://github.com/Zeroto521/foliplus/pull/58))
- `HeatmapControl`: migrated from `L.divIcon`-based SVG hexagons to Canvas 2D rendering (`createCanvas` API) — significant performance improvement for large point datasets ([#38](https://github.com/Zeroto521/foliplus/pull/38), [#71](https://github.com/Zeroto521/foliplus/pull/71))
- Unified `HINT_DURATION` constants across all components: `SHORT` (1200ms), `MEDIUM` (2500ms), `LONG` (4000ms), `PERSIST` (0) ([#41](https://github.com/Zeroto521/foliplus/pull/41))
- `MeasureControl`: refactored HTML string concatenation to use `foliplus.dom.el` ([#47](https://github.com/Zeroto521/foliplus/pull/47), [#51](https://github.com/Zeroto521/foliplus/pull/51))
- Unified CSS design token system; consolidated styles across all controls; added keyboard accessibility and disabled state styling ([#62](https://github.com/Zeroto521/foliplus/pull/62), [#67](https://github.com/Zeroto521/foliplus/pull/67), [#68](https://github.com/Zeroto521/foliplus/pull/68), [#95](https://github.com/Zeroto521/foliplus/pull/95), [#96](https://github.com/Zeroto521/foliplus/pull/96), [#103](https://github.com/Zeroto521/foliplus/pull/103))
- Unified component naming with `Control` suffix: `Base` → `BaseControl`, `ScaleControl` → `ScaleControl`, `SearchControl` → `SearchControl` ([#80](https://github.com/Zeroto521/foliplus/pull/80))
- `LayerControl`: attribution now shows only the topmost visible base TileLayer to avoid clutter ([#83](https://github.com/Zeroto521/foliplus/pull/83))

### Fixed

- `LayerControl`: drag-and-drop reordering restricted to within the same group (overlay ↔ overlay, base ↔ base) ([#25](https://github.com/Zeroto521/foliplus/pull/25))
- `HeatmapControl`: fixed `AUTO` field detection, including single-field cases ([#28](https://github.com/Zeroto521/foliplus/pull/28), [#89](https://github.com/Zeroto521/foliplus/pull/89), [#100](https://github.com/Zeroto521/foliplus/pull/100))
- `LayerControl`: `handleDrop` uses `data-layer-id` instead of stale index to locate moved DOM element ([#48](https://github.com/Zeroto521/foliplus/pull/48))
- `MeasureControl`: distance mode points no longer hidden behind polyline when layer is hidden and re-shown ([#48](https://github.com/Zeroto521/foliplus/pull/48))
- `MeasureControl`: delete icons (✕) now work correctly after layer hide/show by using Leaflet marker events instead of `L.DomEvent.on` ([#48](https://github.com/Zeroto521/foliplus/pull/48))

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

[unreleased]: https://github.com/Zeroto521/foliplus/compare/v0.3.0...HEAD
[v0.3.0]: https://github.com/Zeroto521/foliplus/releases/tag/v0.3.0
[v0.2.0]: https://github.com/Zeroto521/foliplus/releases/tag/v0.2.0
[v0.1.0]: https://github.com/Zeroto521/foliplus/releases/tag/v0.1.0
