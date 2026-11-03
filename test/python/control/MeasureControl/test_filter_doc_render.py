"""Render-level tests for the Measure filter-declaration documentation.

The class docstring is the author-facing contract for ``filter=[...]``. These
tests pin the *documented promises* — the list-of-type-names shape, the
whole-declaration rejection of an unknown name, and the difference between the
filter row's Clear and the factory Reset — so a later docstring edit cannot
silently drop a promise the behaviour tests already rely on. Assertions are
semantic invariants (section presence, key names, rule wording), never the
exact prose.
"""

from __future__ import annotations

import inspect

from foliplus import MeasureControl

# The class docstring is the single contract surface for the declaration.
_DOC = inspect.getdoc(MeasureControl)
assert _DOC is not None, "MeasureControl must carry a class docstring"

# The Notes section (the last major section) holds the declaration tables
# and the resolution rules; anchor on the exact section header.
_NOTES = _DOC.split("Notes\n-----", 1)[1]

# Grid-table rows wrap mid-sentence and carry cell borders. Collapse both so a
# rule can be asserted as one phrase regardless of where the column broke.
_FLAT = " ".join(_NOTES.replace("|", " ").split())


def test_docstring_documents_the_type_name_list_form() -> None:
    """The enum declaration is documented as a list of measurement-type names."""
    assert "``filter`` is a list of measurement-type names" in _DOC
    # Each entry is a string naming a type the filter row offers.
    assert "``str``" in _FLAT
    for name in ("distance", "polygon", "circle", "marker"):
        assert name in _FLAT


def test_docstring_declares_an_unknown_name_rejects_the_whole_list() -> None:
    """One unknown name invalidates the declaration whole, not just itself."""
    assert "unknown type name" in _FLAT.lower()
    assert "alone or beside" in _FLAT
    assert "rejected whole" in _FLAT
    assert "never a partial subset" in _FLAT
    assert "reported once" in _FLAT.lower()


def test_docstring_declares_the_range_arm_as_warned_and_ignored() -> None:
    """A mapping is the other arm: warned once and treated as undeclared."""
    assert "a mapping (the range arm)" in _FLAT.lower()
    assert "``HeatmapControl``" in _FLAT
    assert "treated as" in _FLAT.lower()
    assert "undeclared" in _FLAT.lower()


def test_docstring_separates_filter_row_clear_from_factory_reset() -> None:
    """The filter row's Clear keeps the clear; the factory Reset re-seeds."""
    assert "The filter row's Clear" in _FLAT
    assert "does not come back" in _FLAT
    assert "Factory Reset" in _FLAT
    assert "re-seeds the declaration" in _FLAT
    # The Reset is the toolbar's CLEAR mode, not the filter row.
    assert "CLEAR mode" in _FLAT


def test_docstring_calls_the_declaration_a_starting_condition() -> None:
    """User writes win; the declaration only seeds the first open."""
    assert "starting condition only" in _FLAT
    assert "Wins from then on" in _FLAT
