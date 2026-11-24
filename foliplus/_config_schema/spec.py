"""One declared CONFIG field (FieldSpec) and the shared schema table."""

from __future__ import annotations

from dataclasses import dataclass
from types import UnionType
from typing import Annotated, Any, Literal, Union, get_args, get_origin

from .tag import SUPPORTED_TAGS, TS_OBJECTS, TS_PRIMITIVES, UNSET, validate_shape


@dataclass(frozen=True)
class FieldSpec:
    """Declarative spec for one CONFIG field.

    Attributes
    ----------
    ts
        Base type tag. One of :data:`SUPPORTED_TAGS`, or ``"union"`` — in
        the union case, :attr:`values` must be set and renders as
        ``"a" | "b" | "c"``.

    optional
        Field may be absent at runtime (JSON `undefined`). Renders ``?`` in
        TS.

    nullable
        Field may be JSON ``null`` in addition to its base type. Renders
        ``X | null`` in TS.

    values
        For ``ts="union"``, the tuple of string literal values.

    item
        For array tags, the item type tag (rarely used; most arrays are
        ``array_string``). Kept for extensibility; unused today.


    dynamic
        Python emits this field at render time via ``_extra_config`` (not a
        static ``_config_fields`` key). Excluded from ``_config_fields`` but
        included in the TS type and vitest fixture.

    default
        JSON-serializable default used by the vitest fixture. Must be a
        value a Python dict can hold (str, int, float, bool, list, dict,
        or None). ``None`` is a *real* default and is serialized as JSON
        ``null``; :data:`UNSET` (the dataclass default) means "no default
        declared — omit from fixture" (used for fields whose default is a
        runtime decision, e.g. ``locale_tables``).

    note
        Human-readable note, rendered into the generated TS: a short
        single-line note becomes a trailing ``//`` comment on the field,
        a longer or multi-line one becomes a ``/** */`` block above it.
        Empty means no comment.

    shape
        Optional shape descriptor for a complex type. When set,
        :attr:`name` is also required — the generator emits the type as a
        named alias (``export type <name> = <shape>;``) and this field's
        TS type renders as the name. See :func:`validate_shape` for the
        descriptor grammar. A shape without a name is a construction error
        because there is no emitting target.

        Written in the ``Annotated`` metadata next to :attr:`name`, on a
        constructor parameter's FieldSpec or a dynamic field's. ``get_type_hints``
        resolves it lazily, so an unhashable descriptor there is not a problem.

    name
        Name of a generated type alias in ``config-schema.ts``. An object or
        array alias needs :attr:`shape`, written on the same FieldSpec; a
        literal-union alias (``NumberStyle``) instead needs ``ts="union"`` +
        :attr:`values`, which render the alias by themselves. A named field
        with neither fails at reflection: the alias cannot be rendered
        without a definition.

    config_key
        CONFIG key to emit this constructor parameter under, when it differs
        from the parameter name. Both spellings are snake_case today; the
        field still states the emitted contract name explicitly so the
        generated schema and the layer payload (``data[].zoom_range``) cannot
        drift apart. ``None`` uses the parameter name. The `_config_fields` tuple
        and the generated schema both use the CONFIG key, which is the name
        ``_build_config`` resolves with ``getattr``.
    """

    ts: str = ""
    optional: bool = False
    nullable: bool = False
    values: tuple[str, ...] | None = None
    item: str | None = None
    dynamic: bool = False
    default: Any = UNSET
    note: str = ""
    shape: Any = None
    name: str | None = None
    config_key: str | None = None

    def __post_init__(self) -> None:
        if self.shape is not None:
            # Shape-driven type: the rendered type comes from the alias
            # name, not the base tag. Validate the shape and skip the
            # tag-based checks below — a shape-driven FieldSpec may carry
            # a ``ts`` that is not in SUPPORTED_TAGS (e.g. the alias name
            # itself), which is fine because render_ts_type renders by
            # name.
            if not self.name:
                raise ValueError(
                    "FieldSpec.shape requires FieldSpec.name to name the "
                    "generated alias — a shape without a name has no "
                    "emitting target"
                )
            validate_shape(self.shape, self.name)
        elif self.name is not None and self.ts != "union":
            # A named non-union type names its alias in both ``ts`` and
            # ``name`` (e.g. ``ts="ProviderConfig", name="ProviderConfig"``).
            # render_ts_type renders ``name``, so ``ts`` is a naming
            # declaration rather than a render instruction and is not checked
            # against SUPPORTED_TAGS. Its descriptor arrives as a class
            # attribute (see derive_schema), which is why this branch — unlike
            # the shape-driven one — carries no shape. A tag typo is still
            # caught at dump time by verify_tags.
            pass
        elif self.ts == "union":
            if not self.values:
                raise ValueError(f"FieldSpec(ts='union') requires values, got None")
        elif not self.ts and not self.values:
            # A metadata-only FieldSpec (note, nullable, …) carries no tag.
            # The tag is decided by the reflector; ``ts=""`` means "no
            # override", which is distinct from a typo and must not raise
            # here — an empty tag is not in SUPPORTED_TAGS by design.
            # ``name`` without ``shape`` is validated after reflection
            # (see ``resolve_tag``), because the reflected ``ts``/``values``
            # are not yet known at construction time.
            pass
        elif self.ts not in SUPPORTED_TAGS:
            raise ValueError(
                f"FieldSpec ts={self.ts!r} is not a supported tag; "
                f"valid: {sorted(set(SUPPORTED_TAGS) | {'union'})}"
            )


