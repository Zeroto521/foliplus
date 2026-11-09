"""Browser tests for foliplus.LayerControl."""

from __future__ import annotations

import copy
import json
import re

import folium
from conftest import (
    _js,
    feature_collection,
    load_geojson,
    make_browser_page,
    panel_ready,
    point_feature,
    render,
)

from foliplus import LayerControl


class LayerControlBrowserBase:
    """Browser-level interaction checks for drag/drop feedback."""

    @staticmethod
    def _make_page(browser, tmp_path, *layers, slug="lc", **ctrl_kwargs):
        """Create a map with LayerControl, render, and return (page, errors).

        ``ctrl_kwargs`` are forwarded to ``LayerControl()`` so a browser test can
        exercise a non-default parameter (e.g. ``collapse_on_outside=True``).
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl(**ctrl_kwargs).add_to(m)
        for layer in layers:
            layer.add_to(m)
        html = m.get_root().render()
        # Expose the control instance for re-entry tests (dev build keeps names).
        html, n = re.subn(
            r"(new LayerControl\(\{ position: CONFIG\.position \}\)\.addTo\(map\);)",
            r"window.__layerCtrl = \1",
            html,
            count=1,
        )
        assert n == 1, "LayerControl instantiation not found in rendered HTML"
        page, errors = make_browser_page(browser, tmp_path, html, slug)
        page.wait_for_selector(".foliplus-layer-ctrl", state="attached", timeout=10000)
        return page, errors

    @staticmethod
    def _sample_token(page, name: str) -> str:
        """Computed color of a design token — never hardcode a hex/rgb."""
        return page.evaluate(_js("LayerControl/sample_token"), name)

    @staticmethod
    def _sample_surface(page):
        """Computed color of `var(--foliplus-surface)` — never hardcode a hex/rgb."""
        return LayerControlBrowserBase._sample_token(page, "--foliplus-surface")

    @staticmethod
    def _panel_open(page, selector: str) -> bool:
        """True while the panel at *selector* is expanded, not collapsed."""
        return page.evaluate(_js("LayerControl/panel_open"), selector)

    @staticmethod
    def _ramp_layer() -> folium.GeoJson:
        """A polygon layer with a numeric property, for the fill ramp mode."""
        return folium.GeoJson(
            json.dumps(load_geojson("common", "polygons_fuzhou_3offset")),
            name="Polygon data",
        )

    @staticmethod
    def _declared_ramp_layer() -> folium.GeoJson:
        """A polygon layer with a declared value fill (numeric property),
        so the style panel opens on the by-value mode and the method select
        is present. A plain layer with only a numeric property falls to the
        solid mode (no declared ramp), which has no method select."""
        data = copy.deepcopy(load_geojson("common", "polygons_fuzhou_3offset"))
        for i, feat in enumerate(data["features"]):
            feat["properties"] = {"score": 10 + i}
        return folium.GeoJson(
            json.dumps(data),
            name="Declared polygon data",
            style_function=lambda _f: {
                "fillColor": "#808080",
                "fillOpacity": 0.8,
                "color": "none",
            },
            foliplus={
                "fill": {
                    "field": "score",
                    "method": "equal",
                    "classes": 3,
                    "scheme": "Reds",
                }
            },
        )

    @staticmethod
    def _open_style_ramp(page) -> None:
        """Expand the control, wait for its init pass, then open ⋮ → Style."""
        page.evaluate(_js("LayerControl/open_panel"))
        page.wait_for_selector(
            ".foliplus-layer-ctrl.foliplus-is-expanded",
            state="attached",
            timeout=5000,
        )
        panel_ready(page)
        opened = page.evaluate(_js("LayerControl/open_style_panel"))
        assert opened["ok"], f"style panel did not open: {opened}"
        page.wait_for_selector(
            ".foliplus-layer-style-panel", state="visible", timeout=5000
        )

    @staticmethod
    def _declared_label_layer(name, label, coords, text="12345678901234567890"):
        """A point layer whose foliplus namespace declares its label defaults."""
        features = [point_feature(lng, lat, {"name": text}) for lat, lng in coords]
        return folium.GeoJson(
            json.dumps(feature_collection(*features)),
            name=name,
            foliplus={"label": label},
        )

    def _assert_toggle_all_deselect_title(self, title: str | None, label: str) -> None:
        """The toggle-all tooltip says "deselect all" in whatever locale it renders.

        CI is locale-neutral but a local browser can resolve `zh`, so accept the
        translated wording too — the contract is that the tooltip is the
        toggle-all action, never a layer name.
        """
        assert title and ("Deselect" in title or "隐藏" in title), (
            f"Expected {label} 'deselect all' tooltip, got {title!r}"
        )
