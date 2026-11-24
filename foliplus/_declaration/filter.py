"""Filter declarations: normalise the caller filter into the runtime AST."""

from __future__ import annotations

import math
import numbers
from collections.abc import Callable, Mapping, Sequence
from typing import Any, Literal

from .key import FILTER_KEY, MEASURE_TYPE_FIELD
from .warning import warn_filter, warn_foliplus

#: The filter's kind discriminator (a declared filter is a range or an enum).
FilterKind = Literal["range", "enum"]


def json_number(value: numbers.Real) -> int | float:
    """Coerce a validated endpoint to a number ``json`` can serialise.

    numpy and pandas scalars pass the ``numbers.Real`` check but not
    ``json.dumps``, and ``{"min": df["pop"].min(), "max": df["pop"].max()}`` is the
    natural way to write a declaration from a frame - so the AST carries
    builtins only (``numbers.Integral`` -> int, every other Real -> float).
    """
    if isinstance(value, numbers.Integral):
        return int(value)
    return float(value)


def range_atom(
    raw: Mapping[Any, Any],
    owner: str,
    bound_field: str | None,
    report: Callable[[str, str], None] | None = None,
) -> dict[str, Any] | None:
    """The min/max mapping form: {min: low, max: high} -> a between atom on bound_field.

    The range is bound to the control's aggregation field (``field=``), never
    written into the declaration: ``filter`` carries only the range, and the
    field the runtime filters is the one the heatmap aggregates by. Writing a
    ``field`` key inside ``filter`` is API misuse (the same information is the
    ``field=`` argument) and raises ValueError. Endpoints leave here as
    JSON-native numbers (see ``json_number``): everything downstream of the
    AST is serialised, not interpreted.
    """
    report = report or (lambda message, _reason: warn_filter(message))
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
        key_list = ",".join(unknown)
        report(
            f"{owner}: filter= has unknown key(s) {unknown}; expected only "
            f"'min' and 'max'; ignored",
            f"unknown-key:{key_list}",
        )
        return None
    if "min" not in raw or "max" not in raw:
        report(
            f"{owner}: filter= needs both 'min' and 'max'; "
            f"got key(s) {sorted(str(key) for key in raw)}; ignored",
            "missing-bound",
        )
        return None
    for key in ("min", "max"):
        value = raw[key]
        if (
            isinstance(value, bool)
            or not isinstance(value, numbers.Real)
            or not math.isfinite(value)
        ):
            report(
                f"{owner}: filter['{key}'] must be a finite number; "
                f"got {value!r}; ignored",
                f"non-finite:{key}",
            )
            return None
    low, high = raw["min"], raw["max"]
    if low > high:
        report(f"{owner}: filter= is inverted (min > max); ignored", "inverted")
        return None
    return {
        "kind": "atom",
        "field": bound_field,
        "op": "between",
        "range": [json_number(low), json_number(high)],
    }


def enum_atom(
    raw: Sequence[Any],
    owner: str,
    enum_field: str,
    report: Callable[[str, str], None] | None = None,
) -> dict[str, Any] | None:
    """The list form: a list of value names -> an enum atom.

    Value names are not validated here on purpose: the measurement-type
    vocabulary is the runtime's (MeasureControl/const.ts MEASURE_TYPE_*), so
    the JS reader validates the whole list at construction. One unknown name
    among known ones makes the declaration invalid as a whole: it warns once
    ("unknown measurement type(s): ...", MeasureControl/manager.ts
    declaredMeasureFilter) and the runtime starts unfiltered - never filtered
    on the known subset, because that would apply a condition nobody wrote.
    Duplicating the vocabulary here would be a second closed set to keep in
    step with the runtime's.
    """
    report = report or (lambda message, _reason: warn_filter(message))
    values: list[str] = []
    for item in raw:
        if not isinstance(item, str) or not item.strip():
            report(
                f"{owner}: filter= list entries must be non-empty strings; "
                f"got {item!r}; ignored",
                f"non-string-entry:{item!r}",
            )
            return None
        if item not in values:
            values.append(item)
    if not values:
        report(
            f"{owner}: filter= is an empty list, which would mean no filter; ignored",
            "empty-values",
        )
        return None
    return {"kind": "enum", "field": enum_field, "values": values}


