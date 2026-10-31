"""Serialization tests for MeasureControl's declared zoom range.

The author writes ``zoom_range={"min": 8, "max": 12}``; Python normalises it
into the same ``{min, max}`` shape the layer declaration emits, under the
shared CONF key ``zoomRange``. The declaration gates the toolbar only;
measurements are never touched.
"""

from __future__ import annotations

import warnings
from pathlib import Path

import pytest

from foliplus import MeasureControl


def _conf(**kwargs: object) -> dict:
    # _build_config is the exact dict BaseControl renders into CONFIG; it is
    # also the only part a declaration changes, so this stays independent of
    # the JS asset build.
    return MeasureControl(**kwargs)._build_config()


def test_declared_zoom_range_reaches_conf():
    conf = _conf(zoom_range={"min": 8, "max": 12})

    assert conf["zoomRange"] == {"min": 8, "max": 12}
    # The author-facing argument never reaches CONF under its own key.
    assert "zoom_range" not in conf


def test_undeclared_zoom_range_is_null():
    assert _conf()["zoomRange"] is None


def test_equal_bounds_are_a_valid_declaration():
    assert _conf(zoom_range={"min": 7, "max": 7})["zoomRange"] == {
        "min": 7,
        "max": 7,
    }


@pytest.mark.parametrize(
    "declaration",
    [
        {"min": 12, "max": 8},
        {"min": 8},
        {"min": 8.5, "max": 12},
        {"min": True, "max": 12},
        {"min": "8", "max": "12"},
        {"min": 8, "max": 12, "step": 1},
        {1: 8, "min": 8, "max": 12},
        [8, 12],
    ],
)
def test_invalid_zoom_range_warns_and_is_treated_as_undeclared(declaration):
    with pytest.warns(UserWarning, match="MeasureControl"):
        conf = _conf(zoom_range=declaration)

    assert conf["zoomRange"] is None


def test_a_repeated_construction_repeats_no_declaration_warning():
    from foliplus._declaration import _foliplus_reports

    _foliplus_reports.clear()
    declaration = {"min": 8, "max": 8.5}

    with warnings.catch_warnings(record=True) as first:
        warnings.simplefilter("always")
        MeasureControl(zoom_range=declaration)

    with warnings.catch_warnings(record=True) as second:
        warnings.simplefilter("always")
        MeasureControl(zoom_range=declaration)

    assert len(first) == 1
    assert second == []


def test_a_warning_names_the_zoom_range_argument():
    # A control takes the declaration directly, so the warning must point at
    # ``zoom_range=`` — not at the layer namespace's ``foliplus[...]`` form,
    # which this entry point does not accept.
    from foliplus._declaration import _foliplus_reports

    _foliplus_reports.clear()

    with pytest.warns(UserWarning) as record:
        MeasureControl(zoom_range={"min": 8.5, "max": 12})

    message = str(record[0].message)
    assert "declares zoom_range" in message
    assert "foliplus[" not in message


def test_a_warning_points_at_the_calling_cell():
    # The declaration is written in the user's own cell, so the warning has to
    # name that file: a warning pointing inside the library is not actionable
    # where the author can see it.
    from foliplus._declaration import _foliplus_reports

    _foliplus_reports.clear()

    with pytest.warns(UserWarning) as record:
        MeasureControl(zoom_range={"min": 8, "max": 8.5})

    assert Path(record[0].filename).resolve() == Path(__file__).resolve()
