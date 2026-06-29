# Changelog

## [Unreleased]

### Added

- `MapSearch`: add `mode` parameter to choose default search mode (`"coord"` or `"addr"`) ([#12](https://github.com/Zeroto521/foliplus/pull/12))

### Fixed

- `LayerControl`/`HeatmapControl`/`MeasureControl`: fix multiple accumulated bugs ([#8](https://github.com/Zeroto521/foliplus/pull/8), [#9](https://github.com/Zeroto521/foliplus/pull/9))
  - Heatmap labels now display on top of hexagons instead of being hidden behind them
  - Marker shadows no longer disappear when toggling layers
  - Map tiles no longer overlap markers after layer reordering
  - `MeasureControl`: cleaned up layer management, removed fragile workarounds
- Fix locale detection: preference order changed to browser `Accept-Language` header
  first, then OS locale, fixing conflicts when the two disagree ([#6](https://github.com/Zeroto521/foliplus/pull/6))

## [v0.1.0] (2026-06-25)

### Features

- Add foliplus control plugins: `Fullscreen`, `HeatmapControl`, `LayerControl`, `MapSearch`, `MeasureControl`, `ScaleControl`

[unreleased]: https://github.com/Zeroto521/foliplus/compare/v0.1.0...HEAD
[v0.1.0]: https://github.com/Zeroto521/foliplus/releases/tag/v0.1.0
