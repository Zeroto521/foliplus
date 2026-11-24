"""Resolve one __init__ annotation to the TS tag the schema carries."""

from __future__ import annotations

from types import UnionType
from typing import Annotated, Any, Literal, Union, get_args, get_origin

from .spec import (
    ARRAY_TAGS,
    DICT_TAGS,
    PRIMITIVES,
    FieldSpec,
    evaluate,
    field_spec_in,
    is_nullable,
)
from .tag import SUPPORTED_TAGS, TS_OBJECTS, TS_PRIMITIVES


def resolve_tag(
    hint: Any, meta: FieldSpec | None
) -> tuple[str, tuple[str, ...] | None, bool, FieldSpec | None]:
    """Resolve one annotation to ``(tag, values, nullable, spec)``.

    ``spec`` is the caller's ``FieldSpec`` metadata (or ``None``):
    :func:`derive_schema` reads ``optional`` and ``note`` from it. ``ts``,
    ``values`` and ``nullable`` are the reflector's own decision, reported
    separately so the caller can see what was decided and from where.

    Layers, in order of authority:

    1. An explicit ``FieldSpec(ts=...)`` — an override the caller wrote
       because the automatic mapping cannot decide (a ``Literal`` that is
       really ``NumberStyle``, a ``str | dict`` union that is really
       ``ProviderConfig``, …).
    2. ``X | None`` — a nullable variant of whatever ``X`` resolves to.
    3. Bare Python type, ``Literal``, ``list[X]``, ``dict[K, V]``.

    ``peeled`` distinguishes a real ``Literal`` from a type alias that
    happens to be a ``Literal``: a bare ``Literal`` is a union, but a
    ``Literal`` wrapped in ``Annotated`` with a ``FieldSpec`` is the alias.
    """
    origin = get_origin(hint)
    # Peel Annotated for the base type whether or not it carries a FieldSpec:
    # ``Annotated[float, Bound(0.0, 1.0)]`` validates at call time and has
    # nothing to say about the TS tag, so ``base`` must reach ``float``.
    args = get_args(hint) if origin is Annotated else ()
    base = args[0] if args else hint
    inner_meta = field_spec_in(*args[1:]) if args else None
    # A layer that carries no FieldSpec keeps the one passed down by an outer
    # layer: `Annotated[PositiveInt | None, FieldSpec(note=...)]` peels to
    # `Annotated[int, Bound(...)] | None`, whose Bound is not a FieldSpec, and
    # the note must survive that hop.
    meta = inner_meta or meta
    peeled = meta is not None

    if meta is not None and meta.ts:
        # The caller named the type; nullability still comes from the
        # annotation, not from the override.
        return meta.ts, meta.values, is_nullable(hint) or meta.nullable, meta

    if origin is Annotated:
        # No tag override, so the type to render is the annotated base. It may
        # itself be a union or another Annotated (PositiveInt is
        # Annotated[int, Bound(...)]), so recurse rather than re-implementing
        # the mapping below; the meta carries note and optional through.
        tag, values, nullable, inner_meta = resolve_tag(base, meta)
        return tag, values, nullable, meta or inner_meta

    if origin in (Union, UnionType):
        branches = [evaluate(a) for a in get_args(hint)]
        non_null = [a for a in branches if a is not type(None)]
        nullable = len(non_null) != len(branches)
        if len(non_null) == 1:
            # A FieldSpec may sit on the non-null branch rather than outside the
            # union (`Annotated[dict, FieldSpec(...)] | None`, and the spelled
            # `Optional[Annotated[...]]` form alike). Resolving the branch takes
            # the spec back out so the caller's ts/name/note survive the null
            # branch — a spec already carried in `meta` by an outer Annotated
            # layer wins.
            tag, values, inner_nullable, inner_meta = resolve_tag(non_null[0], meta)
            return tag, values, nullable or inner_nullable, meta or inner_meta
        # A union of two unrelated branches is not a JSON shape: the caller must
        # name it. ProviderConfig's `str | dict` reaches here as
        # `str | TypedDict` and carries FieldSpec(ts=...) for exactly this.
        raise ValueError(
            f"cannot map union annotation {hint!r} to a TS tag — add "
            "FieldSpec(ts=...) to name the union"
        )

    if origin is Literal:
        if not peeled:
            return "union", tuple(str(v) for v in get_args(hint)), False, meta
        # A peeled Literal (wrapped in Annotated with a FieldSpec) is an
        # alias: the reflected tag is "union" with the Literal's values, and
        # the caller's FieldSpec names the alias via ``name`` so the
        # generator emits it. A ``ts`` override on a Literal returns at the
        # meta.ts check above, because ts names the type outright.
        values = tuple(str(v) for v in get_args(hint))
        nullable = is_nullable(hint)
        if meta is not None and meta.name is not None:
            return "union", values, nullable or meta.nullable, meta
        raise ValueError(
            "a Literal alias needs FieldSpec(name=...) to name its TS type; "
            "bare Literal unions are decided automatically"
        )

    if base in PRIMITIVES:
        return PRIMITIVES[base], None, False, None

    if get_origin(base) is list:
        return ARRAY_TAGS.get(get_args(base), "array_unknown"), None, False, None

    if get_origin(base) is dict:
        return DICT_TAGS.get(get_args(base), "object"), None, False, None

    raise ValueError(
        f"cannot map annotation {hint!r} to a TS tag — add FieldSpec(ts=...) "
        "to the type alias it is declared with, or extend _config_schema"
    )
