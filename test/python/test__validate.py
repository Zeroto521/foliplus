"""Tests for foliplus._validate — the annotation-driven argument checks."""

from __future__ import annotations

import inspect
from typing import Annotated, Literal

import pytest

from foliplus._validate import (
    Bound,
    _bound_rule,
    _choice_rule,
    _describe,
    _is_integer_like,
    _optional,
    _rule_for,
    _rules_for,
    validate,
)

Zoom = Annotated[int, Bound(1, 18)]
Mode = Literal["coord", "addr"]


class _Indexable:
    """Integer-like object that is not an ``int`` (stands in for numpy scalars).

    numpy's integer scalars are not registered with :class:`numbers.Integral`, so
    they can only be recognised through the ``__index__`` protocol — exactly what
    this stand-in exercises without depending on numpy.
    """

    def __init__(self, value: int) -> None:
        self.value = value

    def __index__(self) -> int:
        return self.value

    def __eq__(self, other: object) -> bool:
        return self.value == other

    def __lt__(self, other: object) -> bool:
        return self.value < other

    def __gt__(self, other: object) -> bool:
        return self.value > other

    def __repr__(self) -> str:
        return f"_Indexable({self.value})"


class TestBound:
    """Bounds attached to an annotation."""

    def test_requires_at_least_one_end(self):
        with pytest.raises(ValueError, match="at least one of low/high"):
            Bound()

    def test_inclusive_ends_are_inclusive(self):
        bound = Bound(1, 18)
        assert bound.contains(1)
        assert bound.contains(18)
        assert not bound.contains(0)
        assert not bound.contains(19)

    def test_exclusive_low(self):
        bound = Bound(0, None, exclusive_low=True)
        assert not bound.contains(0)
        assert bound.contains(0.1)

    def test_exclusive_high(self):
        bound = Bound(None, 1, exclusive_high=True)
        assert not bound.contains(1)
        assert bound.contains(0.9)

    def test_open_ends(self):
        assert Bound(0, None).contains(10_000_000)
        assert Bound(None, 0).contains(-10_000_000)


class TestDescribe:
    """The noun phrase used in the error message."""

    def test_int_between(self):
        assert _describe(int, Bound(1, 18)) == "an int between 1 and 18"

    def test_number_between(self):
        assert _describe(float, Bound(0.0, 1.0)) == "a number between 0.0 and 1.0"

    def test_zero_exclusive_low_reads_as_positive(self):
        assert _describe(float, Bound(0.0, None, exclusive_low=True)) == (
            "a positive number"
        )

    def test_non_zero_exclusive_low_keeps_the_operator(self):
        assert _describe(int, Bound(1, None, exclusive_low=True)) == "an int > 1"

    def test_inclusive_low_keeps_the_operator(self):
        assert _describe(int, Bound(0, None)) == "an int >= 0"

    def test_exclusive_high_keeps_the_operator(self):
        assert _describe(int, Bound(None, 10, exclusive_high=True)) == "an int < 10"

    def test_inclusive_high_keeps_the_operator(self):
        assert _describe(int, Bound(None, 10)) == "an int <= 10"


class TestIsIntegerLike:
    """Integer detection that numpy scalars survive."""

    def test_plain_int(self):
        assert _is_integer_like(3)

    def test_bool_counts_as_int(self):
        assert _is_integer_like(True)

    def test_index_protocol(self):
        assert _is_integer_like(_Indexable(7))

    def test_float_is_rejected(self):
        assert not _is_integer_like(3.5)
        assert not _is_integer_like(3.0)

    def test_str_and_none_are_rejected(self):
        assert not _is_integer_like("3")
        assert not _is_integer_like(None)

    def test_numpy_integer(self):
        numpy = pytest.importorskip("numpy")
        assert _is_integer_like(numpy.int64(7))
        assert not _is_integer_like(numpy.float64(7.0))


