"""Tests for the face declaration sub-key normalisation
(foliplus._declaration.face).

A face declaration (`icon` / `marker`) carries sub-dimensions. The rendered
spelling is folium-version-dependent (newer folium camelizes the nested dict
keys, 0.15.x keeps whatever spelling the author wrote), so the face reader
accepts both the camelCase and the snake_case spelling of a multi-word key and
normalises every face to the one canonical camelCase shape. These tests pin
that one-way rule plus the warnings for an unknown, duplicated or invalid
sub-key.
"""

from __future__ import annotations

import warnings

import pytest

from foliplus._declaration import (
    normalise_face_keys,
    normalise_icon_face,
    normalise_marker_face,
)

_KEYS = {
    "glyph": ("glyph",),
    "colorOpacity": ("colorOpacity", "color_opacity"),
}


def _silent(*callables):
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        results = [call() for call in callables]
    assert caught == []
    return results[0] if len(results) == 1 else results


class TestNormaliseFaceKeys:
    """The one spelling rule every face declaration rides on."""

    def test_absent_is_none_without_a_warning(self) -> None:
        assert (
            _silent(
                lambda: normalise_face_keys(
                    None, keys=_KEYS, name="test", owner="Owner"
                )
            )
            is None
        )

    def test_a_non_mapping_is_none_without_a_warning(self) -> None:
        # The namespace shape gate (foliplus_namespace) owns that warning; this
        # reader stays silent so one defect is never reported twice.
        assert (
            _silent(
                lambda: normalise_face_keys("x", keys=_KEYS, name="test", owner="Owner")
            )
            is None
        )

    def test_a_canonical_camel_key_is_kept(self) -> None:
        assert normalise_face_keys(
            {"colorOpacity": 60}, keys=_KEYS, name="test", owner="Owner"
        ) == {"colorOpacity": 60}

    def test_the_snake_spelling_is_accepted_and_canonicalised(self) -> None:
        out = normalise_face_keys(
            {"color_opacity": 60}, keys=_KEYS, name="test", owner="Owner"
        )
        assert out == {"colorOpacity": 60}
        assert "color_opacity" not in out

    def test_an_empty_face_is_an_empty_mapping(self) -> None:
        assert normalise_face_keys({}, keys=_KEYS, name="test", owner="Owner") == {}

    def test_an_unknown_sub_key_warns_once_and_is_dropped(self) -> None:
        with pytest.warns(UserWarning, match="unknown test sub-key 'colour'"):
            out = normalise_face_keys(
                {"colour": "#fff", "colorOpacity": 60},
                keys=_KEYS,
                name="test",
                owner="Owner",
                subject="layer L",
                source="foliplus['test']",
            )
        assert out == {"colorOpacity": 60}

    def test_both_spellings_warn_and_the_first_one_wins(self) -> None:
        with pytest.warns(UserWarning, match="twice"):
            out = normalise_face_keys(
                {"colorOpacity": 60, "color_opacity": 40},
                keys=_KEYS,
                name="test",
                owner="Owner",
            )
        assert out == {"colorOpacity": 60}

    def test_the_message_names_the_face_and_the_offending_key(self) -> None:
        with pytest.warns(
            UserWarning,
            match=r"layer Rivers declares foliplus\['icon'\]\['glyphx'\]",
        ):
            normalise_face_keys(
                {"glyphx": "star"},
                keys=_KEYS,
                name="icon",
                owner="LayerControl",
                subject="layer Rivers",
                source="foliplus['icon']",
            )


