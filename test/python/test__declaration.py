"""Unit tests for the shared declaration readers (``foliplus._declaration``).

``_declaration.py`` owns the author-facing declaration payloads — the zoom
range (layer ``foliplus={"zoom_range": ...}`` and the control ``zoom_range=``
kwarg), the filter (Heatmap/Measure ``filter=``) and the layer folder
(``foliplus={"folder": ...}``) — plus the warning family
they share. The per-control suites pin the rendered CONFIG; this module pins
the reader contract itself: accepted shapes, the exact verdict (``None`` means
"treat as undeclared"), the de-duplication rule, and the one API-misuse case
that raises instead of warning.
"""

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


@pytest.fixture(autouse=True)
def _fresh_report_filters() -> None:
    """Isolate the process-wide diagnostic stores between tests."""
    _declaration.foliplus_reports.clear()
    _declaration.refused_captions.clear()
    yield
    _declaration.foliplus_reports.clear()
    _declaration.refused_captions.clear()


# ── Shared diagnostics ───────────────────────────────────────────────────
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
class TestZoomLevel:
    def test_accepts_python_integers(self) -> None:
        assert zoom_level(0) == 0
        assert zoom_level(-3) == -3

    def test_narrows_numpy_integers_to_plain_int(self) -> None:
        np = pytest.importorskip("numpy")

        value = zoom_level(np.int64(8))

        assert value == 8
        assert type(value) is int

    @pytest.mark.parametrize(
        "raw",
        [True, False, 8.0, 8.5, "8", None, [8], {"min": 8}],
    )
    def test_rejects_non_integers(self, raw: object) -> None:
        assert zoom_level(raw) is None


class TestNormaliseZoomRange:
    def test_absent_is_none_without_a_warning(self) -> None:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            assert normalise_zoom_range(None, owner="Owner") is None

        assert caught == []

    def test_a_valid_mapping_is_narrowed_to_min_max(self) -> None:
        assert normalise_zoom_range({"min": 8, "max": 12}, owner="Owner") == {
            "min": 8,
            "max": 12,
        }

    def test_equal_bounds_are_valid(self) -> None:
        assert normalise_zoom_range({"min": 7, "max": 7}, owner="Owner") == {
            "min": 7,
            "max": 7,
        }

    def test_a_generic_mapping_is_accepted(self) -> None:
        declaration = MappingProxyType({"min": 8, "max": 12})

        assert normalise_zoom_range(declaration, owner="Owner") == {
            "min": 8,
            "max": 12,
        }

    def test_numpy_bounds_are_narrowed_to_plain_int(self) -> None:
        np = pytest.importorskip("numpy")

        normalised = normalise_zoom_range(
            {"min": np.int64(8), "max": np.int32(12)}, owner="Owner"
        )

        assert normalised == {"min": 8, "max": 12}
        assert [type(value) for value in normalised.values()] == [int, int]

    @pytest.mark.parametrize(
        ("raw", "reason"),
        [
            ({"min": 12, "max": 8}, "min=12 > max=8"),
            ({"min": 8}, "non-integer max=None"),
            ({"min": 8.5, "max": 12}, "non-integer min=8.5"),
            ({"min": True, "max": 12}, "non-integer min=True"),
            ({"min": "8", "max": "12"}, "non-integer min='8'"),
            ({"min": 8, "max": 12, "step": 1}, "unknown key(s) ['step']"),
            ({1: 8, "min": 8, "max": 12}, "unknown key(s) [1]"),
            ([8, 12], "as list; expected a mapping"),
            ("8-12", "as str; expected a mapping"),
        ],
    )
    def test_unusable_declarations_warn_and_degrade(
        self, raw: object, reason: str
    ) -> None:
        with pytest.warns(UserWarning) as record:
            assert normalise_zoom_range(raw, owner="Owner") is None

        assert reason in str(record[0].message)

    def test_the_message_names_the_owner_and_the_control_source(self) -> None:
        with pytest.warns(UserWarning) as record:
            normalise_zoom_range(
                {"min": 8.5, "max": 12},
                owner="HeatmapControl",
                source="zoom_range",
            )

        message = str(record[0].message)
        assert (
            "HeatmapControl declares zoom_range with a non-integer min=8.5" in message
        )
        assert "foliplus[" not in message

    def test_the_message_names_the_layer_and_the_namespace_source(self) -> None:
        with pytest.warns(UserWarning) as record:
            normalise_zoom_range(
                {"min": 8.5, "max": 12},
                owner="LayerControl",
                subject="layer 'roads'",
            )

        message = str(record[0].message)
        assert (
            "LayerControl: layer 'roads' declares foliplus['zoom_range'] "
            "with a non-integer min=8.5"
        ) in message

    def test_the_same_defect_is_reported_once(self) -> None:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            for _ in range(3):
                assert (
                    normalise_zoom_range({"min": 8.5, "max": 12}, owner="Owner") is None
                )

        assert len(caught) == 1

    def test_different_subjects_are_reported_separately(self) -> None:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            normalise_zoom_range(
                {"min": 8.5, "max": 12}, owner="LayerControl", subject="layer 'a'"
            )
            normalise_zoom_range(
                {"min": 8.5, "max": 12}, owner="LayerControl", subject="layer 'b'"
            )

        assert len(caught) == 2


