from __future__ import annotations

from typing import Optional

from .base import BaseControl
from .locale import LocaleConfig


class HeatmapControl(BaseControl):
    """H3 hexbin aggregation heatmap control.

    **Auto-discovers** all overlay layers containing points
    (Marker / CircleMarker / GeoJSON Point) in the layer control panel.
    When a layer is selected, it aggregates points into H3 hexagons in real-time
    via `h3-js <https://github.com/uber/h3-js>`_. Grid resolution adjusts
    automatically with zoom level. Hover to see aggregated values; the panel
    footer shows data summary and a gradient legend.

    Aggregation method (count/sum) and classification method (natural breaks /
    equal interval) are switchable in the UI. Python-side only provides
    style and color scheme configuration.

    Parameters
    ----------
    position : str, default "topleft"
        Panel position. One of ``"topleft"``, ``"topright"``,
        ``"bottomleft"``, ``"bottomright"``.
    color_scheme : str, default "Blues"
        Default color scheme name. Supports chroma.js / ColorBrewer palettes:
        ``Blues``, ``Greens``, ``Reds``, ``Oranges``, ``Purples``,
        ``YlOrRd``, ``Viridis``.
    method : str, default "jenks"
        Default classification method: ``"jenks"`` (natural breaks),
        ``"quantile"``, ``"equal"`` (equal interval), ``"heads"``.
    n_classes : int, default 6
        Number of classification classes, range 2-9.
    agg : str, default "count"
        Default aggregation method: ``"count"``, ``"sum"``, ``"avg"``,
        ``"min"``, ``"max"``.
    schemes : list[str], optional
        List of available color scheme names. Can include custom hex values
        like ``["#f00", "#0f0", "#00f"]``.
    style : dict, optional
        Grid style overrides. Supported keys:
        - ``border_weight`` (float, default 1.5): border width
        - ``border_color`` (str, default "#333333"): border color
        - ``fill_opacity`` (float, default 0.7): fill opacity
        - ``border_opacity`` (float, default 0.9): border opacity
        - ``label_show`` (bool, default True): show aggregated value at hex center
        - ``label_size`` (int, default 11): label font size
        - ``label_color`` (str, default "#fff"): label color
        - ``label_format`` (str, default "auto"): number format —
          ``"auto"`` (10K/1K suffix), ``"int"``, ``"comma"`` (thousands separator)
    locale : LocaleConfig, optional
        Localization configuration. Defaults to English.

    Examples
    --------
    >>> import folium
    >>> from foliplus import HeatmapControl
    >>> m = folium.Map()
    >>> HeatmapControl(position="topleft").add_to(m)
    """

    default_js = [
        ("h3-js", "https://cdn.jsdelivr.net/npm/h3-js@4/dist/h3-js.umd.js"),
        (
            "simple-statistics",
            "https://cdn.jsdelivr.net/npm/simple-statistics@7/dist/simple-statistics.min.js",
        ),
        (
            "chroma-js",
            "https://cdn.jsdelivr.net/npm/chroma-js@2/chroma.min.js",
        ),
    ]

    def __init__(
        self,
        position: str = "topleft",
        color_scheme: str = "Blues",
        method: str = "jenks",
        n_classes: int = 6,
        agg: str = "count",
        schemes: Optional[list[str]] = None,
        style: Optional[dict] = None,
        locale: Optional[LocaleConfig] = None,
    ):
        super().__init__(position=position, locale=locale)
        self._template = self._get_template(
            css_file="HeatmapControl.css",
            js_file="HeatmapControl.js",
            use_panel=True,
        )
        self.color_scheme = color_scheme
        self.method = method
        self.n_classes = n_classes
        self.agg = agg
        self.schemes = schemes or [
            "Blues",
            "Greens",
            "Reds",
            "Oranges",
            "Purples",
            "YlOrRd",
            "Viridis",
        ]
        self.style = {
            "border_weight": 1.5,
            "border_color": "#333333",
            "fill_opacity": 0.7,
            "border_opacity": 0.9,
            "label_show": True,
            "label_size": 11,
            "label_color": "#fff",
            "label_format": "auto",
        } | (style or {})
