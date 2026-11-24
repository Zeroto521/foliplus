"""The TS tag vocabulary and the shape/type checks built on it."""

from __future__ import annotations

from typing import Any

# TS type tags supported. Primitives are TS construction instructions; every
# other tag is a type name exported by `foliplus/js` (or an inline TS
# construct, listed here so the generator can render it). Add a new tag only
# when a real control needs it; the generator refuses unknown tags so a typo
# fails the build rather than emitting a bogus type.
TS_PRIMITIVES: dict[str, str] = {
    "bool": "boolean",
    "number": "number",
    "string": "string",
    "any": "unknown",
    "null": "null",
}
TS_OBJECTS: dict[str, str] = {
    "object": "Record<string, unknown>",
    "object_string": "Record<string, string>",
    "object_nested": "Record<string, Record<string, string>>",
    "array_string": "string[]",
    "array_unknown": "unknown[]",
    # `ControlPosition` is the Leaflet control position — a string literal
    # union imported from Leaflet in the generated TS.
    "ControlPosition": "ControlPosition",
    # `provider` is `str | dict` — the string is a built-in provider id, the
    # dict is a custom ProviderConfig. Kept as a special tag so the emitted
    # TS reads `string | ProviderConfig` (typed via the ProviderConfig alias
    # generated in config-schema.ts) rather than the generic
    # `Record<string, unknown>`. Not a bare type name.
    "string | ProviderConfig": "string | ProviderConfig",
}
SUPPORTED_TAGS = set(TS_PRIMITIVES) | set(TS_OBJECTS)

# Type names the generated `config-schema.ts` imports. Mirrored by
# `script/build/emit-config-schema.mjs`'s IMPORTS; verify_tags() checks that
# every tag is either a primitive/base-object/union, an entry here, or a
# generated named type (see :attr:`FieldSpec.name`).
IMPORTS: dict[str, str] = {
    "ControlPosition": "leaflet",
}


# Sentinel distinguishing "no default declared" from an explicit null/None
# default. `default: Any = None` cannot carry that distinction — a field whose
# real default is None (e.g. SearchControl.provider_config) would be treated
# as "no default" and dropped from the dump. Anything JSON-serializable is a
# legal default, including None.
UNSET = object()


# Shape descriptors: JSON-serializable trees describing a TS type. Grammar
# (validated by :func:`validate_shape`):
#
# * ``"string"`` / ``"number"`` / ``"bool"`` / ``"null"`` — TS primitive
#   (``"bool"`` renders as ``boolean``).
# * ``"array_string"`` — TS ``string[]``. A leaf tag rather than a list,
#   because an all-string list is a union by content and ``["string"]`` would
#   read as the literal ``"string"`` (the one-element-tuple rule below). This
#   is the general "list of strings" leaf for any shape field, not a
#   fill_author special case: today ``LayerData[].fill_author.scale.stops`` is
#   its only use point, and a future shape with a string array should reuse it
#   instead of inventing a second spelling.
# * ``None`` — TS ``null``.
# * ``tuple`` ``(X, "?")`` — marks the dict-value field optional.
# * ``tuple`` of ≥2 primitive names — a primitive union, rendered unquoted
#   (``("string", "number")`` → ``string | number``). Any other tuple is a
#   *literal* union, its members quoted (``("base", "overlay")`` →
#   ``"base" | "overlay"``). The exception is ``"null"``: a literal union
#   may mix one literal with ``null`` (``("equal", "null")`` →
#   ``"equal" | null``), because ``null`` is a primitive name and renders
#   unquoted in the same union. A one-element tuple is always a literal,
#   so ``("string",)`` stays ``"string"`` rather than becoming a bare
#   ``string``.
# * ``list`` — array of the item's type (``[X]`` is ``X[]``).
# * ``"object_unknown"`` — TS ``Record<string, unknown>``: the open-ended
#   value bag (``LayerData[].filter``'s normalised AST). A leaf is needed
#   because the grammar has no inline open-object tag.
# * ``dict`` — either an object with named identifier keys, or
#   ``Record<string, V>`` when the sole key is ``"*"``. Mixing ``"*"`` with
#   named keys is an error.
#
# The descriptor is dumped to JSON as-is: tuples become lists, so the JS
# generator disambiguates by content — an all-primitive-name list is a
# primitive union, any other all-string list a literal union, and a list
# holding a non-string an array.

