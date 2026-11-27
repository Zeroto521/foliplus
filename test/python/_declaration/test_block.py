"""Tests for the in-block declaration sub-key normalisation
(foliplus._declaration.block).

A block-shaped declaration (`icon` / `marker`) carries sub-dimensions. folium
camelizes only the top-level option keys at render time, so an in-block key
keeps whatever spelling the author wrote; the block reader accepts both the
camelCase and the snake_case spelling of a multi-word key and normalises every
block to the one canonical camelCase shape. These tests pin that one-way rule
plus the warnings for an unknown, duplicated or invalid sub-key.
"""

from __future__ import annotations

import warnings

import pytest

from foliplus._declaration import (
    normalise_block,
    normalise_icon_block,
    normalise_marker_block,
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


class TestNormaliseBlock:
    """The one spelling rule every block-shaped declaration rides on."""

    def test_absent_is_none_without_a_warning(self) -> None:
        assert (
            _silent(
                lambda: normalise_block(None, keys=_KEYS, name="test", owner="Owner")
            )
            is None
        )

    def test_a_non_mapping_is_none_without_a_warning(self) -> None:
        # The namespace shape gate (foliplus_namespace) owns that warning; this
        # reader stays silent so one defect is never reported twice.
        assert (
            _silent(
                lambda: normalise_block("x", keys=_KEYS, name="test", owner="Owner")
            )
            is None
        )

    def test_a_canonical_camel_key_is_kept(self) -> None:
        assert normalise_block(
            {"colorOpacity": 60}, keys=_KEYS, name="test", owner="Owner"
        ) == {"colorOpacity": 60}

    def test_the_snake_spelling_is_accepted_and_canonicalised(self) -> None:
        out = normalise_block(
            {"color_opacity": 60}, keys=_KEYS, name="test", owner="Owner"
        )
        assert out == {"colorOpacity": 60}
        assert "color_opacity" not in out

    def test_an_empty_block_is_an_empty_mapping(self) -> None:
        assert normalise_block({}, keys=_KEYS, name="test", owner="Owner") == {}

    def test_an_unknown_sub_key_warns_once_and_is_dropped(self) -> None:
        with pytest.warns(UserWarning, match="unknown test sub-key 'colour'"):
            out = normalise_block(
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
            out = normalise_block(
                {"colorOpacity": 60, "color_opacity": 40},
                keys=_KEYS,
                name="test",
                owner="Owner",
            )
        assert out == {"colorOpacity": 60}

    def test_the_message_names_the_block_and_the_offending_key(self) -> None:
        with pytest.warns(
            UserWarning,
            match=r"layer Rivers declares foliplus\['icon'\]\['glyphx'\]",
        ):
            normalise_block(
                {"glyphx": "star"},
                keys=_KEYS,
                name="icon",
                owner="LayerControl",
                subject="layer Rivers",
                source="foliplus['icon']",
            )


class TestNormaliseIconBlock:
    """The icon face: glyph, colour and glyph alpha."""

    def test_absent_is_none_without_a_warning(self) -> None:
        assert _silent(lambda: normalise_icon_block(None, owner="Owner")) is None

    def test_the_whole_block_is_canonicalised(self) -> None:
        out = normalise_icon_block(
            {"glyph": "star", "color": "#ABC", "color_opacity": 60},
            owner="Owner",
        )
        assert out == {"glyph": "star", "color": "#aabbcc", "colorOpacity": 60}

    def test_the_camel_alpha_spelling_is_accepted(self) -> None:
        out = normalise_icon_block({"colorOpacity": 40}, owner="Owner")
        assert out == {"colorOpacity": 40}

    def test_an_unknown_sub_key_warns_and_the_rest_survives(self) -> None:
        with pytest.warns(UserWarning, match="unknown icon sub-key 'shape'"):
            out = normalise_icon_block(
                {"glyph": "star", "shape": "pin"},
                owner="LayerControl",
                subject="layer Stations",
                source="foliplus['icon']",
            )
        assert out == {"glyph": "star"}

    def test_a_non_string_glyph_is_rejected_with_a_warning(self) -> None:
        with pytest.warns(UserWarning, match="expected a non-empty string"):
            out = normalise_icon_block(
                {"glyph": 7}, owner="LayerControl", subject="layer A"
            )
        assert out == {}

    def test_a_blank_glyph_is_rejected_with_a_warning(self) -> None:
        with pytest.warns(UserWarning, match="expected a non-empty string"):
            out = normalise_icon_block(
                {"glyph": "  "}, owner="LayerControl", subject="layer B"
            )
        assert out == {}

    def test_an_invalid_color_is_rejected_with_a_warning(self) -> None:
        with pytest.warns(UserWarning, match="expected a CSS hex"):
            out = normalise_icon_block(
                {"color": "red"}, owner="LayerControl", subject="layer C"
            )
        assert out == {}

    def test_an_out_of_range_alpha_is_rejected_with_a_warning(self) -> None:
        with pytest.warns(UserWarning, match="expected a whole number from 0 to 100"):
            out = normalise_icon_block(
                {"colorOpacity": 101}, owner="LayerControl", subject="layer D"
            )
        assert out == {}

    def test_a_malformed_sub_key_does_not_drop_its_siblings(self) -> None:
        with pytest.warns(UserWarning, match="expected a CSS hex"):
            out = normalise_icon_block(
                {"color": "nope", "glyph": "star", "colorOpacity": 20},
                owner="LayerControl",
                subject="layer E",
            )
        assert out == {"glyph": "star", "colorOpacity": 20}


class TestNormaliseMarkerBlock:
    """The marker face carries only the chassis alpha."""

    def test_the_alpha_is_read_in_both_spellings(self) -> None:
        assert normalise_marker_block({"colorOpacity": 40}, owner="Owner") == {
            "colorOpacity": 40
        }
        assert normalise_marker_block({"color_opacity": 40}, owner="Owner") == {
            "colorOpacity": 40
        }

    def test_a_glyph_sub_key_is_unknown_on_the_marker_block(self) -> None:
        with pytest.warns(UserWarning, match="unknown marker sub-key 'glyph'"):
            out = normalise_marker_block({"glyph": "star"}, owner="Owner")
        assert out == {}

    def test_the_chassis_colour_is_not_a_block_sub_key(self) -> None:
        # The chassis colour is the top-level marker_color declaration; a
        # block-level color is a misspelling and must warn instead of silently
        # reading as "not declared".
        with pytest.warns(UserWarning, match="unknown marker sub-key 'color'"):
            out = normalise_marker_block({"color": "#ff0000"}, owner="Owner")
        assert out == {}