# ── Filter declaration ───────────────────────────────────────────────────
class TestJsonNumber:
    def test_integral_values_become_plain_int(self) -> None:
        assert json_number(3) == 3
        assert type(json_number(3)) is int

    def test_real_values_become_float(self) -> None:
        value = json_number(Fraction(1, 2))

        assert value == 0.5
        assert type(value) is float


class TestRangeAtom:
    def test_a_valid_range_is_a_between_atom_on_the_bound_field(self) -> None:
        assert range_atom({"min": 10, "max": 50}, "HeatmapControl", "score") == {
            "kind": "atom",
            "field": "score",
            "op": "between",
            "range": [10, 50],
        }

    def test_a_field_key_is_api_misuse_and_raises(self) -> None:
        with pytest.raises(ValueError, match="drop 'field' from filter="):
            range_atom(
                {"field": "score", "min": 10, "max": 50}, "HeatmapControl", "score"
            )

    def test_a_range_without_a_bound_field_is_api_misuse_and_raises(self) -> None:
        with pytest.raises(ValueError, match="needs the aggregation field"):
            range_atom({"min": 10, "max": 50}, "HeatmapControl", None)

    @pytest.mark.parametrize(
        ("raw", "reason"),
        [
            ({"min": 10}, "needs both 'min' and 'max'"),
            ({"min": 10, "max": 20, "between": [1, 2]}, "unknown key(s)"),
            ({"min": "10-50", "max": 60}, "must be a finite number"),
            ({"min": 10, "max": True}, "must be a finite number"),
            ({"min": 10, "max": float("inf")}, "must be a finite number"),
            ({"min": 50, "max": 10}, "inverted (min > max)"),
        ],
    )
    def test_unusable_ranges_warn_and_return_none(
        self, raw: object, reason: str
    ) -> None:
        with pytest.warns(UserWarning) as record:
            assert range_atom(raw, "HeatmapControl", "score") is None

        assert reason in str(record[0].message)


class TestEnumAtom:
    def test_values_are_deduplicated_in_first_seen_order(self) -> None:
        assert enum_atom(
            ["polygon", "distance", "polygon"], "MeasureControl", MEASURE_TYPE_FIELD
        ) == {
            "kind": "enum",
            "field": "type",
            "values": ["polygon", "distance"],
        }

    @pytest.mark.parametrize(
        ("raw", "reason"),
        [
            (["distance", 3], "non-empty strings"),
            (["distance", ""], "non-empty strings"),
            ([None], "non-empty strings"),
            ([], "empty list"),
        ],
    )
    def test_unusable_values_warn_and_return_none(
        self, raw: list[object], reason: str
    ) -> None:
        with pytest.warns(UserWarning) as record:
            assert enum_atom(raw, "MeasureControl", MEASURE_TYPE_FIELD) is None

        assert reason in str(record[0].message)


