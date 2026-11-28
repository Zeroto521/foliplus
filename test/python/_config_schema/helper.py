"""Shared helpers for the ``foliplus._config_schema`` suites."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Annotated, Any

import pytest

from foliplus import (
    BaseControl,
    ExportControl,
    FullscreenControl,
    HeatmapControl,
    LayerControl,
    LocateControl,
    MeasureControl,
    ScaleControl,
    SearchControl,
)
from foliplus._config_schema import (
    SHARED,
    UNSET,
    FieldSpec,
    config_fields,
    derive_schema,
    derived_control_schemas,
    render_ts_type,
    schema_to_json,
    validate_shape,
)

_JS_CONFIG_SCHEMA = Path(__file__).resolve().parents[3] / "foliplus/js/config-schema.ts"
# Fields set on every control by BaseControl, not declared in a subclass —
# JS reads them, Python exports them, neither side needs to enumerate them.
CONF_COMMON = frozenset({"name", "position", "locale_code", "locale_tables"})
_JS_INTERFACE_NAME_RE = re.compile(r"interface\s+Config(\w+)(?:\s+extends\s+\w+)?\s*\{")
_JS_FIELD_RE = re.compile(r"(?m)^\s*([a-z][A-Za-z0-9_]*)\??\s*:")
_JS_CONFIG_READ_RE = re.compile(r"(?<![_A-Za-z0-9])CONFIG\.([A-Za-z_][A-Za-z0-9_]*)")
# Comments are prose, not reads: a generated header may spell an example like
# `CONFIG.<field>` without that being a field JS reads. A comment is a comment
# only outside a string/template literal — a regex strip would treat the `//`
# in "http://x" as one and swallow a real read later on that line.


def strip_js_comments(text: str) -> str:
    """Drop JS line/block comments, respecting string/template literals.

    Keeps newlines so any line number derived from the result still matches the
    original file.
    """
    out: list[str] = []
    i = 0
    length = len(text)
    while i < length:
        ch = text[i]
        if ch in "\"'\`":
            quote = ch
            out.append(ch)
            i += 1
            while i < length:
                current = text[i]
                out.append(current)
                i += 1
                if current == "\\" and i < length:
                    out.append(text[i])
                    i += 1
                    continue
                if current == quote:
                    break
            continue
        if ch == "/" and i + 1 < length and text[i + 1] == "/":
            while i < length and text[i] != "\n":
                i += 1
            continue
        if ch == "/" and i + 1 < length and text[i + 1] == "*":
            i += 2
            while i + 1 < length and not (text[i] == "*" and text[i + 1] == "/"):
                if text[i] == "\n":
                    out.append("\n")
                i += 1
            i += 2
            continue
        out.append(ch)
        i += 1
    return "".join(out)


_JS_TS_ROOT = Path(__file__).resolve().parents[3] / "foliplus/js"
# The vitest fixture (`test/js/config-fixture.ts`) is the JS side's default
# CONFIG per control, generated from the Python schema; the committed file is
# the drift gate (regenerating it on every run spawned Python from vitest).
_FIXTURE_TS = _JS_TS_ROOT.parent.parent / "test/js/config-fixture.ts"
# Each control's block starts with `  <Name>: {` (two-space indent) and ends
# with `  },`; the emitter's format is pinned by prettier.
_FIXTURE_CONTROL_RE = re.compile(
    r"^  (\w+): \{\n((?:^    .*\n)*)^  \},",
    re.MULTILINE,
)
_FIXTURE_FIELD_RE = re.compile(r"^    ([a-z][A-Za-z0-9_]*)\??: (.+?),$", re.MULTILINE)
# Values appear as JSON literals except booleans (JS `true`/`false`).
_FIXTURE_BOOL_RE = re.compile(r"\A(true|false)\Z")


CONTROL_CLASSES: dict[str, type[BaseControl]] = {
    "FullscreenControl": FullscreenControl,
    "ScaleControl": ScaleControl,
    "LocateControl": LocateControl,
    "LayerControl": LayerControl,
    "MeasureControl": MeasureControl,
    "SearchControl": SearchControl,
    "HeatmapControl": HeatmapControl,
    "ExportControl": ExportControl,
}


def _derived(name: str) -> dict[str, FieldSpec]:
    """Schema reflected from one control's signature."""
    return derive_schema(CONTROL_CLASSES[name])