class TestNormaliseIconFace:
    """The icon face: glyph, colour and glyph alpha."""

    def test_absent_is_none_without_a_warning(self) -> None:
        assert _silent(lambda: normalise_icon_face(None, owner="Owner")) is None

    def test_the_whole_face_is_canonicalised(self) -> None:
        out = normalise_icon_face(
            {"glyph": "star", "color": "#ABC", "color_opacity": 60},
            owner="Owner",
        )
        assert out == {"glyph": "star", "color": "#aabbcc", "colorOpacity": 60}

    def test_the_string_values_are_trimmed_like_the_js_reader(self) -> None:
        # Both stacks trim before validating: a padded glyph / hex is the same
        # declared value on either side, and the stored form is the trimmed,
        # expanded spelling. A reader that kept the raw padding would make the
        # glyph lookup miss a name the guide calls accepted.
        out = normalise_icon_face(
            {"glyph": "  star ", "color": " #F00 "},
            owner="Owner",
            subject="layer Trim",
        )
        assert out == {"glyph": "star", "color": "#ff0000"}

    def test_a_duplicate_spelling_is_not_a_fallback_for_a_bad_first_value(
        self,
    ) -> None:
        # The first occurrence owns the canonical key (marked seen before the
        # value is validated), so an unusable first value drops the key; the
        # second spelling is only a duplicate and never rescues it.
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            out = normalise_icon_face(
                {"colorOpacity": 101, "color_opacity": 40},
                owner="LayerControl",
                subject="layer DupFirst",
            )
        assert out == {}
        assert len(caught) == 2

    @pytest.mark.parametrize(
        "codepoint",
        [
            0x09, 0x0A, 0x0B, 0x0C, 0x0D,
            0x1C, 0x1D, 0x1E, 0x1F, 0x20, 0x85, 0xA0, 0x1680,
            0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007,
            0x2008, 0x2009, 0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000,
            0xFEFF,
        ],
    )
    def test_the_shared_whitespace_set_is_trimmed(self, codepoint: int) -> None:
        # The set is the UNION of the two hosts' whitespace: U+FEFF (a BOM pasted
        # from a CSV) and U+001C-1F / U+0085 disagree between str.strip() and
        # trim(), while U+2000-200A / U+2028 / U+3000 are what an author pastes
        # from rich text or CJK input. One set, one declared value on either stack.
        trim = chr(codepoint)
        out = normalise_icon_face(
            {"glyph": f"{trim}star{trim}", "color": f" #f00{trim}"},
            owner="LayerControl",
            subject=f"layer Trim{codepoint:04X}",
        )
        assert out == {"glyph": "star", "color": "#ff0000"}

    def test_the_whole_shared_whitespace_set_is_one_literal(self) -> None:
        from foliplus._declaration.paint import DECLARED_TRIM_CODEPOINTS

        for codepoint in DECLARED_TRIM_CODEPOINTS:
            trim = chr(codepoint)
            out = normalise_icon_face(
                {"glyph": f"{trim}star{trim}"},
                owner="LayerControl",
                subject=f"layer Set{codepoint:04X}",
            )
            assert out == {"glyph": "star"}

    def test_an_integral_float_alpha_is_accepted(self) -> None:
        # 40.0 and 40 are the same number to JSON and to the JS reader
        # (Number.isInteger(40.0)); the Python gate used to reject the float
        # spelling, so the declaration worked in the panel and failed collection.
        assert normalise_icon_face(
            {"colorOpacity": 40.0}, owner="LayerControl", subject="layer Float40"
        ) == {"colorOpacity": 40}

    def test_a_non_integral_alpha_is_still_rejected(self) -> None:
        with pytest.warns(UserWarning, match="expected a whole number from 0 to 100"):
            out = normalise_icon_face(
                {"colorOpacity": 40.5}, owner="LayerControl", subject="layer FloatHalf"
            )
        assert out == {}

    def test_a_null_color_warns_and_is_dropped(self) -> None:
        # Declared-but-unusable, never "absent": the JS reader warns, so a
        # silent Python drop would split the channel again.
        with pytest.warns(UserWarning, match=r"as None; expected a CSS hex"):
            out = normalise_icon_face(
                {"color": None, "glyph": "star"},
                owner="LayerControl",
                subject="layer NullC",
            )
        assert out == {"glyph": "star"}

    def test_a_null_alpha_warns_and_is_dropped(self) -> None:
        with pytest.warns(
            UserWarning, match=r"as None; expected a whole number from 0 to 100"
        ):
            out = normalise_icon_face(
                {"colorOpacity": None}, owner="LayerControl", subject="layer NullA"
            )
        assert out == {}

    def test_the_camel_alpha_spelling_is_accepted(self) -> None:
        out = normalise_icon_face({"colorOpacity": 40}, owner="Owner")
        assert out == {"colorOpacity": 40}

    def test_an_unknown_sub_key_warns_and_the_rest_survives(self) -> None:
        with pytest.warns(UserWarning, match="unknown icon sub-key 'shape'"):
            out = normalise_icon_face(
                {"glyph": "star", "shape": "pin"},
                owner="LayerControl",
                subject="layer Stations",
                source="foliplus['icon']",
            )
        assert out == {"glyph": "star"}

    def test_a_non_string_glyph_is_rejected_with_a_warning(self) -> None:
        with pytest.warns(UserWarning, match="expected a non-empty string"):
            out = normalise_icon_face(
                {"glyph": 7}, owner="LayerControl", subject="layer A"
            )
        assert out == {}

    def test_a_blank_glyph_is_rejected_with_a_warning(self) -> None:
        with pytest.warns(UserWarning, match="expected a non-empty string"):
            out = normalise_icon_face(
                {"glyph": "  "}, owner="LayerControl", subject="layer B"
            )
        assert out == {}

    def test_a_non_string_color_is_rejected_with_a_warning(self) -> None:
        # The trim step runs only for a string; a non-string colour must fall
        # through to the shape gate and warn, not crash the normaliser.
        with pytest.warns(UserWarning, match="expected a CSS hex"):
            out = normalise_icon_face(
                {"color": 7}, owner="LayerControl", subject="layer NumC"
            )
        assert out == {}

    def test_an_invalid_color_is_rejected_with_a_warning(self) -> None:
        with pytest.warns(UserWarning, match="expected a CSS hex"):
            out = normalise_icon_face(
                {"color": "red"}, owner="LayerControl", subject="layer C"
            )
        assert out == {}

    def test_an_out_of_range_alpha_is_rejected_with_a_warning(self) -> None:
        with pytest.warns(UserWarning, match="expected a whole number from 0 to 100"):
            out = normalise_icon_face(
                {"colorOpacity": 101}, owner="LayerControl", subject="layer D"
            )
        assert out == {}

    def test_a_malformed_sub_key_does_not_drop_its_siblings(self) -> None:
        with pytest.warns(UserWarning, match="expected a CSS hex"):
            out = normalise_icon_face(
                {"color": "nope", "glyph": "star", "colorOpacity": 20},
                owner="LayerControl",
                subject="layer E",
            )
        assert out == {"glyph": "star", "colorOpacity": 20}