ControlSchema = dict[str, FieldSpec]


def render_ts_type(spec: FieldSpec) -> str:
    """Render the TS type for one field spec.

    Combines the base tag with the nullable suffix. Raises on unknown tags
    so a typo in a schema entry fails at dump time rather than silently
    emitting a bogus type into the TS surface.

    When :attr:`FieldSpec.name` is set — either with :attr:`FieldSpec.shape`
    for a complex type or with ``ts="union"`` + :attr:`FieldSpec.values` for
    a literal union — the rendered base type is the alias name; the
    generator emits the alias definition at the top of ``config-schema.ts``.
    """
    if spec.name is not None:
        # Named type — render as the alias name; the generator emits the
        # definition elsewhere. __post_init__ + resolve_tag guarantee the
        # descriptor (shape or union+values) is present.
        base = spec.name
    elif spec.ts == "union":
        # __post_init__ guarantees values for union; assert so mypy narrows.
        assert spec.values is not None
        base = " | ".join(f'"{v}"' for v in spec.values)
    elif spec.ts in TS_PRIMITIVES:
        base = TS_PRIMITIVES[spec.ts]
    elif spec.ts in TS_OBJECTS:
        base = TS_OBJECTS[spec.ts]
    else:
        raise ValueError(f"unknown FieldSpec.ts={spec.ts!r}")
    if spec.nullable:
        return f"{base} | null"
    return base


SHARED: ControlSchema = {
    "name": FieldSpec("string", note="Control class name (Python self._name)."),
    "position": FieldSpec(
        "ControlPosition", optional=True, note="Leaflet control position."
    ),
    "locale_tables": FieldSpec(
        "object_nested",
        optional=True,
        note="Locale tables written by BaseControl._config_block.",
    ),
    "locale_code": FieldSpec(
        "string", optional=True, note="Resolved locale code (empty when unset)."
    ),
}


# ── Reflection ─────────────────────────────────────────────────────────────
# A control's ``__init__`` signature *is* its schema. These tables translate
# the annotation of each parameter into a TS tag; everything they cannot
# decide is resolved by a ``FieldSpec(...)`` metadata attached to the type
# alias it is declared with (see ``foliplus/_typing.py``).

# Bare Python type → TS tag, for annotations the reflector can decide alone.
PRIMITIVES: dict[type, str] = {
    str: "string",
    bool: "bool",
    int: "number",
    float: "number",
}
ARRAY_TAGS: dict[tuple[type, ...], str] = {
    (str,): "array_string",
    (Any,): "array_unknown",
}
DICT_TAGS: dict[tuple[type, ...], str] = {
    (Any, Any): "object",
    (str, Any): "object",
    (str, str): "object_string",
    (str, dict): "object_nested",
}

# ``BaseControl.__init__`` parameters that are the base class's job. A
# subclass that redeclares one in its own signature does not export it as a
# CONFIG field — it is already covered by :data:`SHARED`.
SHARED_PARAMS: frozenset[str] = frozenset({"position", "locale"})


def field_spec_in(*args: Any) -> FieldSpec | None:
    """Return the ``FieldSpec`` among ``Annotated`` metadata, or ``None``.

    ``Annotated[T, Bound(...), FieldSpec(...)]`` carries both channels:
    ``Bound`` is consumed by ``@validate`` at call time, ``FieldSpec`` here
    at schema-derivation time. Anything else (e.g. ``Annotated[int, 3]``) is
    neither and is ignored by both.
    """
    for item in args:
        if isinstance(item, FieldSpec):
            return item
    return None


def evaluate(arg: Any) -> Any:
    """Resolve one ``Union`` branch that may still be a string.

    With `from __future__ import annotations` the branch of a spelled-out union
    (``list[str] | None``) can reach the reflector as the string ``"None"``
    rather than the type. Resolve it against the module's globals so a
    nullable union is recognized the same way whether it is spelled
    ``X | None`` or ``Optional[X]``.
    """
    if not isinstance(arg, str):
        return arg
    if arg == "None":
        return type(None)
    return eval(arg, globals())


def is_nullable(hint: Any) -> bool:
    """Whether ``hint`` admits JSON ``null`` at its outermost level.

    Strips ``Annotated`` first: a tag override names the type, it does not
    license dropping the null. ``Annotated[ProviderConfig | None, FieldSpec(
    ts="object")]`` is still nullable.
    """
    origin = get_origin(hint)
    if origin is Annotated:
        return is_nullable(get_args(hint)[0])
    if origin not in (Union, UnionType):
        return False
    branches = [evaluate(a) for a in get_args(hint)]
    non_null = [a for a in branches if a is not type(None)]
    return len(non_null) == 1 and len(non_null) != len(branches)
