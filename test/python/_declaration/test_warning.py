"""Tests for the shared declaration diagnostics (``foliplus._declaration.warning``)."""

from __future__ import annotations

import ast
import re
import warnings
from fractions import Fraction
from pathlib import Path
from types import MappingProxyType

import pytest

from foliplus import _declaration
from foliplus._declaration import (
    MEASURE_TYPE_FIELD,
    enum_atom,
    json_number,
    normalise_border,
    normalise_fill,
    normalise_folder,
    normalise_icon_size,
    normalise_layer_filter,
    normalise_marker_color,
    normalise_zoom_range,
    normalize_declared_filter,
    range_atom,
    should_report,
    warn_foliplus,
    zoom_level,
)


class TestShouldReport:
    def test_first_report_is_true_and_the_repeat_is_false(self) -> None:
        store: set[tuple[str, ...]] = set()

        assert should_report(("a",), store) is True
        assert should_report(("a",), store) is False
        assert store == {("a",)}

    def test_the_cap_clears_the_store_instead_of_growing(self) -> None:
        store: set[tuple[str, ...]] = set()
        for index in range(_declaration.LOG_FILTER_CAP):
            assert should_report((str(index),), store) is True
        assert len(store) == _declaration.LOG_FILTER_CAP

        assert should_report(("new",), store) is True
        assert store == {("new",)}

    def test_families_do_not_crowd_each_other_out_at_the_cap(self) -> None:
        # #804: each diagnostic family owns its own store, so a flood of
        # declaration notes must not roll over the caption history - otherwise
        # a caption that was already reported would print again once the other
        # family's set cleared.
        declarations: set[tuple[str, ...]] = set()
        captions: set[tuple[str, ...]] = set()
        caption = ("caption", "C", "1", "1")

        assert should_report(caption, captions) is True
        for index in range(_declaration.LOG_FILTER_CAP):
            assert should_report((str(index),), declarations) is True
        assert len(declarations) == _declaration.LOG_FILTER_CAP

        assert should_report(caption, captions) is False


class TestWarnFoliplus:
    def test_the_same_note_warns_once(self) -> None:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            warn_foliplus("note", "first")
            warn_foliplus("note", "second")

        assert [str(item.message) for item in caught] == ["first"]

    def test_a_different_note_warns_separately(self) -> None:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            warn_foliplus("a", "first")
            warn_foliplus("b", "second")

        assert [str(item.message) for item in caught] == ["first", "second"]

    def test_the_warning_points_at_the_caller(self) -> None:
        with pytest.warns(UserWarning) as record:
            warn_foliplus("caller", "message")

        assert Path(record[0].filename).resolve() == Path(__file__).resolve()


# ── Zoom-range declaration ───────────────────────────────────────────────
