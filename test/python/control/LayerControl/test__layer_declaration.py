"""The layer-side declaration namespace: ``foliplus={...}`` on a layer.

A layer declares its own defaults rather than the control: the dict is a folium
passthrough onto layer.options, and each key is read by whichever side owns it.
``zoom_range`` is normalised by Python into CONF so the visibility policy reads
one fact; ``label`` stays a JS-side namespace that the annotation manager reads
off the layer. These tests assert the shipped payload, the layer channel that
carries it, and the warnings a misspelled or malformed declaration produces; the
policy itself is covered by the JS projection tests.

That documented channel is also what pins the supported floor — folium only
forwards those kwargs onto a layer's options from 0.15 on.
"""

from __future__ import annotations

import json
import warnings
from pathlib import Path

import folium
import pytest

from foliplus import LayerControl
from foliplus.control.LayerControl._layer_declaration import (
    FOLIPLUS_KEYS,
    declared_folder,
    declared_zoom_range,
)

_EMPTY = json.dumps({"type": "FeatureCollection", "features": []})


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
    entry = _conf(_render(_geo(foliplus={"zoom_range": {"min": 8, "max": 12}})))[
        "data"
    ][0]

    assert entry["zoomRange"] == {"min": 8, "max": 12}


def test_undeclared_layer_has_no_zoom_key():
    entry = _conf(_render(_geo()))["data"][0]

    assert "zoomRange" not in entry


def test_the_old_zoom_key_is_unknown_and_ignored():
    # The rename is not a compatibility alias: `zoom` is now just a typo and
    # must not reach CONF, where the policy would still honour it.
    with pytest.warns(UserWarning, match="unknown foliplus key 'zoom'"):
        html = _render(_geo(foliplus={"zoom": {"min": 8, "max": 12}}))

    assert "zoomRange" not in _conf(html)["data"][0]


def test_other_foliplus_keys_stay_a_js_side_namespace():
    # fill / label are read by the panel off layer.options.foliplus; only
    # zoom_range is normalised into CONF.
    entry = _conf(_render(_geo(foliplus={"fill": {"ramp": {"field": "score"}}})))[
        "data"
    ][0]

    assert "zoomRange" not in entry


@pytest.mark.parametrize(
    "declaration",
    [
        # One shape per failure class: ordering, endpoint type, structure. The
        # full per-reason matrix (and its exact wording) is pinned on the reader
        # in test/python/test__declaration.py; here the claim is the wiring -
        # a rejected declaration still renders and CONF stays undeclared.
        {"zoom_range": {"min": 12, "max": 8}},
        {"zoom_range": {"min": 8.5, "max": 12}},
        {"zoom_range": [8, 12]},
    ],
)
def test_invalid_zoom_is_dropped_with_a_warning(declaration):
    with pytest.warns(UserWarning, match="foliplus"):
        html = _render(_geo(foliplus=declaration))

    entry = _conf(html)["data"][0]
    assert "zoomRange" not in entry
    # An invalid declaration is ignored, never fatal: the layer still renders.
    assert entry["name"] == "Declared"


def test_unknown_key_warns_once_per_layer():
    # One typo on three layers is three attributable warnings, not one: the
    # de-duplication note carries the layer name (see warn_foliplus), so a
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
    # where the author can see it. Same contract as the declared-filter branch
    # (#805): one shared frame walk in _declaration.caller_stacklevel, so both
    # entry points blame the author's cell.
    with pytest.warns(UserWarning) as record:
        _render(_geo(name="Blame", foliplus={"zooom": {"min": 1, "max": 2}}))

    assert Path(record[0].filename).resolve() == Path(__file__).resolve()


def test_non_mapping_namespace_warns_and_is_ignored():
    with pytest.warns(UserWarning, match="expected a mapping"):
        html = _render(_geo(foliplus=["zoom_range"]))

    assert "zoomRange" not in _conf(html)["data"][0]


def test_declared_zoom_does_not_touch_leaflet_zoom_options():
    # The declaration is a policy fact in CONF, never a Leaflet option:
    # foliplus does not write layer.options.minZoom/maxZoom.
    layer = _geo(foliplus={"zoom_range": {"min": 8, "max": 12}})

    _render(layer)

    assert "minZoom" not in layer.options
    assert "maxZoom" not in layer.options
    assert layer.options["foliplus"] == {"zoom_range": {"min": 8, "max": 12}}


