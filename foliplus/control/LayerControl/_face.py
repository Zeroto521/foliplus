"""The icon / marker declaration blocks, read off one layer namespace.

Both blocks carry the sub-dimensions ONE marker face can set:

* `icon` - `glyph` (the FontAwesome name), `color` (the glyph CSS hex) and
  `colorOpacity` (the glyph alpha, 0-100 integer percent).
* `marker` - `colorOpacity` (the chassis alpha); the chassis colour is the
  top-level `marker_color` declaration.

Like the whole-layer opacity they are read-time defaults for the JS panel (the
row starts at them and Reset returns to them), never draw overrides: folium's
own `Icon(icon=/icon_color=)` values remain the author DRAW values. The panel
reads the block straight off `layer.options.foliplus`, so Python's job here is
the shape validation + one-time warning that the author's spelling is usable.

Each reader mirrors :func:`.declared_border`: the same namespace read, the same
unknown-key warning family, and the same single read point that owns the
warning for layers. The shared normaliser in
:mod:`foliplus._declaration.block` owns the in-block spelling rule (camel and
snake are both accepted, the result is canonical camelCase) and the per-value
shape; the JS panel owns the semantic vocabulary (the glyph name / stylesheet).
"""

from __future__ import annotations

from folium.map import Layer

from foliplus._declaration import (
    ICON_KEY,
    MARKER_KEY,
    normalise_icon_block,
    normalise_marker_block,
)

from ._layer import foliplus_namespace


def declared_icon_block(
    item: Layer, layer_name: str
) -> dict[str, object] | None:
    """Normalise one layer `foliplus={"icon": {...}}` declaration block.

    Returns the canonical record (`glyph` / `color` / `colorOpacity`) when
    the block is a mapping, else `None`: \"not declared\" and \"declared but
    unusable\" are the same state downstream - the panel keeps its derived icon
    face rather than showing a value the author never saw validated.

    Mirrors :func:`.declared_border`: the same namespace read, the same
    unknown-key warning family, and the same single read point that owns the
    warning for layers.
    """
    namespace = foliplus_namespace(item, layer_name)
    if namespace is None:
        return None
    return normalise_icon_block(
        namespace.get(ICON_KEY),
        owner="LayerControl",
        subject=f"layer {layer_name!r}",
        source=f"foliplus[{ICON_KEY!r}]",
    )


def declared_marker_block(
    item: Layer, layer_name: str
) -> dict[str, object] | None:
    """Normalise one layer `foliplus={"marker": {...}}` declaration block.

    Returns the canonical record (`colorOpacity`) when the block is a mapping,
    else `None`. Mirrors :func:`.declared_icon_block`: the same namespace read,
    the same unknown-key warning family, and the same single read point that
    owns the warning for layers.
    """
    namespace = foliplus_namespace(item, layer_name)
    if namespace is None:
        return None
    return normalise_marker_block(
        namespace.get(MARKER_KEY),
        owner="LayerControl",
        subject=f"layer {layer_name!r}",
        source=f"foliplus[{MARKER_KEY!r}]",
    )
