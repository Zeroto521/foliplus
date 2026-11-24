"""Reflect a control __init__ into a ControlSchema (and its config fields)."""

from __future__ import annotations

import inspect
from types import UnionType
from typing import Annotated, Any, Literal, Union, get_args, get_origin, get_type_hints

from .resolve import resolve_tag
from .spec import SHARED_PARAMS, ControlSchema, FieldSpec, field_spec_in
from .tag import TS_OBJECTS, TS_PRIMITIVE_NAMES, TS_PRIMITIVES


def is_json_serializable(value: Any) -> bool:
    """Return ``True`` when ``value`` can be held by the vitest fixture.

    The fixture is JSON; anything else a default could be (an enum member, a
    bound method, a path) would have to be serialized by hand, so the dump
    fails loud rather than emitting a non-JSON default.
    """
    return (
        value is None
        or isinstance(value, (str, int, float, bool))
        or (isinstance(value, list) and all(is_json_serializable(v) for v in value))
        or (
            isinstance(value, dict)
            and all(is_json_serializable(v) for v in value.values())
        )
    )


def derive_schema(cls: type[BaseControl]) -> ControlSchema:
    """Reflect ``cls.__init__`` into a :class:`ControlSchema`.

    Signature order becomes schema order, and schema order becomes
    ``_config_fields`` order, so a new parameter appended to a signature
    appends a CONFIG key — moving a parameter moves the key. Parameters
    inherited from ``BaseControl.__init__`` (``position``, ``locale``) are
    skipped: they are the base's job, already covered by :data:`SHARED`.

    Defaults must be JSON-serializable — the fixture is generated from them.
    A parameter whose default is a runtime decision (nothing the caller can
    write in a signature) raises; such a field is either dynamic
    (:attr:`BaseControl._dynamic_fields`) or should not be a CONFIG field at
    all.
    """
    init = cls.__init__
    sig = inspect.signature(init)
    hints = get_type_hints(init, include_extras=True)
    out: ControlSchema = {}
    for name, param in sig.parameters.items():
        if name == "self" or name == "return" or name in SHARED_PARAMS:
            continue

        hint = hints.get(name, param.annotation)
        has_default = param.default is not inspect._empty  # noqa: SLF001

        # Order matters: a missing default is a declaration error (the field
        # cannot be a CONFIG field at all), so it is reported before the
        # annotation is mapped — otherwise a caller sees a tag error for a
        # parameter they did not intend to export.
        if not has_default:
            raise ValueError(
                f"{cls.__name__}.{name} has no default — a CONFIG field without a "
                "default cannot be a CONFIG field at all, and JS cannot declare it, "
                "cannot be declared in a signature"
            )

        tag, values, nullable, meta = resolve_tag(hint, None)
        # A named non-union type renders as the alias ``name``; the alias
        # definition comes from ``shape`` on the same FieldSpec, which the
        # caller writes inside the Annotated type. A shape-less named
        # non-union type cannot be rendered, so it fails here rather than at
        # dump time.
        shape: Any = None
        if meta is not None and meta.name is not None:
            # Only non-union named types need a descriptor: a reflected union
            # renders itself from ``values``.
            if tag != "union":
                shape = meta.shape
                if shape is None:
                    raise ValueError(
                        f"{cls.__name__}.{name} FieldSpec.name={meta.name!r} "
                        f"names a non-union type (ts={tag!r}), which needs a "
                        "shape descriptor — set FieldSpec.shape= in the "
                        "annotation"
                    )
        if not is_json_serializable(param.default):
            raise ValueError(
                f"{cls.__name__}.{name} default {param.default!r} is not JSON "
                "serializable — the vitest fixture is generated from it"
            )

        # Reflection decides the tag; the caller's FieldSpec decides the
        # render-time attributes. `optional` defaults to False: Python emits
        # every non-runtime, non-dynamic field, so the per-control TS interface
        # declares it required — dynamic carries optionality.
        # ``shape`` and ``name`` come from the same FieldSpec in the
        # annotation (see above); the reflector cannot infer either from a
        # Python annotation.
        spec = FieldSpec(
            ts=tag,
            values=values,
            nullable=nullable,
            optional=meta.optional if meta else False,
            default=param.default,
            note=meta.note if meta else "",
            shape=shape,
            name=meta.name if meta else None,
        )
        config_name = (meta.config_key if meta else None) or name
        if config_name in out:
            raise ValueError(
                f"{cls.__name__}.{name} exports CONFIG key {config_name!r}, "
                "which another parameter already declares"
            )
        out[config_name] = spec

    # Dynamic fields are collected at render time (LayerControl's ``data``),
    # so they are not parameters — the class declares them here as a
    # name-to-annotation map. Each entry is an ``Annotated`` type whose
    # FieldSpec carries the emitted alias name and the descriptor that
    # renders into it, exactly as a static parameter does. _dynamic_fields is
    # never reflected, so there is no get_type_hints in the way.
    for name, declared in getattr(cls, "_dynamic_fields", {}).items():
        if name in out:
            raise ValueError(
                f"{cls.__name__}.{name} is declared both in the signature and "
                "in _dynamic_fields — a dynamic field is not a parameter"
            )
        args = get_args(declared)
        meta = field_spec_in(*args[1:]) if get_origin(declared) is Annotated else None
        if meta is None:
            raise ValueError(
                f"{cls.__name__}._dynamic_fields[{name!r}] is not an Annotated "
                "type carrying a FieldSpec — a dynamic field declares its "
                "emitted alias name and shape there."
            )
        if meta.shape is None:
            raise ValueError(
                f"{cls.__name__}._dynamic_fields[{name!r}] FieldSpec needs both "
                "name= (the emitted alias) and shape= (what that alias renders)."
            )
        # __post_init__ rejects a shape without a name; assert so mypy narrows.
        assert meta.name is not None
        out[name] = FieldSpec(
            ts=meta.name,
            name=meta.name,
            shape=meta.shape,
            dynamic=True,
            optional=True,
            default=[],
            note="Layer list collected from the parent map at render time via _extra_config.",
        )

    return out


# ── Per-control schemas ──────────────────────────────────────────────────
# Order within a control's schema is signature order — the derived
# ``_config_fields`` tuple inherits it verbatim, so a reordered signature
# reorders the exported CONFIG keys.


def config_fields(schema: ControlSchema) -> tuple[str, ...]:
    """Fields Python emits to CONFIG for one control (non-runtime, non-dynamic keys).

    Order is declaration order. Called by BaseControl's
    ``__init_subclass__``, which assigns the result to ``_config_fields`` —
    the schema is the single source and the tuple inherits this order.
    Dynamic fields are intentionally excluded — they are emitted via
    ``_extra_config`` rather than a static ``_config_fields`` key.
    """
    return tuple(k for k, f in schema.items() if not f.dynamic)
