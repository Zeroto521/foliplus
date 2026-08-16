from __future__ import annotations

from ._cdn import GCOORD
from ._typing import Position
from .BaseControl import BaseControl
from .locale import LocaleConfig


class LocateControl(BaseControl):
    """Fly to the user's current position.

    Parameters
    ----------
    position : str, default "topleft"
        One of "topleft", "topright", "bottomleft", "bottomright"\.

    zoom : int, default 15
        Zoom level after locating. Typically 1-18.

        locale : str or LocaleConfig, optional
        Language code ("en", "zh") or a LocaleConfig instance.
        Defaults to auto-detection, falling back to English.

    Examples
    --------
    >>> import folium
    >>> from foliplus import LocateControl
    >>> m = folium.Map()
    >>> LocateControl().add_to(m)
    """

    _export_fields = ("zoom",)

    default_js = [
        (
            "gcoord",
            f"https://cdn.jsdelivr.net/npm/gcoord@{GCOORD}/dist/gcoord.global.prod.js",
        ),
    ]

    def __init__(
        self,
        *,
        position: Position = "bottomright",
        zoom: int = 15,
        locale: str | LocaleConfig | None = None,
    ):
        if not isinstance(zoom, int) or zoom < 1 or zoom > 18:
            raise ValueError(f"zoom must be an int between 1 and 18, got {zoom!r}")

        super().__init__(position=position, locale=locale)
        self.zoom = zoom
        self._template = self._get_template()
