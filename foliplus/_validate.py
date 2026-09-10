"""Annotation-driven keyword validation for foliplus controls.

A control declares what it accepts **in its own type annotations**, so there is
no second table to keep in sync with the signature:

* ``Literal[...]`` — the value must be one of the literal's options
  (``position``, ``mode``, ``format``, ``method``, ``agg``, ``export_format``,
  ``label_format``).
* ``Annotated[T, Bound(...)]`` — the value must be a real number inside the
  bounds (``zoom``, ``n_classes``, ``quality``, ``opacity``, ``scale``, ...).
* ``T | None`` — ``None`` is always accepted, ``T`` is validated otherwise.

Only those two explicit forms are enforced. Plain annotations such as ``bool``,
``str`` or ``list[str]`` are left alone, so callers that legitimately pass ``0``
for a flag or a non-``str`` value keep working.

Integer bounds accept any integer-like value — ``int``, ``bool`` and numpy's
integer scalars — through the ``__index__`` protocol rather than
``isinstance(x, numbers.Integral)``, which is ``False`` for ``np.int64``. Float
bounds accept anything the bound can be compared against, so numpy floats and
``fractions.Fraction`` pass as well.

Validation is opt-in per constructor through :func:`validate`::

    @validate
    def __init__(self, *, zoom: Zoom = 15, ...):
        ...

The error wording is deliberately stable — ``"{name} must be ..."`` — because the
Python test suite asserts on it.
"""

from __future__ import annotations

import operator
from collections.abc import Callable
from dataclasses import dataclass
from functools import wraps
from types import NoneType, UnionType
from typing import (
    Annotated,
    Any,
    Literal,
    TypeVar,
    Union,
    cast,
    get_args,
    get_origin,
    get_type_hints,
)

F = TypeVar("F", bound=Callable[..., Any])

#: A compiled check: called with the public keyword name and the passed value.
Rule = Callable[[str, Any], None]

#: Noun phrases per annotated base type, used to build the error message.
_NOUNS: dict[Any, tuple[str, str]] = {
    int: ("an int", "int"),
    float: ("a number", "number"),
}


@dataclass(frozen=True)
class Bound:
    """Numeric bounds attached to an annotation via ``Annotated``.

    At least one end must be given; ``None`` leaves that end open. Attached as
    ``Annotated[float, Bound(0.0, 1.0)]`` (inclusive) or
    ``Annotated[float, Bound(0.0, None, exclusive_low=True)]`` (strictly positive).

    Parameters
    ----------
    low : int or float, optional
        Lower bound; ``None`` leaves the range unbounded below.

    high : int or float, optional
        Upper bound; ``None`` leaves the range unbounded above.

    exclusive_low : bool, default False
        Compare with ``>`` instead of ``>=``.

    exclusive_high : bool, default False
        Compare with ``<`` instead of ``<=``.
    """

    low: int | float | None = None
    high: int | float | None = None
    exclusive_low: bool = False
    exclusive_high: bool = False

    def __post_init__(self) -> None:
        if self.low is None and self.high is None:
            raise ValueError("Bound needs at least one of low/high")

    def contains(self, value: Any) -> bool:
        """Whether ``value`` sits inside the bounds.

        Parameters
        ----------
        value : int or float
            The number to test.

        Returns
        -------
        bool
            ``True`` when the value satisfies both configured ends.
        """
        if self.low is not None and (
            value < self.low or (self.exclusive_low and value == self.low)
        ):
            return False
        if self.high is not None and (
            value > self.high or (self.exclusive_high and value == self.high)
        ):
            return False
        return True


def _describe(base: Any, bound: Bound) -> str:
    """Render ``bound`` as the noun phrase used in the error message.

    Parameters
    ----------
    base : type
        The annotated base type (``int`` or ``float``), which picks the noun.

    bound : Bound
        The bounds to describe.

    Returns
    -------
    str
        e.g. ``"an int between 1 and 18"``, ``"a positive number"``.
    """
    article, noun = _NOUNS[float] if base is float else _NOUNS[int]
    if bound.low is not None and bound.high is not None:
        return f"{article} between {bound.low} and {bound.high}"
    if bound.low is not None:
        if bound.low == 0 and bound.exclusive_low:
            return f"a positive {noun}"
        operator = ">" if bound.exclusive_low else ">="
        return f"{article} {operator} {bound.low}"
    operator = "<" if bound.exclusive_high else "<="
    return f"{article} {operator} {bound.high}"


