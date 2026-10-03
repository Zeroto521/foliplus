"""Tests for ``derive_schema`` — the reflection core.

These cover the mechanics the per-control tests cannot reach: how an
annotation becomes a TS tag, where a ``FieldSpec`` metadata is picked up
(parameter, type alias, or not at all), and what makes the reflector fail
loud rather than guess.
"""

from __future__ import annotations

from typing import Annotated, Literal

import pytest

from foliplus._config_schema import FieldSpec, _evaluate, derive_schema, verify_tags
from foliplus._validate import Bound


class _ReflectBase:
    """Base whose parameters are shared and must be skipped by the reflector."""

    def __init__(self, *, position: str = "topleft", locale: str | None = None) -> None:
        self.position = position
        self.locale = locale


def _control(init: object, **extra: object) -> type:
    """Build a throwaway control from a given ``__init__``."""
    return type("ProbeControl", (_ReflectBase,), dict({"__init__": init}, **extra))


class _Primitives(_ReflectBase):
    def __init__(self, *, a: str = "x", b: bool = True, c: int = 1, d: float = 2.0):
        self.a, self.b, self.c, self.d = a, b, c, d


class _Literal(_ReflectBase):
    def __init__(self, *, fmt: Literal["png", "jpeg"] = "png"):
        self.fmt = fmt


class _Nullable(_ReflectBase):
    def __init__(self, *, n: int | None = None):
        self.n = n


class _Pep604(_ReflectBase):
    """A spelled-out union under `from __future__ import annotations`."""

    def __init__(self, *, s: list[str] | None = None):
        self.s = s


class _Bound(_ReflectBase):
    def __init__(self, *, z: Annotated[int, Bound(1, 18)] = 15):
        self.z = z


class _Override(_ReflectBase):
    def __init__(
        self,
        *,
        hint: Annotated[dict, FieldSpec(ts="object_nested")] = {},
    ):
        self.hint = hint


class _Alias(_ReflectBase):
    def __init__(
        self, *, alias: Annotated[Literal["a", "b"], FieldSpec(name="NumberStyle")] = "a"
    ):
        self.alias = alias


# The pattern HeatmapControl.LABEL_FORMAT uses: an alias that carries its TS
# type name in a FieldSpec. The shared ``ControlPosition`` alias stays a bare
# Literal (a public contract), so the alias-metadata channel is exercised
# here rather than through it.
_POSITION = Annotated[Literal["topleft", "topright"], FieldSpec(ts="ControlPosition")]


class _Position(_ReflectBase):
    def __init__(self, *, pos: _POSITION = "topright"):
        self.pos = pos


class _BareLiteralAlias(_ReflectBase):
    def __init__(self, *, field: Literal["a", "b"] = "a"):
        self.field = field


class _Shared(_ReflectBase):
    def __init__(self, *, locale: str | None = None):
        self.locale = locale


class _NoDefault(_ReflectBase):
    def __init__(self, *, required: str) -> None:
        self.required = required


class _BadDefault(_ReflectBase):
    class _NotJSON:
        pass

    def __init__(self, *, x: str = _NotJSON()):
        self.x = x


class _Dynamic(_ReflectBase):
    _dynamic_fields = ("data",)
    _data_hint = "LayerData"

    def __init__(self, *, show: bool = True):
        self.show = show


class _DynamicClash(_ReflectBase):
    _dynamic_fields = ("data",)

    def __init__(self, *, data: list[str] = []):
        self.data = data


class _DynamicNoHint(_ReflectBase):
    """A dynamic field without a hint attribute — a declaration bug."""

    _dynamic_fields = ("data",)

    def __init__(self, *, show: bool = True):
        self.show = show


class _Order(_ReflectBase):
    def __init__(self, *, b: str = "1", a: str = "2", c: str = "3"):
        self.b, self.a, self.c = b, a, c


class _UnnamedUnion(_ReflectBase):
    def __init__(self, *, provider: str | dict = "x"):
        self.provider = provider


class _UnknownType(_ReflectBase):
    def __init__(self, *, w: tuple[int, str] = (1, "x")):
        self.w = w


class _DictParam(_ReflectBase):
    def __init__(self, *, meta: dict[int, str] = {}):
        self.meta = meta


class _LiteralAliasNoTag(_ReflectBase):
    """A ``Literal`` alias that declares a note but no TS type name."""

    def __init__(
        self,
        *,
        fmt: Annotated[Literal["a", "b"], FieldSpec(ts="", note="a named style")] = "a",
    ):
        self.fmt = fmt


def test_bare_primitives_map_to_their_ts_tags() -> None:
    schema = derive_schema(_Primitives)
    assert schema["a"].ts == "string"
    assert schema["b"].ts == "bool"
    assert schema["c"].ts == "number"
    assert schema["d"].ts == "number"


def test_literal_becomes_a_union_with_values() -> None:
    schema = derive_schema(_Literal)
    assert schema["fmt"].ts == "union"
    assert schema["fmt"].values == ("png", "jpeg")
    assert schema["fmt"].default == "png"


