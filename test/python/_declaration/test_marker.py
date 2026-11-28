"""Tests for the marker colour/size readers (``foliplus._declaration.marker``)."""

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


@pytest.mark.parametrize("raw", ["", " ", "\u001c", "\ufeff", "\u2003"])
def test_normalise_marker_color_rejects_a_whitespace_only_value(raw):
    # Pure whitespace is not a preset and not a hex; the same union trim as the
    # JS reader decides it, and the message names the blank case (not a shape
    # defect), so a whitespace-only name is rejected on both stacks.
    with pytest.warns(UserWarning, match="empty or whitespace-only"):
        assert normalise_marker_color(raw, owner="Owner") is None


def test_normalise_marker_color_trims_with_the_shared_set():
    # The preset/hex channel trims with the shared declared-string set, not
    # str.strip(): the JS reader accepts the same padded spelling.
    for raw in [" darkred ", "\ufeffdarkred", "\u2003darkred"]:
        assert normalise_marker_color(raw, owner="Owner") == "darkred"
    for raw in [" #f00 ", "\ufeff#f00", "\u3000#f00"]:
        assert normalise_marker_color(raw, owner="Owner") == "#ff0000"


def test_normalise_marker_color_strips_a_valid_name():
    assert (
        normalise_marker_color("  darkred  ", owner="Owner", subject="layer 'L'")
        == "darkred"
    )


@pytest.mark.parametrize("raw", [7, ["red"], "   "])
def test_normalise_marker_color_rejects_non_string_or_blank(raw):
    _declaration.foliplus_reports.clear()
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        assert normalise_marker_color(raw, owner="Owner", subject="layer 'L'") is None
        assert any("marker_color" in str(w.message) for w in caught), (
            raw,
            [str(w.message) for w in caught],
        )


def test_normalise_marker_color_does_not_gate_the_vocabulary():
    # An out-of-vocabulary name is the JS reader's verdict (it owns the preset
    # table); here it survives as a plain string, like the enum filter's
    # measurement-type names.
    assert normalise_marker_color("not-a-preset", owner="Owner") == "not-a-preset"


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("#00A6A6", "#00a6a6"),
        ("#abc", "#aabbcc"),
        ("  #1A2B3C  ", "#1a2b3c"),
    ],
)
def test_normalise_marker_color_accepts_a_css_hex(raw, expected):
    assert normalise_marker_color(raw, owner="Owner") == expected


@pytest.mark.parametrize("raw", ["#12", "#12345", "#1234567", "red", "#GGGGGG"])
def test_normalise_marker_color_passes_a_non_preset_through(raw):
    # The Python reader does not own the preset/hex vocabulary (that is the JS
    # reader's verdict, which warns once) — it only gates the shape (a
    # non-empty string), so a malformed hex or an unknown preset name survives
    # unchanged for the JS reader to warn about.
    _declaration.foliplus_reports.clear()
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        assert normalise_marker_color(raw, owner="Owner") == raw


def test_normalise_marker_color_hex_is_lowercased():
    assert normalise_marker_color("#AABBCC", owner="Owner") == "#aabbcc"


# icon_size normalisation: a whole-number pixel size; folium Icon has no
# px-size channel, so this is foliplus-only.


@pytest.mark.parametrize("raw", [1, 36, 120])
def test_normalise_icon_size_accepts_positive_ints(raw):
    assert normalise_icon_size(raw, owner="Owner") == raw


@pytest.mark.parametrize("raw", [0, -8, 12.5, "36", True])
def test_normalise_icon_size_rejects_non_positive_or_non_int(raw):
    _declaration.foliplus_reports.clear()
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        assert normalise_icon_size(raw, owner="Owner") is None
        assert any("icon_size" in str(w.message) for w in caught), (
            raw,
            [str(w.message) for w in caught],
        )


def test_normalise_marker_color_none_is_not_declared_without_a_warning():
    # None is "not declared", not a defect: it reads as None and never warns,
    # the same verdict the border/folder readers give a missing declaration.
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        assert normalise_marker_color(None, owner="Owner") is None
    assert caught == []


def test_normalise_icon_size_none_is_not_declared_without_a_warning():
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        assert normalise_icon_size(None, owner="Owner") is None
    assert caught == []
