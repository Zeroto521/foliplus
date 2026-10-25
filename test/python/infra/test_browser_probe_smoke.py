"""Headless-Chromium smoke for the test/js/browser probe corpus.

The probe files are not a test suite: each one is a JavaScript snippet that a
Python browser test injects through the conftest JS-snippet helper. Only the
probes some Python test happens to reference were exercised before, and the
only way to notice a probe that stopped parsing was to wait for that specific
test to run in the heavy browser suite.

This module gives the corpus its own bounded smoke:

* every probe is compiled by Chromium V8 with the same two-step rule
  Playwright applies (expression, then function body), using the shared
  helper test/js/browser/_parse_probe.js; and
* the two pure-DOM probes in BaseControl execute end-to-end, which proves the
  evaluate contract still works on a real page.

Both checks run on a raw page: they only need document.body, not a folium map,
the CDN cache, or the built assets. That keeps this job independent of the
heavy browser suite and its navigation timeouts.

Marker: browser (the class name ends with Browser, so conftest
pytest_collection_modifyitems marks it). Skipped when Playwright is not
installed, exactly like the rest of the browser suite.
"""

from __future__ import annotations

from pathlib import Path

from conftest import _js, use_raw_page

# This file lives at test/python/infra/, one level deeper than conftest.py:
# walk up to test/ and into the probe corpus.
PROBE_ROOT = Path(__file__).resolve().parents[2] / "js" / "browser"


def _probe_sources() -> list[dict[str, str]]:
    """Probe sources by name, skipping `_`-prefixed support helpers."""
    paths = sorted(PROBE_ROOT.rglob("*.js"), key=lambda path: path.as_posix())
    return [
        {
            "name": path.relative_to(PROBE_ROOT).as_posix(),
            "source": path.read_text(encoding="utf-8"),
        }
        for path in paths
        if not path.name.startswith("_")
    ]


class TestBrowserProbeCorpusBrowser:
    """The corpus compiles in Chromium and its pure-DOM probes execute."""

    def test_every_probe_parses_in_chromium(self, browser):
        """The whole corpus compiles under the Playwright evaluate contract."""
        sources = _probe_sources()
        assert len(sources) >= 400, (
            "probe corpus unexpectedly small — did test/js/browser move? "
            f"found {len(sources)} files under {PROBE_ROOT}"
        )

        with use_raw_page(browser.new_page) as page:
            failures = page.evaluate(_js("_parse_probe"), sources)

        assert failures == [], (
            f"{len(failures)} probe(s) no longer compile in Chromium: {failures[:10]}"
        )

    def test_pure_dom_probes_execute_headless(self, browser):
        """The evaluate round-trip works on a real page, not just the parser."""
        with use_raw_page(browser.new_page) as page:
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
