"""Fill declarations: the per-layer fill mode and its solid colour/opacity."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any, Literal

from .keys import FILL_KEY
from .paint import _declared_hex, _declared_opacity
from .warnings import warn_foliplus


def normalise_fill(
    raw: object,
    *,
    owner: str,
    subject: str | None = None,
    source: str | None = None,
) -> dict[str, object] | None:
    """Normalise one declared fill into its single canonical shape.

    Two declaration shapes converge here (mirrored 1:1 by the JS
    parseFillDeclaration): a mode-shell mapping with a "mode" key and the flat
    fill-isomorphic value form with a "field" key (implicit value mode).
    "mode", when present, is authoritative. A declaration that names neither a
    mode, a field, a colour nor an opacity is dropped whole.

    The accepted modes are "solid" (one declared colour, or the author's base
    colour when none is given), "value" (classify by a field) and "original"
    (the author's own per-feature paint). "color" (a CSS hex) is the solid
    mode's colour and "opacity" (a number from 0 to 1, Leaflet's fillOpacity
    unit) rides every mode — the two sub-dimensions the panel's fill row can
    set, now expressible as a read-time default.

    Returns the normalised record ("mode" plus the declared sub-keys) when the
    declaration is usable, else None: "not declared" and "declared but
    invalid" are the same state downstream - the fill stays on its derived
    default rather than painting a face the author never saw validated.

    owner names the control and subject the specific subject (a layer name);
    source is how the caller wrote it. Python validates the STRUCTURAL shape
    only (mapping, mode/field presence, contradictions, known keys, the
    declared colour/opacity shape); the value-mode field TYPE validation lives
    in the JS reader, the same division border follows.
    """
    if raw is None:
        return None

    where = f"{owner}: {subject}" if subject else owner
    declared = source or f"foliplus[{FILL_KEY!r}]"

    def reject(reason: str) -> None:
        note = f"{owner}:{subject or '-'}:fill:{reason}"
        warn_foliplus(
            note,
            f"{where} declares {declared} {reason} - ignored",
        )

    if not isinstance(raw, Mapping):
        reject(f"as {type(raw).__name__}; expected a mapping")
        return None

    VALUE_KEYS = ("field", "method", "classes", "scheme", "kind")
    MODE_LITERALS = ("solid", "value", "original")
    allowed = {"mode", "color", "opacity", *VALUE_KEYS}
    for key in sorted((key for key in raw if key not in allowed), key=repr):
        reject(
            f"with unknown key {key!r}; expected only "
            f"{', '.join(sorted(allowed, key=repr))}"
        )

    has_field = "field" in raw
    mode = raw.get("mode")

    if mode is None:
        if has_field:
            mode = "value"
        elif "color" in raw or "opacity" in raw:
            # The panel's solid row is colour + opacity; a declaration naming
            # either (or both) is the solid read-time default.
            mode = "solid"
        else:
            reject(
                "without a mode, a field, a color or an opacity; expected "
                "{'mode': 'solid', 'color': ...} or {'field': ...}"
            )
            return None
    elif mode not in MODE_LITERALS:
        reject(f"with a mode {mode!r}; expected 'solid', 'value' or 'original'")
        return None

    if mode != "value":
        if has_field:
            reject(f"with a field; {mode!r} contradicts a value-mode field")
            return None
        extra = [key for key in VALUE_KEYS if key != "field" and key in raw]
        if extra:
            reject(f"with {', '.join(extra)}; {mode!r} does not classify by value")
            return None
    elif not has_field:
        reject("with a mode 'value' but no field; value mode requires a field")
        return None

    if mode != "solid" and "color" in raw:
        reject(f"with a color; {mode!r} contradicts a solid colour")
        return None

    record: dict[str, object] = {"mode": mode}
    if mode == "value":
        record["field"] = raw["field"]
    color = _declared_hex(raw.get("color"), reject)
    if color is not None:
        record["color"] = color
    opacity = _declared_opacity(raw.get("opacity"), reject)
    if opacity is not None:
        record["opacity"] = opacity
    return record


# ── Folder declaration ───────────────────────────────────────────────────
