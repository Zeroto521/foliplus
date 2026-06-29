from __future__ import annotations

from typing import Literal

from ._cdn import CHROMA_VERSION, H3_VERSION, SIMPLE_STATISTICS_VERSION
from ._typing import Position
from .base import BaseControl
from .locale import LocaleConfig


class HeatmapControl(BaseControl):
    """H3 hexbin aggregation heatmap control.

    Auto-discovers point layers (`Marker` / `CircleMarker` / `GeoJSON` Point) and
    aggregates them into H3 hexagons in real-time via h3-js. Resolution auto-adjusts
    with zoom.

    Parameters
    ----------
    position : str, default "topleft"
        One of ``"topleft"``, ``"topright"``, ``"bottomleft"``, ``"bottomright"``.

    color_scheme : str, default "Reds"
        Default color scheme name. Supports chroma.js / ColorBrewer palettes: ``Blues``,
        ``Greens``, ``Reds``, ``Oranges``, ``Purples``, ``YlOrRd``, ``Viridis``.

    method : Literal["jenks", "quantile", "equal", "heads"], default "jenks"
        Default classification method.

    n_classes : int, default 6
        Number of classification classes, range 2-9.

    agg : Literal["count", "sum", "avg", "min", "max"], default "count"
        Default aggregation method.

    schemes : list[str], optional
        List of available color scheme names. Can include custom hex values like
        ``["#f00", "#0f0", "#00f"]``.

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

    locale : str or LocaleConfig, optional
        Language code (``"en"``, ``"zh"``) or a :class:`LocaleConfig` instance.
        Defaults to auto-detection, falling back to English.

    Examples
    --------
    >>> import folium
    >>> from foliplus import HeatmapControl
    >>> m = folium.Map()
    >>> HeatmapControl().add_to(m)
    """

    default_js = [
        ("h3-js", f"https://cdn.jsdelivr.net/npm/h3-js@{H3_VERSION}/dist/h3-js.umd.js"),
        (
            "simple-statistics",
            f"https://cdn.jsdelivr.net/npm/simple-statistics@{SIMPLE_STATISTICS_VERSION}/dist/simple-statistics.min.js",
        ),
        (
            "chroma-js",
            f"https://cdn.jsdelivr.net/npm/chroma-js@{CHROMA_VERSION}/chroma.min.js",
        ),
    ]

    def __init__(
        self,
        position: Position = "topleft",
        color_scheme: str = "Reds",
        method: Literal["jenks", "quantile", "equal", "heads"] = "jenks",
        n_classes: int = 6,
        agg: Literal["count", "sum", "avg", "min", "max"] = "count",
        schemes: list[str] | None = None,
        style: dict | None = None,
        locale: str | LocaleConfig | None = None,
    ):
        super().__init__(position=position, locale=locale)
        self._template = self._get_template(
            js_file="HeatmapControl.js", css_file="HeatmapControl.css", use_panel=True
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

        # CDN versions for JS dynamic loader
        self._h3_version = H3_VERSION
        self._ss_version = SIMPLE_STATISTICS_VERSION
        self._chroma_version = CHROMA_VERSION