class TestNormalizeDeclaredFilter:
    def test_absent_is_none_without_a_warning(self) -> None:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            assert normalize_declared_filter(None, owner="Owner", kind="range") is None

        assert caught == []

    def test_the_range_kind_delegates_to_the_range_atom(self) -> None:
        assert normalize_declared_filter(
            {"min": 10, "max": 50},
            owner="HeatmapControl",
            kind="range",
            bound_field="score",
        ) == range_atom({"min": 10, "max": 50}, "HeatmapControl", "score")

    def test_the_range_kind_rejects_a_list_and_points_at_measurecontrol(self) -> None:
        with pytest.raises(ValueError, match="enum filters belong to MeasureControl"):
            normalize_declared_filter(
                ["score"],
                owner="HeatmapControl",
                kind="range",
                bound_field="score",
            )

    def test_the_range_kind_warns_on_a_non_mapping_scalar(self) -> None:
        with pytest.warns(UserWarning, match="must be a mapping with min and max"):
            assert (
                normalize_declared_filter(
                    "score",
                    owner="HeatmapControl",
                    kind="range",
                    bound_field="score",
                )
                is None
            )

    def test_the_list_kind_delegates_to_the_enum_atom(self) -> None:
        assert normalize_declared_filter(
            ["distance"], owner="MeasureControl", kind="enum", enum_field="type"
        ) == enum_atom(["distance"], "MeasureControl", "type")

    def test_the_list_kind_rejects_a_non_sequence(self) -> None:
        with pytest.warns(UserWarning, match="must be a list of value names"):
            assert (
                normalize_declared_filter(
                    {"field": "type"},
                    owner="MeasureControl",
                    kind="enum",
                    enum_field="type",
                )
                is None
            )

    def test_the_list_kind_requires_an_enum_field(self) -> None:
        with pytest.raises(ValueError, match="requires enum_field"):
            normalize_declared_filter(["distance"], owner="MeasureControl", kind="enum")


# ── Folder declaration ───────────────────────────────────────────────────
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
        Path(__file__).resolve().parents[2] / "foliplus/js/core/layer/folderLayout.ts"
    ).read_text(encoding="utf-8")
    match = _JS_FOLDER_NAME_MAX_RE.search(source)
    assert match is not None, "FOLDER_NAME_MAX missing from folderLayout.ts"
    assert int(match[1]) == _declaration.FOLDER_NAME_MAX


