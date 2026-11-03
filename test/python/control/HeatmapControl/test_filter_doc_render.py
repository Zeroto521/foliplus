"""Render-level tests for the Heatmap filter-declaration documentation.

The class docstring is the author-facing contract for ``filter={"min": ...,
"max": ...}``. These tests pin the *documented promises* — the mapping shape
bound to the aggregation field, the API-misuse ``ValueError``, the warn-once /
treat-as-undeclared rule for data-shaped problems, and the difference between
the filter row's Clear and the factory Reset — so a later docstring edit cannot
silently drop a promise the behaviour tests already rely on. Assertions are
semantic invariants (section presence, key names, rule wording), never the
exact prose.
"""

from __future__ import annotations

import inspect

from foliplus import HeatmapControl

# The class docstring is the single contract surface for the declaration.
_DOC = inspect.getdoc(HeatmapControl)
assert _DOC is not None, "HeatmapControl must carry a class docstring"

# The Notes section (the last major section) holds the declaration tables
# and the resolution rules; anchor on the exact section header.
_NOTES = _DOC.split("Notes\n-----", 1)[1]

# Grid-table rows wrap mid-sentence and carry cell borders. Collapse both so a
# rule can be asserted as one phrase regardless of where the column broke.
_FLAT = " ".join(_NOTES.replace("|", " ").split())


def test_docstring_documents_the_min_max_mapping_form() -> None:
    """The range declaration is documented as a mapping with min and max."""
    assert "``filter`` is a mapping with ``min`` and ``max``" in _DOC
    assert "``min`` / ``max``" in _FLAT
    assert "``number``" in _FLAT
    # The range is bound to the aggregation field, not a free-standing window.
    assert "``field=``" in _FLAT


def test_docstring_declares_api_misuse_raises_valueerror() -> None:
    """A filter key, no bound field, or the other arm raises at the cell."""
    assert "``ValueError``" in _FLAT
    assert "``field`` key inside ``filter``" in _FLAT
    assert '``agg="count"``' in _FLAT
    assert "a list of value names" in _FLAT


def test_docstring_declares_data_shaped_problems_warn_once() -> None:
    """An extent failure warns once and is treated as undeclared."""
    assert "Data-shaped problem" in _FLAT
    assert "Reported once" in _FLAT
    assert "treated as" in _FLAT.lower()
    assert "undeclared" in _FLAT.lower()
    # The failure never turns into a filter that hides every feature.
    assert "never silently filtered to" in _FLAT
    assert "empty" in _FLAT


def test_docstring_separates_filter_row_clear_from_factory_reset() -> None:
    """The filter row's Clear keeps the clear; the panel's Clear re-seeds."""
    assert "The filter row's Clear" in _FLAT
    assert "does not come back" in _FLAT
    assert "Factory Reset" in _FLAT
    assert "re-seeds the declaration" in _FLAT
    # The factory Reset here is the panel's own Clear button.
    assert "the panel's Clear" in _FLAT


def test_docstring_calls_the_declaration_a_starting_condition() -> None:
    """User writes win; the declaration only seeds the first open."""
    assert "starting condition only" in _FLAT
    assert "Wins from then on" in _FLAT
