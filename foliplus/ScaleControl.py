from __future__ import annotations

from typing import Optional, Union

from ._typing import Position
from .base import BaseControl
from .locale import LocaleConfig


class ScaleControl(BaseControl):
    """Scale control with metric/imperial units and optional zoom level display.

    Adds a scale bar to the map supporting metric and imperial units, with an
    optional current zoom level label.

    Parameters
    ----------
    position : str, default "bottomleft"
        Control position. One of ``"topleft"``, ``"topright"``,
        ``"bottomleft"``, ``"bottomright"``.

    metric : bool, default True
        Whether to show metric units (meters / kilometers).

    imperial : bool, default False
        Whether to show imperial units (feet / miles).

    show_zoom : bool, default True
        Whether to show the current map zoom level.

    locale : LocaleConfig, optional
        Localization configuration. Defaults to English.

    Examples
    --------
    >>> import folium
    >>> from foliplus import ScaleControl
    >>> m = folium.Map()
    >>> ScaleControl().add_to(m)
    """

    def __init__(
        self,
        position: Position = "bottomleft",
        metric: bool = True,
        imperial: bool = False,
        show_zoom: bool = True,
        locale: Optional[Union[str, LocaleConfig]] = None,
    ):
        super().__init__(position=position, locale=locale)
        self.metric = metric
        self.imperial = imperial
        self.show_zoom = show_zoom
        self._template = self._get_template(
            js_file="ScaleControl.js", css_file="ScaleControl.css"
        )