class TestNormaliseBorder:
    def test_absent_is_none_without_a_warning(self) -> None:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            assert normalise_border(None, owner="Owner") is None

        assert caught == []

    def test_a_valid_follow_fill_declaration_is_returned(self) -> None:
        assert normalise_border({"mode": "follow_fill"}, owner="Owner") == {
            "mode": "follow_fill"
        }

    def test_an_unknown_mode_warns_and_degrades(self) -> None:
        with pytest.warns(UserWarning) as record:
            assert normalise_border({"mode": "nope"}, owner="Owner") is None

        assert "with a mode 'nope'" in str(record[0].message)

    def test_a_missing_mode_warns_and_degrades(self) -> None:
        with pytest.warns(UserWarning) as record:
            assert normalise_border({}, owner="Owner") is None

        assert "without a mode or a field" in str(record[0].message)

    def test_a_value_mode_shell_is_returned(self) -> None:
        assert normalise_border(
            {"mode": "value", "field": "count", "scheme": "Reds"}, owner="Owner"
        ) == {"mode": "value", "field": "count"}

    def test_a_flat_fill_isomorphic_form_is_an_implicit_value_mode(self) -> None:
        assert normalise_border({"field": "count"}, owner="Owner") == {
            "mode": "value",
            "field": "count",
        }

    def test_a_value_mode_without_a_field_warns_and_degrades(self) -> None:
        with pytest.warns(UserWarning) as record:
            assert normalise_border({"mode": "value"}, owner="Owner") is None

        assert "requires a field" in str(record[0].message)

    def test_a_follow_fill_with_a_field_is_a_contradiction(self) -> None:
        with pytest.warns(UserWarning) as record:
            assert (
                normalise_border(
                    {"mode": "follow_fill", "field": "count"}, owner="Owner"
                )
                is None
            )

        assert "contradicts" in str(record[0].message)

    def test_an_unknown_mode_message_names_the_literals(self) -> None:
        with pytest.warns(UserWarning) as record:
            assert normalise_border({"mode": "nope"}, owner="Owner") is None

        assert (
            "expected 'follow_fill', 'value', 'solid' or 'original'"
            in str(record[0].message)
        )

    def test_an_unknown_key_warns_but_keeps_the_valid_mode(self) -> None:
        with pytest.warns(UserWarning) as record:
            normalised = normalise_border(
                {"mode": "follow_fill", "dash": "4 4"}, owner="Owner"
            )

        assert normalised == {"mode": "follow_fill"}
        assert "with unknown key 'dash'" in str(record[0].message)

    @pytest.mark.parametrize(
        ("raw", "reason"),
        [
            ("follow_fill", "as str; expected a mapping"),
            (["follow_fill"], "as list; expected a mapping"),
            (42, "as int; expected a mapping"),
        ],
    )
    def test_a_non_mapping_warns_and_degrades(self, raw: object, reason: str) -> None:
        with pytest.warns(UserWarning) as record:
            assert normalise_border(raw, owner="Owner") is None

        assert reason in str(record[0].message)

    def test_the_message_names_the_layer(self) -> None:
        with pytest.warns(UserWarning) as record:
            normalise_border({"mode": "nope"}, owner="layer 'roads'")

        message = str(record[0].message)
        assert "layer 'roads' declares foliplus['border']" in message

    def test_the_message_uses_the_source_it_was_written_with(self) -> None:
        with pytest.warns(UserWarning) as record:
            normalise_border(
                {"mode": "nope"},
                owner="LayerControl",
                source="foliplus['border']",
            )

        message = str(record[0].message)
        assert "LayerControl declares foliplus['border']" in message

    def test_the_same_defect_is_reported_once(self) -> None:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            for _ in range(3):
                assert normalise_border({"mode": "nope"}, owner="Owner") is None

        assert len(caught) == 1

    def test_never_raises_on_any_input(self) -> None:
        for raw in [
            None,
            {"mode": "follow_fill"},
            {"mode": "value", "field": "count"},
            {"field": "count"},
            {"mode": "nope"},
            {},
            42,
            "x",
            [],
            object(),
        ]:
            try:
                normalise_border(raw, owner="Owner")
            except Exception as exc:  # pragma: no cover - must never raise
                pytest.fail(f"normalise_border({raw!r}) raised {exc!r}")

    def test_a_solid_border_with_color_and_weight_is_returned(self) -> None:
        assert normalise_border(
            {"mode": "solid", "color": "#FF0000", "weight": 2}, owner="Owner"
        ) == {"mode": "solid", "color": "#ff0000", "weight": 2}

    def test_a_color_implies_solid_mode(self) -> None:
        assert normalise_border({"color": "#abc"}, owner="Owner") == {
            "mode": "solid",
            "color": "#aabbcc",
        }

    def test_a_weight_implies_solid_mode(self) -> None:
        assert normalise_border({"weight": 3}, owner="Owner") == {
            "mode": "solid",
            "weight": 3,
        }

    def test_weight_rides_follow_fill(self) -> None:
        assert normalise_border({"mode": "follow_fill", "weight": 2}, owner="Owner") == {
            "mode": "follow_fill",
            "weight": 2,
        }

    def test_an_original_border_keeps_the_weight(self) -> None:
        assert normalise_border({"mode": "original", "weight": 1.5}, owner="Owner") == {
            "mode": "original",
            "weight": 1.5,
        }

    def test_a_color_contradicts_value_mode(self) -> None:
        with pytest.warns(UserWarning) as record:
            assert (
                normalise_border(
                    {"mode": "value", "field": "count", "color": "#ff0000"},
                    owner="Owner",
                )
                is None
            )

        assert "contradicts" in str(record[0].message)

    def test_a_field_contradicts_solid_mode(self) -> None:
        with pytest.warns(UserWarning) as record:
            assert (
                normalise_border({"mode": "solid", "field": "count"}, owner="Owner")
                is None
            )

        assert "contradicts" in str(record[0].message)

    @pytest.mark.parametrize("color", ["red", "#12", 7, ""])
    def test_an_invalid_color_warns_and_drops_only_that_key(self, color: object) -> None:
        with pytest.warns(UserWarning) as record:
            assert normalise_border(
                {"mode": "solid", "color": color}, owner="Owner"
            ) == {"mode": "solid"}

        assert "color" in str(record[0].message)

    @pytest.mark.parametrize("weight", [0, -1, "2", True, float("nan")])
    def test_an_invalid_weight_warns_and_drops_only_that_key(self, weight: object) -> None:
        with pytest.warns(UserWarning) as record:
            assert normalise_border(
                {"mode": "solid", "weight": weight}, owner="Owner"
            ) == {"mode": "solid"}

        assert "weight" in str(record[0].message)


