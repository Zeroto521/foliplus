from __future__ import annotations

from typing import Literal, get_args

from ._typing import Position
from .BaseControl import BaseControl
from .locale import LocaleConfig

FORMAT = Literal["png", "jpeg", "webp"]


class ExportControl(BaseControl):
    """Capture a specific area of the map and export it as an image.

    Parameters
    ----------
    position : str, default "bottomright"
        Button position. One of "topleft", "topright", "bottomleft", "bottomright".

    filename : str, default "map"
        Base filename for the exported image, without the extension.

    format : str, default "png"
        Image format. One of "png", "jpeg", or "webp".

    quality : float, default 0.92
        Compression quality for "jpeg" and "webp".

    scale : float, default 2.0
        DPI scaling. 1.0 = original, 2.0 = Retina, 3.0 = printing.

    max_pixels : int, default 10240000
        Maximum pixel count (width * height).

    background : str, optional
        Export background color (e.g. "#ffffff").

    timeout : int, default 7500
        Max time (ms) to wait for tiles to load.

    locale : str or LocaleConfig, optional
        Language code ("en", "zh") or a LocaleConfig instance.

    Notes
    -----
    Export opt-out.  To exclude an element from export, set data-foliplus-export="exclude".
    Text labels.  Mark text labels with data-foliplus-export="label".

    Keyboard shortcuts.
    While the crop box is visible:

    ================== =============================================
    Key                Action
    ================== =============================================
    Enter              Lock the current crop area, then begin export
    Escape             Unlock or dismiss the crop box
    Ctrl+Z / Cmd+Z     Undo the last crop adjustment
    Ctrl+Shift+Z / Cmd+Shift+Z  Redo the last crop adjustment
    ================== =============================================

    Examples
    --------
    >>> import folium
    >>> from foliplus import ExportControl
    >>> m = folium.Map()
    >>> ExportControl(position="bottomright").add_to(m)
    >>> ExportControl(format="jpeg", quality=0.8, background="#ffffff").add_to(m)
    >>> ExportControl(scale=3.0, filename="print").add_to(m)
    """

    _export_fields = (
        "filename",
        "format",
        "quality",
        "scale",
        "max_pixels",
        "background",
        "timeout",
    )

    def __init__(
        self,
        *,
        position: Position = "bottomright",
        filename: str = "map",
        format: FORMAT = "png",
        quality: float = 0.92,
        scale: float = 2.0,
        max_pixels: int | None = 10_240_000,
        background: str | None = None,
        timeout: int = 7500,
        locale: str | LocaleConfig | None = None,
    ):
        if format not in get_args(FORMAT):
            raise ValueError(
                f"format must be one of {get_args(FORMAT)}, got {format!r}"
            )

        super().__init__(position=position, locale=locale)
        self.filename = filename
        self.format = format
        self.quality = quality
        self.scale = scale
        self.max_pixels = max_pixels
        self.background = background
        self.timeout = timeout
        self._template = self._get_template()
