# foliplus/control/LayerControl/_role — the layer-role vocabulary, Python side.
#
# The overlay/base grouping a layer belongs to is ONE word in foliplus: role
# (foliplus/control/LayerControl/_role.py, mirrored by JS core/layer/role.ts).
# folium calls the same grouping 'overlay' — its native Layer.__init__ param
# (name, overlay, control, show) — and foliplus must keep reading that param
# because it IS the folium API. This module is the single place that maps
# folium.overlay <-> foliplus role: no other Python module hand-rolls the
# ternary or the literal tuple.
from __future__ import annotations

from typing import Literal

LayerRole = Literal["base", "overlay"]


def layer_role(layer: object) -> LayerRole:
    """The foliplus role of a folium layer.

    ``folium.overlay`` is the native grouping flag (a data layer is an overlay,
    a basemap is not); foliplus calls the same grouping ``role``. The mapping is
    total: a layer with no declared overlay (missing attribute) is a base layer,
    which is folium's own default for a bare Layer.

    Args:
        layer: A folium layer (anything with an ``overlay`` attribute).

    Returns:
        ``"overlay"`` when ``layer.overlay`` is true, else ``"base"``.
    """
    return "overlay" if getattr(layer, "overlay", False) else "base"
