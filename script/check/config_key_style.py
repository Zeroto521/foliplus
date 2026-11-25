#!/usr/bin/env python3
"""Enforce snake_case on the CONFIG contract keys.

The CONFIG payload is the one surface both languages own: Python emits the keys
through ``_build_config`` / the layer collection, TypeScript reads them through
``ComponentConfig`` / ``LayerData``. Spelling them differently on the two sides
(``zoomRange`` vs ``zoom_range``, #1341) was a silent-contract bug class: a
rename that landed on one side only still type-checked on both sides. This gate
keeps the spelling single: every key of that surface is snake_case.

Two surfaces are checked:

* the committed ``foliplus/js/config-schema.ts`` (default) — the generated
  declaration file, where a hand edit would otherwise reintroduce camelCase
  without touching Python at all. Needs no Python import, so the pre-commit
  hook runs it in the isolated hook env.
* a schema dump from ``python -m foliplus._config_schema --dump``
  (``--dump PATH``) — field names plus every shape payload key
  (``LayerData[].fill_author.per_feature`` and friends). The CI
  ``config-schema-verify` target runs this after regenerating the schema.

Zero exceptions (owner ruling): a key that cannot be renamed is a
contract bug, so :data:`EXCEPTIONS` must stay empty and the check fails if it
does not. The report is ``location: contract key 'x' is not snake_case``;
exit code 1 on violations, 2 on usage errors.

Usage:
    python script/check/config_key_style.py
    python script/check/config_key_style.py --dump .build/js/config-schema.json
"""

from __future__ import annotations

import json
import re
import sys
from collections.abc import Iterator
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
SCHEMA_TS = REPO_ROOT / "foliplus" / "js" / "config-schema.ts"

# The contract spelling: lower-case words joined by single underscores. A bare
# lower-case word ("name", "role") is valid; digits are allowed after the first
# letter ("vmin", "locale_tables").
KEY_RE = re.compile(r"^[a-z][a-z0-9_]*$")

# Must stay empty — see the module docstring. The dict shape (key -> reason)
# exists only so a hypothetical exception would carry its justification; the
# check refuses to run while it has any entry.
EXCEPTIONS: dict[str, str] = {}

# The one non-identifier key the shape grammar allows: a Record's wildcard
# (``{"*": "string"}``), which is not a contract name.
WILDCARD = "*"

# FieldSpec metadata keys in a schema dump. They are the generator's own
# vocabulary ("ts", "optional", ...), not payload keys, so the snake_case rule
# does not apply to them; their values are still walked (a shape lives under
# "shape", literals under "values").
_META_KEYS = frozenset(
    {
        "version",
        "ts",
        "optional",
        "nullable",
        "dynamic",
        "default",
        "note",
        "values",
        "name",
        "shape",
        "item",
    }
)

# Comments go; their newlines stay so reported line numbers match the file.
_COMMENT_RE = re.compile(r"/\*[\s\S]*?\*/|//[^\n]*")

# A property declaration in the generated file: ``name:`` / ``name?:`` in a
# member position — after ``{``, ``;``, or at line start. The anchor is what
# keeps ternaries (``cond ? a : b``) and type annotations (``): Type {``) out;
# inline object members (``{ min: number; max: number }``) are matched too.
_TS_PROPERTY_RE = re.compile(r"(?:^|[;{])\s*([A-Za-z_$][\w$]*)\??\s*:", re.MULTILINE)


def strip_comments(text: str) -> str:
    """Drop TS comments, keeping their newlines so line numbers survive."""
    return _COMMENT_RE.sub(lambda m: "\n" * m.group(0).count("\n"), text)


def ts_property_violations(text: str, label: str) -> list[str]:
    """Report every non-snake_case property key declared in TS source text."""
    code = strip_comments(text)
    violations: list[str] = []
    for match in _TS_PROPERTY_RE.finditer(code):
        key = match.group(1)
        if KEY_RE.match(key):
            continue
        # Report the key's own line, not the \`{\`/\`;\` the match anchor sat on.
        line = code.count("\n", 0, match.start(1)) + 1
        violations.append(f"{label}:{line}: contract key {key!r} is not snake_case")
    return violations


