"""T59: headless-Chromium smoke for the test/js/browser probe corpus.

The probe files are not a test suite: each one is a JavaScript snippet that a
Python browser test injects through the conftest JS-snippet helper. Only the
probes some Python test happens to reference were exercised before, and the
only way to notice a probe that stopped parsing was to wait for that specific
test to run in the heavy browser suite.

This module gives the corpus its own bounded smoke:

* every probe is compiled by Chromium V8 with the same two-step rule
  Playwright applies (expression, then function body), and
* the two pure-DOM probes in BaseControl execute end-to-end, which proves the
  evaluate contract still works on a real page.

Marker: browser (the class name ends with Browser, so conftest
pytest_collection_modifyitems marks it). Skipped when Playwright is not
installed, exactly like the rest of the browser suite.
"""

from __future__ import annotations

from pathlib import Path

import folium
from conftest import _js, make_browser_page, use_page

# This file lives at test/python/infra/, one level deeper than conftest.py:
# walk up to test/ and into the probe corpus.
PROBE_ROOT = Path(__file__).resolve().parents[2] / "js" / "browser"

# Mirrors script/browser-probe.mjs: Playwright compiles the source as an
# expression first and falls back to a function body, so only a source that
# fails BOTH is unrunnable.
_PARSE_JS = """
(probes) =>
  probes.flatMap(({ name, source }) => {
    try {
      new Function("return (" + source + ")");
      return [];
    } catch (expressionError) {
      try {
        new Function(source);
        return [];
      } catch (bodyError) {
        return [name + ": " + bodyError.message];
      }
    }
  })
"""


def _probe_sources() -> list[dict[str, str]]:
    """Every probe file, name relative to test/js/browser and its source."""
    paths = sorted(PROBE_ROOT.rglob("*.js"), key=lambda path: path.as_posix())
    return [
        {
            "name": path.relative_to(PROBE_ROOT).as_posix(),
            "source": path.read_text(encoding="utf-8"),
        }
        for path in paths
    ]


class TestBrowserProbeCorpusBrowser:
    """T59 smoke: the probe corpus parses and its DOM probes execute."""

    @staticmethod
    def _make_page(browser, tmp_path):
        # A bare folium map is enough: the smoke needs a real page and headless
        # Chromium, not foliplus built assets (the CDN proxy serves folium own
        # scripts from the local cache).
        base_map = folium.Map(location=[26.08, 119.30], zoom_start=12)
        return make_browser_page(
            browser, tmp_path, base_map.get_root().render(), "probes"
        )

    def test_every_probe_parses_in_chromium(self, browser, tmp_path):
        """The whole corpus compiles under the Playwright evaluate contract."""
        sources = _probe_sources()
        assert len(sources) >= 400, (
            "probe corpus unexpectedly small — did test/js/browser move? "
            f"found {len(sources)} files under {PROBE_ROOT}"
        )

        with use_page(self._make_page, browser, tmp_path) as (page, _errors):
            failures = page.evaluate(_PARSE_JS, sources)

        assert failures == [], (
            f"{len(failures)} probe(s) no longer compile in Chromium: {failures[:10]}"
        )

    def test_pure_dom_probes_execute_headless(self, browser, tmp_path):
        """The evaluate round-trip works on a real page, not just the parser."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            assert page.evaluate(_js("BaseControl/button_probe")) == [
                "tb",
                "tool",
                "panel",
            ]
            radius = page.evaluate(_js("BaseControl/read_border_radius"), "#tb")
            assert isinstance(radius, str) and radius, (
                f"read_border_radius did not return a computed radius: {radius!r}"
            )
            assert page.locator("#tb").count() == 1

        assert errors == [], f"console errors during probe smoke: {errors}"


__all__ = ["TestBrowserProbeCorpusBrowser"]
