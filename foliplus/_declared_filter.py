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
    ``json.dumps``, and ``between=[df["pop"].min(), df["pop"].max()]`` is the
    natural way to write a declaration from a frame - so the AST carries
    builtins only (``numbers.Integral`` -> int, every other Real -> float).
    """
    if isinstance(value, numbers.Integral):
        return int(value)
    return float(value)


def _range_atom(raw: Mapping[Any, Any], owner: str) -> dict[str, Any] | None:
    """The numeric arm: {field, between: [low, high]} -> a between atom.

    Endpoints leave here as JSON-native numbers (see ``_json_number``):
    everything downstream of the AST is serialised, not interpreted.
    """
    field = raw.get("field")
    if not isinstance(field, str) or not field.strip():
        raise ValueError(
            f"{owner}: filter= needs a non-empty 'field' naming the numeric "
            f"field to filter; got {field!r}"
        )
    unknown = sorted(str(key) for key in raw if key not in {"field", "between"})
    if unknown:
        _warn(f"{owner}: filter= has unknown key(s) {unknown}; ignored")
        return None
    between = raw.get("between")
    if (
        not isinstance(between, Sequence)
        or isinstance(between, (str, bytes))
        or len(between) != 2
    ):
        _warn(
            f"{owner}: filter['between'] must be [low, high]; got {between!r}; ignored"
        )
        return None
    low, high = between
    for name, value in (("low", low), ("high", high)):
        if (
            isinstance(value, bool)
            or not isinstance(value, numbers.Real)
            or not math.isfinite(value)
        ):
            _warn(
                f"{owner}: filter['between'] {name} must be a finite number; "
                f"got {value!r}; ignored"
            )
            return None
    if low > high:
        _warn(f"{owner}: filter['between'] is inverted ({low} > {high}); ignored")
        return None
    return {
        "kind": "atom",
        "field": field.strip(),
        "op": "between",
        "range": [_json_number(low), _json_number(high)],
    }


def _enum_atom(
    raw: Sequence[Any], owner: str, enum_field: str
) -> dict[str, Any] | None:
    """The equality arm: a list of value names -> an enum atom."""
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
) -> dict[str, Any] | None:
    """Normalise one control's filter= declaration into the shared AST.

    Two friendly arms, one AST:

    - arm="range": a mapping with field + between -> a numeric range atom
      (HeatmapControl; the field names the field the panel filters).
    - arm="enum": a list of value names -> an enum atom (MeasureControl; the
      field is enum_field).

    Returns None for "not declared" and for "declared but unusable" - both
    mean the runtime starts unfiltered, never filtered-to-empty. A missing or
    non-string field is API misuse and raises ValueError: it fails in the
    author's notebook cell, where the typo is, instead of being buried in a
    warning among the page output.
    """
    if raw is None:
        return None
    if arm == "range":
        if isinstance(raw, Mapping):
            return _range_atom(raw, owner)
        _warn(
            f"{owner}: filter= must be a mapping with field/between; "
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