def test_nullable_union_sets_nullable() -> None:
    schema = derive_schema(_Nullable)
    assert schema["n"].ts == "number"
    assert schema["n"].nullable is True


def test_pep604_string_annotation_is_nullable_too() -> None:
    schema = derive_schema(_Pep604)
    assert schema["s"].ts == "array_string"
    assert schema["s"].nullable is True


def test_evaluate_resolves_a_stringified_union_arm() -> None:
    """A union arm can reach the reflector as a string; resolve it.

    ``get_type_hints`` evaluates a spelled-out union as a whole, so an arm
    normally arrives as a type. The string path keeps ``"None"`` equivalent
    to ``None``, so a nullable union resolves however it is spelled.
    """
    assert _evaluate("None") is type(None)
    assert _evaluate("list") is list


def test_bound_metadata_is_ignored_by_the_reflector() -> None:
    """``Bound`` is the validation channel; the reflector reads only the type."""
    schema = derive_schema(_Bound)
    assert schema["z"].ts == "number"


def test_field_spec_at_the_parameter_overrides_the_tag() -> None:
    schema = derive_schema(_Override)
    assert schema["hint"].ts == "object_nested"


def test_field_spec_at_the_alias_definition_carries_the_tag() -> None:
    """A type alias declares its TS type next to itself, not in a table."""
    schema = derive_schema(_Alias)
    assert schema["alias"].name == "NumberStyle"


def test_position_alias_resolves_through_its_own_metadata() -> None:
    """A control-position alias names Leaflet's ``ControlPosition``."""
    schema = derive_schema(_Position)
    assert schema["pos"].ts == "ControlPosition"


def test_bare_literal_alias_falls_back_to_union() -> None:
    """A Literal spelled inline (no alias) is a plain union.

    The alias case — ``LABEL_FORMAT``-style — requires ``FieldSpec(ts=...)``
    on the alias; without it the reflector cannot distinguish a bare
    ``Literal`` from a ``Literal`` that is really an alias (get_type_hints
    evaluates the alias away). The current behaviour is to emit a literal
    union, which is a safe downgrade: it renders to a valid TS type. A
    stricter refusal would need alias-identity tracking, which the
    contract rejects as a central table.
    """
    schema = derive_schema(_BareLiteralAlias)
    assert schema["field"].ts == "union"
    assert schema["field"].values == ("a", "b")


def test_unnamed_union_fails_loud() -> None:
    """A union of two unrelated arms cannot be rendered; the author names it."""
    with pytest.raises(ValueError, match="union"):
        derive_schema(_UnnamedUnion)


def test_shared_parameters_are_skipped() -> None:
    """``position`` and ``locale`` belong to the base class, not the schema."""
    schema = derive_schema(_Shared)
    assert "locale" not in schema


def test_no_default_fails_loud() -> None:
    """A CONFIG field without a default is emitted only if JS sets it."""
    with pytest.raises(ValueError, match="no default"):
        derive_schema(_NoDefault)


def test_non_json_default_fails_loud() -> None:
    """A default the vitest fixture cannot hold must be rejected."""
    with pytest.raises(ValueError, match="JSON"):
        derive_schema(_BadDefault)


def test_dynamic_fields_are_declared_on_the_class() -> None:
    schema = derive_schema(_Dynamic)
    assert schema["show"].dynamic is False
    assert schema["data"].dynamic is True
    assert schema["data"].ts == "LayerData"


def test_dynamic_field_clashing_with_a_parameter_fails_loud() -> None:
    with pytest.raises(ValueError, match="dynamic"):
        derive_schema(_DynamicClash)


def test_dynamic_field_without_hint_fails_loud() -> None:
    """A dynamic field without ``_<name>_hint`` is a declaration bug."""
    with pytest.raises(ValueError, match="_data_hint"):
        derive_schema(_DynamicNoHint)


def test_derivation_preserves_signature_order() -> None:
    schema = derive_schema(_Order)
    assert list(schema) == ["b", "a", "c"]


def test_unknown_annotation_fails_loud() -> None:
    """A hint no tag can render is named in the error, not swallowed."""
    with pytest.raises(ValueError, match="cannot map annotation"):
        derive_schema(_UnknownType)


def test_dict_annotation_falls_back_to_object() -> None:
    """A dict shape no tag names renders as the generic record."""
    schema = derive_schema(_DictParam)
    assert schema["meta"].ts == "object"
    assert schema["meta"].nullable is False


def test_literal_alias_without_a_tag_fails_loud() -> None:
    """A Literal alias must name its TS type; a note alone does not count."""
    with pytest.raises(ValueError, match="Literal alias needs FieldSpec"):
        derive_schema(_LiteralAliasNoTag)


def test_verify_tags_fails_loud_on_an_unimported_name() -> None:
    """A tag no import supplies would render as an unresolvable TS type."""
    with pytest.raises(ValueError, match="does not declare"):
        verify_tags({"Nope"}, set())
