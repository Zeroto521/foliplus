"""Paint declarations: the colour/weight/opacity readers behind border and fill."""

from __future__ import annotations

import math
import numbers
import re
from collections.abc import Callable, Mapping
from typing import Any, Literal

from .key import BORDER_KEY
from .warning import caller_stacklevel, warn_foliplus

#: The CSS hex shapes a declared marker chassis colour may take (#rgb or
#: #rrggbb). The shape is validated here so a malformed hex warns at
#: collection time; the value is normalised here too (see
#: normalise_marker_color) so both channels carry the same string.
#: KEEP IN STEP with isHexColor / normalizeHexColor in
#: foliplus/js/platform/color.ts - this regex is a hand-copied twin of
#: the JS one (follow-up guard card pending); if one side widens the
#: shape the other must widen too or a hex one side paints the other
#: rejects.
_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$")


def _expand_hex(name: str) -> str:
    """Expand a CSS hex to 6-digit lowercase (#rgb -> #rrggbb).

    Mirrors normalizeHexColor in foliplus/js/platform/color.ts: both stacks
    must carry one spelling for one declared colour, or one side's value would
    miss the other side's comparison.
    """
    if len(name) == 4:  # "#rgb"
        r, g, b = name[1], name[2], name[3]
        return f"#{r}{r}{g}{g}{b}{b}".lower()
    return name.lower()


def _declared_hex(
    raw: object,
    reject: Callable[[str], None],
) -> str | None:
    """Normalise one declared colour, or reject it and return None.

    The shape (#rgb / #rrggbb) is the same hand-copied twin of the JS
    isHexColor the marker chassis colour uses; the value is expanded and
    lowered exactly as the JS reader does, so both channels carry one spelling
    for one declared colour. reject owns the wording and the warn-once.
    """
    if raw is None:
        return None
    if not isinstance(raw, str) or not _HEX_COLOR_RE.match(raw.strip()):
        reject(f"with a color {raw!r}; expected a CSS hex (#rgb or #rrggbb)")
        return None
    return _expand_hex(raw.strip())


def _declared_weight(
    raw: object,
    reject: Callable[[str], None],
) -> int | float | None:
    """Normalise one declared border weight, or reject it and return None.

    A stroke width is a positive number of pixels; a zero/negative/non-finite
    value would hide or corrupt the stroke, and a bool is an int subclass that
    is never a weight. An integral value is narrowed to int so the emitted
    record stays JSON-serialisable in its natural spelling.
    """
    if raw is None:
        return None
    if isinstance(raw, bool) or not isinstance(raw, numbers.Real):
        reject(f"with a weight {raw!r}; expected a positive number")
        return None
    weight = float(raw)
    if not math.isfinite(weight) or weight <= 0:
        reject(f"with a weight {raw!r}; expected a positive number")
        return None
    return int(weight) if weight.is_integer() else weight


def _declared_opacity(
    raw: object,
    reject: Callable[[str], None],
) -> float | None:
    """Normalise one declared fill opacity, or reject it and return None.

    The unit is Leaflet's fillOpacity (0 = transparent, 1 = opaque), the same
    0-1 unit the panel stores; a bool and a non-finite/out-of-range value are
    rejected so the runtime never paints an unvalidated opacity.
    """
    if raw is None:
        return None
    if isinstance(raw, bool) or not isinstance(raw, numbers.Real):
        reject(f"with an opacity {raw!r}; expected a number from 0 to 1")
        return None
    opacity = float(raw)
    if not math.isfinite(opacity) or not 0 <= opacity <= 1:
        reject(f"with an opacity {raw!r}; expected a number from 0 to 1")
        return None
    return opacity


# ── Border declaration ────────────────────────────────────────────────
def normalise_border(
    raw: object,
    *,
    owner: str,
    subject: str | None = None,
    source: str | None = None,
) -> dict[str, object] | None:
    """Normalise one declared border into its single canonical shape.

    Two declaration shapes converge here (the lead's single-rule-table ruling,
    mirrored 1:1 by the JS parseBorder): a mode-shell mapping with a "mode" key
    and the flat fill-isomorphic form with a "field" key (implicit value mode).
    "mode", when present, is authoritative: a mode plus a contradictory key is
    invalid. A declaration that names neither a mode, a field, a colour nor a
    weight is dropped whole.

    The accepted modes are "follow_fill" (the border follows the fill's paint),
    "value" (classify by a field), "solid" (one declared colour) and
    "original" (the author's own stroke). "color" (a CSS hex) is the solid
    mode's colour and "weight" (a positive pixel number) rides every mode —
    the two sub-dimensions the panel's border row can set, now expressible as a
    read-time default.

    Returns the normalised record ("mode" plus the declared sub-keys) when the
    declaration is usable, else None: "not declared" and "declared but
    invalid" are the same state downstream - the border stays on its derived
    default (original/solid) rather than painting a mode the author never saw
    validated.

    owner names the control and subject the specific subject (a layer name),
    so every message and de-duplication note is attributable. source is how the
    caller wrote it (the layer's foliplus['border']), so the warning points at
    the entry point they used.

    Python validates the STRUCTURAL shape only (mapping, mode/field presence,
    contradictions, known keys, the declared colour/weight shape) — the field
    TYPE validation lives in the JS reader, the same division the fill
    declaration follows (Python gates the fill mapping shape, JS validates
    fill's fields), so Python can never be stricter or looser than JS on what
    an author may write.
    """
    if raw is None:
        return None

    where = f"{owner}: {subject}" if subject else owner
    declared = source or f"foliplus[{BORDER_KEY!r}]"

    def reject(reason: str) -> None:
        note = f"{owner}:{subject or '-'}:border:{reason}"
        warn_foliplus(
            note,
            f"{where} declares {declared} {reason} - ignored",
        )

    if not isinstance(raw, Mapping):
        reject(f"as {type(raw).__name__}; expected a mapping")
        return None

    VALUE_KEYS = ("field", "method", "classes", "scheme", "kind")
    MODE_LITERALS = ("follow_fill", "value", "solid", "original")
    allowed = {"mode", "color", "weight", *VALUE_KEYS}
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
        elif "color" in raw or "weight" in raw:
            # The panel's solid row is colour + width; a declaration naming
            # either (or both) is the solid read-time default.
            mode = "solid"
        else:
            reject(
                "without a mode or a field; expected {'mode': 'follow_fill'}, "
                "{'field': ...} or {'color': ...}"
            )
            return None
    elif mode not in MODE_LITERALS:
        reject(
            f"with a mode {mode!r}; expected 'follow_fill', 'value', "
            "'solid' or 'original'"
        )
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
    weight = _declared_weight(raw.get("weight"), reject)
    if weight is not None:
        record["weight"] = weight
    return record


# ── Fill declaration ──────────────────────────────────────────────────
