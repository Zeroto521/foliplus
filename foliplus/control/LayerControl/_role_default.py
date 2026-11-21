# foliplus/control/LayerControl/_role_default — the central role-defaults
# declaration.
#
# The author passes roles={"overlay": {"folded": True}, "base": {"folded": False}}
# to LayerControl. This module is the single place that normalises that payload
# into the CONF contract the JS side reads: author-default folded state per
# role. One module, one vocabulary — the JS reader
# (control/LayerControl/declaredRole.ts) mirrors the shape.
from __future__ import annotations

from collections.abc import Mapping

from foliplus._declaration import warn_foliplus

from ._role import LAYER_ROLES

#: The entry keys v1 understands. Anything else rejects the whole entry (warn
#: once) — a future key is its own card, never silently dropped.
ROLE_DEFAULT_KEYS = ("folded",)


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
