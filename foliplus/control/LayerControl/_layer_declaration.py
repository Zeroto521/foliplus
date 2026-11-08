from __future__ import annotations

from collections.abc import Mapping

from folium.map import Layer

from foliplus._declaration import (
    FILL_KEY,
    FILTER_KEY,
    FOLDER_KEY,
    LABEL_KEY,
    ZOOM_RANGE_KEY,
    normalise_folder,
    normalise_layer_filter,
    normalise_zoom_range,
    warn_foliplus,
)

#: The keys the per-layer foliplus={...} declaration namespace accepts.
#: fill and label are consumed by the JS panel straight off
#: layer.options.foliplus (folium forwards the unknown keyword into the
#: layer options); zoom_range and folder are normalised here into CONFIG
#: data[].zoomRange / data[].folder so the visibility and grouping policies
#: read one CONF fact instead of the raw namespace.
FOLIPLUS_KEYS = frozenset({FILL_KEY, LABEL_KEY, FILTER_KEY, FOLDER_KEY, ZOOM_RANGE_KEY})


def foliplus_namespace(item: Layer, layer_name: str) -> dict[str, object] | None:
    """Read one layer's foliplus={...} namespace, or None when unusable.

    Returns the raw mapping when the layer declares one, else ``None``: "no
    declaration" and "declared but not a mapping" are the same downstream state
    (each caller keeps its own fact undeclared). Unknown keys and non-mapping
    ``fill``/``label`` values are warned here so every reader reports the same
    shape errors; the caller then normalises the key it owns.
    """
    # Two declaration channels are accepted so third-party/custom layers
    # declare a folder the same way foliplus layers do:
    #   * attribute: layer.foliplus = {...} - folium's base Layer.__init__
    #     never consumes **kwargs (only attribute assignment), so custom and
    #     extension layers commonly set the attribute directly;
    #   * options: layer.options["foliplus"] - folium forwards the unknown
    #     keyword into the layer options (GeoJson, TileLayer, ...).
    # The attribute channel wins when present; the options channel is the
    # fallback. Malformed containers never raise - a third-party layer written
    # wrong must not break the whole map - and read as "undeclared". A
    # declared-but-not-a-mapping namespace warns once (dedup key omits the
    # layer name so many layers with the same shape error do not spam).
    attr_raw = getattr(item, "foliplus", None)
    if attr_raw is not None:
        raw = attr_raw
    else:
        options = getattr(item, "options", None)
        if not isinstance(options, Mapping):
            return None
        raw = options.get("foliplus")
    if raw is None:
        return None
    if not isinstance(raw, dict):
        warn_foliplus(
            f"shape:{type(raw).__name__}",
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
        elif key in {FILL_KEY, LABEL_KEY, FILTER_KEY} and not isinstance(value, dict):
            warn_foliplus(
                f"{layer_name}:shape:{key}:{type(value).__name__}",
                f"LayerControl: layer {layer_name!r} declares "
                f"foliplus[{key!r}] as {type(value).__name__}; expected a "
                "mapping - ignored",
            )
    return raw


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
    namespace = foliplus_namespace(item, layer_name)
    if namespace is None:
        return None
    return normalise_zoom_range(
        namespace.get(ZOOM_RANGE_KEY),
        owner="LayerControl",
        subject=f"layer {layer_name!r}",
    )


def declared_folder(item: Layer, layer_name: str) -> str | None:
    """Normalise one layer ``foliplus={"folder": "Name"}``.

    Returns the stripped folder name when the declaration is a non-empty
    string, else ``None``: "not declared" and "declared but invalid" are the
    same state downstream - the layer stays at the section root rather than
    disappearing into a folder the author never saw validated.

    Mirrors :func:`declared_zoom_range`: the same namespace read, the same
    unknown-key warning family, and the same single read point that owns the
    warning for layers. The shared reader in :mod:`foliplus._declaration` owns
    the ``folder`` shape and the warning family, so layering the same rules
    here and on the controls cannot drift.
    """
    namespace = foliplus_namespace(item, layer_name)
    if namespace is None:
        return None
    return normalise_folder(
        namespace.get(FOLDER_KEY),
        owner="LayerControl",
        subject=f"layer {layer_name!r}",
    )


def declared_filter(item: Layer, layer_name: str) -> dict[str, object] | None:
    """Normalise one layer ``foliplus={"filter": {...}}`` into the shared AST.

    Returns the filter AST when the declaration is usable, else ``None``:
    "not declared" and "declared but invalid" are the same state downstream -
    the layer starts unfiltered, never filtered-to-empty.

    Mirrors :func:`declared_zoom_range`: the same namespace read, the same
    unknown-key warning family, and the same single read point that owns the
    warning for layers. The shared reader in :mod:`foliplus._declaration` owns
    the ``filter`` shape and the warning family, so layering the same rules
    here and on the controls cannot drift.
    """
    namespace = foliplus_namespace(item, layer_name)
    if namespace is None:
        return None
    return normalise_layer_filter(
        namespace.get(FILTER_KEY),
        owner="LayerControl",
        subject=f"layer {layer_name!r}",
        source="foliplus['filter']",
    )
