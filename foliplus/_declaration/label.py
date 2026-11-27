"""Label declarations: the per-layer text-label defaults.

The foliplus={"label": {...}} block is the one declaration whose every
consumer is the JS panel's label manager. Before this module Python checked
only that the block was a mapping, so a wrong type, an unknown key or an
out-of-range value was silently dropped by the JS reader - the author saw a
built-in default instead of a typo. This normaliser owns the values (the
format vocabulary, the colour hex shape, the size bounds, the field/collide/
show types) and reports every rejected key once, so "declared but unusable"
is a warning rather than a silent downgrade.

The normalised record is the one fact the JS side reads: _collect.py puts it
into CONF data[].label, and the label manager applies it as the middle layer
of its defaults -> declaration -> user-choice merge. The raw
layer.options.foliplus namespace is no longer a second read channel for
labels, the same single-normaliser split filter already follows.

The JS mirror is readDeclaredLabel in
foliplus/js/control/LayerControl/label/index.ts (it reads this record rather
than picking fields): a key accepted here must be one the label manager
consumes, and the format literals / size bounds below must stay in step with
NUMBER_FORMAT (platform/format.ts) and LABEL_SIZE (ui/form.ts), or the same
declaration would be valid in one channel and ignored in the other.
"""

from __future__ import annotations

import math
import numbers
from collections.abc import Mapping

from .key import LABEL_KEY
from .paint import _declared_hex
from .warning import warn_foliplus

#: The number formats a declared format may name. Mirrors NUMBER_FORMAT in
#: foliplus/js/platform/format.ts, the source of the NumberStyle union the
#: generated config schema carries - keep the two in step.
NUMBER_FORMATS = ("auto", "int", "comma", "percent")

#: The label font-size bounds in px. Mirrors LABEL_SIZE in
#: foliplus/js/ui/form.ts (the style panel's number input and the shared
#: clampLabelSize); a declared size outside them is clamped, not dropped, so
#: the behaviour matches the panel's own input clamp while the author is told.
LABEL_SIZE_MIN = 6
LABEL_SIZE_MAX = 32

#: The keys the block accepts - the dimensions the style drawer's label row
#: can set. A reported unknown key is dropped; the remaining keys still apply.
_LABEL_KEYS = ("field", "format", "color", "size", "collide", "show")


def normalise_label(
    raw: object,
    *,
    owner: str,
    subject: str | None = None,
    source: str | None = None,
) -> dict[str, object] | None:
    """Normalise one declared foliplus={"label": {...}} block.

    Returns the canonical partial record (only the keys the author wrote, plus
    the show a declared field implies) when anything in the block is usable,
    else None: "not declared" and "declared but unusable" are the same state
    downstream - the label config stays on its built-in default rather than
    showing a value the author never saw accepted.

    Each key is validated on its own, the same way fill/border validate their
    sub-keys: one bad sibling (a non-hex colour) warns and drops that key,
    while the others (a valid field, format) still apply. Unknown keys warn
    too. field must be a non-empty string, format one of NUMBER_FORMATS,
    color a CSS hex, size a finite number (clamped to LABEL_SIZE_MIN..
    LABEL_SIZE_MAX with a warning), and collide / show booleans.

    Declaring a field turns the labels on unless show says otherwise - the
    built-in default is off, so the field alone would only be the panel's
    starting value. That rule lives here rather than in the JS reader so the
    record stays the single, complete declaration fact.

    owner names the control and subject the specific subject (a layer name),
    so every message and de-duplication note is attributable. source is how the
    caller wrote it (the layer's foliplus['label']), so the warning points at
    the entry point they used.
    """
    if raw is None:
        return None

    where = f"{owner}: {subject}" if subject else owner
    declared = source or f"foliplus[{LABEL_KEY!r}]"

    def reject(reason: str) -> None:
        note = f"{owner}:{subject or '-'}:label:{reason}"
        warn_foliplus(
            note,
            f"{where} declares {declared} {reason} - ignored",
        )

    if not isinstance(raw, Mapping):
        reject(f"as {type(raw).__name__}; expected a mapping")
        return None

    # key=repr keeps a mixed-type payload ({1: ..., "field": ...}) from raising
    # inside sorted: a malformed declaration warns, it never takes the page
    # down.
    for key in sorted((key for key in raw if key not in _LABEL_KEYS), key=repr):
        reject(f"with unknown key {key!r}; expected only {', '.join(_LABEL_KEYS)}")

    record: dict[str, object] = {}

    if "field" in raw:
        field = raw["field"]
        if not isinstance(field, str):
            reject(f"with a field {field!r}; expected a non-empty string")
        elif not field.strip():
            reject(
                "with an empty or whitespace-only field; expected a non-empty string"
            )
        else:
            record["field"] = field.strip()

    if "format" in raw:
        fmt = raw["format"]
        if not isinstance(fmt, str) or fmt not in NUMBER_FORMATS:
            reject(
                f"with a format {fmt!r}; expected one of {', '.join(NUMBER_FORMATS)}"
            )
        else:
            record["format"] = fmt

    if "color" in raw:
        color = raw["color"]
        if color is None:
            reject(f"with a color {color!r}; expected a CSS hex (#rgb or #rrggbb)")
        else:
            normalised_color = _declared_hex(color, reject)
            if normalised_color is not None:
                record["color"] = normalised_color

    if "size" in raw:
        size = raw["size"]
        if isinstance(size, bool) or not isinstance(size, numbers.Real):
            reject(
                f"with a size {size!r}; expected a number from "
                f"{LABEL_SIZE_MIN} to {LABEL_SIZE_MAX}"
            )
        else:
            value = float(size)
            if not math.isfinite(value):
                reject(
                    f"with a size {value}; expected a number from "
                    f"{LABEL_SIZE_MIN} to {LABEL_SIZE_MAX}"
                )
            else:
                clamped = min(LABEL_SIZE_MAX, max(LABEL_SIZE_MIN, value))
                if clamped != value:
                    note = f"{owner}:{subject or '-'}:label:size:{value}"
                    warn_foliplus(
                        note,
                        f"{where} declares {declared} with a size {value}; "
                        f"expected {LABEL_SIZE_MIN} to {LABEL_SIZE_MAX} - "
                        f"clamped to {clamped:g}",
                    )
                whole = int(clamped)
                record["size"] = whole if clamped == whole else clamped

    if "collide" in raw:
        if not isinstance(raw["collide"], bool):
            reject(f"with a collide {raw['collide']!r}; expected a bool")
        else:
            record["collide"] = raw["collide"]

    if "show" in raw:
        if not isinstance(raw["show"], bool):
            reject(f"with a show {raw['show']!r}; expected a bool")
        else:
            record["show"] = raw["show"]
    if "show" not in record and "field" in record:
        # A declared field turns the labels on; an explicit show:false remains
        # the escape hatch (name the field for the panel, keep the map clean).
        # An invalid show is ignored like an absent one, so the field rule
        # still applies rather than leaving the labels silently off.
        record["show"] = True

    return record or None