class TestNormaliseMarkerFace:
    """The marker face carries only the chassis alpha."""

    def test_the_alpha_is_read_in_both_spellings(self) -> None:
        assert normalise_marker_face({"colorOpacity": 40}, owner="Owner") == {
            "colorOpacity": 40
        }
        assert normalise_marker_face({"color_opacity": 40}, owner="Owner") == {
            "colorOpacity": 40
        }

    def test_a_glyph_sub_key_is_unknown_on_the_marker_face(self) -> None:
        with pytest.warns(UserWarning, match="unknown marker sub-key 'glyph'"):
            out = normalise_marker_face({"glyph": "star"}, owner="Owner")
        assert out == {}

    def test_an_out_of_range_marker_alpha_is_rejected(self) -> None:
        with pytest.warns(UserWarning, match="expected a whole number from 0 to 100"):
            out = normalise_marker_face(
                {"colorOpacity": 101}, owner="LayerControl", subject="layer Mark101"
            )
        assert out == {}

    def test_a_null_marker_alpha_warns_and_is_dropped(self) -> None:
        with pytest.warns(
            UserWarning, match=r"as None; expected a whole number from 0 to 100"
        ):
            out = normalise_marker_face(
                {"colorOpacity": None}, owner="LayerControl", subject="layer NullM"
            )
        assert out == {}

    def test_the_chassis_colour_is_not_a_face_sub_key(self) -> None:
        # The chassis colour is the top-level marker_color declaration; a
        # face-level color is a misspelling and must warn instead of silently
        # reading as "not declared".
        with pytest.warns(UserWarning, match="unknown marker sub-key 'color'"):
            out = normalise_marker_face({"color": "#ff0000"}, owner="Owner")
        assert out == {}
