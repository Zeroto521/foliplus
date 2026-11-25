"""The per-layer opacity declarations: whole-layer opacity and the marker
glyph / chassis alpha.

Three declarations live here, all read by the JS panel as read-time defaults
(Reset return points), never as draw overrides:

* ``opacity`` - the whole-layer opacity (0-1, Leaflet's opacity unit). A
  scalar declaration: ``foliplus={"opacity": 0.6}`` names the value the panel
  opacity slider starts at and Reset returns to. folium's ``opacity=`` kwarg
  remains the author DRAW value (read first), so the two channels never fight:
  a layer that sets both draws the folium value but shows the declared one in
  the panel.
* ``icon.colorOpacity`` / ``marker.colorOpacity`` - the marker glyph / chassis
  alpha (0-100 integer percent, the panel unit). These ride the ``icon`` /
  ``marker`` declaration blocks, the same in-block shape fill / border use.

Each reader mirrors :func:`.declared_border`: the same namespace read, the
same unknown-key warning family, and the same single read point that owns the
warning for layers. The shared reader in :mod:`foliplus._declaration` owns the
structural shape (scalar vs block, the declared number's range); the JS panel
reads the raw namespace and validates the semantic vocabulary - the same split
the border and fill channels follow.

Split out of ``_layer.py`` when the opacity family pushed that module past the
300-code-line criterion (see ``script/check/module_size_check.py``); the
readers share ``foliplus_namespace`` there but own no other state.
"""

from __future__ import annotations

from collections.abc import Mapping

from folium.map import Layer

from foliplus._declaration import (
    ICON_KEY,
    MARKER_KEY,
    OPACITY_KEY,
    normalise_color_opacity,
    normalise_opacity,
)

from ._layer import foliplus_namespace


def declared_opacity(item: Layer, layer_name: str) -> float | None:
    """Normalise one layer ``foliplus={"opacity": 0.6}`` (the whole-layer
    opacity).

    Returns the 0-1 float when the declaration is usable, else ``None``:
    "not declared" and "declared but invalid" are the same state downstream -
    the panel keeps its derived default rather than showing a value the author
    never saw validated.

    Mirrors :func:`.declared_border`: the same namespace read, the same
    unknown-key warning family, and the same single read point that owns the
    warning for layers. The shared reader in :mod:`foliplus._declaration` owns
    the ``opacity`` shape, so the layer channel and any other reader cannot
    drift on what an author may write. The JS panel reads the declaration as a
    read-time default (the slider starts there and Reset returns to it); folium
    ``opacity=`` remains the author DRAW value and is read first, so the two
    channels never fight.
    """
    namespace = foliplus_namespace(item, layer_name)
    if namespace is None:
        return None
    return normalise_opacity(
        namespace.get(OPACITY_KEY),
        owner="LayerControl",
        subject=f"layer {layer_name!r}",
        source="foliplus['opacity']",
    )


def declared_icon_color_opacity(item: Layer, layer_name: str) -> int | None:
    """Normalise one layer ``foliplus={"icon": {"colorOpacity": 60}}``.

    Returns the 0-100 integer percent when the declaration is usable, else
    ``None``: "not declared" and "declared but invalid" are the same state
    downstream - the marker keeps its derived alpha rather than painting one the
    author never saw validated.

    Mirrors :func:`.declared_border`: the same namespace read, the same
    unknown-key warning family, and the same single read point that owns the
    warning for layers. The shared reader in :mod:`foliplus._declaration` owns
    the ``color_opacity`` shape; the JS panel reads the raw ``icon`` block and
    validates the key (the same split border follows).
    """
    namespace = foliplus_namespace(item, layer_name)
    if namespace is None:
        return None
    icon = namespace.get(ICON_KEY)
    if not isinstance(icon, Mapping):
        return None
    return normalise_color_opacity(
        icon.get("colorOpacity"),
        owner="LayerControl",
        subject=f"layer {layer_name!r}",
        source="foliplus['icon']['colorOpacity']",
    )


def declared_marker_color_opacity(item: Layer, layer_name: str) -> int | None:
    """Normalise one layer ``foliplus={"marker": {"colorOpacity": 60}}``.

    Returns the 0-100 integer percent when the declaration is usable, else
    ``None``: "not declared" and "declared but invalid" are the same state
    downstream - the marker keeps its derived alpha rather than painting one the
    author never saw validated.

    Mirrors :func:`.declared_border`: the same namespace read, the same
    unknown-key warning family, and the same single read point that owns the
    warning for layers. The shared reader in :mod:`foliplus._declaration` owns
    the ``color_opacity`` shape; the JS panel reads the raw ``marker`` block and
    validates the key (the same split border follows).
    """
    namespace = foliplus_namespace(item, layer_name)
    if namespace is None:
        return None
    marker = namespace.get(MARKER_KEY)
    if not isinstance(marker, Mapping):
        return None
    return normalise_color_opacity(
        marker.get("colorOpacity"),
        owner="LayerControl",
        subject=f"layer {layer_name!r}",
        source="foliplus['marker']['colorOpacity']",
    )