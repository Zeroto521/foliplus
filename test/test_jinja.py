"""Verify JS files contain valid Jinja2 template tags and render correctly."""

from __future__ import annotations

import re
from pathlib import Path

import folium
import pytest

from foliplus import (
    Fullscreen, HeatmapControl, LayerControl,
    MapSearch, MeasureControl, ScaleControl,
)

JS_DIR = Path(__file__).parent.parent / "foliplus" / "js"


class TestJinjaIntegrity:
    """Verify JS files contain valid Jinja2 template tags."""

    @pytest.fixture
    def js_files(self) -> list[Path]:
        return list(JS_DIR.glob("*.js"))

    def test_no_broken_jinja_tags(self, js_files: list[Path]):
        broken = [
            (r"\{ \{", "{{"), (r"\} \}", "}}"),
            (r"\{% -", "{%-"), (r"% \}", "%}"),
            (r"\{ %", "{%"),
        ]
        errors = []
        for f in js_files:
            content = f.read_text(encoding="utf-8")
            for pattern, correct in broken:
                if re.search(pattern, content):
                    errors.append(
                        f"Broken Jinja2 tag matching '{pattern}' in {f.name}. "
                        f"Should be '{correct}'.")
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
                    f"{f.name}: {{ {opens} vs }} {closes} "
                    f"(diff={opens - closes})")
        if errors:
            pytest.fail("Brace imbalance:\n" + "\n".join(errors))

    def test_all_components_render(self):
        m = folium.Map()
        components = [
            MapSearch(), LayerControl(), Fullscreen(),
            ScaleControl(), MeasureControl(), HeatmapControl(),
        ]
        try:
            for comp in components:
                comp.add_to(m)
            m.get_root().render()
        except Exception as e:
            pytest.fail(f"Render failed: {e}")

    def test_locale_injection(self):
        from conftest import render
        from foliplus import ZH
        m = folium.Map()
        MapSearch(locale=ZH).add_to(m)
        html = render(m)
        assert "search.coord_placeholder" in html
        assert '"zh"' in html
