from __future__ import annotations

from folium.map import Layer

from foliplus._declaration import (
    ZOOM_RANGE_KEY,
    normalise_zoom_range,
    warn_foliplus,
)

#: The keys the per-layer foliplus={...} declaration namespace accepts.
#: fill and label are consumed by the JS panel straight off
#: layer.options.foliplus (folium forwards the unknown keyword into the
#: layer options); zoom_range is normalised here into CONFIG data[].zoomRange
#: so the visibility policy reads one CONF fact instead of the raw namespace.
FOLIPLUS_KEYS = frozenset({"fill", "label", ZOOM_RANGE_KEY})


def declared_zoom_range(item: Layer, layer_name: str) -> dict[str, int] | None:
    """Normalise one layer ``foliplus={"zoom_range": {"min": ..., "max": ...}}``.

    Returns ``{"min": int, "max": int}`` when the declaration is usable, else
    ``None``: "not declared" and "declared but invalid" are the same state
    downstream - the visibility policy stays unconstrained rather than hiding
    the layer on a payload the author never saw validated.

    The namespace is a folium passthrough, so nothing validates it at
    construction. This is the single read point for layers, hence the single
    place that warns; every message names the layer so a typo is attributable.
    The shared reader in :mod:`foliplus._declaration` owns the
    ``zoom_range`` shape and the warning family, so layering the same rules
    here and on the controls cannot drift.
    """
    # folium's base Layer (map.py) never assigns self.options: only the
    # concrete subclasses do (Marker, GeoJson, FeatureGroup, TileLayer, ...).
    # A bare Layer or a custom subclass is therefore a real runtime shape, not
    # just a type hole, and it simply carries no declaration.
    raw = getattr(item, "options", {}).get("foliplus")
    if raw is None:
        return None
    if not isinstance(raw, dict):
        warn_foliplus(
            f"{layer_name}:shape:{type(raw).__name__}",
            f"LayerControl: layer {layer_name!r} declares foliplus= as "
            f"{type(raw).__name__}; expected a mapping - ignored",
        )
        return None

    for key, value in raw.items():
        if key not in FOLIPLUS_KEYS:
            warn_foliplus(
                f"{layer_name}:unknown:{key}",
                f"LayerControl: layer {layer_name!r} declares unknown "
                f"foliplus key {key!r}; expected one of "
                f"{sorted(FOLIPLUS_KEYS)} - ignored",
            )
        elif key in {"fill", "label"} and not isinstance(value, dict):
            warn_foliplus(
                f"{layer_name}:shape:{key}:{type(value).__name__}",
                f"LayerControl: layer {layer_name!r} declares "
                f"foliplus[{key!r}] as {type(value).__name__}; expected a "
                "mapping - ignored",
            )

    return normalise_zoom_range(
        raw.get(ZOOM_RANGE_KEY), owner="LayerControl", subject=f"layer {layer_name!r}"
    )
