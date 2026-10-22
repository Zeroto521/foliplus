# Row-Panel Layout

## Problem

The row panel (style/attrs) is a `position: absolute; top: 100%` child of its
layer row, capped by `max-height: var(--foliplus-panel-max-height)` (400px).
When the panel's natural content exceeds the space between its anchor row and
the map's bottom edge, the panel's bottom rows fall below the map's
`overflow: hidden` boundary and are clipped.

Reported symptom (1280x720, bottom row): panel rect height 207px, content
scrollHeight 270-330px, the "可见范围" (zoom range) row falls below the first
screen.

## Root Cause

Three factors combine:

1. **Fixed cap.** The panel's `max-height` reads the shared token
   `--foliplus-panel-max-height` (400px), which does not account for the map's
   actual visible area or the anchor's position within it.

2. **Downward-only anchoring.** The panel always opens below its row
   (`top: 100%`). A row near the map's bottom edge has little space below, so
   even a short panel can be clipped.

3. **No viewport awareness.** Neither the panel nor its caller measures the
   available space; the layout is purely CSS-driven with a static cap.

## Solution

B + C converged in `createRowPanel`:

**B — Viewport-aware cap.** On mount, `measureRowPanelPlacement` reads the
map's and anchor row's bounding rects, computes the space below and above the
row, and writes a per-panel CSS variable
`--foliplus-row-panel-max-height` to the larger of the two. The panel's
content area scrolls internally when the cap is tighter than the content.

**C — Upward flip.** When the space below is smaller than the panel's natural
height and the space above is larger, the panel re-anchors upward via the
`.foliplus-row-panel-up` modifier class (`bottom: 100%; top: auto`).

**Floor.** When both strips are tighter than the content, the cap holds a 120px
floor. Below that, the panel would hide more content than it shows, so the
fallback is "fit the visible strip" with internal scroll.

The placement is re-measured on `window.resize` and via a `ResizeObserver` on
the map element. A `MutationObserver` on `document.body` activates the
measurement when the panel enters the DOM and releases everything on removal.

## Measured Numbers (Playwright, 5 FeatureGroups x [Polygon + Marker])

| Scenario           | Viewport | Row  | Panel rect | Content | Below | Above | Flip | Cap     |
|--------------------|----------|------|------------|---------|-------|-------|------|---------|
| First row          | 1280x720 | y=160| 239px      | 237px   | 523px | 160px | No    | 239px   |
| 500px viewport     | 1280x500 | y=160| 235px      | 233px   | 303px | 160px | No    | 235px   |
| Last row (5 layers)| 1280x720 | y=308| 239px      | 237px   | 375px | 308px | No    | 239px   |
| Last row (10 layers)| 1280x720| y=510| 239px      | 237px   | 210px | 510px | Yes   | 239px   |

Without the fix, the cap was always "400px" (the token default). With the fix,
the cap is written from the measurement and the flip triggers when the space
below is the tight side.

## Files Changed

- `foliplus/css/common/panel.css` — add `--foliplus-row-panel-max-height`
  token with fallback, add `.foliplus-row-panel-up` modifier.
- `foliplus/js/core/leaflet/panel.ts` — add `measureRowPanelPlacement` and
  `observeRowPanelPlacement`, called from `createRowPanel`.
- `foliplus/js/core/leaflet/index.ts` — re-export `measureRowPanelPlacement`.
- `test/js/core/leaflet/panel.test.ts` — 5 unit tests for placement logic.
- `test/js/listener-guard.test.ts` — bump allow-list pin for the new
  `window.addEventListener`.
- `test/python/LayerControl/test_row_panel_layout.py` — 3 acceptance tests
  with screenshots.