def normalize_declared_filter(
    raw: object,
    *,
    owner: str,
    kind: FilterKind,
    enum_field: str | None = None,
    bound_field: str | None = None,
) -> dict[str, Any] | None:
    """Normalise one control's filter= declaration into the shared AST.

    Two friendly forms, one AST:

    - kind="range": a mapping with min and max -> a numeric range atom bound to
      bound_field (HeatmapControl; the range is bound to the aggregation field
      field=, never written into the declaration).
    - kind="enum": a list of value names -> an enum atom (MeasureControl; the
      field is enum_field).

    Returns None for "not declared" and for "declared but unusable" - both
    mean the runtime starts unfiltered, never filtered-to-empty. A ``field``
    key inside a range declaration is API misuse (the range is bound to the
    aggregation field) and raises ValueError; a range declaration with no
    bound field (no field=, or agg="count") also raises ValueError — the
    bound-field check runs before the ``min``/``max`` validation, so an inverted
    or malformed range with no field still raises instead of being masked by
    a warning. A list of values in the min/max mapping form is the list form of another
    owner (MeasureControl), so it also raises instead of being downgraded to
    "undeclared": the caller is using the wrong control, not a typo in the
    data. All three fail in the caller's notebook cell, where the mistake is,
    instead of being buried in a warning among the page output.
    """
    if raw is None:
        return None
    if kind == "range":
        if isinstance(raw, Mapping):
            return range_atom(raw, owner, bound_field)
        if isinstance(raw, Sequence) and not isinstance(raw, (str, bytes)):
            raise ValueError(
                f"{owner}: filter= was given a list of value names, which is the "
                f"list form; enum filters belong to MeasureControl. A range filter "
                f"takes a mapping {{'min': ..., 'max': ...}} bound to field=."
            )
        warn_filter(
            f"{owner}: filter= must be a mapping with min and max; "
            f"got {type(raw).__name__}; ignored"
        )
        return None
    if not enum_field:  # pragma: no cover - both call sites pass one
        raise ValueError("kind='enum' requires enum_field")
    if isinstance(raw, Sequence) and not isinstance(raw, (str, bytes)):
        return enum_atom(raw, owner, enum_field)
    warn_filter(
        f"{owner}: filter= must be a list of value names; "
        f"got {type(raw).__name__}; ignored"
    )
    return None


def normalise_layer_filter(
    raw: object,
    *,
    owner: str,
    subject: str | None = None,
    source: str | None = None,
) -> dict[str, object] | None:
    """Normalise one layer's {"filter": ...} declaration into the shared AST.

    Unlike the Heatmap/Measure filter= kwarg (whose field is the control's
    aggregation field), a per-layer declaration names its own field. Two
    friendly forms, one AST:

    - {"field": "pop", "min": 0, "max": 100} -> a between atom on 'pop'
    - {"field": "cat", "values": ["A", "B"]}  -> an enum atom on 'cat'

    This reader owns the layer-form *shape* gate (a mapping with a non-empty
    field string and exactly one form) and then delegates the value checks to
    the shared validators :func:`range_atom` / :func:`enum_atom` — one
    validator, two call sites (the control filter= kwarg and the per-layer
    foliplus declaration), so the AST and its defect verdicts cannot drift
    between the two entry points. The reporter passed down routes through
    :func:`warn_foliplus` with the layer-attributable note, keeping the
    layer form's "reported once per layer" contract.

    Returns None for not-declared and declared-but-unusable - both mean
    the layer starts unfiltered, never filtered-to-empty. owner names the
    control and subject the layer, so every message and de-duplication
    note is attributable; source points at the entry point the author
    used. The field is the layer's own property name, so it is required here
    (unlike the controls, where the aggregation field is a constructor
    argument); a declaration without one warns once and is ignored.
    """
    if raw is None:
        return None

    where = f"{owner}: {subject}" if subject else owner
    declared = source or "foliplus['filter']"

    def reject(message: str, reason: str) -> None:
        note = f"{owner}:{subject or '-'}:filter:{reason}"
        warn_foliplus(note, f"{where} declares {declared} {message} - ignored")

    if not isinstance(raw, Mapping):
        reject(f"as {type(raw).__name__}; expected a mapping", "shape")
        return None
    field = raw.get("field")
    if not isinstance(field, str) or not field.strip():
        reject("without a non-empty 'field' string", "field")
        return None
    extra = sorted(
        (key for key in raw if key not in {"field", "min", "max", "values"}),
        key=repr,
    )
    if extra:
        reject(
            f"with unknown key(s) {extra}; expected field plus min/max or values",
            "unknown-key:" + ",".join(map(repr, extra)),
        )
        return None
    if "values" in raw:
        if "min" in raw or "max" in raw:
            reject("with both 'values' and min/max; choose one form", "both-forms")
            return None
        raw_values = raw["values"]
        if not isinstance(raw_values, Sequence) or isinstance(raw_values, (str, bytes)):
            reject(
                f"with 'values' as {type(raw_values).__name__}; expected a list",
                "values-shape",
            )
            return None
        return enum_atom(raw_values, owner, field, report=reject)
    if "min" not in raw or "max" not in raw:
        reject("needing both 'min' and 'max' (range) or 'values' (enum)", "form")
        return None
    return range_atom(
        {key: raw[key] for key in ("min", "max")},
        owner,
        field,
        report=reject,
    )


# ── Declared style sub-dimensions (colour / weight / opacity) ──────────
