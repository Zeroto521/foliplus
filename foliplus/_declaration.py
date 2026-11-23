"""Normalisation for the caller-facing declarations.

Three payloads reach Python, and all are *declarations* rather than values
the runtime computes:

* the zoom range: a layer writes ``foliplus={"zoom_range": {...}}`` and the
  two declarative controls take ``zoom_range={...}`` directly; it gates
  visibility on the map's zoom level.
* the filter: HeatmapControl / MeasureControl take ``filter=...``; it is
  normalised into the filter AST the JS runtime already speaks
  (foliplus/js/core/layer/filter.ts), so CONF never grows a second dialect.
* the folder: a LayerControl layer carries ``foliplus={"folder": "..."}``; it is
  read and stripped into the layer attribute the runtime groups on, and a
  malformed name is reported once and treated as "not filed".

The entry points differ (a control is not a folium layer, and a filter has a
form the owner chooses), but the verdict rule is shared: a malformed
declaration is reported once and then treated exactly like "not declared",
never as a reason to hide data or take the page down. The warning family is
process-wide (see :data:`foliplus_reports`), so re-rendering a page does not
repeat a line.

A filter declaration has deliberate exceptions to "never raises": a ``field``
key inside a range declaration, a range with no bound field, or a list of
value names in the min/max mapping form (the list form belongs to MeasureControl) is API
misuse and raises ValueError in the caller's cell instead of being buried in a
warning among the page output.
"""

from __future__ import annotations

import math
import numbers
import os
import re
import sys
import unicodedata
import warnings
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
from types import FrameType
from typing import Any, Literal

import folium

# ── Module constants ─────────────────────────────────────────────────────
# Diagnostics already reported in this process, so re-rendering a page does not
# repeat the same line. Each family owns its own filter: the foliplus={...}
# declaration rejections and the refused captions do not crowd each other out
# at the cap.
refused_captions: set[tuple[str, ...]] = set()
foliplus_reports: set[tuple[str, ...]] = set()

LOG_FILTER_CAP = 64

#: Directory of this package with a trailing separator, so a sibling whose name
#: merely starts with it (e.g. "foliplus-demo") cannot pass for library code.
PACKAGE_DIR = str(Path(__file__).resolve().parent) + os.sep
#: Installed dependency tree. A foliplus= warning is raised while the control is
#: being *rendered*, so between this package and the caller's cell sit the Jinja
#: template machinery, folium and branca. Pointing the warning at
#: jinja2/environment.py would be technically accurate and useless; the walk
#: skips the plumbing too, and stops at the first frame that is neither this
#: package nor an installed dependency.
DEPENDENCY_DIR = str(Path(folium.__file__).resolve().parent.parent) + os.sep
PLUMBING_DIRS = (PACKAGE_DIR, DEPENDENCY_DIR)

#: The declaration key that asks for a visibility window over map zoom levels.
ZOOM_RANGE_KEY = "zoom_range"
#: The field the measurement-type filter is bound to. Mirrors
#: CONST.FILTER.FIELD in foliplus/js/MeasureControl/const.ts: the list form
#: emits it so CONF carries a complete AST atom.
MEASURE_TYPE_FIELD = "type"
#: The declaration key that asks for a layer folder.
FOLDER_KEY = "folder"
#: The longest folder name a declaration may carry, in Unicode code points.
#: A folder name is a short label read on a list row, not a data field: past
#: this the row's ellipsis hides everything and the value is far likelier a
#: pasted value than a name. Mirrors FOLDER_NAME_MAX in the JS reader
#: (LayerInfoRegistry), so Python and JS cannot disagree about which names
#: reach the panel. Measured after normalising, so whitespace padding cannot
#: disguise a long name and a padded name is judged by what the author sees.
FOLDER_NAME_MAX = 64
#: The per-layer fill declaration key.
FILL_KEY = "fill"
#: The per-layer label declaration key.
LABEL_KEY = "label"
#: The per-layer filter declaration key.
FILTER_KEY = "filter"
#: The per-layer border declaration key: the author declares a
#: border mode default (follow_fill) on the layer, read by the JS panel as a
#: read-time default under the user's stored choice.
BORDER_KEY = "border"
#: The per-layer marker chassis-colour declaration key: the author names one
#: of the runtime's marker chassis presets (markerColorPreset.ts) as a
#: read-time default. folium's named Icon colours are a DIFFERENT palette
#: (different hex values), so this chassis vocabulary is not expressible via
#: folium kwargs - that is why it is a foliplus declaration.
MARKER_COLOR_KEY = "marker_color"
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
#: The per-layer marker icon pixel-size declaration key: a whole-number pixel
#: size for the marker icon. folium's Icon carries a fixed pixel size and
#: exposes no scaling channel, so this too is a foliplus-only declaration.
ICON_SIZE_KEY = "icon_size"
#: The filter's kind discriminator (a declared filter is a range or an enum).
FilterKind = Literal["range", "enum"]


