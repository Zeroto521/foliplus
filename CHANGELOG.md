# Changelog

## [Unreleased]

### Added

- `ExportControl`: select any region on the map and export it as a high-resolution map image for presentations/demos ([#106](https://github.com/Zeroto521/foliplus/pull/106), [#154](https://github.com/Zeroto521/foliplus/pull/154), [#158](https://github.com/Zeroto521/foliplus/pull/158), [#170](https://github.com/Zeroto521/foliplus/pull/170), [#171](https://github.com/Zeroto521/foliplus/pull/171))
- `MeasureControl`: `show_bearing` parameter (default `true`) to display azimuth in distance segment labels ([#113](https://github.com/Zeroto521/foliplus/pull/113), [#127](https://github.com/Zeroto521/foliplus/pull/127))
- `MeasureControl`: polygon area measurement mode — draw polygons, see area at centroid, per-segment and closing-edge distance labels ([#114](https://github.com/Zeroto521/foliplus/pull/114))
- `LocateControl`: Fly to the user's current position ([#129](https://github.com/Zeroto521/foliplus/pull/129), [#134](https://github.com/Zeroto521/foliplus/pull/134))
- `HeatmapControl`: auto-select single point layer on panel expand, skipping the manual selection step ([#133](https://github.com/Zeroto521/foliplus/pull/133))
- `EventBus`: decouple cross-component communication via typed semantic events, replacing direct Leaflet map-event wiring ([#148](https://github.com/Zeroto521/foliplus/pull/148), [#153](https://github.com/Zeroto521/foliplus/pull/153), [#155](https://github.com/Zeroto521/foliplus/pull/155), [#159](https://github.com/Zeroto521/foliplus/pull/159), [#161](https://github.com/Zeroto521/foliplus/pull/161))
- `ModeManager`: prevent conflicting component actions (e.g. measurement during export) via mode tracking and mutual-exclusion blocking ([#150](https://github.com/Zeroto521/foliplus/pull/150), [#159](https://github.com/Zeroto521/foliplus/pull/159))
- `LayerControl`: keyboard shortcuts for layer panel — `ArrowUp`/`ArrowDown`/`ArrowLeft`/`ArrowRight`/`Space`/`Enter`/`Escape` and `Ctrl+ArrowUp`/`Ctrl+ArrowDown` for reorder. Added `moveLayerUp(id)` and `moveLayerDown(id)` to `LayerAPI` ([#156](https://github.com/Zeroto521/foliplus/pull/156))

### Changed

- `MeasureControl`: migrate distance, bearing, area, midpoint calculations to turf.js geodesic implementations ([#114](https://github.com/Zeroto521/foliplus/pull/114))
- `LayerControl`: rework internal architecture into `LayerRegistry` (ordered layer list, read-only `api.layers`) + `PaneManager` (pane lifecycle: creation, discovery cache, fallback mapping, DOM migration) + `LayerUI` (fold/drag/color state), orchestrated by a slim `LayerManager` ([#117](https://github.com/Zeroto521/foliplus/pull/117), [#119](https://github.com/Zeroto521/foliplus/pull/119), [#120](https://github.com/Zeroto521/foliplus/pull/120), [#121](https://github.com/Zeroto521/foliplus/pull/121))
- `Project architecture`: migrate from single Jinja-embedded JavaScript IIFE to modular TypeScript with ES module structure. Each component now has its own `*.ts` source file, bundled via esbuild into a single IIFE for distribution ([#122](https://github.com/Zeroto521/foliplus/pull/122), [#125](https://github.com/Zeroto521/foliplus/pull/125), [#136](https://github.com/Zeroto521/foliplus/pull/136), [#137](https://github.com/Zeroto521/foliplus/pull/137))
- `Frontend language`: migrate all JavaScript source files to TypeScript (`*.js` → `*.ts`). Added `vitest` for JS unit tests ([#122](https://github.com/Zeroto521/foliplus/pull/122), [#130](https://github.com/Zeroto521/foliplus/pull/130))
- `Test boundary refactoring`: establish clear PY ↔ JS bridge boundary rule — PY tests validate config serialization, locale injection, CDN dependencies, and CSS tokens only; JS tests (vitest) cover all internal component logic; browser tests (Playwright) cover real DOM interaction ([#122](https://github.com/Zeroto521/foliplus/pull/122), [#131](https://github.com/Zeroto521/foliplus/pull/131))
- `BaseControl`: extract `_export_fields` and `_extra_config` protocol for clean PY→JS config injection. Rework the **lifecycle management** in the shared JS `BaseControl`: a `L.Control` base class with `init()`/`buildDOM()`/`destroy()` hooks and final `onAdd()`/`onRemove()`. `onRemove` auto-unbinds all tracked DOM/map listeners before calling the subclass `destroy()` hook, eliminating listener leaks across controls ([#122](https://github.com/Zeroto521/foliplus/pull/122))
- `CSS build`: migrate all component stylesheets to CSS Nesting source syntax, compiled to fully-flat selectors via `postcss-nesting` ([#124](https://github.com/Zeroto521/foliplus/pull/124), [#151](https://github.com/Zeroto521/foliplus/pull/151))
- `LayerControl`: extract layer core into `core/layer/` ([#138](https://github.com/Zeroto521/foliplus/pull/138), [#139](https://github.com/Zeroto521/foliplus/pull/139), [#140](https://github.com/Zeroto521/foliplus/pull/140), [#141](https://github.com/Zeroto521/foliplus/pull/141), [#143](https://github.com/Zeroto521/foliplus/pull/143), [#144](https://github.com/Zeroto521/foliplus/pull/144))
  - **Why**: `LayerAPI` used to require `LayerControl`; now the core lives in DOM-free `core/layer/` and `ensureLayerAPI` guarantees a usable API even without the `LayerControl`.
- `Build artifacts`: prefix built assets with `foliplus-` and inject a version banner ([#147](https://github.com/Zeroto521/foliplus/pull/147))
- `Shared bundle`: `foliplus-common.min.js` aggregates all shared code once — core/layer, common helpers, BaseControl, hint, geocode — cutting total JS ~43% (193KB→110KB). Auto-tree-shake unused shared exports in component bundles: shim generation scans component imports and emits only the actually-used names, reducing bundle sizes 5-28% per component. LocateControl -28%, ScaleControl -28%, SearchControl -10%, FullscreenControl -10% ([#147](https://github.com/Zeroto521/foliplus/pull/147), [#177](https://github.com/Zeroto521/foliplus/pull/177))
- `hint`: made per-map — `window.foliplus.showHint` removed; each map gets its own `HintManager` ([#147](https://github.com/Zeroto521/foliplus/pull/147), [#149](https://github.com/Zeroto521/foliplus/pull/149))
- `geocode`: add forward geocoding alongside reverse; bidirectional FIFO cache with 24h TTL ([#147](https://github.com/Zeroto521/foliplus/pull/147))
- `Cache`: generic `Cache<K,V>` (FIFO + optional TTL) for bounded caching; optional `onEvict` callback to release resources (e.g. GPU `ImageBitmap`s) on removal ([#147](https://github.com/Zeroto521/foliplus/pull/147), [#154](https://github.com/Zeroto521/foliplus/pull/154))
- `Build pipeline`: enable esbuild Tree Shaking via auto-scanned import detection; eliminate `.build/` source mirror (transforms at bundle time). `foliplus-common.min.js` tree-shaking disabled on shared entry (esbuild cannot trace `window.foliplus.X = {X}`); component bundles tree-shaken for correctness (~0.2% size reduction). Standalone CLI arg parser + registry generator. 77 new vitest tests (716→785). ([#162](https://github.com/Zeroto521/foliplus/pull/162))
- `SearchControl`: address search delegates to `foliplus.geocode` (shared bidirectional CRS-aware cache, Nominatim throttle, CRS conversion); suggestion results pre-populate the same cache via `cacheSuggestion` so a follow-up address search reuses cached coordinates ([#166](https://github.com/Zeroto521/foliplus/pull/166))
- `HeatmapControl`: remove the nested `style` dict parameter; `field`, `border_weight`, `border_color`, `fill_opacity`, `border_opacity`, `label_show`, `label_size`, `label_color`, `label_format` are now first-class constructor keyword arguments — no `style=` wrapper needed ([#169](https://github.com/Zeroto521/foliplus/pull/169))

### Fixed

- `hint icon`: fix missing hint icons for components loaded after the first `ensureHint(map)` call — `registerHintIcon` now syncs all active HintManager instances, making icons load-order independent ([#149](https://github.com/Zeroto521/foliplus/pull/149))
- `LayerControl`: fix layer order reset after hide/show — `paneSet` flag is now reset on re-add so `enforceOrder` correctly re-moves paths to the target fallback pane ([#106](https://github.com/Zeroto521/foliplus/pull/106))
- `MeasureControl`: markers are saved immediately on placement, so they survive a page refresh even while the address lookup is still running ([#112](https://github.com/Zeroto521/foliplus/pull/112))
- `FullscreenControl`: `hide_self` now hides the zoom +/- buttons together with the fullscreen button while in fullscreen ([#115](https://github.com/Zeroto521/foliplus/pull/115), [#116](https://github.com/Zeroto521/foliplus/pull/116))
- `LayerControl`: clicking toggle-all checkbox in indeterminate state (some layers visible) now deselects all layers instead of selecting them ([#132](https://github.com/Zeroto521/foliplus/pull/132))

## [v0.3.0] (2026-08-02)

### Added

- `LayerControl`: `createLayers`/`createCanvas` managed layer APIs for programmatic use ([#25](https://github.com/Zeroto521/foliplus/pull/25), [#39](https://github.com/Zeroto521/foliplus/pull/39), [#53](https://github.com/Zeroto521/foliplus/pull/53), [#91](https://github.com/Zeroto521/foliplus/pull/91), [#92](https://github.com/Zeroto521/foliplus/pull/92), [#104](https://github.com/Zeroto521/foliplus/pull/104))
- `MeasureControl`: real-time distance preview during measurement ([#27](https://github.com/Zeroto521/foliplus/pull/27))
- `LayerControl`: `EMPTY`, `UNKNOWN`, and `COLOR` SVG icons for layer type display ([#29](https://github.com/Zeroto521/foliplus/pull/29), [#35](https://github.com/Zeroto521/foliplus/pull/35), [#40](https://github.com/Zeroto521/foliplus/pull/40), [#61](https://github.com/Zeroto521/foliplus/pull/61), [#76](https://github.com/Zeroto521/foliplus/pull/76), [#101](https://github.com/Zeroto521/foliplus/pull/101))
- `FullscreenControl`: `hide_others` parameter (default `true`) to hide all other map controls in fullscreen; icon switches between maximize/minimize ([#33](https://github.com/Zeroto521/foliplus/pull/33), [#49](https://github.com/Zeroto521/foliplus/pull/49))
- `SearchControl`/`MeasureControl`: separator between toggle button and toolbar in expanded mode ([#43](https://github.com/Zeroto521/foliplus/pull/43))
- `SearchControl`: toggle button stays fixed on screen side when expanded ([#45](https://github.com/Zeroto521/foliplus/pull/45))
- `LayerControl`: batch show/hide of all overlay or base layers via toggle-all checkbox ([#47](https://github.com/Zeroto521/foliplus/pull/47), [#101](https://github.com/Zeroto521/foliplus/pull/101), [#108](https://github.com/Zeroto521/foliplus/pull/108))
- `MeasureControl`: measurement persistence via `localStorage` — markers, distances, and circles survive page refresh ([#48](https://github.com/Zeroto521/foliplus/pull/48), [#83](https://github.com/Zeroto521/foliplus/pull/83))
- `LayerControl`: fold/unfold toggle-all rows for overlay and base groups ([#52](https://github.com/Zeroto521/foliplus/pull/52), [#55](https://github.com/Zeroto521/foliplus/pull/55))
- `SearchControl`: address autocomplete suggestions with Nominatim integration ([#75](https://github.com/Zeroto521/foliplus/pull/75))
- `ScaleControl`: `unit` parameter (`"metric"` / `"imperial"`) to control scale bar unit system ([#88](https://github.com/Zeroto521/foliplus/pull/88))
- `MeasureControl`: per-node delete icons for distance measurement ([#97](https://github.com/Zeroto521/foliplus/pull/97))

### Changed

- `ScaleControl`: Fixed to `bottomleft` and aligned UI style with native Leaflet elements ([#23](https://github.com/Zeroto521/foliplus/pull/23), [#50](https://github.com/Zeroto521/foliplus/pull/50), [#85](https://github.com/Zeroto521/foliplus/pull/85))
- Unified control tokens and simplified shared styles ([#37](https://github.com/Zeroto521/foliplus/pull/37), [#56](https://github.com/Zeroto521/foliplus/pull/56), [#58](https://github.com/Zeroto521/foliplus/pull/58), [#63](https://github.com/Zeroto521/foliplus/pull/63))
- `FullscreenControl`: replaced zoom +/- text with styled SVG icons matching foliplus design, unified fullscreen button and zoom controls with consistent hover/active effects ([#37](https://github.com/Zeroto521/foliplus/pull/37), [#58](https://github.com/Zeroto521/foliplus/pull/58))
- `HeatmapControl`: migrated from `L.divIcon` based SVG hexagons to Canvas 2D rendering (`createCanvas` API). Significant performance improvement for large point datasets ([#38](https://github.com/Zeroto521/foliplus/pull/38), [#71](https://github.com/Zeroto521/foliplus/pull/71))
- Unified `HINT_DURATION` constants across all components: `SHORT`, `MEDIUM`, `LONG`, `PERSIST` ([#41](https://github.com/Zeroto521/foliplus/pull/41))
- `MeasureControl`: simplify HTML string concatenation via `foliplus.dom.el` ([#47](https://github.com/Zeroto521/foliplus/pull/47), [#51](https://github.com/Zeroto521/foliplus/pull/51))
- `FullscreenControl`: no external CDN dependencies, rewritten `FullscreenControl` ([#58](https://github.com/Zeroto521/foliplus/pull/58))
- UI polish: unified CSS design token system, optimized and consolidated styles, added keyboard accessibility and disabled state styling, improved checkbox/toggle/scheme dropdown interactions ([#62](https://github.com/Zeroto521/foliplus/pull/62), [#67](https://github.com/Zeroto521/foliplus/pull/67), [#68](https://github.com/Zeroto521/foliplus/pull/68), [#95](https://github.com/Zeroto521/foliplus/pull/95), [#96](https://github.com/Zeroto521/foliplus/pull/96), [#103](https://github.com/Zeroto521/foliplus/pull/103), [#105](https://github.com/Zeroto521/foliplus/pull/105))
- Unify component naming with `Control` suffix: `Base` -> `BaseControl`, `Fullscreen` -> `FullscreenControl` and `MapSearch` -> `SearchControl` ([#80](https://github.com/Zeroto521/foliplus/pull/80))
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

- Locale system overhaul: locale resolution is now fully browser-based (`navigator.language`). Removed Python-side `detect_language()`. `resolve_locale()` now validates inputs with `ValueError`/`TypeError` ([#6](https://github.com/Zeroto521/foliplus/pull/6), [#11](https://github.com/Zeroto521/foliplus/pull/11))

### Fixed

- `LayerControl`/`HeatmapControl`/`MeasureControl`: fix multiple accumulated bugs ([#8](https://github.com/Zeroto521/foliplus/pull/8), [#9](https://github.com/Zeroto521/foliplus/pull/9), [#18](https://github.com/Zeroto521/foliplus/pull/18))
  - Heatmap labels now display on top of hexagons instead of being hidden behind them
  - Marker shadows no longer disappear when toggling layers
  - Map tiles no longer overlap markers after layer reordering
  - `MeasureControl`: cleaned up layer management, removed fragile workarounds
- `HeatmapControl`: add `onRemove()` cleanup, no-layer hint, always-visible UI, unify color bar rendering, fix dropdown color sync, move label to a single pane ([#14](https://github.com/Zeroto521/foliplus/pull/14), [#16](https://github.com/Zeroto521/foliplus/pull/16), [#17](https://github.com/Zeroto521/foliplus/pull/17))

## [v0.1.0] (2026-06-25)

### Added

- Add plugins: `FullscreenControl`, `HeatmapControl`, `LayerControl`, `SearchControl`, `MeasureControl`, `ScaleControl`

[unreleased]: https://github.com/Zeroto521/foliplus/compare/v0.3.0...HEAD
[v0.3.0]: https://github.com/Zeroto521/foliplus/releases/tag/v0.3.0
[v0.2.0]: https://github.com/Zeroto521/foliplus/releases/tag/v0.2.0
[v0.1.0]: https://github.com/Zeroto521/foliplus/releases/tag/v0.1.0
