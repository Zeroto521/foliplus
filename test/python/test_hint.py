"""Browser checks for .foliplus-hint width behaviour.

The hint is the one common block rendered directly on the map rather than inside
a control container, so nothing constrains its width. ``max-width:
min(480px, 80vw)`` stops a long locale string from scrolling the map, and the
``@media (max-width: 480px)`` block widens the cap on phones, where 80vw alone
would leave ~188px of text room and a 92-char string would wrap to seven lines.

Line counts are asserted instead of pixel budgets so a future token change does
not force an edit here.
"""

import folium
import pytest
from conftest import make_browser_page, use_page

from foliplus import LayerControl

# Longest (92 chars) and a short hint string shipped in foliplus/locale/*.json.
# 92 chars -> 2 lines at the 480px cap, 4 at the 375px media-block width, 7 at
# the un-mitigated 80vw(375) width, so it trips both halves of the rule.
LONG_TEXT = "Click to start measuring area, double-click / right-click / click first/last point to finish"
SHORT_TEXT = "Export: 2000 x 1200"

VIEWPORTS = [375, 768, 1024, 1440]

# Line count comes from the text Range, not from the box height. Box height is
# the obvious choice and it fails here: 1440px gives h = 57.19px, so
# (h - padding - border) / lineHeight = 39.1875 / 19.6 = 1.999, which rounds to
# 2 — correct, but only because two wrapped lines that happen to render at the
# same width collapse the height to two line boxes. At 480px the same string is
# genuinely three lines (39.2 -> 3) and a 60-char string that is genuinely two
# lines measures 39.1875 too, so the box height cannot distinguish them.
# Range.getClientRects() returns one rect per line box the text actually occupies,
# with no coalescing, so a 4-line hint yields 4 rects at every width probed.
_MEASURE = """(text) => {
    map.foliplus.showHint('hint-width-test', text, 0);
    const el = document.querySelector('.foliplus-hint');
    if (!el) throw new Error('hint not rendered');
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const textNode = el.lastChild;
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const lines = range.getClientRects().length;
    return {
        w: Math.round(r.width),
        h: Math.round(r.height),
        lines,
        overRight: r.right > window.innerWidth + 1,
        overLeft: r.left < -1,
        boxSizing: cs.boxSizing,
        maxW: cs.maxWidth,
    };
}"""


class TestHintWidthBrowser:
    """Hint geometry across the viewport widths foliplus supports."""

    @staticmethod
    def _make_page(browser, tmp_path, width):
        """A map page at *width*; the viewport is set before navigation so the
        first layout uses it rather than reflowing after."""
        m = folium.Map(location=[39.9, 116.4], zoom_start=4)
        LayerControl().add_to(m)
        page, errors = make_browser_page(
            browser, tmp_path, m.get_root().render(), name="hint"
        )
        page.set_viewport_size({"width": width, "height": 700})
        page.wait_for_selector(".foliplus-layer-ctrl", state="attached", timeout=10000)
        return page, errors

    @staticmethod
    def _geom(page, text):
        """Show a hint the way core/hint.ts does and read its geometry.

        duration 0 keeps it on screen (PERSIST) so the rect is readable before
        the auto-dismiss timer removes it.
        """
        return page.evaluate(_MEASURE, text)

    @pytest.mark.parametrize("width", VIEWPORTS)
    def test_hint_never_overflows_viewport(self, browser, tmp_path, width):
        """The regression this file exists for. The old ``nowrap`` rule rendered
        the 92-char string at 603px, past the edge of a 375px phone."""
        with use_page(self._make_page, browser, tmp_path, width) as (page, errors):
            geom = self._geom(page, LONG_TEXT)
            assert not geom["overRight"], (
                f"{width}px: hint runs {geom['w']}px and its right edge is past "
                f"the viewport ({geom['lines']} lines)"
            )
            assert not geom["overLeft"]
        assert not errors, f"JS errors: {errors}"

    def test_hint_caps_at_480_on_desktop(self, browser, tmp_path):
        """480 < 80vw(1440) = 1152, so min() must resolve to 480px — a toast
        that grows with the viewport eats half a 1440px map for one sentence.

        Border-box is checked because a content-box 480px cap would silently
        narrow the text box by the horizontal padding and every hint with it."""
        with use_page(self._make_page, browser, tmp_path, 1440) as (page, errors):
            geom = self._geom(page, LONG_TEXT)
        assert geom["boxSizing"] == "border-box"
        assert geom["w"] <= 480, f"desktop hint {geom['w']}px exceeds the 480px cap"
        assert geom["w"] > 400, (
            f"desktop hint is only {geom['w']}px wide: the cap resolved smaller "
            f"than 480px (maxW {geom['maxW']})"
        )
        assert geom["lines"] == 2, (
            f"92-char string should sit on 2 lines inside 480px, got {geom['lines']}"
        )
        assert not errors, f"JS errors: {errors}"

    def test_hint_stays_one_line_when_it_fits(self, browser, tmp_path):
        """The cap constrains overflow; it must not force wrapping. A 19-char
        string is ~159px, well inside 480px."""
        with use_page(self._make_page, browser, tmp_path, 1440) as (page, errors):
            geom = self._geom(page, SHORT_TEXT)
        assert geom["lines"] == 1, f"short hint wrapped to {geom['lines']} lines"
        assert geom["w"] <= 480
        assert not errors, f"JS errors: {errors}"

    def test_phone_uses_wider_cap_than_80vw(self, browser, tmp_path):
        """At 375px, 80vw = 300 would win inside min() and cap the text box at
        188px, so the 92-char string wraps to seven lines. The media block
        replaces it with calc(100vw - 16px) — the toast reserves only its outer
        gutters — and the worst case drops to four lines."""
        with use_page(self._make_page, browser, tmp_path, 375) as (page, errors):
            geom = self._geom(page, LONG_TEXT)
        assert geom["maxW"] == "359px", f"media block did not apply: maxW {geom['maxW']}"
        assert geom["w"] <= 375, "hint wider than its viewport"
        assert geom["lines"] == 4, (
            f"375px: {geom['lines']} lines means the media block did not widen the "
            f"text box (width {geom['w']}px, maxW {geom['maxW']})"
        )
        assert not errors, f"JS errors: {errors}"

    def test_desktop_80vw_only_binds_when_under_600(self, browser, tmp_path):
        """The media block is scoped to max-width 480px, so at 768px the 80vw
        term must win again (384px). If the media query ever broadens, this
        pins where it is allowed to stop."""
        with use_page(self._make_page, browser, tmp_path, 768) as (page, errors):
            geom = self._geom(page, LONG_TEXT)
        assert geom["maxW"] == "480px"
        assert geom["w"] <= 768
        assert geom["lines"] == 2, f"768px wrapped to {geom['lines']} lines"
        assert not errors, f"JS errors: {errors}"