def is_plumbing(filename: str) -> bool:
    """True for a frame that is machinery, not the caller's code.

    Three shapes count: this package; the installed dependency tree (a render
    passes through jinja2, folium and branca); and a synthetic source name -
    Jinja compiles a template *string* to a code object whose filename is
    "<template>", and that is the frame a render-time warning is raised from.
    """
    return filename.startswith(PLUMBING_DIRS) or filename.startswith("<")


def caller_stacklevel() -> int:
    """Frames from warnings.warn out to the first frame that is the caller's.

    A fixed stacklevel cannot work here, and that is a fact of the call path
    rather than a guess: a layer declaration is read during the Jinja render,
    which compiles the control template to a "<template>" frame and calls
    through its own interpreter frames, so between this package and the
    caller's cell sit the template frame, jinja2 and folium. The depth also
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
    the layer/control on a payload the caller never saw validated.

    ``owner`` names the control and ``subject`` the specific subject (a layer
    name), so every message and de-duplication note is attributable. ``source``
    is how the caller wrote it (the layer's ``foliplus['zoom_range']`` or a
    control's ``zoom_range=``), so the warning points at the entry point they
    used. Both keys are required, must be integers, and must be ordered;
    anything else warns once and is ignored.
    """
    if raw is None:
        return None

    where = f"{owner}: {subject}" if subject else owner
    declared = source or f"foliplus[{ZOOM_RANGE_KEY!r}]"

    def reject(reason: str) -> None:
        note = f"{owner}:{subject or '-'}:zoom_range:{reason}"
        warn_foliplus(
            note,
            f"{where} declares {declared} {reason} - ignored",
        )

    if not isinstance(raw, Mapping):
        reject(f"as {type(raw).__name__}; expected a mapping")
        return None
    # ``key=repr`` keeps a mixed-type payload (``{1: ..., "min": ...}``) from
    # raising inside ``sorted``: a malformed declaration warns, it never takes
    # the page down.
    extra = sorted((key for key in raw if key not in {"min", "max"}), key=repr)
    if extra:
        reject(f"with unknown key(s) {extra}; expected only min and max")
        return None
    raw_lo, raw_hi = raw.get("min"), raw.get("max")
    lo, hi = zoom_level(raw_lo), zoom_level(raw_hi)
    if lo is None:
        reject(f"with a non-integer min={raw_lo!r}")
        return None
    if hi is None:
        reject(f"with a non-integer max={raw_hi!r}")
        return None
    if lo > hi:
        reject(f"with min={lo} > max={hi}")
        return None
    return {"min": lo, "max": hi}


# ── Filter declaration ───────────────────────────────────────────────────


