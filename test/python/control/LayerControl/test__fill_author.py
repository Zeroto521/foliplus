"""Split of test__fill_author.py by dimension."""

from __future__ import annotations

import importlib

import json

import branca.colormap as branca_cm

import folium

import pytest

from conftest import (
    _js,
    feature_collection,
    load_geojson,
    make_browser_page,
    panel_ready,
    point_feature,
    use_page,
)

from foliplus import LayerControl

_SCORES = [10.0, 11.0, 12.0, 13.0, 14.0, 15.0]

_NOTE = (
    "Colors set per feature by geopandas.GeoDataFrame.explore. "
    "Editing the fill overrides them; Reset restores them."
)

_ORIGINAL = "Original Colors"

_DECLARED_NAME = "Facility Points"

_DECLARED_SCORES = [10, 20, 30, 40, 50, 60]

_ARM = _js("LayerControl/fill_author_variant")

_READ_FILL = _js("LayerControl/fill_author_read")

_PARITY = _js("LayerControl/control_inset_parity")

_PICK_SCHEME = _js("LayerControl/pick_fill_scheme")

_READ_FILL_METHOD = _js("LayerControl/read_fill_method")

_DECLARED_READ = _js("LayerControl/fill_declared_read")

_layer_control_mod = importlib.import_module(
    "foliplus.control.LayerControl._fill_author"
)

_scale_mod = importlib.import_module("foliplus.control.LayerControl._fill_author.scale")

_colormap_mod = importlib.import_module(
    "foliplus.control.LayerControl._fill_author.colormap"
)

_payload_mod = importlib.import_module(
    "foliplus.control.LayerControl._fill_author.payload"
)

def _collection(
    colors: list[str | None],
    *,
    column: str = "score",
    values: list[float] | None = None,
) -> dict:
    features: list[dict] = []
    for i, color in enumerate(colors):
        props: dict[str, object] = {
            column: float(i) if values is None else values[i],
        }
        if color is not None:
            props["__folium_color"] = color
        features.append(point_feature(119.30 + i * 0.01, 26.08, props))
    return feature_collection(*features)

def _geo(
    colors: list[str | None],
    *,
    column: str = "score",
    values: list[float] | None = None,
    style: bool = True,
    name: str = "Facility Points",
) -> folium.GeoJson:
    layer = folium.GeoJson(_collection(colors, column=column, values=values), name=name)
    if style:
        layer.style_function = lambda feature: {
            "fillColor": feature["properties"].get("__folium_color", "#3388ff"),
        }
    return layer

def _linear(
    colors: tuple[str, ...] = ("#0d0887", "#f0f921"),
    *,
    vmin: float = 0,
    vmax: float = 100,
    caption: str = "score",
) -> branca_cm.LinearColormap:
    """A continuous scale with the 256-point resolution explore produces."""
    base = branca_cm.LinearColormap(list(colors), vmin=vmin, vmax=vmax)
    # branca emits #rrggbbaa on call and only parses #rrggbb at construction.
    dense = [str(base(vmin + (vmax - vmin) * step / 255))[:7] for step in range(256)]
    return branca_cm.LinearColormap(dense, vmin=vmin, vmax=vmax, caption=caption)

def _stepped(
    colors: tuple[str, ...] = ("#440154", "#3b528b", "#21918c", "#fde725"),
    *,
    index: tuple[float, ...] = (0, 25, 50, 75, 100),
    caption: str = "score",
) -> branca_cm.StepColormap:
    return branca_cm.StepColormap(list(colors), index=list(index), caption=caption)

def _render(*layers: folium.Layer, scales: tuple[object, ...] = ()) -> str:
    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    for scale in scales:
        scale.add_to(m)  # type: ignore[attr-defined]
    for layer in layers:
        layer.add_to(m)
    LayerControl().add_to(m)
    return m.get_root().render()

def _conf(html: str) -> dict:
    marker = "CONFIG = "
    start = html.index(marker) + len(marker)
    end = html.index(";", start)
    return json.loads(html[start:end])

def _meta(layer: folium.GeoJson, *scales: object) -> dict:
    html = _render(layer, scales=tuple(scales))
    return _conf(html)["data"][0]["fillAuthor"]

