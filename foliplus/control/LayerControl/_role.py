# foliplus/control/LayerControl/_role — the layer-role vocabulary, Python side.
#
# The overlay/base grouping a layer belongs to is ONE word in foliplus: role
# (foliplus/control/LayerControl/_role.py, mirrored by JS core/layer/role.ts).
# folium calls the same grouping 'overlay' — its native Layer.__init__ param
# (name, overlay, control, show) — and foliplus must keep reading that param
# because it IS the folium API. This module is the single place that maps
# folium.overlay <-> foliplus role: no other Python module hand-rolls the
# ternary or the literal tuple.
#
# It also owns the author's central role-defaults declaration
# (roles={"overlay": {"folded": True}}): that payload is role vocabulary too —
# which roles exist, and what each one defaults to — so it normalises here
# rather than in a second module that would have to import this one back.
from __future__ import annotations

from collections.abc import Mapping
from typing import Literal, get_args

from foliplus._declaration import warn_foliplus

LayerRole = Literal["base", "overlay"]

#: The two role words, in a deterministic order. The single vocabulary for
#: "which roles exist": a caller that needs to iterate them (the central
#: folders config) reads this tuple instead of hand-rolling ("base", "overlay"),
#: so the source cannot drift from :data:`LayerRole`.
LAYER_ROLES: tuple[LayerRole, ...] = get_args(LayerRole)


#: The entry keys v1 understands. Anything else rejects the whole entry (warn
#: once) — a future key is its own card, never silently dropped.
ROLE_DEFAULT_KEYS = ("folded",)


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


def normalise_role_defaults(
    raw: object,
    *,
    owner: str = "LayerControl",
    source: str = "roles",
) -> dict[str, dict[str, object]] | None:
    """Normalise the central role-defaults config.

    Returns ``{"overlay": {...}, "base": {...}}`` (both keys always present)
    when *raw* is a usable mapping — possibly with empty mappings after
    per-entry rejection. Returns ``None`` when *raw* is ``None`` or not a
    mapping at all: "not declared" and "declared but unusable" are the same
    state downstream, every role stays on its built-in default (expanded)
    rather than folding on a payload the author never saw validated.

    v1 understands one entry shape: ``{"folded": <bool>}``. An unknown key
    rejects the whole entry (warn once). A non-mapping *raw*, an unknown
    section, or a non-bool ``folded`` all warn once and are ignored per-item;
    a non-bool ``folded`` is treated as expanded (``False``). An absent
    section becomes an empty mapping — no author opinion, so the role keeps
    the built-in expanded default.
    """
    if raw is None:
        return None

    def reject(section: str, reason: str) -> None:
        note = f"{owner}:roles:{section}:{reason}"
        warn_foliplus(
            note,
            f"{owner} declares {source}[{section!r}] {reason} - ignored",
        )

    if not isinstance(raw, Mapping):
        reject("-", f"as {type(raw).__name__}; expected a mapping of sections")
        return None

    unknown = sorted((key for key in raw if key not in LAYER_ROLES), key=repr)
    for section in unknown:
        reject(section, "unknown role; expected only overlay and base")

    out: dict[str, dict[str, object]] = {}
    for section in LAYER_ROLES:
        entry = raw.get(section)
        if entry is None:
            out[section] = {}
            continue
        if not isinstance(entry, Mapping):
            reject(section, f"as {type(entry).__name__}; expected a mapping")
            out[section] = {}
            continue
        extra = sorted((key for key in entry if key not in ROLE_DEFAULT_KEYS), key=repr)
        if extra:
            reject(
                section,
                f"with unknown key(s) {extra}; expected only folded",
            )
            out[section] = {}
            continue
        raw_folded = entry.get("folded", False)
        if isinstance(raw_folded, bool):
            out[section] = {"folded": raw_folded}
        else:
            reject(
                section,
                f"with folded={raw_folded!r}; expected a bool (treated as expanded)",
            )
            out[section] = {}
    return out