class TestNormaliseFill:
    def test_absent_is_none_without_a_warning(self) -> None:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            assert normalise_fill(None, owner="Owner") is None

        assert caught == []

    def test_a_solid_fill_with_color_and_opacity_is_returned(self) -> None:
        assert normalise_fill(
            {"mode": "solid", "color": "#FF0000", "opacity": 0.5}, owner="Owner"
        ) == {"mode": "solid", "color": "#ff0000", "opacity": 0.5}

    def test_a_color_implies_solid_mode(self) -> None:
        assert normalise_fill({"color": "#abc"}, owner="Owner") == {
            "mode": "solid",
            "color": "#aabbcc",
        }

    def test_an_opacity_implies_solid_mode(self) -> None:
        assert normalise_fill({"opacity": 0.4}, owner="Owner") == {
            "mode": "solid",
            "opacity": 0.4,
        }

    def test_a_flat_field_is_an_implicit_value_mode(self) -> None:
        assert normalise_fill({"field": "score"}, owner="Owner") == {
            "mode": "value",
            "field": "score",
        }

    def test_a_value_mode_shell_is_returned(self) -> None:
        assert normalise_fill(
            {"mode": "value", "field": "score", "scheme": "Reds"}, owner="Owner"
        ) == {"mode": "value", "field": "score"}

    def test_opacity_rides_value_mode(self) -> None:
        assert normalise_fill(
            {"mode": "value", "field": "score", "opacity": 0.3}, owner="Owner"
        ) == {"mode": "value", "field": "score", "opacity": 0.3}

    def test_an_original_fill_keeps_the_opacity(self) -> None:
        assert normalise_fill({"mode": "original", "opacity": 0.8}, owner="Owner") == {
            "mode": "original",
            "opacity": 0.8,
        }

    def test_a_color_contradicts_value_mode(self) -> None:
        with pytest.warns(UserWarning) as record:
            assert (
                normalise_fill(
                    {"mode": "value", "field": "score", "color": "#ff0000"},
                    owner="Owner",
                )
                is None
            )

        assert "contradicts" in str(record[0].message)

    def test_a_color_contradicts_original_mode(self) -> None:
        with pytest.warns(UserWarning) as record:
            assert (
                normalise_fill({"mode": "original", "color": "#ff0000"}, owner="Owner")
                is None
            )

        assert "contradicts" in str(record[0].message)

    def test_a_field_contradicts_solid_mode(self) -> None:
        with pytest.warns(UserWarning) as record:
            assert (
                normalise_fill({"mode": "solid", "field": "score"}, owner="Owner")
                is None
            )

        assert "contradicts" in str(record[0].message)

    def test_a_value_mode_without_a_field_warns_and_degrades(self) -> None:
        with pytest.warns(UserWarning) as record:
            assert normalise_fill({"mode": "value"}, owner="Owner") is None

        assert "requires a field" in str(record[0].message)

    def test_an_empty_fill_warns_and_degrades(self) -> None:
        with pytest.warns(UserWarning) as record:
            assert normalise_fill({}, owner="Owner") is None

        assert "without a mode" in str(record[0].message)

    @pytest.mark.parametrize("color", ["red", "#12", 7, ""])
    def test_an_invalid_color_warns_and_drops_only_that_key(self, color: object) -> None:
        with pytest.warns(UserWarning) as record:
            assert normalise_fill(
                {"mode": "solid", "color": color}, owner="Owner"
            ) == {"mode": "solid"}

        assert "color" in str(record[0].message)

    @pytest.mark.parametrize("opacity", [-0.1, 1.1, "0.5", True, float("nan")])
    def test_an_invalid_opacity_warns_and_drops_only_that_key(
        self, opacity: object
    ) -> None:
        with pytest.warns(UserWarning) as record:
            assert normalise_fill(
                {"mode": "solid", "opacity": opacity}, owner="Owner"
            ) == {"mode": "solid"}

        assert "opacity" in str(record[0].message)

    def test_an_unknown_key_warns_but_keeps_the_valid_mode(self) -> None:
        with pytest.warns(UserWarning) as record:
            normalised = normalise_fill(
                {"mode": "solid", "color": "#ff0000", "dash": "4 4"}, owner="Owner"
            )

        assert normalised == {"mode": "solid", "color": "#ff0000"}
        assert "with unknown key 'dash'" in str(record[0].message)

    def test_the_message_names_the_layer(self) -> None:
        with pytest.warns(UserWarning) as record:
            normalise_fill({"mode": "nope"}, owner="layer 'roads'")

        message = str(record[0].message)
        assert "layer 'roads' declares foliplus['fill']" in message

    def test_never_raises_on_any_input(self) -> None:
        for raw in [
            None,
            {"mode": "solid"},
            {"field": "x"},
            {},
            42,
            "x",
            [],
            object(),
        ]:
            try:
                normalise_fill(raw, owner="Owner")
            except Exception as exc:  # pragma: no cover - must never raise
                pytest.fail(f"normalise_fill({raw!r}) raised {exc!r}")


