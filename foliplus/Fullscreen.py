from __future__ import annotations

from ._cdn import LEAFLET_FULLSCREEN_VERSION
from ._typing import Position
from .base import BaseControl
from .locale import LocaleConfig


class Fullscreen(BaseControl):
    """Fullscreen toggle with auto-hide for other controls.

    When toggling fullscreen, other controls (HeatmapControl, LayerControl, ScaleControl
    , MapSearch, MeasureControl, etc.), inside ``.leaflet-control-container`` are
    automatically hidden/shown for a cleaner view.

    Parameters
    ----------
    position : str, default "bottomright"
        One of ``"topleft"``, ``"topright"``, ``"bottomleft"``, ``"bottomright"``.

    hide_self : bool, default True
        Whether to hide the fullscreen button itself after entering fullscreen.
        Users can exit via the ``Esc`` key.

    locale : str or LocaleConfig, optional
        Language code (``"en"``, ``"zh"``) or a :class:`LocaleConfig` instance.
        Defaults to auto-detection, falling back to English.

    Examples
    --------
    >>> import folium
    >>> from foliplus import Fullscreen
    >>> m = folium.Map()
    >>> Fullscreen().add_to(m)
    """

    default_js = [
        (
            "Control.Fullscreen.js",
            f"https://cdn.jsdelivr.net/npm/leaflet.fullscreen@{LEAFLET_FULLSCREEN_VERSION}/Control.FullScreen.min.js",
        )
    ]
    default_css = [
        (
            "Control.FullScreen.css",
            f"https://cdn.jsdelivr.net/npm/leaflet.fullscreen@{LEAFLET_FULLSCREEN_VERSION}/Control.FullScreen.css",
        )
    ]

    def __init__(
        self,
        *,
        position: Position = "bottomright",
        hide_self: bool = True,
        locale: str | LocaleConfig | None = None,
    ):
        super().__init__(position=position, locale=locale)
        self.hide_self = hide_self
        self._template = self._get_template(js_file="Fullscreen.js")
