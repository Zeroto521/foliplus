# Row-Panel Layout

## Problem

The row panel (style/attrs) used to be a `position: absolute; top: 100%` child
of its layer row. Its `max-height` was the shared 400px token, so when the
panel's natural content exceeded the space between its anchor row and the map's
bottom edge, the panel's lower rows fell outside the map's `overflow: hidden`
boundary and were clipped.

Reported symptom (1280x720, bottom row): panel rect height 207px, content
scrollHeight 270-330px, the "可见范围" (zoom range) row fell below the first
screen.

## Root Cause

Three factors combined:

1. **Fixed cap.** The panel's `max-height` read the shared token
   `--foliplus-panel-max-height` (400px), which does not account for the map's
   actual visible area or the anchor's position within it.
2. **Downward-only anchoring.** The panel always opened below its row
   (`top: 100%`). A row near the map's bottom edge has little space below, so
   even a short panel could be clipped.
3. **No viewport awareness.** Neither the panel nor its caller measured the
   available space; the layout was purely CSS-driven with a static cap.

## Current Architecture

Layer-row panels are now **pinned**: a caller that mounts a card inside the
layer list's scroll box calls `pinRowPanel(panel, row)`. The card gets
`foliplus-is-pinned` (`position: fixed`) and therefore floats above the layer
control instead of being clipped by its scroll box. `createRowPanel` still
returns a plain absolute card for callers that do not need pinning.

The pinned card adds two placement moves on top of the floating box:

**B — Viewport-aware cap.** `fitRowPanel` reads the map's and anchor row's
bounding rects, computes the space below and above the row, and writes a
per-panel CSS variable `--foliplus-row-panel-max-height` to the natural content
height clamped to the chosen strip. The content area scrolls internally when the
cap is tighter than the content.

**C — Upward flip.** When the space below is smaller than the panel's natural
height and the space above is larger, the card re-anchors upward.
`.foliplus-row-panel-up` records the state; the measured `top` is written inline
by `placeRowPanel`, so it cannot fight the fixed box.

**Floor.** When both strips are tighter than the content, the cap holds a 120px
floor. Below that the panel would hide more content than it shows, so the
fallback is "fit the visible strip" with internal scroll.

The pinned card re-runs the fit from `pinRowPanel`'s page-level scroll/resize
listener pair, so it needs no per-card observer. A caller that only uses
`createRowPanel` keeps the plain absolute card and the existing CSS behavior;
placement is opt-in.

The scheme dropdown inside a row panel keeps its own independent
positioning/flip/clamp in `common/dropdown.ts`; it is not part of this
measurement.

## Measured Numbers (Playwright, 5 FeatureGroups x [Polygon + Marker])

| Scenario             | Viewport | Row   | Panel rect | Content | Below | Above | Flip | Cap   |
| -------------------- | -------- | ----- | ---------- | ------- | ----- | ----- | ---- | ----- |
| First row            | 1280x720 | y=160 | 239px      | 237px   | 523px | 160px | No   | 239px |
| 500px viewport       | 1280x500 | y=160 | 235px      | 233px   | 303px | 160px | No   | 235px |
| Last row (5 layers)  | 1280x720 | y=308 | 239px      | 237px   | 375px | 308px | No   | 239px |
| Last row (10 layers) | 1280x720 | y=510 | 239px      | 237px   | 210px | 510px | Yes  | 239px |

Without the fix, the cap was always "400px" (the token default). With the fix,
the cap is written from the measurement and the flip triggers when the space
below is the tight side.

## Files Changed

- `foliplus/css/common/panel.css` — add `--foliplus-row-panel-max-height`
  token with fallback; keep the pinned box's fixed positioning.
- `foliplus/js/core/leaflet/panel.ts` — add `fitRowPanel` and run it from
  `placeRowPanel` for pinned cards.
- `test/js/core/leaflet/panel.test.ts` — unit tests for the pinned cap, flip
  and floor.
- `test/python/LayerControl/test_row_panel_layout.py` — 3 acceptance tests
  with screenshots.
