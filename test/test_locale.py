"""Tests for foliplus.locale — Localization support."""

from __future__ import annotations

from foliplus.locale import EN, ZH, LocaleConfig, detect_language


class TestLocaleConfig:
    def test_default_locale_is_english(self):
        assert EN.code == "en"
        assert EN.get("heatmap.title") == "Hexbin Aggregation"

    def test_chinese_locale(self):
        assert ZH.code == "zh"
        assert ZH.get("heatmap.title") == "网格聚合"

    def test_missing_key_returns_key(self):
        assert EN.get("nonexistent.key") == "nonexistent.key"

    def test_get_js_table(self):
        table = EN.get_js_table()
        assert isinstance(table, str)
        assert '"en"' in table

    def test_custom_locale_config(self):
        custom = LocaleConfig(language="ja")
        # Falls back to English table since "ja" is not in LOCALE_TABLES
        assert custom.code == "en"
        assert custom.language == "ja"
        assert custom.get("heatmap.title") == "Hexbin Aggregation"
        assert custom.get("nonexistent.key") == "nonexistent.key"


class TestDetectLanguage:
    def test_detect_chinese(self):
        assert detect_language("zh-CN,zh;q=0.9") == "zh"

    def test_detect_english(self):
        assert detect_language("en-US,en;q=0.5") == "en"

    def test_empty_accept(self):
        assert detect_language("") == "en"

    def test_unsupported_language(self):
        assert detect_language("fr-FR") == "en"
