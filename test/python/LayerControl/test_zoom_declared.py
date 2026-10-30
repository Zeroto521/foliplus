"""Rendering tests for the declared zoom range (CONFIG data[].zoom).

The declaration is the layer's own foliplus={"zoom": {...}} namespace - a
folium passthrough onto layer.options - which Python normalises into CONF so
the visibility policy reads one fact. These tests assert the shipped payload
and the warnings a misspelled or malformed declaration produces; the policy
itself is covered by the JS projection tests.
"""

from __future__ import annotations

import json
import warnings
from pathlib import Path

import folium
import pytest

from foliplus import LayerControl


def _render(*layers: folium.Layer) -> str:
    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    for layer in layers:
        layer.add_to(m)
    LayerControl().add_to(m)
    return m.get_root().render()


def _conf(html: str) -> dict:
    marker = "CONFIG = "
    start = html.index(marker) + len(marker)
    end = html.index(";", start)
    return json.loads(html[start:end])


def _geo(name: str = "Declared", **options: object) -> folium.GeoJson:
    return folium.GeoJson(
        {"type": "FeatureCollection", "features": []}, name=name, **options
    )


def test_declared_zoom_reaches_conf():
    entry = _conf(_render(_geo(foliplus={"zoom": {"min": 8, "max": 12}})))["data"][0]

    assert entry["zoom"] == {"min": 8, "max": 12}


def test_undeclared_layer_has_no_zoom_key():
    entry = _conf(_render(_geo()))["data"][0]

    assert "zoom" not in entry


def test_other_foliplus_keys_stay_a_js_side_namespace():
    # fill / label are read by the panel off layer.options.foliplus; only
    # zoom is normalised into CONF.
    entry = _conf(_render(_geo(foliplus={"fill": {"ramp": {"field": "score"}}})))[
        "data"
    ][0]

    assert "zoom" not in entry


@pytest.mark.parametrize(
    "declaration",
    [
        {"zoom": {"min": 12, "max": 8}},
        {"zoom": {"min": 8}},
        {"zoom": {"min": 8.5, "max": 12}},
        {"zoom": {"min": True, "max": 12}},
        {"zoom": {"min": "8", "max": "12"}},
        {"zoom": {"min": 8, "max": 12, "step": 1}},
        {"zoom": [8, 12]},
    ],
)
def test_invalid_zoom_is_dropped_with_a_warning(declaration):
    with pytest.warns(UserWarning, match="foliplus"):
        html = _render(_geo(foliplus=declaration))

    entry = _conf(html)["data"][0]
    assert "zoom" not in entry
    # An invalid declaration is ignored, never fatal: the layer still renders.
    assert entry["name"] == "Declared"


def test_unknown_key_warns_once_per_layer():
    # One typo on three layers is three attributable warnings, not one: the
    # de-duplication note carries the layer name (see _warn_foliplus), so a
    # reader can tell which layer holds the misspelled key.
    layers = [
        _geo(name=f"L{i}", foliplus={"zooom": {"min": 1, "max": 2}}) for i in range(3)
    ]

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        _render(*layers)

    unknown = [w for w in caught if "unknown foliplus key" in str(w.message)]
    assert len(unknown) == 3
    for index, warning in enumerate(unknown):
        assert f"layer 'L{index}'" in str(warning.message)
        assert "'zooom'" in str(warning.message)


def test_a_repeated_render_repeats_no_declaration_warning():
    # The log filter lives for the process (#781's convention, reused here):
    # re-rendering the same page must not print the same line again.
    layers = [
        _geo(name=f"Repeat{i}", foliplus={"zooom": {"min": 1, "max": 2}})
        for i in range(2)
    ]

    with warnings.catch_warnings(record=True) as first:
        warnings.simplefilter("always")
        _render(*layers)

    with warnings.catch_warnings(record=True) as second:
        warnings.simplefilter("always")
        _render(*layers)

    assert len([w for w in first if "unknown foliplus key" in str(w.message)]) == 2
    assert [w for w in second if "unknown foliplus key" in str(w.message)] == []


def test_a_warning_points_at_the_calling_cell():
    # The declaration is written in the user's own cell, so the warning has to
    # name that file: a warning pointing inside the library is not actionable
    # where the author can see it. Same contract as
    # _declared_filter._caller_stacklevel on the declared-filter branch
    # (#805); the walk lives in _caller_stacklevel here.
    with pytest.warns(UserWarning) as record:
        _render(_geo(name="Blame", foliplus={"zooom": {"min": 1, "max": 2}}))

    assert Path(record[0].filename).resolve() == Path(__file__).resolve()


def test_non_mapping_namespace_warns_and_is_ignored():
    with pytest.warns(UserWarning, match="expected a mapping"):
        html = _render(_geo(foliplus=["zoom"]))

    assert "zoom" not in _conf(html)["data"][0]


def test_declared_zoom_does_not_touch_leaflet_zoom_options():
    # The declaration is a policy fact in CONF, never a Leaflet option:
    # foliplus does not write layer.options.minZoom/maxZoom.
    layer = _geo(foliplus={"zoom": {"min": 8, "max": 12}})

    _render(layer)

    assert "minZoom" not in layer.options
    assert "maxZoom" not in layer.options
    assert layer.options["foliplus"] == {"zoom": {"min": 8, "max": 12}}


def test_non_mapping_fill_namespace_warns_and_is_ignored():
    # fill / label are the JS panel's namespace: a non-mapping value cannot
    # be a config object, so it is reported once and left to the panel. zoom
    # stays independent of that shape check.
    with pytest.warns(UserWarning, match=r"foliplus\['fill'\]"):
        html = _render(_geo(foliplus={"fill": "red"}))

    entry = _conf(html)["data"][0]
    assert "zoom" not in entry
    assert entry["name"] == "Declared"
