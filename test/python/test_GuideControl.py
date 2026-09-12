"""Validation and serialisation tests for GuideControl."""

from __future__ import annotations

import pytest

from foliplus import GuideControl


def _guide(**kwargs) -> GuideControl:
    kwargs.setdefault("title", "How to read this map")
    return GuideControl(**kwargs)


class TestTitle:
    def test_accepts_a_normalised_title(self):
        assert _guide(title="  Guide  ").title == "Guide"

    def test_rejects_non_string(self):
        with pytest.raises(TypeError, match="title must be a string"):
            _guide(title=123)

    def test_rejects_blank(self):
        with pytest.raises(ValueError, match="non-empty"):
            _guide(title="   ")


class TestMetrics:
    def test_normalises_prefix_value_suffix(self):
        guide = _guide(
            metrics=[
                {"prefix": "orders: ", "value": "1,234", "suffix": " 笔"},
                {"value": "87.4%"},
            ]
        )
        assert guide.metrics == [
            {"prefix": "orders: ", "value": "1,234", "suffix": " 笔"},
            {"prefix": "", "value": "87.4%", "suffix": ""},
        ]

    def test_rejects_a_bare_string(self):
        with pytest.raises(TypeError, match="must be a sequence of mappings"):
            _guide(metrics="1,234 orders")

    def test_rejects_non_mapping_items(self):
        with pytest.raises(TypeError, match=r"metrics\[0\] must be a mapping"):
            _guide(metrics=[("prefix", "value")])

    def test_reports_unknown_fields(self):
        with pytest.raises(ValueError, match="unknown fields"):
            _guide(metrics=[{"value": "1", "colour": "red"}])

    def test_requires_value(self):
        with pytest.raises(TypeError, match=r"metrics\[0\]\.value"):
            _guide(metrics=[{"prefix": "only a prefix"}])


class TestSections:
    def test_normalises_title_and_text(self):
        guide = _guide(sections=[{"title": "How to read", "text": "Green is a store."}])
        assert guide.sections == [{"title": "How to read", "text": "Green is a store."}]

    def test_requires_text(self):
        with pytest.raises(TypeError, match=r"sections\[0\]\.text"):
            _guide(sections=[{"title": "How to read"}])

    def test_rejects_unknown_fields(self):
        with pytest.raises(ValueError, match="unknown fields"):
            _guide(sections=[{"title": "t", "text": "x", "html": "<b>"}])


class TestFlags:
    def test_rejects_non_bool_collapsed(self):
        with pytest.raises(TypeError, match="collapsed must be a bool"):
            _guide(collapsed="yes")

    def test_rejects_non_bool_draggable(self):
        with pytest.raises(TypeError, match="draggable must be a bool"):
            _guide(draggable=1)

    def test_rejects_unknown_placement(self):
        with pytest.raises(ValueError, match="placement must be one of"):
            _guide(placement="middle")


class TestConfigBlock:
    def test_escapes_characters_unsafe_in_an_inline_script(self):
        guide = _guide(
            title="a<b>&c",
            metrics=[{"value": "</script><script>alert(1)</script>"}],
        )
        block = guide._config_block
        assert "</script>" not in block
        assert "\\u003c" in block
        assert "\\u0026" in block

    def test_exports_every_configured_field(self):
        guide = _guide()
        block = guide._config_block
        for field in GuideControl._export_fields:
            assert field in block
