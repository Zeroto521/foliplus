"""Test the single serialization choke point behind both script tags."""

from __future__ import annotations

import json

from foliplus.BaseControl import _safe_json

from .helper import (
    LINE_TERMINATORS,
    LS,
    LS_ESCAPED,
    PS,
    PS_ESCAPED,
)


class TestSafeJson:
    """The single serialization choke point behind both script tags."""

    def test_escapes_all_four_html_sensitive_characters(self):
        """<, >, &, ' are rewritten; none may reach the script tag raw."""
        out = _safe_json({"n": "</script> & 'quoted'"})

        assert "<" not in out and ">" not in out
        assert "&" not in out and "'" not in out
        assert out == '{"n": "\\u003c/script\\u003e \\u0026 \\u0027quoted\\u0027"}'

    def test_escalines_line_terminators(self):
        """U+2028/U+2029 are emitted as \\uXXXX escapes, never literally."""
        out = _safe_json({"n": LINE_TERMINATORS})

        assert LS not in out and PS not in out
        assert LS_ESCAPED in out and PS_ESCAPED in out
        # Escaping must be a spelling change only — the value is intact.
        assert json.loads(out) == {"n": LINE_TERMINATORS}

    def test_keeps_ascii_off_for_cjk(self):
        """CJK stays literal — ensure_ascii=False is deliberate, not incidental."""
        out = _safe_json({"n": "中文图层"})

        assert "中文图层" in out
        assert "u4e2d" not in out

    def test_no_terminator_injection_on_clean_input(self):
        """The replace pass must not manufacture escapes for values that had none."""
        out = _safe_json({"n": "plain text 中文 & <tag>"})

        assert "u2028" not in out and "u2029" not in out
        assert json.loads(out) == {"n": "plain text 中文 & <tag>"}

    def test_round_trips_every_json_type(self):
        """Numbers, booleans, None, lists and nesting survive the escaping."""
        value = {
            "s": "</script>",
            "i": 42,
            "f": 0.5,
            "t": True,
            "f2": False,
            "n": None,
            "l": ["</script>", LS],
            "d": {"nested": {"deep": [1, 2, 3]}},
        }
        assert json.loads(_safe_json(value)) == value

    def test_returns_plain_str(self):
        """The template interpolates this into ``| safe`` — it must be a str."""
        assert type(_safe_json({"a": 1})) is str
