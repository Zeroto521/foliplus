"""Build-artifact contract tests.

Verify the distribution artifacts follow the agreed naming and carry the
version banner. Skips when dist/ has not been built (e.g. source-only runs).
"""

from __future__ import annotations

from pathlib import Path

import pytest

import foliplus

COMPONENTS = (
    "ExportControl",
    "FullscreenControl",
    "HeatmapControl",
    "LayerControl",
    "LocateControl",
    "MeasureControl",
    "ScaleControl",
    "SearchControl",
)


def _dist() -> Path:
    return Path(foliplus.__file__).parent / "dist"


class TestBuildArtifacts:
    def test_component_artifacts_use_foliplus_prefix(self):
        dist = _dist()
        if not dist.exists():
            pytest.skip("dist/ not built")
        for name in COMPONENTS:
            js = dist / f"foliplus-{name}.min.js"
            assert js.exists(), f"missing {js.name}"

    def test_shared_artifacts_present(self):
        dist = _dist()
        if not dist.exists():
            pytest.skip("dist/ not built")
        assert (dist / "foliplus-common.min.js").exists()
        assert (dist / "foliplus-common.min.css").exists()

    def test_common_css_merges_panel_css(self):
        """Guard for the merged-CSS chain: common.min.css must include real
        content from BOTH common.css and panel.css, not just a bare banner.
        We assert on selectors that exist in exactly one source each."""
        dist = _dist()
        if not dist.exists():
            pytest.skip("dist/ not built")
        merged = (dist / "foliplus-common.min.css").read_text(encoding="utf-8")
        assert "foliplus-panel-header" in merged, "panel.css content missing from merge"
        assert "foliplus-hint" in merged, "common.css content missing from merge"

    def test_shared_bundle_contains_layer_code(self):
        """P5: core/layer lives in foliplus-common.min.js, not per-component."""
        dist = _dist()
        if not dist.exists():
            pytest.skip("dist/ not built")
        common = (dist / "foliplus-common.min.js").read_text(encoding="utf-8")
        assert "LayerFactory" in common, "shared bundle must include core/layer"

    def test_artifacts_carry_version_banner(self):
        dist = _dist()
        if not dist.exists():
            pytest.skip("dist/ not built")
        js = (dist / "foliplus-ExportControl.min.js").read_text(encoding="utf-8")
        assert js.lstrip().startswith("/*! foliplus@"), "version banner missing"
        css = (dist / "foliplus-common.min.css").read_text(encoding="utf-8")
        assert "foliplus@" in css, "CSS artifact missing version banner"