def warn_filter(message: str) -> None:
    """Report one unusable filter declaration at the line that wrote it.

    Never raises: a shape-level problem (a non-numeric bound, an inverted
    range, an empty or non-string value list) must be visible and ignored,
    not take the page down.

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


# ── Border declaration ────────────────────────────────────────────────
def normalise_border(
    raw: object,
    *,
    owner: str,
    subject: str | None = None,
    source: str | None = None,
) -> dict[str, str] | None:
    """Normalise one declared border into its single canonical shape.

    Two declaration shapes converge here (the lead's single-rule-table ruling,
    mirrored 1:1 by the JS parseBorder): a mode-shell `{"mode": "follow_fill"}`
    or `{"mode": "value", "field": ...}`, and the flat fill-isomorphic form
    `{"field": ...}` (implicit value mode). `mode`, when present, is
    authoritative: a mode + field combination is contradictory and invalid.

    Returns the normalised record `{"mode": "follow_fill"}` or
    `{"mode": "value", "field": ...}` when the declaration is usable, else
    `None`: "not declared" and "declared but invalid" are the same state
    downstream - the border stays on its derived default (original/solid)
    rather than painting a mode the author never saw validated.

    `owner` names the control and `subject` the specific subject (a layer
    name), so every message and de-duplication note is attributable.
    `source` is how the caller wrote it (the layer's `foliplus['border']`),
    so the warning points at the entry point they used.

    Python validates the STRUCTURAL shape only (mapping, mode/field presence,
    the mode + field contradiction, known keys) — the field TYPE validation
    lives in the JS reader, the same division the fill declaration follows
    (Python gates the fill mapping shape, JS validates fill's fields), so
    Python can never be stricter or looser than JS on what an author may write.
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
    has_field = "field" in raw
    mode = raw.get("mode")

    if mode == "follow_fill" and has_field:
        # The mode + field contradiction is the sharper defect: report it
        # before any unknown-key warning, so the author sees why the shell
        # cannot stand (a value-mode field on a follow_fill border).
        reject("with a field; 'follow_fill' contradicts a value-mode field")
        return None

    allowed = {"mode", *VALUE_KEYS} if mode != "follow_fill" else {"mode"}
    for key in sorted((key for key in raw if key not in allowed), key=repr):
        reject(
            f"with unknown key {key!r}; expected only {', '.join(sorted(allowed, key=repr))}"
        )

    if mode is None:
        if not has_field:
            reject(
                "without a mode or a field; expected {'mode': 'follow_fill'} or {'field': ...}"
            )
            return None
        return {"mode": "value", "field": raw["field"]}

    if mode == "follow_fill":
        # A follow_fill shell never carries a field: the contradiction is
        # reported before the unknown-key loop (a field is a known value-mode
        # key, so this branch is only reached without one).
        return {"mode": mode}

    if mode == "value":
        if not has_field:
            reject("with a mode 'value' but no field; value mode requires a field")
            return None
        return {"mode": mode, "field": raw["field"]}

    reject(f"with a mode {mode!r}; expected 'follow_fill' or 'value'")
    return None


# ── Folder declaration ───────────────────────────────────────────────────
def normalise_folder(
    raw: object,
    *,
    owner: str,
    subject: str | None = None,
    source: str | None = None,
) -> str | None:
    """Normalise one declared layer folder name.

    Returns the stripped name when the declaration is a non-empty string, else
    ``None``: "not declared" and "declared but invalid" are the same state
    downstream - the layer stays at the section root rather than disappearing
    into a folder the caller never saw validated.

    ``owner`` names the layer and ``subject`` the specific subject, so every
    message and de-duplication note is attributable. ``source`` is how the
    caller wrote it (the layer's ``foliplus['folder']``), so the warning
    points at the entry point they used. A non-string, blank or over-long
    value warns once and is ignored. This reader only reads, normalises and
    caps the name; role
    matching, the stable caller-folder id and the folder registry live with
    the grouping work, not here.
    """
    if raw is None:
        return None

    where = f"{owner}: {subject}" if subject else owner
    declared = source or f"foliplus[{FOLDER_KEY!r}]"

    def reject(reason: str) -> None:
        note = f"{owner}:{subject or '-'}:folder:{reason}"
        warn_foliplus(
            note,
            f"{where} declares {declared} {reason} - ignored",
        )

    if not isinstance(raw, str):
        reject(f"as {type(raw).__name__}; expected a non-empty string")
        return None
    name = re.sub(r"\s+", " ", unicodedata.normalize("NFC", raw.strip()))
    if not name:
        reject("as an empty or whitespace-only string; expected a non-empty string")
        return None
    # The cap is measured on the normalised name: the same strip/fold that
    # keeps a padded name from looking long is what the panel will show, so a
    # name the author intends is not rejected by whitespace they never see.
    if len(name) > FOLDER_NAME_MAX:
        reject(
            f"at {len(name)} code points; expected at most {FOLDER_NAME_MAX}",
        )
        return None
    return name


# ── Marker chassis-colour declaration ────────────────────────────────
def normalise_marker_color(
    raw: object,
    *,
    owner: str,
    subject: str | None = None,
    source: str | None = None,
) -> str | None:
    """Normalise one declared marker chassis preset name.

    Returns the stripped preset name, or the hex lowered to lowercase when the
    declaration is a CSS hex (#rgb / #rrggbb), else ``None``: "not declared"
    and "declared but invalid" are the same state downstream - the marker
    keeps its derived chassis colour rather than painting a name the author
    never saw validated.

    The *shape* is gated here (a non-empty string in the preset vocabulary OR
    a CSS hex). Whether a preset name is one of the runtime's chassis presets
    is the JS reader's verdict: the preset vocabulary lives in
    markerColorPreset.ts, and duplicating the 19-name closed set here would be
    a second list to keep in step with the runtime's - the same split the enum
    filter uses (shape here, vocabulary at the consumer). An unknown preset
    name therefore survives this reader and is warned once by the JS panel,
    which owns the preset table. A CSS hex shape is recognised here and
    normalised exactly as the JS reader normalises it (#rgb is expanded to
    #rrggbb and the value lowered), so the two channels carry the same
    string for one chassis colour; a malformed hex is not a preset either
    and also survives this reader, so the JS panel warns once for it - the
    hex vocabulary is the JS reader's, not this module's.

    ``owner`` names the control and ``subject`` the specific subject (a layer
    name), so every message and de-duplication note is attributable.
    ``source`` is how the caller wrote it (the layer's
    ``foliplus['marker_color']``), so the warning points at the entry point
    they used. A non-string or blank value warns once and is ignored.
    """
    if raw is None:
        return None

    where = f"{owner}: {subject}" if subject else owner
    declared = source or f"foliplus[{MARKER_COLOR_KEY!r}]"

    def reject(reason: str) -> None:
        note = f"{owner}:{subject or '-'}:marker_color:{reason}"
        warn_foliplus(
            note,
            f"{where} declares {declared} {reason} - ignored",
        )

    if not isinstance(raw, str):
        reject(f"as {type(raw).__name__}; expected a non-empty string")
        return None
    name = raw.strip()
    if not name:
        reject("as an empty or whitespace-only string; expected a non-empty string")
        return None
    # A hex shape must be a valid CSS hex (3 or 6 digits); anything else is a
    # shape defect and warns at collection time (a malformed hex is not a
    # preset the JS reader owns).
    if _HEX_COLOR_RE.match(name):
        # Expand #rgb to #rrggbb here too - the JS reader paints the expanded
        # form (normalizeHexColor), so the two channels must agree on the
        # string for one chassis colour (single source, not shape-only).
        if len(name) == 4:  # "#rgb"
            r, g, b = name[1], name[2], name[3]
            return f"#{r}{r}{g}{g}{b}{b}".lower()
        return name.lower()
    return name


# ── Marker icon pixel-size declaration ───────────────────────────────
def normalise_icon_size(
    raw: object,
    *,
    owner: str,
    subject: str | None = None,
    source: str | None = None,
) -> int | None:
    """Normalise one declared marker icon pixel size.

    Returns a positive int when the declaration is usable, else ``None``:
    "not declared" and "declared but invalid" are the same state downstream -
    the marker keeps its built-in pixel size rather than scaling to a value
    the author never saw validated.

    A whole-number pixel size is required: a marker icon scales as a box, so a
    fractional pixel is not meaningful, and a zero/negative size would hide
    the marker. ``numbers.Integral`` rather than ``int`` so a numpy/pandas
    scalar from a data-driven declaration is accepted like any other integer;
    ``bool`` is an ``int`` subclass but never a size, so it is rejected too.

    ``owner`` names the control and ``subject`` the specific subject (a layer
    name); ``source`` is how the caller wrote it. A non-integer, zero or
    negative value warns once and is ignored.
    """
    if raw is None:
        return None

    where = f"{owner}: {subject}" if subject else owner
    declared = source or f"foliplus[{ICON_SIZE_KEY!r}]"

    def reject(reason: str) -> None:
        note = f"{owner}:{subject or '-'}:icon_size:{reason}"
        warn_foliplus(
            note,
            f"{where} declares {declared} {reason} - ignored",
        )

    if isinstance(raw, bool) or not isinstance(raw, numbers.Integral):
        reject(f"as {type(raw).__name__}; expected a positive whole number of pixels")
        return None
    size = int(raw)
    if size <= 0:
        reject(f"as {size}; expected a positive whole number of pixels")
        return None
    return size
