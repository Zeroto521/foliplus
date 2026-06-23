"""Tests for foliplus.__init__."""

from __future__ import annotations

import foliplus


class TestVersion:
    def test_version_exists(self):
        assert hasattr(foliplus, "__version__")
        assert isinstance(foliplus.__version__, str)

    def test_all_exports(self):
        expected = [
            "Fullscreen", "HeatmapControl", "LayerControl",
            "MapSearch", "MeasureControl", "ScaleControl",
            "EN", "ZH", "LocaleConfig", "detect_language",
        ]
        for name in expected:
            assert hasattr(foliplus, name), f"Missing export: {name}"
