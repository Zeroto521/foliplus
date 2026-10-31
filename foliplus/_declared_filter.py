"""Normalisation for the filter declarations on HeatmapControl / MeasureControl.

One helper for both controls: the friendly declaration a user writes is
normalised here into the filter AST the JS runtime already speaks
(foliplus/js/core/layer/filter.ts), so CONF never grows a second dialect.
The runtime reads the result through its tolerant AST parser and applies the
same domain rules it applies to a panel-written filter.

The arm is the owner's, not the payload's: HeatmapControl declares a numeric
range and MeasureControl declares an enum, and neither may emit an atom its
panel cannot render (the "declared but the panel cannot show it" gap this
whole line of work exists to close).
"""

from __future__ import annotations

import math
import numbers
import os
import sys
import warnings
from collections.abc import Mapping, Sequence
from pathlib import Path
from types import FrameType
from typing import Any, Literal

#: The field the measurement-type filter is bound to. Mirrors
#: CONST.FILTER.FIELD in foliplus/js/MeasureControl/const.ts: the enum arm
#: emits it so CONF carries a complete AST atom.
MEASURE_TYPE_FIELD = "type"

FilterArm = Literal["range", "enum"]


#: This package's directory, with a trailing separator so a sibling whose name
#: merely starts with it (``foliplus-demo``) cannot pass for library code. A
#: declaration is written in the caller's cell, so a warning has to walk out of
#: here to find the line worth pointing at.
_PACKAGE_DIR = str(Path(__file__).resolve().parent) + os.sep


def _caller_stacklevel() -> int:
    """Frames from ``warnings.warn`` out to the first frame outside this package.

    The depth differs per call path - an arm helper is one frame further in
    than the shape checks ``normalize_declared_filter`` makes itself - so the
    caller's frame is found by walking out of the package instead of
    hard-coding one number per call site.
    """
    frame: FrameType | None = sys._getframe(1)  # _warn, the warn() caller
    level = 1
    while frame is not None:
        if not frame.f_code.co_filename.startswith(_PACKAGE_DIR):
            return level
        frame = frame.f_back
        level += 1
    return level  # pragma: no cover - only when the whole stack is library code


def _warn(message: str) -> None:
    """Report one unusable declaration at the line that wrote it.

    Never raises: a data-shaped problem (a range outside the field, a type
    name the runtime does not know) must be visible and ignored, not take the
    page down.
    """
    warnings.warn(message, UserWarning, stacklevel=_caller_stacklevel())


def _json_number(value: numbers.Real) -> int | float:
    """Coerce a validated endpoint to a number ``json`` can serialise.

    numpy and pandas scalars pass the ``numbers.Real`` check but not
    ``json.dumps``, and ``{"min": df["pop"].min(), "max": df["pop"].max()}`` is the
    natural way to write a declaration from a frame - so the AST carries
    builtins only (``numbers.Integral`` -> int, every other Real -> float).
    """
    if isinstance(value, numbers.Integral):
        return int(value)
    return float(value)