def _choice_rule(options: tuple[Any, ...]) -> Rule:
    """Build a checker that only accepts ``options``."""

    def check(name: str, value: Any) -> None:
        if value not in options:
            raise ValueError(f"{name} must be one of {options}, got {value!r}")

    return check


def _is_integer_like(value: Any) -> bool:
    """Whether ``value`` is an integer, numpy scalars included.

    ``isinstance(x, numbers.Integral)`` is ``False`` for ``np.int64``, so the
    ``__index__`` protocol is used instead: it accepts ``int``, ``bool`` and every
    numpy integer scalar while rejecting floats, strings and ``None``.

    Parameters
    ----------
    value : Any
        The value to test.

    Returns
    -------
    bool
        ``True`` when the value can be used as an integer index.
    """
    try:
        operator.index(value)
    except TypeError:
        return False
    return True


def _bound_rule(base: Any, bound: Bound) -> Rule:
    """Build a checker that only accepts numbers inside ``bound``.

    For an ``int`` base the value must additionally be integer-like; for a
    ``float`` base any real number is accepted. A value the bound cannot be
    compared against (a string, ``None``, ...) is reported as a ``ValueError``
    rather than leaking the underlying ``TypeError``.
    """
    phrase = _describe(base, bound)
    needs_int = base is not float

    def check(name: str, value: Any) -> None:
        failed = needs_int and not _is_integer_like(value)
        if not failed:
            try:
                failed = not bound.contains(value)
            except TypeError:
                failed = True
        if failed:
            raise ValueError(f"{name} must be {phrase}, got {value!r}")

    return check


def _optional(rule: Rule) -> Rule:
    """Wrap ``rule`` so that an explicit ``None`` always passes."""

    def check(name: str, value: Any) -> None:
        if value is not None:
            rule(name, value)

    return check


def _rule_for(hint: Any) -> Rule | None:
    """Compile one annotation into a checker, or ``None`` when unconstrained.

    Parameters
    ----------
    hint : Any
        A resolved type annotation, with ``Annotated`` extras kept.

    Returns
    -------
    Rule or None
        The checker for a ``Literal`` or bounded annotation; ``None`` for
        anything else (plain types are not enforced).
    """
    origin = get_origin(hint)
    if origin is Annotated:
        base, *metadata = get_args(hint)
        for item in metadata:
            if isinstance(item, Bound):
                return _bound_rule(base, item)
        return None
    if origin is Literal:
        return _choice_rule(get_args(hint))
    if origin is Union or origin is UnionType:
        arms = get_args(hint)
        values = [arm for arm in arms if arm is not NoneType]
        if len(values) != 1:
            return None
        inner = _rule_for(values[0])
        if inner is None:
            return None
        return _optional(inner) if len(values) != len(arms) else inner
    return None


def _rules_for(fn: Callable[..., Any]) -> tuple[tuple[str, Rule], ...]:
    """Compile every constrained parameter of ``fn`` into a rule.

    Parameters
    ----------
    fn : Callable
        The function whose annotations should be read.

    Returns
    -------
    tuple of (str, Rule)
        One entry per parameter that carries a ``Literal`` or ``Bound``.
    """
    rules = []
    for name, hint in get_type_hints(fn, include_extras=True).items():
        if name == "return":
            continue
        rule = _rule_for(hint)
        if rule is not None:
            rules.append((name, rule))
    return tuple(rules)


def validate(fn: F) -> F:
    """Enforce the annotated choices and bounds of a constructor.

    Compiles the rules once, at decoration time, then checks the keyword
    arguments actually passed. Parameters that are not supplied fall back to
    their defaults and are not re-checked.

    Parameters
    ----------
    fn : Callable
        A constructor whose configuration parameters are keyword-only.

    Returns
    -------
    Callable
        ``fn`` wrapped with validation; ``functools.wraps`` keeps the original
        signature for type checkers and documentation tools.
    """
    rules = _rules_for(fn)

    @wraps(fn)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        for name, check in rules:
            if name in kwargs:
                check(name, kwargs[name])
        return fn(*args, **kwargs)

    return cast(F, wrapper)