def _scale() -> branca_cm.LinearColormap:
    """A continuous scale with the 256-point resolution explore produces."""
    base = branca_cm.LinearColormap(["#0d0887", "#f0f921"], vmin=10, vmax=15)
    dense = [str(base(10 + 5 * step / 255))[:7] for step in range(256)]
    return branca_cm.LinearColormap(dense, vmin=10, vmax=15, caption="score")

def _layer(scale: branca_cm.LinearColormap) -> folium.GeoJson:
    colors = [str(scale(score))[:7] for score in _SCORES]
    data = load_geojson("common", "polygons_fuzhou_6offset")
    for i, (feat, color, score) in enumerate(
        zip(data["features"], colors, _SCORES, strict=True)
    ):
        feat["properties"] = {"__folium_color": color, "cat": f"c{i}", "score": score}
    return folium.GeoJson(
        json.dumps(data),
        name="Facility Points",
        style_function=lambda f: {
            "fillColor": f["properties"]["__folium_color"],
            "fillOpacity": 0.8,
            "color": "none",
        },
    )

def _make_author_page(browser, tmp_path):
    scale = _scale()
    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    scale.add_to(m)
    _layer(scale).add_to(m)
    LayerControl(locale="en").add_to(m)
    return make_browser_page(browser, tmp_path, m.get_root().render(), "fill_author")

def _open_author_style_panel(page):
    """Open the row's style drawer: the more menu, then the style entry."""
    page.evaluate(_js("LayerControl/open_panel"))
    opened = page.evaluate(_ARM)
    assert opened["ok"], f"style panel did not open: {opened}"
    page.wait_for_selector(".foliplus-layer-style-panel", state="visible", timeout=5000)

def _declared_layer() -> folium.GeoJson:
    data = load_geojson("common", "polygons_fuzhou_6offset")
    for feat, score in zip(data["features"], _DECLARED_SCORES, strict=True):
        feat["properties"] = {"score": score}
    return folium.GeoJson(
        json.dumps(data),
        name=_DECLARED_NAME,
        style_function=lambda _feature: {
            "fillColor": "#808080",
            "fillOpacity": 0.8,
            "color": "none",
        },
        foliplus={
            "fill": {
                "field": "score",
                "scheme": "Reds",
                "method": "equal",
                "classes": 3,
            }
        },
    )

def _make_declared_page(browser, tmp_path):
    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    _declared_layer().add_to(m)
    LayerControl(locale="en").add_to(m)
    return make_browser_page(browser, tmp_path, m.get_root().render(), "declared_fill")

def _open_declared_style_panel(page) -> None:
    page.evaluate(_js("LayerControl/open_panel"))
    page.wait_for_selector(
        ".foliplus-layer-ctrl.foliplus-is-expanded",
        state="attached",
        timeout=5000,
    )
    panel_ready(page)
    opened = page.evaluate(_ARM)
    assert opened["ok"], f"style panel did not open: {opened}"
    page.wait_for_selector(".foliplus-layer-style-panel", state="visible", timeout=5000)

def test_scale_controls_are_reachable_through_a_feature_group():
    # A control attached to a FeatureGroup sits one level below the map; the
    # scale walk must climb, or the declaration is silently lost.
    scale = _linear()
    values = [10.0, 40.0, 90.0]
    layer = _geo([str(scale(value))[:7] for value in values], values=values)

    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    scale.add_to(m)  # type: ignore[attr-defined]
    group = folium.FeatureGroup(name="group")
    layer.add_to(group)
    control = LayerControl()
    group.add_child(control)
    m.add_child(group)
    html = m.get_root().render()
    entry = _conf(html)["data"][0]

    assert entry["fillAuthor"]["scale"]["column"] == "score"

def test_scale_does_not_read_a_map_it_is_not_attached_to():
    scale = _linear()
    values = [10.0, 40.0, 90.0]
    colors = [str(scale(value))[:7] for value in values]
    layer = _geo(colors, values=values)
    # The scale lives on another map entirely: nothing may pair.
    other = folium.Map()
    scale.add_to(other)  # type: ignore[attr-defined]
    html = _render(layer)
    entry = _conf(html)["data"][0]

    assert "scale" not in entry["fillAuthor"]