def _spec_dict(spec: FieldSpec) -> dict[str, object]:
    """JSON-friendly view of one field spec (for dump-shape assertions)."""
    out: dict[str, object] = {
        "ts": spec.ts,
        "optional": spec.optional,
        "nullable": spec.nullable,
        "dynamic": spec.dynamic,
    }
    if spec.values is not None:
        out["values"] = list(spec.values)
    if spec.note:
        out["note"] = spec.note
    if spec.default is not UNSET:
        out["default"] = spec.default
    return out


def _schema_dict(schema: dict[str, FieldSpec]) -> dict[str, dict[str, object]]:
    return {name: _spec_dict(spec) for name, spec in schema.items()}


def _ts_short_to_control(short: str) -> str | None:
    """``Layer`` -> ``LayerControl``; ``Common`` -> ``None``.

    The emitter names TS interfaces as ``Config<ShortName>`` where the short
    name is the Python control class with its ``Control`` suffix dropped.
    ``ConfigCommon`` is the shared block, not a per-control interface, so it
    maps to no control.
    """
    if short == "Common":
        return None
    return f"{short}Control"


def _ts_interface_fields() -> dict[str, set[str]]:
    """Field set per ``ConfigX`` interface in the committed TS schema.

    Bodies are cut by brace-depth counting, not regex: the interfaces contain
    one nested ``{}`` each (the Layer data shape), so a ``[^}]*`` match stops
    early and misses the tail.
    """
    text = _JS_CONFIG_SCHEMA.read_text(encoding="utf-8")
    out: dict[str, set[str]] = {}
    for m in _JS_INTERFACE_NAME_RE.finditer(text):
        name = f"Config{m.group(1)}"
        depth = 1
        i = m.end()
        while i < len(text) and depth > 0:
            c = text[i]
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
            i += 1
        body = text[m.end() : i - 1]
        out[name] = set(_JS_FIELD_RE.findall(body))
    return out


def _py_control_field_sets() -> dict[str, set[str]]:
    """Python-emitted field set per control, from the same schema the JS side mirrors."""
    data = json.loads(schema_to_json())
    return {name: set(fields) for name, fields in data["controls"].items()}


def _js_files() -> list[Path]:
    return [p for p in _JS_TS_ROOT.rglob("*.ts") if not p.name.endswith(".d.ts")]


def _read_committed_fixture_defaults() -> dict[str, dict[str, object]]:
    """Parse ``CONFIG_DEFAULTS`` from the committed fixture, per control.

    Values come back as Python objects: booleans are handled directly (JS
    spelling), the rest round-trip through ``json.loads``. A value the
    parser cannot round-trip is stored as a sentinel string so the failure
    is actionable rather than a JSONDecodeError deep in the stack.
    """
    text = _FIXTURE_TS.read_text(encoding="utf-8")
    out: dict[str, dict[str, object]] = {}
    for name, body in _FIXTURE_CONTROL_RE.findall(text):
        out[name] = {}
        for fname, raw in _FIXTURE_FIELD_RE.findall(body):
            m = _FIXTURE_BOOL_RE.match(raw)
            if m:
                out[name][fname] = m.group(1) == "true"
                continue
            try:
                out[name][fname] = json.loads(raw)
            except json.JSONDecodeError:
                out[name][fname] = f"<unparsable: {raw}>"
    return out


def _schema_defaults() -> dict[str, dict[str, object]]:
    """Python schema defaults per control: only the `default` key, when set."""
    out: dict[str, dict[str, object]] = {}
    for control, fields in json.loads(schema_to_json())["controls"].items():
        out[control] = {
            fname: spec["default"]
            for fname, spec in fields.items()
            if "default" in spec
        }
    return out


def _default_literal(value: object) -> str:
    """Render one Python default the way the fixture emitter would."""
    return repr(value)


def _walk_specs() -> list[tuple[str, FieldSpec]]:
    """Iterate every FieldSpec in the schema (for parametrize helpers)."""
    out: list[tuple[str, FieldSpec]] = []
    for name, field in SHARED.items():
        out.append((f"SHARED.{name}", field))

    for name in CONTROL_CLASSES:
        for field_name, field in _derived(name).items():
            out.append((f"{name}.{field_name}", field))
    return out
