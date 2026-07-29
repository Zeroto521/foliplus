from __future__ import annotations

from ._typing import Position
from .BaseControl import BaseControl
from .locale import LocaleConfig


class ExportControl(BaseControl):
    """Capture a specific area of the map and export it as a PNG image.

    Parameters
    ----------
    position : str, default "bottomright"
        Button position. One of ``"topleft"``, ``"topright"``, ``"bottomleft"``,
        ``"bottomright"``.

    filename : str, default "map.png"
        Default filename for the exported image.

    scale : float, default 2.0
        DPI scaling. 1.0 is original resolution, 2.0 is suitable for Retina screens,
        3.0 for printing. Note: excessively high values may crash the browser.

    background : str, optional
        Export background color (e.g., ``"#ffffff"``). Default is None (transparent).

    timeout : int, default 7500
        Maximum time (ms) to wait for map tiles to finish loading before capture.

    locale : str or LocaleConfig, optional
        Language code (``"en"``, ``"zh"``) or a :class:`LocaleConfig` instance.
        Defaults to auto-detection, falling back to English.

    Examples
    --------
    >>> import folium
    >>> from foliplus import ExportControl
    >>> m = folium.Map()
    >>> ExportControl(position="bottomright").add_to(m)
    """

    def __init__(
        self,
        *,
        position: Position = "bottomright",
        filename: str = "map.png",
        scale: float = 2.0,
        background: str | None = None,
        timeout: int = 7500,
        locale: str | LocaleConfig | None = None,
    ):
        super().__init__(position=position, locale=locale)
        self.filename = filename
        self.scale = scale
        self.background = background
        self.timeout = timeout
        self._template = self._get_template(
            css_file="ExportControl.css", js_file="ExportControl.js"
        )