def _range_atom(
    raw: Mapping[Any, Any], owner: str, bound_field: str | None
) -> dict[str, Any] | None:
    """The numeric arm: {min: low, max: high} -> a between atom on bound_field.

    The range is bound to the control's aggregation field (``field=``), never
    written into the declaration: ``filter`` carries only the range, and the
    field the runtime filters is the one the heatmap aggregates by. Writing a
    ``field`` key inside ``filter`` is API misuse (the same information is the
    ``field=`` argument) and raises ValueError. Endpoints leave here as
    JSON-native numbers (see ``_json_number``): everything downstream of the
    AST is serialised, not interpreted.
    """
    if "field" in raw:
        raise ValueError(
            f"{owner}: drop 'field' from filter= — the range is bound to the "
            f"aggregation field (field={bound_field!r})."
        )
    if not bound_field:
        raise ValueError(
            f"{owner}: filter= needs the aggregation field it binds to — pass "
            f"field='<column>' (a value aggregation, not agg='count')."
        )
    unknown = sorted(str(key) for key in raw if key not in {"min", "max"})
    if unknown:
        _warn(f"{owner}: filter= has unknown key(s) {unknown}; ignored")
        return None
    if "min" not in raw or "max" not in raw:
        _warn(
            f"{owner}: filter= needs both 'min' and 'max'; "
            f"got key(s) {sorted(str(key) for key in raw)}; ignored"
        )
        return None
    for key in ("min", "max"):
        value = raw[key]
        if (
            isinstance(value, bool)
            or not isinstance(value, numbers.Real)
            or not math.isfinite(value)
        ):
            _warn(
                f"{owner}: filter['{key}'] must be a finite number; "
                f"got {value!r}; ignored"
            )
            return None
    low, high = raw["min"], raw["max"]
    if low > high:
        _warn(f"{owner}: filter= is inverted (min > max); ignored")
        return None
    return {
        "kind": "atom",
        "field": bound_field,
        "op": "between",
        "range": [_json_number(low), _json_number(high)],
    }


def _enum_atom(
    raw: Sequence[Any], owner: str, enum_field: str
) -> dict[str, Any] | None:
    """The equality arm: a list of value names -> an enum atom.

    Value names are not validated here on purpose: the measurement-type
    vocabulary is the runtime's (MeasureControl/const.ts MEASURE_TYPE_*), so
    the JS normalizer drops the names it does not know. A declaration naming
    one unknown value among known ones therefore starts filtered on the known
    values and drops the unknown one silently; only a declaration whose every
    name is unknown is reported and ignored ("no declared value is a
    measurement type", MeasureControl/manager.ts warnDeclaredFilter).
    Duplicating the vocabulary here would be a second closed set to keep in
    step with the runtime's.
    """
    values: list[str] = []
    for item in raw:
        if not isinstance(item, str) or not item.strip():
            _warn(
                f"{owner}: filter= list entries must be non-empty strings; "
                f"got {item!r}; ignored"
            )
            return None
        if item not in values:
            values.append(item)
    if not values:
        _warn(f"{owner}: filter= is an empty list, which would mean no filter; ignored")
        return None
    return {"kind": "enum", "field": enum_field, "values": values}


def normalize_declared_filter(
    raw: object,
    *,
    owner: str,
    arm: FilterArm,
    enum_field: str | None = None,
    bound_field: str | None = None,
) -> dict[str, Any] | None:
    """Normalise one control's filter= declaration into the shared AST.

    Two friendly arms, one AST:

    - arm="range": a mapping with min and max -> a numeric range atom bound to
      bound_field (HeatmapControl; the range is bound to the aggregation field
      field=, never written into the declaration).
    - arm="enum": a list of value names -> an enum atom (MeasureControl; the
      field is enum_field).

    Returns None for "not declared" and for "declared but unusable" - both
    mean the runtime starts unfiltered, never filtered-to-empty. A ``field``
    key inside a range declaration is API misuse (the range is bound to the
    aggregation field) and raises ValueError; a range declaration with no
    bound field (no field=, or agg="count") also raises ValueError — the
    bound-field check runs before the ``min``/``max`` validation, so an inverted
    or malformed range with no field still raises instead of being masked by
    a warning. It fails in the author's notebook cell, where the typo is,
    instead of being buried in a warning among the page output.
    """
    if raw is None:
        return None
    if arm == "range":
        if isinstance(raw, Mapping):
            return _range_atom(raw, owner, bound_field)
        _warn(
            f"{owner}: filter= must be a mapping with min and max; "
            f"got {type(raw).__name__}; ignored"
        )
        return None
    if not enum_field:  # pragma: no cover - both call sites pass one
        raise ValueError("arm='enum' requires enum_field")
    if isinstance(raw, Sequence) and not isinstance(raw, (str, bytes)):
        return _enum_atom(raw, owner, enum_field)
    _warn(
        f"{owner}: filter= must be a list of value names; "
        f"got {type(raw).__name__}; ignored"
    )
    return None
