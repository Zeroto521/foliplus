"""The whole-layer opacity declaration, read off the layer namespace.

`foliplus={"opacity": 0.6}` names the value the panel opacity slider starts at
and Reset returns to. It is a read-time default, never a draw override: folium's
own `opacity=` keyword remains the author DRAW value and is read first, so the
two channels never fight - a layer that sets both draws the folium value but
shows the declared one in the panel.

The icon / marker block alpha readers live in :mod:`._face`: they normalise a
whole block (`icon` / `marker`) through one shared spelling rule, so the block
is read once at its own single entry point rather than per sub-key here.

Split out of `_layer.py` when the opacity family pushed that module past the
300-code-line criterion (see `script/check/module_size_check.py`); the reader
shares `foliplus_namespace` there but owns no other state.
"""

from __future__ import annotations

from folium.map import Layer

from foliplus._declaration import OPACITY_KEY, normalise_opacity

from ._layer import foliplus_namespace


def declared_opacity(item: Layer, layer_name: str) -> float | None:
    """Normalise one layer `foliplus={"opacity": 0.6}` (the whole-layer
    opacity).

    Returns the 0-1 float when the declaration is usable, else `None`:
    "not declared" and "declared but invalid" are the same state downstream -
    the panel keeps its derived default rather than showing a value the author
    never saw validated.

    Mirrors :func:`.declared_border`: the same namespace read, the same
    unknown-key warning family, and the same single read point that owns the
    warning for layers. The shared reader in :mod:`foliplus._declaration` owns
    the `opacity` shape, so the layer channel and any other reader cannot
    drift on what an author may write. The JS panel reads the declaration as a
    read-time default (the slider starts there and Reset returns to it); folium
    `opacity=` remains the author DRAW value and is read first, so the two
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
