"""Verify JS files contain valid Jinja2 template tags and render correctly."""

from __future__ import annotations

import re
from pathlib import Path

import folium
import pytest
from conftest import render

from foliplus import (
    ExportControl,
    FullscreenControl,
    HeatmapControl,
    LayerControl,
    LocateControl,
    MeasureControl,
    ScaleControl,
    SearchControl,
)
from foliplus.BaseControl import _load_asset, control_assets
from textwrap import dedent

# All controls with their CONST.name value
_CONTROLS = {
    "ExportControl": ExportControl,
    "FullscreenControl": FullscreenControl,
    "HeatmapControl": HeatmapControl,
    "LayerControl": LayerControl,
    "LocateControl": LocateControl,
    "SearchControl": SearchControl,
    "MeasureControl": MeasureControl,
    "ScaleControl": ScaleControl,
}


class TestJinjaIntegrity:
    """Verify BaseControl templates contain valid Jinja2 template tags."""

    @pytest.fixture
    def template_sources(self) -> dict[str, str]:
        """Build template source strings for all controls."""
        sources = {}
        for name in _CONTROLS:
            js_artifact, css_artifact = control_assets(name)
            js = _load_asset(js_artifact)
            css = _load_asset(css_artifact)
            sources[name] = dedent(f"""
    {{% macro html(this, kwargs) %}}
    <style>
    {css}
    </style>
    {{% endmacro %}}

    {{% macro script(this, kwargs) %}}
    (() => {{
    const map = {{{{ this._parent.get_name() }}}};
    const CONF = {{{{ this._config_block | safe }}}};
    {js}
    }})();
    {{% endmacro %}}
""")
        return sources

    def test_no_broken_jinja_tags(self, template_sources: dict[str, str]):
        broken = [
            (r"\{ \{", "{{"),
            (r"\{% -", "{%-"),
            (r"% \}", "%}"),
            (r"\{ %", "{%"),
        ]
        errors = []
        for name, source in template_sources.items():
            for pattern, correct in broken:
                if re.search(pattern, source):
                    errors.append(
                        f"Broken Jinja2 tag matching '{pattern}' in {name}. "
                        f"Should be '{correct}'."
                    )
        if errors:
            pytest.fail("\n".join(errors))

    def test_brace_balance(self, template_sources: dict[str, str]):
        errors = []
        for name, source in template_sources.items():
            opens = source.count("{")
            closes = source.count("}")
            if opens != closes:
                errors.append(
                    f"{name}: {{ {opens} vs }} {closes} (diff={opens - closes})"
                )
        if errors:
            pytest.fail("Brace imbalance:\n" + "\n".join(errors))

    def test_all_components_render(self):
        m = folium.Map()
        components = [
            SearchControl(),
            LayerControl(),
            FullscreenControl(),
            ScaleControl(),
            MeasureControl(),
            HeatmapControl(),
            ExportControl(),
            LocateControl(),
        ]
        try:
            for comp in components:
                comp.add_to(m)
            m.get_root().render()
        except Exception as e:
            pytest.fail(f"Render failed: {e}")

    def test_locale_injection(self):
        m = folium.Map()
        SearchControl(locale="zh").add_to(m)
        html = render(m)
        assert "SearchControl.coord_placeholder" in html
        assert '"zh"' in html

    def test_all_components_render_with_zh(self):
        """All components must render without error with Chinese locale."""
        m = folium.Map()
        components = [
            SearchControl(locale="zh"),
            LayerControl(locale="zh"),
            FullscreenControl(locale="zh"),
            ScaleControl(locale="zh"),
            MeasureControl(locale="zh"),
            HeatmapControl(locale="zh"),
            ExportControl(locale="zh"),
            LocateControl(locale="zh"),
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