# ── Module-constants placement guard ─────────────────────────────────────
# A regression guard for the top-of-file "Module constants" block: every
# module-level binding — plain assignment, annotated assignment, augmented
# assignment, a module-level walrus, or an import — must sit above the first
# function/class definition, so a new constant cannot be dropped mid-module
# and escape the single block the module docstring promises. The check is
# deliberately declaration-scoped: it inspects only the module body, never a
# function/class body (a binding inside a definition is inherently after the
# first definition and would be a false positive). Parametrised over the
# reader and its own test module, plus negative fixtures that prove the
# guard actually sees each late-binding shape it claims to.
def _first_definition_line(tree: ast.Module) -> int | None:
    return next(
        (
            node.lineno
            for node in tree.body
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
        ),
        None,
    )


def _module_binding_names(node: ast.AST) -> list[str]:
    """Names a module-level node binds, for the placement guard.

    Declaration scope only: top-level ``Assign``/``AnnAssign``/``AugAssign``,
    a bare module-level walrus (an ``Expr`` wrapping a ``NamedExpr``), and
    imports. Function/class bodies are never entered, so their internal
    bindings are invisible to the guard.
    """
    if isinstance(node, ast.AnnAssign):
        return [node.target.id] if isinstance(node.target, ast.Name) else []
    if isinstance(node, ast.Assign):
        return [target.id for target in node.targets if isinstance(target, ast.Name)]
    if isinstance(node, ast.AugAssign):
        return [node.target.id] if isinstance(node.target, ast.Name) else []
    if isinstance(node, ast.Expr) and isinstance(node.value, ast.NamedExpr):
        return [node.value.target.id] if isinstance(node.value.target, ast.Name) else []
    if isinstance(node, ast.Import):
        return [alias.asname or alias.name for alias in node.names]
    if isinstance(node, ast.ImportFrom):
        return [alias.asname or alias.name for alias in node.names]
    return []


