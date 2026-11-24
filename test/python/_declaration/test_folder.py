"""Tests for the folder reader (``foliplus._declaration.folder``)."""

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

_JS_FOLDER_NAME_MAX_RE = re.compile(r"const FOLDER_NAME_MAX = (\d+);")

class TestNormaliseFolder:
    def test_absent_is_none_without_a_warning(self) -> None:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            assert normalise_folder(None, owner="Owner") is None

        assert caught == []

    def test_a_valid_name_is_stripped_and_returned(self) -> None:
        assert normalise_folder("roads", owner="Owner") == "roads"

    def test_surrounding_whitespace_is_stripped(self) -> None:
        assert normalise_folder("  roads  ", owner="Owner") == "roads"

    def test_a_name_over_the_cap_warns_and_degrades(self) -> None:
        cap = _declaration.FOLDER_NAME_MAX
        with pytest.warns(UserWarning) as record:
            assert normalise_folder("f" * (cap + 1), owner="layer 'roads'") is None

        message = str(record[0].message)
        assert f"at {cap + 1} code points; expected at most {cap}" in message

    def test_a_name_at_the_cap_is_accepted(self) -> None:
        cap = _declaration.FOLDER_NAME_MAX
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            assert normalise_folder("g" * cap, owner="Owner") == "g" * cap

        assert caught == []

    def test_the_cap_counts_code_points_not_bytes(self) -> None:
        # Astral code points are four UTF-8 bytes each, so the same name is
        # far longer on the wire. The cap is on the name the author reads,
        # so a name heavy in non-BMP characters is not refused for being
        # long in bytes.
        name = "\U0001f30d" * _declaration.FOLDER_NAME_MAX
        assert normalise_folder(name, owner="Owner") == name

    def test_the_cap_is_measured_after_normalising(self) -> None:
        cap = _declaration.FOLDER_NAME_MAX
        # Padding is stripped before measuring, so a name the author means is
        # not refused for whitespace the panel never shows.
        assert normalise_folder("   " + "x" * cap + "   ", owner="Owner") == "x" * cap
        with pytest.warns(UserWarning):
            assert normalise_folder(" " + "y" * (cap + 2) + " ", owner="Owner") is None

    @pytest.mark.parametrize(
        ("raw", "reason"),
        [
            ("", "empty or whitespace-only string"),
            ("   ", "empty or whitespace-only string"),
            (42, "as int; expected a non-empty string"),
            ({"name": "roads"}, "as dict; expected a non-empty string"),
            (["roads"], "as list; expected a non-empty string"),
        ],
    )
    def test_unusable_declarations_warn_and_degrade(
        self, raw: object, reason: str
    ) -> None:
        with pytest.warns(UserWarning) as record:
            assert normalise_folder(raw, owner="Owner") is None

        assert reason in str(record[0].message)

    def test_the_message_names_the_layer(self) -> None:
        with pytest.warns(UserWarning) as record:
            normalise_folder(42, owner="layer 'roads'")

        message = str(record[0].message)
        assert "layer 'roads' declares foliplus['folder'] as int" in message

    def test_the_message_names_the_layer_via_subject(self) -> None:
        with pytest.warns(UserWarning) as record:
            normalise_folder(42, owner="LayerControl", subject="layer 'roads'")

        message = str(record[0].message)
        assert (
            "LayerControl: layer 'roads' declares foliplus['folder'] as int" in message
        )

    def test_the_message_uses_the_source_it_was_written_with(self) -> None:
        with pytest.warns(UserWarning) as record:
            normalise_folder(42, owner="LayerControl", source="foliplus['layerFolder']")

        message = str(record[0].message)
        assert "LayerControl declares foliplus['layerFolder'] as int" in message

    def test_the_same_defect_is_reported_once(self) -> None:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            for _ in range(3):
                assert normalise_folder("", owner="Owner") is None

        assert len(caught) == 1

    def test_different_layers_are_reported_separately(self) -> None:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            normalise_folder("", owner="layer 'a'")
            normalise_folder("", owner="layer 'b'")

        assert len(caught) == 2

    def test_never_raises_on_any_input(self) -> None:
        # The verdict rule shared with zoom_range: a malformed folder
        # declaration is a warning, never an exception.
        for raw in [None, "", "  ", "roads", 42, {}, {"name": "x"}, [], object()]:
            try:
                normalise_folder(raw, owner="Owner")
            except Exception as exc:  # pragma: no cover - must never raise
                pytest.fail(f"normalise_folder({raw!r}) raised {exc!r}")

def test_the_js_reader_uses_the_same_cap() -> None:
    """The JS reader caps a folder name with its own copy of the constant.

    Both stacks decide which names reach the panel, so the value is read from
    the committed ``folderLayout.ts`` instead of being asserted against a
    literal that would survive a change to either side.
    """
    source = (
        Path(__file__).resolve().parents[3] / "foliplus/js/core/layer/folderLayout.ts"
    ).read_text(encoding="utf-8")
    match = _JS_FOLDER_NAME_MAX_RE.search(source)
    assert match is not None, "FOLDER_NAME_MAX missing from folderLayout.ts"
    assert int(match[1]) == _declaration.FOLDER_NAME_MAX
