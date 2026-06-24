from typing import Optional

from folium.plugins import Fullscreen as FoliumFullscreen

from ._typing import Position
from .base import BaseControl
from .locale import LocaleConfig
from typing import Union


class Fullscreen(FoliumFullscreen, BaseControl):
    """Fullscreen control that hides other map components when entering fullscreen.

    Extends :class:`folium.plugins.Fullscreen`. When toggling fullscreen, other
    controls (layer switcher, scale bar, search box, etc.) inside
    ``.leaflet-control-container`` are automatically hidden/shown for a cleaner view.

    Parameters
    ----------
    position : str, default "bottomright"
        Button position. One of ``"topleft"``, ``"topright"``,
        ``"bottomleft"``, ``"bottomright"``.

    hide_self : bool, default True
        Whether to hide the fullscreen button itself after entering fullscreen.
        Users can exit via the ``Esc`` key.

    locale : str or LocaleConfig, optional
        Language code (``"en"``, ``"zh"``) or a :class:`LocaleConfig` instance.
        Defaults to auto-detection, falling back to English.

    **kwargs
        Extra keyword arguments forwarded to :class:`folium.plugins.Fullscreen`.

    Examples
    --------
    >>> import folium
    >>> from foliplus import Fullscreen
    >>> m = folium.Map()
    >>> Fullscreen().add_to(m)
    """

    def __init__(
        self,
        position: Position = "bottomright",
        hide_self: bool = True,
        locale: Optional[Union[str, LocaleConfig]] = None,
        **kwargs,
    ):
        FoliumFullscreen.__init__(self, position=position, **kwargs)
        BaseControl.__init__(self, position=position, locale=locale)
        self.hide_self = hide_self
        self._template = self._get_template(js_file="Fullscreen.js")
