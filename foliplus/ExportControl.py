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
        One of "topleft", "topright", "bottomleft", "bottomright"\.
        ``"bottomright"``.

    filename : str, default "map"
        Base filename for the exported image, without the extension. The correct
        extension (``.png``, ``.jpeg``, or ``.webp``) is appended automatically based on
        ``format``.

    format : str, default "png"
        Image format for the export. One of ``"png"``, ``"jpeg"``, or ``"webp"``. JPEG
        and WebP are lossy and much smaller than PNG; PNG preserves transparency
        (recommended when ``background`` is None).

    quality : float, default 0.92
        Compression quality for ``"jpeg"`` and ``"webp"`` formats, ranging from
        0.0 (worst) to 1.0 (best). Ignored for ``"png"``.

    scale : float, default 2.0
        DPI scaling. 1.0 is original resolution, 2.0 is suitable for Retina screens,
        3.0 for printing. Note: excessively high values may crash the browser.

    max_pixels : int, default 10240000
        Maximum number of pixels in the exported image (``width * height``). Larger
        exports may exceed the browser canvas limit or exhaust memory. Default is
        10,240,000 (e.g. 3200×3200). Set to ``None`` to disable the limit.

    background : str, optional
        Export background color (e.g., ``"#ffffff"``). Default is None (transparent).
        Required for ``"jpeg"`` (JPEG has no alpha channel).

    timeout : int, default 7500
        Maximum time (ms) to wait for map tiles to finish loading before capture.

        locale : str or LocaleConfig, optional
        Language code ("en", "zh") or a LocaleConfig instance.
        Defaults to auto-detection, falling back to English.

    Notes
    -----
    **Export opt-out.**  By default, most elements inside a layer pane are captured
    in the export.  To exclude an element from the exported image, set the
    ``data-foliplus-export="exclude"`` attribute on it.  This is used by built-in
    controls (e.g. ``MeasureControl``'s delete icons) and is the recommended way for
    third-party controls to exclude internal UI without coupling to ``ExportControl``.

    **Text labels.**  Elements that should be rendered as text labels (with background
    fill and centered text) can be marked with  ``data-foliplus-export="label"``.
    ``MeasureControl``'s distance labels use this attribute.

    **Keyboard shortcuts.**
    While the crop box is visible:

    ================== =============================================
    Key                Action
    ================== =============================================
    Enter              Lock the current crop area, then begin export
    Escape             Unlock or dismiss the crop box
    Ctrl+Z / Cmd+Z     Undo the last crop adjustment
    Ctrl+Shift+Z / Cmd+Shift+Z  Redo the last crop adjustment
    ================== =============================================

    **Image format.**  The download filename is ``{filename}.{format}``. For example,
    ``filename="map"`` with ``format="jpeg"`` produces ``map.jpeg``. JPEG and WebP use
    the ``quality`` parameter for compression; PNG is always lossless.

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
