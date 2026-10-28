"""Tests for foliplus.__init__."""

from __future__ import annotations

import foliplus


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
            "LocaleConfig",
            "LocateControl",
            "MeasureControl",
            "ScaleControl",
            "SearchControl",
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
            "LocaleConfig",
            "LocateControl",
            "MeasureControl",
            "ScaleControl",
            "SearchControl",
        }
        assert set(foliplus.__all__) == expected

    def test_type_aliases_are_usable_in_annotations(self):
        """The aliases carry the constraints @validate enforces."""
        from foliplus._typing import ControlPosition, Fraction, PositiveInt, Zoom

        assert "topleft" in ControlPosition.__args__  # Literal[...] membership
        for alias in (Zoom, PositiveInt, Fraction):
            assert hasattr(alias, "__metadata__")  # Annotated[...] alias

    def test_typing_helpers_are_internal(self):
        """The annotation aliases are not package attributes: they type the
        constructor signatures, nothing else re-exports them."""
        import foliplus._typing as typing_

        for name in ("ControlPosition", "Fraction", "PositiveInt", "Zoom"):
            assert hasattr(typing_, name), f"Missing alias: {name}"
            assert not hasattr(foliplus, name), f"Re-exported at the root: {name}"


class TestCDN:
    """CDN dependency version tests."""

    def test_cdn_urls_in_default_js(self):
        """All default_js URLs in controls with external dependencies follow expected format."""
        from foliplus import (
            ExportControl,
            FullscreenControl,
            HeatmapControl,
            MeasureControl,
        )

        for ctrl in (HeatmapControl, MeasureControl, ExportControl):
            assert len(ctrl.default_js) > 0, f"{ctrl.__name__} has no CDN deps"
            for _, url in ctrl.default_js:
                assert url.startswith("https://cdn.jsdelivr.net/npm/"), (
                    f"Bad URL: {url}"
                )
                assert "@" in url, f"Version missing in {url}"

        # Controls without external dependencies have empty default_js/css lists
        assert FullscreenControl.default_js == []
        assert FullscreenControl.default_css == []
