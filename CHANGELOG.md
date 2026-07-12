# Changelog

## [Unreleased]

### Added

- `Fullscreen`: added `hide_others` parameter (default `true`) to hide all other map controls in fullscreen; icon now switches between maximize/minimize ([#33](https://github.com/Zeroto521/foliplus/pull/33))
- `MeasureControl`: added real-time distance preview during measurement ([#27](https://github.com/Zeroto521/foliplus/pull/27))
- `LayerControl`: added `EMPTY` and `UNKNOWN` SVG icons for layer type display ([#29](https://github.com/Zeroto521/foliplus/pull/29))

### Changed

- `ScaleControl`: Fixed to `bottomleft` and aligned UI style with native Leaflet elements ([#23](https://github.com/Zeroto521/foliplus/pull/23))
- Unified control tokens and simplified shared styles ([#25](https://github.com/Zeroto521/foliplus/pull/25))
- `LayerControl`: centralized z-index engine with `*10` step spacing between layers to reserve room for sub-panes (graph / label) ([#25](https://github.com/Zeroto521/foliplus/pull/25))
- `LayerControl`: auto-discover child custom panes (`__heatmap_graph__`, `__heatmap_label__`, etc.) on layer registration and create them before `addLayer`, removing the need for manual `ensurePane` calls from child components ([#25](https://github.com/Zeroto521/foliplus/pull/25))
- `HeatmapControl`, `MeasureControl`: label z-index offset (`+1`) is now applied automatically by `LayerControl` when a pane name contains "label" or "lbl" ([#25](https://github.com/Zeroto521/foliplus/pull/25))

### Fixed

- `LayerControl`: restricted drag-and-drop reordering to within the same group (overlay ↔ overlay, base ↔ base)  ([#25](https://github.com/Zeroto521/foliplus/pull/25))
- `LayerControl`: added blocked-reorder hint and group order normalization ([#25](https://github.com/Zeroto521/foliplus/pull/25))
- `HeatmapControl`: fixed `_auto` field detection, including single-field cases ([#28](https://github.com/Zeroto521/foliplus/pull/28))

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