class TestRules:
    """The compiled per-parameter checkers."""

    def test_choice_rule_accepts_a_member(self):
        _choice_rule(("coord", "addr"))("mode", "addr")

    def test_choice_rule_rejects_an_outsider(self):
        with pytest.raises(
            ValueError, match=r"mode must be one of \('coord', 'addr'\)"
        ):
            _choice_rule(("coord", "addr"))("mode", "invalid")

    def test_int_bound_rejects_a_float(self):
        with pytest.raises(ValueError, match="zoom must be an int between 1 and 18"):
            _bound_rule(int, Bound(1, 18))("zoom", 6.5)

    def test_int_bound_accepts_an_indexable(self):
        _bound_rule(int, Bound(1, 18))("zoom", _Indexable(15))

    def test_int_bound_rejects_an_indexable_out_of_range(self):
        with pytest.raises(ValueError, match="zoom must be an int between 1 and 18"):
            _bound_rule(int, Bound(1, 18))("zoom", _Indexable(19))

    def test_number_bound_accepts_an_int(self):
        _bound_rule(float, Bound(0.0, 1.0))("quality", 1)

    def test_uncomparable_value_reports_a_value_error(self):
        """A bound cannot be compared with a str — that must not leak a TypeError."""
        with pytest.raises(
            ValueError, match="quality must be a number between 0.0 and 1.0"
        ):
            _bound_rule(float, Bound(0.0, 1.0))("quality", "high")

    def test_none_reports_a_value_error(self):
        with pytest.raises(ValueError, match="quality must be a number"):
            _bound_rule(float, Bound(0.0, 1.0))("quality", None)

    def test_optional_skips_none_but_checks_the_value(self):
        seen = []

        def spy(name: str, value: object) -> None:
            seen.append((name, value))

        rule = _optional(spy)
        rule("zoom", None)
        rule("zoom", 15)
        assert seen == [("zoom", 15)]


class TestRuleFor:
    """Turning a single annotation into a checker."""

    def test_plain_types_are_not_enforced(self):
        assert _rule_for(int) is None
        assert _rule_for(str) is None
        assert _rule_for(bool) is None
        assert _rule_for(list[str]) is None

    def test_annotated_without_a_bound_is_not_enforced(self):
        assert _rule_for(Annotated[int, "note"]) is None

    def test_literal_becomes_a_choice_rule(self):
        rule = _rule_for(Mode)
        assert rule is not None
        rule("mode", "addr")
        with pytest.raises(ValueError, match="mode must be one of"):
            rule("mode", "invalid")

    def test_annotated_bound_becomes_a_range_rule(self):
        rule = _rule_for(Zoom)
        assert rule is not None
        rule("zoom", 18)
        with pytest.raises(ValueError, match="zoom must be an int between 1 and 18"):
            rule("zoom", 19)

    def test_optional_bound_allows_none(self):
        rule = _rule_for(Zoom | None)
        assert rule is not None
        rule("zoom", None)
        with pytest.raises(ValueError, match="zoom must be an int between 1 and 18"):
            rule("zoom", 0)

    def test_union_of_two_plain_types_is_not_enforced(self):
        assert _rule_for(int | str) is None

    def test_union_with_two_constrained_arms_is_not_enforced(self):
        assert _rule_for(Zoom | Mode) is None


class TestRulesFor:
    """Collecting the constrained parameters of a function."""

    def test_only_constrained_parameters_are_collected(self):
        def fn(
            *,
            zoom: Zoom = 15,
            mode: Mode = "coord",
            filename: str = "map",
            enabled: bool = True,
        ):
            return None

        assert [name for name, _ in _rules_for(fn)] == ["zoom", "mode"]

    def test_return_annotation_is_ignored(self):
        def fn(*, zoom: Zoom = 15) -> Mode:
            return "coord"

        assert [name for name, _ in _rules_for(fn)] == ["zoom"]


class TestValidate:
    """The decorator applied to a constructor."""

    def test_valid_arguments_pass_through(self):
        @validate
        def fn(*, zoom: Zoom = 15, mode: Mode = "coord") -> tuple[int, str]:
            return zoom, mode

        assert fn(zoom=3, mode="addr") == (3, "addr")

    def test_no_arguments_passes_through(self):
        @validate
        def fn(*, zoom: Zoom = 15) -> int:
            return zoom

        assert fn() == 15

    def test_out_of_range_argument_raises(self):
        @validate
        def fn(*, zoom: Zoom = 15) -> int:
            return zoom

        with pytest.raises(ValueError, match="zoom must be an int between 1 and 18"):
            fn(zoom=0)

    def test_defaults_are_never_revalidated(self):
        """Only the arguments actually passed are checked."""

        @validate
        def fn(*, zoom: Zoom = 99) -> int:
            return zoom

        assert fn() == 99

    def test_unconstrained_parameters_are_left_alone(self):
        @validate
        def fn(*, enabled: bool = True) -> bool:
            return enabled

        assert fn(enabled=0) == 0

    def test_positional_arguments_are_forwarded(self):
        @validate
        def fn(value: str, *, zoom: Zoom = 15) -> tuple[str, int]:
            return value, zoom

        assert fn("v", zoom=2) == ("v", 2)

    def test_name_and_signature_are_preserved(self):
        @validate
        def fn(*, zoom: Zoom = 15) -> int:
            return zoom

        assert fn.__name__ == "fn"
        assert inspect.signature(fn) == inspect.signature(fn.__wrapped__)
