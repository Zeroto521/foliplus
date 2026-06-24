from __future__ import annotations

from collections import OrderedDict
from typing import Optional, Union

from folium.map import Layer

from ._typing import Position
from .base import BaseControl
from .locale import LocaleConfig


class LayerControl(BaseControl):
    """Layer control with geometry-type icons, drag-and-drop order, and a collapsible
    panel.

    Replaces Folium's default layer control with:
    - 📐 Geometry-type icons for quick layer identification.
    - 🔀 Drag-and-drop reordering, synced to Leaflet render order.
    - ✅ Multi-select checkboxes with z-index stacking.
    - 🎨 Color picker to replace base maps with a solid background color.
    - 📂 Collapsible panel consistent with other foliplus controls.

    Parameters
    ----------
    position : str, default "topleft"
        One of ``"topleft"``, ``"topright"``, ``"bottomleft"``, ``"bottomright"``.

    locale : str or LocaleConfig, optional
        Language code (``"en"``, ``"zh"``) or a :class:`LocaleConfig` instance.
        Defaults to auto-detection, falling back to English.

    Notes
    -----
    Layer identification relies on ``map._layers`` and the ``window`` global variable at
    runtime. The initial layer list is collected during rendering by traversing the
    parent map's children.

    Examples
    --------
    >>> import folium
    >>> from foliplus import LayerControl
    >>> m = folium.Map()
    >>> LayerControl().add_to(m)
    """

    def __init__(
        self,
        position: Position = "topleft",
        locale: Optional[Union[str, LocaleConfig]] = None,
    ):
        super().__init__(position=position, locale=locale)
        self.base_layers: OrderedDict[str, str] = OrderedDict()
        self.overlays: OrderedDict[str, str] = OrderedDict()
        self._template = self._get_template(
            js_file="LayerControl.js", css_file="LayerControl.css", use_panel=True
        )

    def render(self, **kwargs):
        """Collect layers from the parent map before rendering.

        Traverses the parent map's ``_children`` to find ``Layer`` instances, then
        populates ``self.base_layers`` and ``self.overlays`` according to each layer's
        ``overlay`` flag.
        """
        self.base_layers.clear()
        self.overlays.clear()
        for item in self._parent._children.values():
            if not isinstance(item, Layer) or not item.control:
                continue

            key = item.layer_name
            if not item.overlay:
                self.base_layers[key] = item.get_name()
            else:
                self.overlays[key] = item.get_name()

        super().render(**kwargs)