def _late_module_bindings(tree: ast.Module) -> list[tuple[str, int]]:
    """Module-level bindings that land after the first definition."""
    first_def = _first_definition_line(tree)
    if first_def is None:
        return []
    return [
        (name, node.lineno)
        for node in tree.body
        if node.lineno > first_def
        for name in _module_binding_names(node)
    ]


@pytest.mark.parametrize(
    "module_path",
    ["foliplus/_declaration.py", "test/python/test__declaration.py"],
)
def test_module_constants_precede_the_first_definition(module_path: str) -> None:
    module = Path(__file__).resolve().parents[2] / module_path
    tree = ast.parse(module.read_text(encoding="utf-8"))
    assert _first_definition_line(tree) is not None, (
        f"{module_path}: no function or class definition"
    )
    late = _late_module_bindings(tree)
    assert not late, (
        f"{module_path}: module bindings after the first definition: {late}"
    )


@pytest.mark.parametrize(
    "source, shape",
    [
        ("X = 1\ndef f():\n    pass\nX += 1\n", "AugAssign"),
        ("def f():\n    pass\n(y := 5)\n", "module-level walrus"),
        (
            "def f():\n    pass\nimport os\nfrom os import path\n",
            "import / import-from",
        ),
    ],
)
def test_guard_catches_late_module_bindings(source: str, shape: str) -> None:
    """Negative fixtures: each late-binding shape must actually be caught.

    A negative fixture that never fires would not exercise the branch it
    claims to cover — the guard would be green regardless of whether the
    branch exists. Each shape here must produce at least one late binding.
    """
    late = _late_module_bindings(ast.parse(source))
    assert late, f"guard missed a late {shape} binding"


def test_normalise_layer_filter_forms():
    assert normalise_layer_filter(
        {"field": "pop", "min": 0, "max": 100}, owner="Owner"
    ) == {
        "kind": "atom",
        "field": "pop",
        "op": "between",
        "range": [0, 100],
    }
    assert normalise_layer_filter(
        {"field": "cat", "values": ["A", "B", "A"]}, owner="Owner"
    ) == {
        "kind": "enum",
        "field": "cat",
        "values": ["A", "B"],
    }
    assert normalise_layer_filter(None, owner="Owner") is None


def test_normalise_layer_filter_invalid_warns():
    # Non-mapping and malformed shapes warn once and read as undeclared. The
    # dedup store is cleared per shape: two shapes can share a reason (e.g. a
    # missing and a non-string field both say 'field'), and the second would
    # otherwise be suppressed as a repeat.
    for raw in (
        ["x"],
        {"min": 0, "max": 1},
        {"field": "x", "values": ["A"], "min": 0},
        {"field": "pop", "min": 10, "max": 1},
        {"field": "x", "values": []},
        {"field": "x", "foo": 1},
        {"field": 1, "min": 0, "max": 1},
    ):
        _declaration.foliplus_reports.clear()
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            assert (
                normalise_layer_filter(raw, owner="Owner", subject="layer 'L'") is None
            )
            assert any("filter" in str(w.message) for w in caught), (
                raw,
                [str(w.message) for w in caught],
            )


def test_normalise_layer_filter_extra_shape_branches():
    # Branches the forms/invalid tests above do not reach: a 'values' payload
    # that is not a list, a non-string 'values' entry, a declaration with a
    # valid field but neither min/max nor values, and a non-finite bound.
    for raw in (
        {"field": "cat", "values": "A"},  # values as a bare string
        {"field": "cat", "values": ["A", 3]},  # non-string entry
        {"field": "cat"},  # valid field, no form chosen
        {"field": "pop", "min": 0, "max": float("inf")},  # non-finite bound
    ):
        _declaration.foliplus_reports.clear()
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            assert (
                normalise_layer_filter(raw, owner="Owner", subject="layer 'L'") is None
            )
            assert any("filter" in str(w.message) for w in caught), (
                raw,
                [str(w.message) for w in caught],
            )


# marker_color normalisation: shape here; the preset vocabulary is the JS
# reader's, so an out-of-vocabulary name deliberately survives this layer.
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
