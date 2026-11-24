"""Compose the schema into its JSON dump and the model-side collections."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

from .derive import derive_schema
from .spec import SHARED, ControlSchema, FieldSpec
from .tag import UNSET, verify_tags

if TYPE_CHECKING:
    from ..BaseControl import BaseControl


def derived_control_schemas(
    base: type[BaseControl],
) -> list[tuple[str, ControlSchema]]:
    """Reflect every shipped control, returning ``(name, schema)`` pairs."""
    return [
        (c.__name__, derive_schema(c))
        for c in sorted(
            (
                c
                for c in base.__subclasses__()
                if c.__module__.startswith("foliplus.")
                and not c.__name__.startswith("_")
            ),
            key=lambda c: c.__name__,
        )
    ]


def collect_tags(*schemas: ControlSchema) -> set[str]:
    """Every tag appearing in ``schemas`` (for :func:`verify_tags`).

    Empty tags (metadata-only FieldSpecs where the reflector decides the
    tag) are skipped — they are not type names and must not be checked
    against :data:`SUPPORTED_TAGS`.
    """
    return {spec.ts for schema in schemas for spec in schema.values() if spec.ts}


def collect_named_types(*schemas: ControlSchema) -> set[str]:
    """Every generated alias name across ``schemas`` (for :func:`verify_tags`).

    ``FieldSpec.name`` values are the types the generator emits as aliases in
    ``config-schema.ts`` — the "second half" of the tag universe alongside
    primitives/base-objects/imports.
    """
    return {spec.name for schema in schemas for spec in schema.values() if spec.name}


def field_dict_list(schema: ControlSchema) -> dict[str, dict[str, Any]]:
    """Convert one ControlSchema to a JSON-friendly dict of field dicts.

    Drops the Python-only ``item`` field the generators don't need; ``note`` is
    kept so the generated TS carries docstrings. ``shape`` and ``name`` are
    emitted when set: they carry the descriptor the generator needs to emit a
    named alias in ``config-schema.ts``, and the field's TS type renders as
    the name.
    """
    out: dict[str, dict[str, Any]] = {}
    for name, spec in schema.items():
        entry: dict[str, Any] = {
            "ts": spec.ts,
            "optional": spec.optional,
            "nullable": spec.nullable,
            "dynamic": spec.dynamic,
        }
        if spec.values is not None:
            entry["values"] = list(spec.values)
        if spec.note:
            entry["note"] = spec.note
        if spec.default is not UNSET:
            entry["default"] = spec.default
        if spec.shape is not None:
            entry["shape"] = spec.shape
        if spec.name is not None:
            entry["name"] = spec.name
        out[name] = entry
    return out


def schema_to_json() -> str:
    """Serialize the whole schema table to JSON (deterministic, sorted).

    The dumped shape is what pytest consumes as the schema source of truth,
    and what the two manual emitters (``script/build/emit-config-schema.mjs``
    and ``test/js/script/emit-config-fixture.mjs``) read when regenerating the
    committed TS artifacts. Kept stable: adding a new ``FieldSpec`` attribute
    is a schema version bump, not a silent change.

    Every tag is checked against the union of :data:`SUPPORTED_TAGS` and the
    set of generated alias names (:func:`verify_tags`) so a tag that renders
    to a type name ``config-schema.ts`` does not declare fails here rather
    than as an unimported type in the generated TS.

    Must not touch ``sys.path`` or ``sys.modules``: in-process callers (pytest)
    already hold a live ``foliplus`` import, and re-importing the package would
    hand the reflector a second ``FieldSpec`` class — the ``isinstance`` check
    in :func:`field_spec_in` would then stop finding the ``Annotated``
    metadata and every typed field would fail to resolve. Path pinning for
    script mode lives in ``__main__`` below.
    """
    from foliplus import BaseControl

    control_schemas = derived_control_schemas(BaseControl)
    payload = {
        "version": 1,
        "shared": field_dict_list(SHARED),
        "controls": {name: field_dict_list(schema) for name, schema in control_schemas},
    }
    verify_tags(
        collect_tags(SHARED, *(s for _, s in control_schemas)),
        collect_named_types(SHARED, *(s for _, s in control_schemas)),
    )
    return json.dumps(payload, indent=2, ensure_ascii=False, sort_keys=False) + "\n"