def test_non_mapping_fill_namespace_warns_and_is_ignored():
    # fill / label are the JS panel's namespace: a non-mapping value cannot
    # be a config object, so it is reported once and left to the panel.
    # zoom_range stays independent of that shape check.
    with pytest.warns(UserWarning, match=r"foliplus\['fill'\]"):
        html = _render(_geo(foliplus={"fill": "red"}))

    entry = _conf(html)["data"][0]
    assert "zoomRange" not in entry
    assert entry["name"] == "Declared"


# --- Direct unit tests for declared_zoom_range() ---------------------------


def test_declared_zoom_range_returns_normalised_bounds():
    layer = _geo(foliplus={"zoom_range": {"min": 8, "max": 12}})
    assert declared_zoom_range(layer, "Declared") == {"min": 8, "max": 12}


def test_declared_zoom_range_undeclared_layer_is_none():
    layer = _geo()
    assert declared_zoom_range(layer, "Declared") is None


def test_declared_zoom_range_invalid_is_dropped():
    layer = _geo(foliplus={"zoom_range": {"min": "eight"}})
    assert declared_zoom_range(layer, "Declared") is None


# --- The layer is its own declaration channel ------------------------------


def test_label_key_reaches_the_layer_options() -> None:
    """The documented author channel lands the declaration on the layer."""
    m = folium.Map()
    ctrl = LayerControl().add_to(m)
    layer = folium.GeoJson(
        _EMPTY, name="declared", foliplus={"label": {"field": "name"}}
    )
    layer.add_to(ctrl)

    # folium's typing does not declare `options` on a Layer, hence the
    # defensive read; the constructor above is what pins the supported floor.
    options = getattr(layer, "options", {})
    assert options.get("foliplus") == {"label": {"field": "name"}}

    data = ctrl._extra_config()["data"]  # type: ignore[attr-defined]


# --- Folder declaration (D1) -------------------------------------------------


def test_declared_folder_reaches_conf():
    entry = _conf(_render(_geo(foliplus={"folder": "North"})))["data"][0]
    assert entry["folder"] == "North"


def test_undeclared_layer_has_no_folder_key():
    entry = _conf(_render(_geo()))["data"][0]
    assert "folder" not in entry


def test_blank_folder_is_dropped_with_a_warning():
    with pytest.warns(UserWarning, match="expected a non-empty string"):
        html = _render(_geo(foliplus={"folder": "   "}))
    entry = _conf(html)["data"][0]
    assert "folder" not in entry
    assert entry["name"] == "Declared"


def test_non_string_folder_is_dropped_with_a_warning():
    with pytest.warns(UserWarning, match="expected a non-empty string"):
        html = _render(_geo(foliplus={"folder": {"name": "x"}}))
    entry = _conf(html)["data"][0]
    assert "folder" not in entry


def test_duplicate_folder_warns_once_per_declaring_layer():
    # Two layers declaring the same folder is an ambiguous grouping: neither
    # may adopt the folder, and each declaring layer is warned so the defect
    # is attributable (one warning per layer, not one per defect).
    layers = [_geo(name=f"L{i}", foliplus={"folder": "Shared"}) for i in range(2)]
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        html = _render(*layers)

    dup = [w for w in caught if "ambiguous" in str(w.message)]
    assert len(dup) == 2
    for index, warning in enumerate(dup):
        assert f"layer 'L{index}'" in str(warning.message)
    # The ambiguous folder is not adopted by either layer.
    data = _conf(html)["data"]
    assert all("folder" not in entry for entry in data)


def test_foliplus_keys_contains_folder():
    # The folder key is accepted by the declaration namespace: a regression
    # here would turn a valid folder declaration into an "unknown key" warning.
    assert "folder" in FOLIPLUS_KEYS


# --- Direct unit tests for declared_folder() --------------------------------


def test_declared_folder_returns_normalised_name():
    layer = _geo(foliplus={"folder": "  North  "})
    assert declared_folder(layer, "Declared") == "North"


def test_declared_folder_undeclared_layer_is_none():
    layer = _geo()
    assert declared_folder(layer, "Declared") is None


def test_declared_folder_blank_is_none():
    layer = _geo(foliplus={"folder": "   "})
    assert declared_folder(layer, "Declared") is None


def test_declared_folder_non_string_is_none():
    layer = _geo(foliplus={"folder": 5})
    assert declared_folder(layer, "Declared") is None
