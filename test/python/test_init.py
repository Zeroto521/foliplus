"""Tests for foliplus.__init__."""

from __future__ import annotations

import re

import foliplus
from foliplus._cdn import (
    CHROMA,
    GCOORD,
    H3,
    SS,
)


class TestVersion:
    def test_version_exists(self):
        assert hasattr(foliplus, "__version__")
        assert isinstance(foliplus.__version__, str)

    def test_all_exports(self):
        expected = [
            "BaseControl",
            "ExportControl",
            "FullscreenControl",
            "HeatmapControl",
            "LayerControl",
            "LocateControl",
            "SearchControl",
            "MeasureControl",
            "ScaleControl",
        ]
        for name in expected:
            assert hasattr(foliplus, name), f"Missing export: {name}"

    def test_all_matches_all(self):
        """__all__ must match actual public API."""
        expected = {
            "BaseControl",
            "ExportControl",
            "FullscreenControl",
            "HeatmapControl",
            "LayerControl",
            "LocateControl",
            "SearchControl",
            "MeasureControl",
            "ScaleControl",
        }
        assert set(foliplus.__all__) == expected


class TestCDN:
    """CDN dependency version tests."""

    def test_h3_js_version(self):
        assert H3 == "4"

    def test_SS(self):
        assert SS == "7"

    def test_chroma_js_version(self):
        assert CHROMA == "2"

    def test_GCOORD(self):
        assert GCOORD == "1"

    def test_cdn_urls_in_default_js(self):
        """All default_js URLs in controls with external dependencies follow expected format."""
        from foliplus import FullscreenControl, HeatmapControl, MeasureControl

        assert len(HeatmapControl.default_js) > 0
        for _, url in HeatmapControl.default_js:
            assert url.startswith("https://cdn.jsdelivr.net/npm/")
            assert "@" in url, f"Version missing in {url}"

        assert len(MeasureControl.default_js) > 0
        for _, url in MeasureControl.default_js:
            assert url.startswith("https://cdn.jsdelivr.net/npm/")
            assert "@" in url, f"Version missing in {url}"

        # Controls without external dependencies have empty default_js/css lists
        assert FullscreenControl.default_js == []
        assert FullscreenControl.default_css == []