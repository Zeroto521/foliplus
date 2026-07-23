"""Verify JS files contain valid Jinja2 template tags and render correctly."""

from __future__ import annotations

import re
from pathlib import Path

import folium
import pytest
from conftest import render

from foliplus import (
    Fullscreen,
    HeatmapControl,
    LayerControl,
    MapSearch,
    MeasureControl,
    ScaleControl,
)

JS_DIR = Path(__file__).parent.parent / "foliplus" / "js"

# All controls with their CONST.name value
_CONTROLS = {
    "Fullscreen": Fullscreen,
    "HeatmapControl": HeatmapControl,
    "LayerControl": LayerControl,
    "MapSearch": MapSearch,
    "MeasureControl": MeasureControl,
    "ScaleControl": ScaleControl,
}


class TestJinjaIntegrity:
    """Verify JS files contain valid Jinja2 template tags."""

    @pytest.fixture
    def js_files(self) -> list[Path]:
        return list(JS_DIR.glob("*.js"))

    def test_no_broken_jinja_tags(self, js_files: list[Path]):
        broken = [
            (r"\{ \{", "{{"),
            (r"\} \}", "}}"),
            (r"\{% -", "{%-"),
            (r"% \}", "%}"),
            (r"\{ %", "{%"),
        ]
        errors = []
        for f in js_files:
            content = f.read_text(encoding="utf-8")
            for pattern, correct in broken:
                if re.search(pattern, content):
                    errors.append(
                        f"Broken Jinja2 tag matching '{pattern}' in {f.name}. "
                        f"Should be '{correct}'."
                    )
        if errors:
            pytest.fail("\n".join(errors))

    def test_brace_balance(self, js_files: list[Path]):
        errors = []
        for f in js_files:
            content = f.read_text(encoding="utf-8")
            opens = content.count("{")
            closes = content.count("}")
            if opens != closes:
                errors.append(
                    f"{f.name}: {{ {opens} vs }} {closes} (diff={opens - closes})"
                )
        if errors:
            pytest.fail("Brace imbalance:\n" + "\n".join(errors))

    def test_all_components_render(self):
        m = folium.Map()
        components = [
            MapSearch(),
            LayerControl(),
            Fullscreen(),
            ScaleControl(),
            MeasureControl(),
            HeatmapControl(),
        ]
        try:
            for comp in components:
                comp.add_to(m)
            m.get_root().render()
        except Exception as e:
            pytest.fail(f"Render failed: {e}")

    def test_locale_injection(self):
        m = folium.Map()
        MapSearch(locale="zh").add_to(m)
        html = render(m)
        assert "MapSearch.coord_placeholder" in html
        assert '"zh"' in html

    def test_all_components_render_with_zh(self):
        """All components must render without error with Chinese locale."""
        m = folium.Map()
        components = [
            MapSearch(locale="zh"),
            LayerControl(locale="zh"),
            Fullscreen(locale="zh"),
            ScaleControl(locale="zh"),
            MeasureControl(locale="zh"),
            HeatmapControl(locale="zh"),
        ]
        try:
            for comp in components:
                comp.add_to(m)
            html = m.get_root().render()
        except Exception as e:
            pytest.fail(f"zh render failed: {e}")

        assert isinstance(html, str)
        assert len(html) > 0

    def test_const_name_consistency(self):
        """Each component's CONST.name matches its Python _name."""
        for expected_name, cls in _CONTROLS.items():
            instance = cls()
            assert instance._name == expected_name, (
                f"{cls.__name__}._name expected '{expected_name}', "
                f"got '{instance._name}'"
            )

    def test_runtime_error_keys_injected(self):
        """Runtime error keys (gcoord.warn) appear in HTML."""
        m = folium.Map()
        MapSearch().add_to(m)
        html = render(m)
        assert "gcoord.warn" in html

    def test_debounce_utility(self):
        """foliplus.debounce returns a debounced function with .cancel()."""
        m = folium.Map()
        MapSearch().add_to(m)
        html = render(m)
        assert "foliplus.debounce" in html
        assert "debounced.cancel" in html
        assert "clearTimeout(timer)" in html
