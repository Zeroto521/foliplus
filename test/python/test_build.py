"""Build-artifact contract tests.

Verify the distribution artifacts follow the agreed naming and carry the
version banner. Skips when dist/ has not been built (e.g. source-only runs).
"""

from __future__ import annotations

from pathlib import Path

import pytest

import foliplus

_PKG = Path(foliplus.__file__).parent
# Discover from the package so a scaffolded control is covered without
# hand-editing this tuple. BaseControl is the shared base, not a component.
COMPONENTS = tuple(
    sorted(p.stem for p in _PKG.glob("*Control.py") if p.stem != "BaseControl")
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

    def test_dist_css_has_layer_declaration(self):
        """The shipped stylesheets carry the cascade layer declaration.

        B1: the wa-* layer order is declared at the top of every foliplus
        stylesheet so the library's layers (loaded after via <link>) slot
        into a known order. The foliplus rules themselves stay **unlayered**
        on purpose: unlayered rules outrank every cascade layer, which is
        what keeps foliplus's skin winning over both wa-* layers and the
        host page's unlayered resets (Bootstrap). Wrapping foliplus in
        `@layer foliplus` demotes it below those resets — the T266
        regression (menu shell padding-left drift) this test guards against.
        """
        dist = _dist()
        if not dist.exists():
            pytest.skip("dist/ not built")
        for css_path in dist.glob("*.min.css"):
            css = css_path.read_text(encoding="utf-8")
            assert "@layer" in css, f"{css_path.name}: @layer declaration missing"
            assert "@layer foliplus {" not in css, (
                f"{css_path.name}: foliplus rules must stay unlayered (T266)"
            )
