"""Browser tests for the cursor coordinate readout.

The chip is the last surface the placement kernel adopted; the CSS no longer
carries the vertical gap, so its rendered box must be asserted against the
cursor rather than against the old transform.
"""

from __future__ import annotations

from conftest import use_page

from .helper import _make_page

_MAP_RECT = """
() => {
  const r = document.querySelector(".leaflet-container").getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}
"""

_READOUT = """
() => {
  const el = document.querySelector(".foliplus-measure-readout");
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    left: r.left,
    top: r.top,
    right: r.right,
    bottom: r.bottom,
    width: r.width,
    height: r.height,
    side: el.dataset.side,
    hidden: el.hidden,
    text: el.textContent,
  };
}
"""


def test_readout_anchors_below_the_cursor_and_flips_above(browser, tmp_path):
    with use_page(_make_page, browser, tmp_path) as (page, errors):
        page.evaluate("() => window.__measureManager.setMode('distance')")
        map_rect = page.evaluate(_MAP_RECT)

        # Middle of the map: the chip sits ANCHOR_GAP (10px) below the cursor,
        # centred on it horizontally.
        x = (map_rect["left"] + map_rect["right"]) / 2
        y = (map_rect["top"] + map_rect["bottom"]) / 2
        page.mouse.move(x, y)
        page.wait_for_timeout(50)
        mid = page.evaluate(_READOUT)
        assert mid is not None and not mid["hidden"], mid
        assert mid["side"] == "below", mid
        assert abs(mid["top"] - (y + 10)) <= 1.5, mid
        assert abs((mid["left"] + mid["right"]) / 2 - x) <= 1.5, mid
        assert mid["text"] and "," in mid["text"], mid

        # Near the bottom edge there is no room below: the chip is re-anchored
        # above the cursor with the same gap, and stays inside the map.
        x = map_rect["left"] + (map_rect["right"] - map_rect["left"]) / 2
        y = map_rect["bottom"] - 10
        page.mouse.move(x, y)
        page.wait_for_timeout(50)
        above = page.evaluate(_READOUT)
        assert above is not None, above
        assert above["side"] == "above", above
        assert abs(above["bottom"] - (y - 10)) <= 1.5, above
        assert above["top"] >= map_rect["top"], above

        # At the left edge the box is clamped to the map's left edge.
        x = map_rect["left"] + 3
        y = map_rect["top"] + (map_rect["bottom"] - map_rect["top"]) / 2
        page.mouse.move(x, y)
        page.wait_for_timeout(50)
        left = page.evaluate(_READOUT)
        assert left is not None, left
        assert abs(left["left"] - map_rect["left"]) <= 1.5, left
        assert left["side"] == "below", left

        assert not errors, f"JS errors: {errors}"