TS_PRIMITIVE_NAMES = {
    "string",
    "number",
    "bool",
    "null",
    "array_string",
    "object_unknown",
}


def validate_shape(x: Any, path: str = "", in_dict_value: bool = False) -> None:
    """Recursively validate a shape descriptor, failing loudly on bad inputs."""
    if x is None:
        return
    if isinstance(x, str):
        if x not in TS_PRIMITIVE_NAMES:
            raise ValueError(
                f"shape at {path}: unknown primitive {x!r} — "
                f"expected one of {sorted(TS_PRIMITIVE_NAMES)}"
            )
        return
    if isinstance(x, tuple):
        if len(x) == 2 and x[1] == "?":
            if not in_dict_value:
                raise ValueError(
                    f"shape at {path}: optional marker (X, '?') is only "
                    "valid as a dict value"
                )
            validate_shape(x[0], f"{path}[0]")
            return
        # Otherwise: a union of strings. Primitive names render unquoted
        # ("string", "number" → string | number); everything else quoted. That
        # split is content-based and belongs to the JS renderer — the validator
        # cannot tell the two apart either, so it accepts any string tuple.
        for v in x:
            if not isinstance(v, str):
                raise ValueError(
                    f"shape at {path}: union elements must be strings, got {v!r}"
                )
        return
    if isinstance(x, list):
        if not x:
            raise ValueError(f"shape at {path}: empty array is not a valid shape")
        for i, v in enumerate(x):
            validate_shape(v, f"{path}[{i}]")
        return
    if isinstance(x, dict):
        if "*" in x:
            if len(x) != 1:
                raise ValueError(
                    f"shape at {path}: '*' key cannot be mixed with named "
                    f"keys; got {list(x.keys())!r}"
                )
            validate_shape(x["*"], f"{path}.*")
            return
        for k, v in x.items():
            if not isinstance(k, str) or not k.isidentifier():
                raise ValueError(
                    f"shape at {path}: key {k!r} is not a valid JS identifier"
                )
            validate_shape(v, f"{path}.{k}", in_dict_value=True)
        return
    raise ValueError(f"shape at {path}: unknown shape type {type(x).__name__}")


def verify_tags(tags: set[str], named_types: set[str]) -> None:
    """Fail loud when a tag is not a supported primitive/base-object, a
    union, the special ``string | ProviderConfig`` case, an imported name,
    or a generated named type.

    ``named_types`` are the :attr:`FieldSpec.name` values across the schema —
    types the generator emits as aliases. Any tag not in
    :data:`SUPPORTED_TAGS` (which covers primitives, base objects,
    ``ControlPosition``, and the ``string | ProviderConfig`` special case)
    must be a named type; otherwise it is a typo or a rename that landed on
    one side only.
    """
    bad = sorted(
        t for t in tags if t not in SUPPORTED_TAGS | {"union"} and t not in named_types
    )
    if bad:
        raise ValueError(
            f"tags render to a type name that config-schema.ts does not "
            f"declare: {bad} — add to IMPORTS (external import), "
            f"TS_OBJECTS (inline construct), or declare as a FieldSpec.name "
            f"(generated alias)."
        )


# ── Shared (BaseControl) fields ──────────────────────────────────────────
# Emitted by every control via ``BaseControl._build_config`` /
# ``_config_block``. Not part of any control's ``_config_fields`` (they are
# the base's job), but part of the CONFIG contract every control sees.
