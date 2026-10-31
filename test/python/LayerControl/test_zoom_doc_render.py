"""Render-level tests for the zoom-declaration documentation.

The class docstring is the author-facing contract for the ``zoom``
declaration (``foliplus={"zoom": {"min": ..., "max": ...}}``). These tests
pin the *documented promises* - the mapping form, the ``gdf.explore``
writing form, and the warn-once / treat-as-undeclared rules - so a later
docstring edit cannot silently drop a promise the behaviour tests already
rely on. Assertions are semantic invariants (section presence, key names,
rule wording), never the exact prose.
"""

from __future__ import annotations

import inspect

from foliplus import LayerControl

# The class docstring is the single contract surface for the declaration.
_DOC = inspect.getdoc(LayerControl)
assert _DOC is not None, "LayerControl must carry a class docstring"

# The Notes section (the last major section) holds the declaration tables
# and the resolution rules; anchor on the exact section header.
_NOTES = _DOC.split("Notes\n-----", 1)[1]


def test_docstring_documents_zoom_mapping_form() -> None:
    """The zoom declaration is documented as a mapping with min and max."""
    # The Recognised-keys table names the ``zoom`` key.
    assert "``zoom``" in _DOC
    # The declaration-keys table names both mapping keys as the only shape.
    assert "``min``" in _DOC
    assert "``max``" in _DOC
    # The mapping form appears in the table (Type column = dict).
    assert "dict" in _NOTES


def test_docstring_documents_explore_writing_form() -> None:
    """The example writes the declaration through ``gdf.explore(foliplus=...)``."""
    assert "gdf.explore(foliplus=" in _DOC
    assert "zoom" in _DOC


def test_docstring_declares_malformed_warns_once_and_is_ignored() -> None:
    """Notes says a malformed declaration warns once and is never fatal."""
    assert "Warns once" in _NOTES
    assert "treated as undeclared" in _NOTES.lower()
    assert "never hides" in _NOTES


def test_docstring_declares_unusable_treated_as_undeclared() -> None:
    """Notes says an unusable range is treated as undeclared and stays visible."""
    assert "Treated as undeclared" in _NOTES
    assert "stays visible" in _NOTES
