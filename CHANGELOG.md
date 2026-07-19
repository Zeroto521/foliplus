# Changelog

## [Unreleased]

### Added

- `Fullscreen`: added `hide_others` parameter (default `true`) to hide all other map controls in fullscreen; icon now switches between maximize/minimize ([#33](https://github.com/Zeroto521/foliplus/pull/33))
- `MeasureControl`: added real-time distance preview during measurement ([#27](https://github.com/Zeroto521/foliplus/pull/27))
- `LayerControl`: added `EMPTY`, `UNKNOWN`, and `COLOR` SVG icons for layer type display ([#29](https://github.com/Zeroto521/foliplus/pull/29), [#35](https://github.com/Zeroto521/foliplus/pull/35), [#40](https://github.com/Zeroto521/foliplus/pull/40))
- `LayerControl`: introduced `createCanvas()`/`createLayers()` API with deferred registration — `mainLayer.addLayer` auto-adds content to map for visibility while drawing, `register()` only creates the panel checkbox on completion; `layerCallbacks` Map for callback-only layers (Canvas heatmap) ([#38](https://github.com/Zeroto521/foliplus/pull/38), [#39](https://github.com/Zeroto521/foliplus/pull/39))
- `MapSearch`/`MeasureControl`: added separator between toggle button and toolbar in expanded mode ([#43](https://github.com/Zeroto521/foliplus/pull/43))
- `MapSearch`: keeping toggle button fixed on screen side when expanded ([#45](https://github.com/Zeroto521/foliplus/pull/45))
- `LayerControl`: added `toggleAll` / `syncToggleAll` for batch show/hide of overlay or base layers ([#47](https://github.com/Zeroto521/foliplus/pull/47))
- `MeasureControl`: refactored HTML string concatenation to use `foliplus.dom.el` ([#47](https://github.com/Zeroto521/foliplus/pull/47))

### Changed

- `ScaleControl`: Fixed to `bottomleft` and aligned UI style with native Leaflet elements ([#23](https://github.com/Zeroto521/foliplus/pull/23))
- Unified control tokens and simplified shared styles ([#25](https://github.com/Zeroto521/foliplus/pull/25))
- `LayerControl`: centralized z-index engine with `*10` step spacing between layers to reserve room for sub-panes (graph / label) ([#25](https://github.com/Zeroto521/foliplus/pull/25))
- `LayerControl`: auto-discover child custom panes on layer registration and create them before `addLayer`, removing the need for manual `ensurePane` calls from child components ([#25](https://github.com/Zeroto521/foliplus/pull/25))
- `Fullscreen`: replaced zoom +/- text with styled SVG icons matching foliplus design, unified fullscreen button and zoom controls with consistent hover/active effects (red accent, scale) and `--shadow-ctrl-strong`; CSS extracted into `Fullscreen.css` ([#37](https://github.com/Zeroto521/foliplus/pull/37))
- `HeatmapControl`, `MeasureControl`: label z-index offset (`+1`) is now applied automatically by `LayerControl`; label pane detection improved to use pre-registration in `createManagedLayers` instead of fragile string matching ([#25](https://github.com/Zeroto521/foliplus/pull/25), [#35](https://github.com/Zeroto521/foliplus/pull/35))
- `HeatmapControl`: migrated from `L.divIcon` based SVG hexagons to Canvas 2D rendering (`createCanvas` API). Significant performance improvement for large point datasets ([#38](https://github.com/Zeroto521/foliplus/pull/38))
- Unified `HINT_DURATION` constants across all components: `SHORT` (1200ms), `MEDIUM` (2500ms), `LONG` (4000ms), `PERSIST` (0 — persistent); `HeatmapControl`/`MeasureControl`/`MapSearch` updated to use these tiers ([#41](https://github.com/Zeroto521/foliplus/pull/41))
- Unified button styles: extracted shared hover/active/scale effects into `common.css`; added `toggle-btn`/`tool-btn`/`search-mode-btn`/`ctrl-abs-btn`/`leaflet-control-zoom-*` unified reset; added `::before` zoom SVG icons with hover color change ([#37](https://github.com/Zeroto521/foliplus/pull/37))

### Fixed

- `LayerControl`: restricted drag-and-drop reordering to within the same group (overlay ↔ overlay, base ↔ base) ([#25](https://github.com/Zeroto521/foliplus/pull/25))
- `HeatmapControl`: fixed `_auto` field detection, including single-field cases ([#28](https://github.com/Zeroto521/foliplus/pull/28))
- `MeasureControl`: labels are marked with `isMeasureLabel = true` BEFORE `addTo(mainLayer)`, ensuring correct routing to sub-layers ([#35](https://github.com/Zeroto521/foliplus/pull/35))
- `MeasureControl`: fixed distance mode points hidden behind the polyline when layer is hidden and re-shown ([#48](https://github.com/Zeroto521/foliplus/pull/48))
- `MeasureControl`: delete icons (✕) now correctly work after layer hide/show by using Leaflet marker events instead of `L.DomEvent.on` ([#48](https://github.com/Zeroto521/foliplus/pull/48))
- `LayerControl`: `handleDrop` now uses `data-layer-id` attribute instead of stale index to locate moved DOM element after splice ([#48](https://github.com/Zeroto521/foliplus/pull/48))
- `LayerControl`: `registerLayer` preserves user's `visible` state when re-registering a callback-only layer (e.g. Canvas heatmap); callback-only layers no longer auto-check when `initTypesAndVisibility` runs after re-registration ([#48](https://github.com/Zeroto521/foliplus/pull/48))

## [v0.2.0] (2026-07-01)

### Added

- `MapSearch`: add `mode` parameter to choose default search mode (`"coord"` or `"addr"`) ([#12](https://github.com/Zeroto521/foliplus/pull/12))
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

- Add foliplus control plugins: `Fullscreen`, `HeatmapControl`, `LayerControl`, `MapSearch`, `MeasureControl`, `ScaleControl`

[unreleased]: https://github.com/Zeroto521/foliplus/compare/v0.2.0...HEAD
[v0.2.0]: https://github.com/Zeroto521/foliplus/releases/tag/v0.2.0
[v0.1.0]: https://github.com/Zeroto521/foliplus/releases/tag/v0.1.0
