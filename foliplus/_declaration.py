"""Normalisation for the author-facing declarations.

Two payloads reach Python, and both are *declarations* rather than values the
runtime computes:

* the zoom range: a layer writes ``foliplus={"zoom_range": {...}}`` and the
  two declarative controls take ``zoom_range={...}`` directly; it gates
  visibility on the map's zoom level.
* the filter: HeatmapControl / MeasureControl take ``filter=...``; it is
  normalised into the filter AST the JS runtime already speaks
  (foliplus/js/core/layer/filter.ts), so CONF never grows a second dialect.

The entry points differ (a control is not a folium layer, and a filter has an
arm the owner chooses), but the verdict rule is shared: a malformed
declaration is reported once and then treated exactly like "not declared",
never as a reason to hide data or take the page down. The warning family is
process-wide (see :data:`foliplus_reports`), so re-rendering a page does not
repeat a line.

A filter declaration has one deliberate exception to "never raises": a
``field`` key inside a range declaration, or a range with no bound field, is
API misuse and raises ValueError in the author's cell instead of being buried
in a warning among the page output.
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

import folium

# ── Shared diagnostics ───────────────────────────────────────────────────
# Diagnostics already reported in this process, so re-rendering a page does not
# repeat the same line. Each family owns its own filter: the foliplus={...}
# declaration rejections and the refused captions (#781) do not crowd each
# other out at the cap.
refused_captions: set[tuple[str, ...]] = set()
foliplus_reports: set[tuple[str, ...]] = set()

LOG_FILTER_CAP = 64

#: Directory of this package with a trailing separator, so a sibling whose name
#: merely starts with it (e.g. "foliplus-demo") cannot pass for library code.
PACKAGE_DIR = str(Path(__file__).resolve().parent) + os.sep
#: Installed dependency tree. A foliplus= warning is raised while the control is
#: being *rendered*, so between this package and the author's cell sit the Jinja
#: template machinery, folium and branca. Pointing the warning at
#: jinja2/environment.py would be technically accurate and useless; the walk
#: skips the plumbing too, and stops at the first frame that is neither this
#: package nor an installed dependency.
DEPENDENCY_DIR = str(Path(folium.__file__).resolve().parent.parent) + os.sep
PLUMBING_DIRS = (PACKAGE_DIR, DEPENDENCY_DIR)


def is_plumbing(filename: str) -> bool:
    """True for a frame that is machinery, not the author's code.

    Three shapes count: this package; the installed dependency tree (a render
    passes through jinja2, folium and branca); and a synthetic source name -
    Jinja compiles a template *string* to a code object whose filename is
    "<template>", and that is the frame a render-time warning is raised from.
    """
    return filename.startswith(PLUMBING_DIRS) or filename.startswith("<")


def caller_stacklevel() -> int:
    """Frames from warnings.warn out to the first frame that is the author's.

    A fixed stacklevel cannot work here, and that is a fact of the call path
    rather than a guess: a layer declaration is read during the Jinja render,
    which compiles the control template to a "<template>" frame and calls
    through its own interpreter frames, so between this package and the
    author's cell sit the template frame, jinja2 and folium. The depth also
    differs between call paths (a control declaration is read at construction,
    one frame lower). Walking out to the first frame that is not plumbing is
    therefore the only stable rule.
    """
    frame: FrameType | None = sys._getframe(1)  # the warning helper that called us
    level = 1
    while frame is not None:
        if not is_plumbing(frame.f_code.co_filename):
            return level
        frame = frame.f_back
        level += 1
    return level  # pragma: no cover - only when the whole stack is library code


def should_report(note: tuple[str, ...], store: set[tuple[str, ...]]) -> bool:
    """True when this diagnostic has not been printed in this process yet.

    ``store`` is the family's own filter (one per diagnostic family, so the
    families do not crowd each other out at the cap). The cap keeps a long
    process that renders many maps from growing the set without bound;
    clearing it wholesale is what #781 chose over an LRU.
    """
    if note in store:
        return False
    if len(store) >= LOG_FILTER_CAP:
        store.clear()
    store.add(note)
    return True


def warn_foliplus(note: str, message: str) -> None:
    """Report one unusable foliplus={...} declaration at the line that wrote it.

    De-duplicated through the same process-wide log-filter mechanism as the
    refused captions, but its own family store (see :func:`should_report` and
    the ``foliplus_reports`` / ``refused_captions`` split): the note carries
    the owner and the defect, so one typo on three layers prints three
    attributable warnings and re-rendering the same page stays quiet. Never
    raises: a typo in the declaration namespace is a warning, not a page
    failure.
    """
    if not should_report(("foliplus", note), foliplus_reports):
        return
    warnings.warn(message, UserWarning, stacklevel=caller_stacklevel())


# ── Zoom-range declaration ───────────────────────────────────────────────
#: The declaration key that asks for a visibility window over map zoom levels.
ZOOM_RANGE_KEY = "zoom_range"


def zoom_level(raw: object) -> int | None:
    """One declared zoom end as an int, or None when it is not an integer.

    ``numbers.Integral`` rather than ``int`` so a numpy/pandas scalar from a
    data-driven declaration is accepted like any other integer; the result is
    narrowed to a plain ``int`` so the caller's comparison and the emitted dict
    stay in int territory (and JSON-serialisable). ``bool`` is an ``int``
    subclass but never a zoom level, so it is rejected too. Returning the
    narrowed value keeps the caller from re-checking after the loop.
    """
    if isinstance(raw, bool) or not isinstance(raw, numbers.Integral):
        return None
    return int(raw)


def normalise_zoom_range(
    raw: object,
    *,
    owner: str,
    subject: str | None = None,
    source: str | None = None,
) -> dict[str, int] | None:
    """Normalise one declared ``{"min": ..., "max": ...}`` zoom range.

    Returns ``{"min": int, "max": int}`` when the declaration is usable, else
    ``None``: "not declared" and "declared but invalid" are the same state
    downstream - the visibility policy stays unconstrained rather than hiding
    the layer/control on a payload the author never saw validated.

    ``owner`` names the control and ``subject`` the specific subject (a layer
    name), so every message and de-duplication note is attributable. ``source``
    is how the author wrote it (the layer's ``foliplus['zoom_range']`` or a
    control's ``zoom_range=``), so the warning points at the entry point they
    used. Both keys are required, must be integers, and must be ordered;
    anything else warns once and is ignored.
    """
    if raw is None:
        return None

    where = f"{owner}: {subject}" if subject else owner
    declared = source or f"foliplus[{ZOOM_RANGE_KEY!r}]"

    def _reject(reason: str) -> None:
        note = f"{owner}:{subject or '-'}:zoom_range:{reason}"
        warn_foliplus(
            note,
            f"{where} declares {declared} {reason} - ignored",
        )

    if not isinstance(raw, Mapping):
        _reject(f"as {type(raw).__name__}; expected a mapping")
        return None
    # ``key=repr`` keeps a mixed-type payload (``{1: ..., "min": ...}``) from
    # raising inside ``sorted``: a malformed declaration warns, it never takes
    # the page down.
    extra = sorted((key for key in raw if key not in {"min", "max"}), key=repr)
    if extra:
        _reject(f"with unknown key(s) {extra}; expected only min and max")
        return None
    raw_lo, raw_hi = raw.get("min"), raw.get("max")
    lo, hi = zoom_level(raw_lo), zoom_level(raw_hi)
    if lo is None:
        _reject(f"with a non-integer min={raw_lo!r}")
        return None
    if hi is None:
        _reject(f"with a non-integer max={raw_hi!r}")
        return None
    if lo > hi:
        _reject(f"with min={lo} > max={hi}")
        return None
    return {"min": lo, "max": hi}


# ── Filter declaration ───────────────────────────────────────────────────
#: The field the measurement-type filter is bound to. Mirrors
#: CONST.FILTER.FIELD in foliplus/js/MeasureControl/const.ts: the enum arm
#: emits it so CONF carries a complete AST atom.
MEASURE_TYPE_FIELD = "type"

FilterArm = Literal["range", "enum"]


def warn_filter(message: str) -> None:
    """Report one unusable filter declaration at the line that wrote it.

    Never raises: a data-shaped problem (a range outside the field, a type
    name the runtime does not know) must be visible and ignored, not take the
    page down.

    The frame walk in :func:`caller_stacklevel` is shared with the zoom-range
    reader: a fixed stacklevel cannot cover both a control's ``__init__`` and a
    layer read during the Jinja render.
    """
    warnings.warn(message, UserWarning, stacklevel=caller_stacklevel())


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
    raw: Mapping[Any, Any], owner: str, bound_field: str | None
) -> dict[str, Any] | None:
    """The numeric arm: {min: low, max: high} -> a between atom on bound_field.

    The range is bound to the control's aggregation field (``field=``), never
    written into the declaration: ``filter`` carries only the range, and the
    field the runtime filters is the one the heatmap aggregates by. Writing a
    ``field`` key inside ``filter`` is API misuse (the same information is the
    ``field=`` argument) and raises ValueError. Endpoints leave here as
    JSON-native numbers (see ``json_number``): everything downstream of the
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
        warn_filter(
            f"{owner}: filter= has unknown key(s) {unknown}; expected only "
            f"'min' and 'max'; ignored"
        )
        return None
    if "min" not in raw or "max" not in raw:
        warn_filter(
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
            warn_filter(
                f"{owner}: filter['{key}'] must be a finite number; "
                f"got {value!r}; ignored"
            )
            return None
    low, high = raw["min"], raw["max"]
    if low > high:
        warn_filter(f"{owner}: filter= is inverted (min > max); ignored")
        return None
    return {
        "kind": "atom",
        "field": bound_field,
        "op": "between",
        "range": [json_number(low), json_number(high)],
    }


def enum_atom(
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
            warn_filter(
                f"{owner}: filter= list entries must be non-empty strings; "
                f"got {item!r}; ignored"
            )
            return None
        if item not in values:
            values.append(item)
    if not values:
        warn_filter(
            f"{owner}: filter= is an empty list, which would mean no filter; ignored"
        )
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
            return range_atom(raw, owner, bound_field)
        warn_filter(
            f"{owner}: filter= must be a mapping with min and max; "
            f"got {type(raw).__name__}; ignored"
        )
        return None
    if not enum_field:  # pragma: no cover - both call sites pass one
        raise ValueError("arm='enum' requires enum_field")
    if isinstance(raw, Sequence) and not isinstance(raw, (str, bytes)):
        return enum_atom(raw, owner, enum_field)
    warn_filter(
        f"{owner}: filter= must be a list of value names; "
        f"got {type(raw).__name__}; ignored"
    )
    return None
