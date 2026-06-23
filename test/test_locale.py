"""Tests for foliplus.locale — Localization support."""

from __future__ import annotations

from foliplus.locale import EN, ZH, LocaleConfig, detect_language

# LOCALE_TABLES is not in __init__; import directly from the module
from foliplus.locale import LOCALE_TABLES as _LOCALE_TABLES


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

    def test_code_property(self):
        assert EN.code == "en"
        assert ZH.code == "zh"

    def test_all_english_keys_have_values(self):
        """Verify every EN key has a non-empty string."""
        table = _LOCALE_TABLES["en"]
        for key, value in table.items():
            assert isinstance(value, str) and value, f"EN key '{key}' is empty"

    def test_all_chinese_keys_have_values(self):
        """Verify every ZH key has a non-empty string."""
        table = _LOCALE_TABLES["zh"]
        for key, value in table.items():
            assert isinstance(value, str) and value, f"ZH key '{key}' is empty"

    def test_zh_has_same_keys_as_en(self):
        """ZH must have all the same keys as EN."""
        en_keys = set(_LOCALE_TABLES["en"].keys())
        zh_keys = set(_LOCALE_TABLES["zh"].keys())
        missing = en_keys - zh_keys
        assert not missing, f"ZH is missing keys: {missing}"

    def test_zh_no_extra_keys(self):
        """ZH must not have extra keys beyond EN."""
        en_keys = set(_LOCALE_TABLES["en"].keys())
        zh_keys = set(_LOCALE_TABLES["zh"].keys())
        extra = zh_keys - en_keys
        assert not extra, f"ZH has extra keys: {extra}"


class TestDetectLanguage:
    def test_detect_chinese(self):
        assert detect_language("zh-CN,zh;q=0.9") == "zh"

    def test_detect_english(self):
        assert detect_language("en-US,en;q=0.5") == "en"

    def test_empty_accept(self):
        assert detect_language("") == "en"

    def test_unsupported_language(self):
        assert detect_language("fr-FR") == "en"