def _key_violation(label: str, path: str, key: str) -> str:
    return f"{label}:{path}: contract key {key!r} is not snake_case"


def _walk_payload(node: Any, label: str, path: str) -> list[str]:
    """Walk shape/payload values: every dict key is a contract name.

    FieldSpec metadata (``ts``, ``shape``, ...) and the Record wildcard are
    the only keys exempt; the values under them are walked because that is
    where the shape trees live.
    """
    violations: list[str] = []
    if isinstance(node, dict):
        for key, value in node.items():
            child = f"{path}.{key}"
            if key != WILDCARD and key not in _META_KEYS and not KEY_RE.match(str(key)):
                violations.append(_key_violation(label, child, str(key)))
            violations.extend(_walk_payload(value, label, child))
    elif isinstance(node, list):
        for index, value in enumerate(node):
            violations.extend(_walk_payload(value, label, f"{path}[{index}]"))
    return violations


def _field_map_violations(fields: dict[str, Any], label: str, path: str) -> list[str]:
    """Check one field map (the ``shared`` map or one control's map)."""
    violations: list[str] = []
    for key, value in fields.items():
        child = f"{path}.{key}"
        if key != WILDCARD and key not in _META_KEYS and not KEY_RE.match(str(key)):
            violations.append(_key_violation(label, child, str(key)))
        violations.extend(_walk_payload(value, label, child))
    return violations


def dump_violations(payload: Any, label: str) -> list[str]:
    """Report every non-snake_case key in a schema dump JSON tree.

    The dump's structure is ``{version, shared, controls}``; ``controls`` is
    keyed by control CLASS name (``LayerControl``), which is Python vocabulary,
    not a payload key — only the two field-map levels below them hold contract
    names. Shape dicts nested in FieldSpecs are walked for payload keys
    (``fill_author``, ``per_feature``, ``base_url``, ...).
    """
    violations: list[str] = []
    shared = payload.get("shared") if isinstance(payload, dict) else None
    if isinstance(shared, dict):
        violations.extend(_field_map_violations(shared, label, "shared"))
    controls = payload.get("controls") if isinstance(payload, dict) else None
    if isinstance(controls, dict):
        for control_name, fields in controls.items():
            if isinstance(fields, dict):
                violations.extend(
                    _field_map_violations(fields, label, f"controls.{control_name}")
                )
    return violations


def _exception_violations() -> list[str]:
    """Fail while EXCEPTIONS is non-empty: zero camelCase keys is the ruling."""
    return [
        f"script/check/config_key_style.py: exception {key!r} is not allowed ({reason})"
        for key, reason in sorted(EXCEPTIONS.items())
    ]


def main(argv: list[str] | None = None) -> int:
    """Run the gate over the committed schema or a supplied dump."""
    args = list(sys.argv[1:] if argv is None else argv)
    dump_path: Path | None = None
    files: list[str] = []
    while args:
        arg = args.pop(0)
        if arg in {"-h", "--help"}:
            print(__doc__.strip())
            return 0
        if arg == "--dump":
            if not args:
                print("config_key_style: --dump needs a path", file=sys.stderr)
                return 2
            dump_path = Path(args.pop(0))
            continue
        files.append(arg)

    if files:
        print(
            "config_key_style: unexpected arguments "
            f"{files} — the gate reads the generated file and --dump only",
            file=sys.stderr,
        )
        return 2

    violations = _exception_violations()
    if dump_path is not None:
        try:
            payload = json.loads(dump_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            print(f"config_key_style: cannot read {dump_path}: {exc}", file=sys.stderr)
            return 2
        violations.extend(dump_violations(payload, str(dump_path)))
    else:
        try:
            source = SCHEMA_TS.read_text(encoding="utf-8")
        except OSError as exc:
            print(f"config_key_style: cannot read {SCHEMA_TS}: {exc}", file=sys.stderr)
            return 2
        violations.extend(
            ts_property_violations(source, "foliplus/js/config-schema.ts")
        )

    if violations:
        for violation in violations:
            print(violation)
        print(
            f"config_key_style: {len(violations)} contract key(s) are not "
            "snake_case — rename on both sides (Python emitter and the "
            "TypeScript consumer), never one side only",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
