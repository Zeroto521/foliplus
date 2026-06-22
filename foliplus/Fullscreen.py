from folium.plugins import Fullscreen as FoliumFullscreen

from .base import BaseControl
from .locale import LocaleConfig


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
    locale : LocaleConfig, optional
        Localization configuration. Defaults to English.
    **kwargs
        Extra keyword arguments forwarded to :class:`folium.plugins.Fullscreen`.

    Examples
    --------
    >>> import folium
    >>> from foliplus import Fullscreen
    >>> m = folium.Map()
    >>> Fullscreen(position="bottomright").add_to(m)
    """

    def __init__(
        self,
        position: str = "bottomright",
        hide_self: bool = True,
        locale: LocaleConfig = None,
        **kwargs,
    ):
        FoliumFullscreen.__init__(self, position=position, **kwargs)
        BaseControl.__init__(self, position=position, locale=locale)
        self.hide_self = hide_self
        self._template = self._get_template(js_file="Fullscreen.js")
