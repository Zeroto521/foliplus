"""T251 guard: foliplus button :hover keeps its radius under Bootstrap.

Bootstrap ships an unlayered `button{border-radius:0}` reset. During the
@layer era (#568) that outranked the layered foliplus rule at any
specificity — the unified button hover turned square (user report).
After #579 removed the layer wrap, `.foliplus-*:hover` (0,4,0) beats
`button` (0,0,1) again. This pins the radius for the whole button family
on a real folium page with Bootstrap injected.
"""

from __future__ import annotations

import io

import folium
from conftest import _js, make_browser_page, use_page
from PIL import Image


class TestButtonRadiusBrowser:
    """T251 guard: foliplus button :hover keeps its radius under Bootstrap."""

    # --foliplus-radius-sm resolves through --foliplus-size-4 (4px).
    RADIUS_SM = "4px"

    @staticmethod
    def _make_page(browser, tmp_path):
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        # Any foliplus control injects the shared stylesheet into the page;
        # without one the foliplus CSS never ships and the buttons would
        # render with Bootstrap's reset alone.
        from foliplus import LayerControl

        LayerControl().add_to(m)
        html = m.get_root().render()
        page, errors = make_browser_page(browser, tmp_path, html, "btn_radius")
        # Inject the three button kinds the guard covers (shared snippet).
        assert page.evaluate(_js("BaseControl/button_probe")) == [
            "tb",
            "tool",
            "panel",
        ]
        return page, errors

    def _radius(self, page, selector: str) -> str:
        return page.evaluate(_js("BaseControl/read_border_radius"), selector)

    def _corner_pink_counts(self, page, selector: str) -> list[int]:
        """Per-corner pink-pixel counts (6x6 block) of the hovered button.

        A square corner (radius 0) is fully pink under :hover (accent-light
        fills the whole box); a rounded corner leaves the corner pixels
        unpainted. 'pink' = --foliplus-accent-light (#fde8e8), tolerance 24.
        Uses the element screenshot so the `:hover` transform scale is
        included in the sampled box (a layout-bounding-box clip would shift
        the corners off the rendered glyph).
        """
        shot = page.locator(selector).screenshot()
        img = Image.open(io.BytesIO(shot)).convert("RGB")
        w, h = img.size
        size = 6
        corners = [(0, 0), (w - size, 0), (0, h - size), (w - size, h - size)]
        counts = []
        for cx, cy in corners:
            n = 0
            for dx in range(size):
                for dy in range(size):
                    r, g, b = img.getpixel((cx + dx, cy + dy))
                    if (
                        abs(r - 0xFD) <= 24
                        and abs(g - 0xE8) <= 24
                        and abs(b - 0xE8) <= 24
                    ):
                        n += 1
            counts.append(n)
        return counts

    def test_radius_under_bootstrap(self, browser, tmp_path):
        """Toggle keeps 4px radius on hover; tool flips 0 -> 4; panel stays 4."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            # toggle: rounded at rest, rounded on hover (Bootstrap reset must not win)
            assert self._radius(page, "#tb") == self.RADIUS_SM
            page.hover("#tb")
            assert self._radius(page, "#tb") == self.RADIUS_SM
            # tool: square at rest, rounded on hover
            assert self._radius(page, "#tool") == "0px"
            page.hover("#tool")
            assert self._radius(page, "#tool") == self.RADIUS_SM
            # panel: rounded at rest
            assert self._radius(page, "#panel") == self.RADIUS_SM
            assert not errors, f"JS errors: {errors}"

    def test_hover_corners_paint_rounded_under_bootstrap(self, browser, tmp_path):
        """Visual pin: hovered corners are not fully pink (radius not zero)."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            for sel in ("#tb", "#tool", "#panel"):
                page.hover(sel)
                # Let the hover background/transform transition settle.
                page.wait_for_timeout(300)
                counts = self._corner_pink_counts(page, sel)
                # A square corner would be all 36 pink; rounded corners leave gaps.
                assert all(c < 36 for c in counts), (
                    f"{sel}: corner fully pink under Bootstrap ({counts}) — "
                    "border-radius lost to the host button reset"
                )
            assert not errors, f"JS errors: {errors}"
