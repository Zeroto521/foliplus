from __future__ import annotations

from typing import cast

from folium.map import Layer

from ._typing import Position
from .BaseControl import BaseControl
from .locale import LocaleConfig


class LayerControl(BaseControl):
    """Drag-and-drop layer ordering with geometry icons, color picker, and panes.

    - 📐 Geometry-type icons for quick layer identification.
    - 🔀 Drag-and-drop reordering, synced to Leaflet render order.
    - ✅ Multi-select checkboxes with z-index stacking.
    - 🎨 Color picker to replace base maps with a solid background color.
    - ⌨️ Keyboard navigation for layer panel (see Shortcuts below).

    Shortcuts
    ---------
    Focus a layer row by clicking it, then use:

    ============ ======================
    Key          Action
    ============ ======================
    ArrowUp      Move focus to previous layer
    ArrowDown    Move focus to next layer
    ArrowLeft    Toggle visibility of focused layer (deselect)
    ArrowRight   Toggle visibility of focused layer (select)
    Space        Toggle visibility of focused layer
    Enter        Toggle visibility of focused layer
    Ctrl+Up      Move focused layer one position up
    Ctrl+Down    Move focused layer one position down
    Escape       Clear focus
    ============ ======================

    On macOS, Cmd acts as the modifier key instead of Ctrl.

    Parameters
    ----------
    position : str, default "topleft"
        One of "topleft", "topright", "bottomleft", "bottomright"\.

    locale : str or LocaleConfig, optional
        Language code ("en", "zh") or a LocaleConfig instance.
        Defaults to auto-detection, falling back to English.


    Examples
    --------
    >>> import folium
    >>> from foliplus import LayerControl
    >>> m = folium.Map()
    >>> LayerControl().add_to(m)
    """

    def __init__(
        self,
        *,
        position: Position = "topleft",
        locale: str | LocaleConfig | None = None,
    ):
        super().__init__(position=position, locale=locale)
        self._template = self._get_template()

    def _extra_config(self) -> dict:
        """Collect layers from the parent map at render time.

        This is the canonical example of a control that needs render-time data the
        constructor cannot know: the layer list only exists once the control is added
        to a map. Traverses the parent map's ``_children`` and emits a serializable
        list of ``{name, id, isBase}`` dicts.

        Returns
        -------
        dict
            ``{"data": [{"name", "id", "isBase"}, ...]}`` — the ``data`` key is merged
            into the JS ``CONF`` object by :meth:`BaseControl._build_config`.
        """
        data: list[dict[str, object]] = []
        if (parent := self._parent) is not None:
            for item in parent._children.values():
                # isinstance first — the control itself is a child but not a Layer
                # (and has no `.control` attribute).
                if not isinstance(item, Layer) or not item.control:
                    continue

                data.append(
                    {
                        "name": item.layer_name,
                        "id": item.get_name(),
                        "isBase": not item.overlay,
                    }
                )

        # Stable ordering: overlays first, then base layers (matches JS enforceOrder).
        data.sort(key=lambda d: cast(bool, d["isBase"]))
        return {"data": data}
