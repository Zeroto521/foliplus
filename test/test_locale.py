"""Tests for foliplus.locale — Localization support."""

from __future__ import annotations

import json
import os
import tempfile

import pytest

from foliplus.locale import (
    _LOCALE_DIR,
    LOCALE_TABLES,
    LocaleConfig,
    _load_builtin_tables,
    detect_language,
    resolve_locale,
)


class TestLocaleConfig:
    def test_default_locale_is_english(self):
        assert LocaleConfig("en").get("heatmap.title") == "Hexbin Aggregation"

    def test_chinese_locale(self):
        assert LocaleConfig("zh").get("heatmap.title") == "网格聚合"

    def test_missing_key_returns_key(self):
        assert LocaleConfig("en").get("nonexistent.key") == "nonexistent.key"

    def test_custom_locale_config(self):
        custom = LocaleConfig(language="ja")
        # Falls back to English table since "ja" is not in LOCALE_TABLES
        assert custom.code == "en"
        assert custom.language == "ja"
        assert custom.get("heatmap.title") == "Hexbin Aggregation"
        assert custom.get("nonexistent.key") == "nonexistent.key"

    def test_code_property(self):
        assert LocaleConfig("en").code == "en"
        assert LocaleConfig("zh").code == "zh"

    def test_all_english_keys_have_values(self):
        """Verify every locale key has a non-empty string."""
        table = LOCALE_TABLES["en"]
        for key, value in table.items():
            assert isinstance(value, str) and value, f"en key '{key}' is empty"

    def test_all_chinese_keys_have_values(self):
        """Verify every ZH key has a non-empty string."""
        table = LOCALE_TABLES["zh"]
        for key, value in table.items():
            assert isinstance(value, str) and value, f"ZH key '{key}' is empty"

    def test_zh_keys_match_en(self):
        """zh must have the exact same keys as en."""
        en_keys = set(LOCALE_TABLES["en"].keys())
        zh_keys = set(LOCALE_TABLES["zh"].keys())
        assert en_keys == zh_keys, (
            f"Missing: {en_keys - zh_keys}, Extra: {zh_keys - en_keys}"
        )


class TestDetectLanguage:
    def test_detect_chinese(self):
        assert detect_language("zh-CN,zh;q=0.9") == "zh"

    def test_detect_english(self):
        assert detect_language("en-US,en;q=0.5") == "en"

    def test_empty_accept(self):
        assert detect_language("") == "en"

    def test_unsupported_language(self):
        assert detect_language("fr-FR") == "en"

    def test_accept_priority_over_env(self):
        """accept_language takes precedence over env vars."""
        os.environ["LANG"] = "zh_CN.UTF-8"
        result = detect_language("en")
        assert result == "en"
        del os.environ["LANG"]

    def test_accept_multi_lang_falls_back(self):
        """Multiple accept languages — only first is checked."""
        # detect_language only uses the first language from the accept header
        assert detect_language("fr-FR,zh;q=0.9") == "en"
        assert detect_language("zh-CN") == "zh"

    def test_env_lang(self):
        """detect_language reads $LANG environment variable."""
        os.environ["LANG"] = "zh_CN.UTF-8"
        result = detect_language()
        assert result == "zh"
        del os.environ["LANG"]

    def test_env_lang_posix_falls_back(self):
        """POSIX / C locale falls back to English."""
        os.environ["LANG"] = "C.UTF-8"
        result = detect_language()
        assert result == "en"
        del os.environ["LANG"]

    def test_env_lang_posix_uppercase(self):
        """POSIX / C locale (uppercase) falls back to English."""
        os.environ["LANG"] = "POSIX"
        result = detect_language()
        assert result == "en"
        del os.environ["LANG"]

    def test_env_lc_all(self):
        """detect_language reads $LC_ALL."""
        os.environ["LC_ALL"] = "de_DE.UTF-8"
        result = detect_language()
        assert result == "en"  # German not supported → fallback
        del os.environ["LC_ALL"]

    def test_env_lc_messages(self):
        """detect_language reads $LC_MESSAGES."""
        os.environ["LC_MESSAGES"] = "zh_CN.UTF-8"
        result = detect_language()
        assert result == "zh"
        del os.environ["LC_MESSAGES"]

    def test_env_order_lang_over_lc_all(self):
        """LANG takes priority over LC_ALL in candidates list."""
        os.environ["LANG"] = "zh_CN.UTF-8"
        os.environ["LC_ALL"] = "en_US.UTF-8"
        result = detect_language()
        assert result == "zh"
        del os.environ["LANG"]
        del os.environ["LC_ALL"]

    def test_env_empty_all_fallback_en(self):
        """When all env vars are empty, fall back to English."""
        for var in ("LANG", "LC_ALL", "LC_MESSAGES"):
            os.environ.pop(var, None)
        result = detect_language()
        assert result == "en"

    def test_locale_getlocale_fallback(self):
        """If getlocale() raises, it's caught and ignored."""
        import locale as _stdlib_locale

        original = _stdlib_locale.getlocale

        def _raise(*args):
            raise RuntimeError("mock failure")

        _stdlib_locale.getlocale = _raise
        try:
            result = detect_language()
            assert isinstance(result, str)
        finally:
            _stdlib_locale.getlocale = original


class TestLoadBuiltinTables:
    def test_uses_filename_as_fallback_code(self):
        """If JSON has no locale.code, use the stem as language code."""
        tmp = _LOCALE_DIR / "zz.json"
        try:
            tmp.write_text('{"hello": "world"}', encoding="utf-8")
            tables = _load_builtin_tables()
            assert "zz" in tables
            assert "locale.code" not in tables["zz"]
        finally:
            if tmp.exists():
                tmp.unlink()


class TestFromFile:
    def test_json_file(self):
        """Load locale from a .json file."""
        data = {"locale.code": "fr", "hello": "Bonjour"}
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False, encoding="utf-8"
        ) as f:
            json.dump(data, f, ensure_ascii=False)
            tmp = f.name
        try:
            cfg = LocaleConfig.from_json(tmp)
            assert cfg.code == "fr"
            assert cfg.get("hello") == "Bonjour"
        finally:
            os.unlink(tmp)

    def test_unsupported_format(self):
        """Unsupported file extension raises ValueError."""
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".toml", delete=False, encoding="utf-8"
        ) as f:
            f.write('[tool]\nkey = "val"\n')
            tmp = f.name
        try:
            with pytest.raises(
                ValueError, match="only .json locale files are supported"
            ):
                LocaleConfig.from_json(tmp)
        finally:
            os.unlink(tmp)


class TestToFile:
    def test_to_file_roundtrip(self):
        """Export and re-import a LocaleConfig."""
        cfg = LocaleConfig("zh")
        tmp = os.path.join(tempfile.mkdtemp(), "test_zh.json")
        try:
            cfg.to_json(tmp)
            loaded = LocaleConfig.from_json(tmp)
            assert loaded.code == "zh"
            assert loaded.get("heatmap.title") == "网格聚合"
            assert loaded.get("fullscreen.enter") == "已进入全屏，按 Esc 退出"
        finally:
            os.unlink(tmp)
            os.rmdir(os.path.dirname(tmp))


class TestLocaleBrowserJS:
    """Browser-based tests for client-side locale detection."""

    def test_locales_all_tables_injected(self, browser, tmp_path):
        """All locale tables are injected into the JS runtime."""
        import folium

        from foliplus import MapSearch

        m = folium.Map()
        MapSearch().add_to(m)
        html = m.get_root().render()
        dest = tmp_path / "map.html"
        dest.write_text(html, encoding="utf-8")

        page = browser.new_page()
        page.goto(f"file://{dest}")
        page.wait_for_function("typeof _LOCALES !== 'undefined'", timeout=10000)

        keys = page.evaluate("Object.keys(_LOCALES).sort()")
        assert keys == ["en", "zh"]
        assert page.evaluate("_LOCALES['en']['locale.name']") == "English"
        assert page.evaluate("_LOCALES['zh']['locale.name']") == "中文"
        page.close()

    def test_auto_detect_zh(self, browser, tmp_path):
        """navigator.language=zh-CN selects zh table."""
        import folium

        from foliplus import MapSearch

        m = folium.Map()
        MapSearch().add_to(m)
        html = m.get_root().render()
        dest = tmp_path / "map.html"
        dest.write_text(html, encoding="utf-8")

        page = browser.new_page(locale="zh-CN")
        page.goto(f"file://{dest}")
        page.wait_for_function("typeof window._LOCALE !== 'undefined'", timeout=10000)
        assert page.evaluate("window._LOCALE['locale.code']") == "zh"
        assert page.evaluate("window._LOCALE['search.btn_title']") == "地图搜索"
        page.close()

    def test_auto_detect_en(self, browser, tmp_path):
        """navigator.language=en-US selects en table."""
        import folium

        from foliplus import MapSearch

        m = folium.Map()
        MapSearch().add_to(m)
        html = m.get_root().render()
        dest = tmp_path / "map.html"
        dest.write_text(html, encoding="utf-8")

        page = browser.new_page(locale="en-US")
        page.goto(f"file://{dest}")
        page.wait_for_function("typeof window._LOCALE !== 'undefined'", timeout=10000)
        assert page.evaluate("window._LOCALE['locale.code']") == "en"
        assert page.evaluate("window._LOCALE['search.btn_title']") == "Map Search"
        page.close()

    def test_fallback_unsupported(self, browser, tmp_path):
        """Unsupported navigator.language falls back to en."""
        import folium

        from foliplus import MapSearch

        m = folium.Map()
        MapSearch().add_to(m)
        html = m.get_root().render()
        dest = tmp_path / "map.html"
        dest.write_text(html, encoding="utf-8")

        page = browser.new_page(locale="fr-FR")
        page.goto(f"file://{dest}")
        page.wait_for_function("typeof window._LOCALE !== 'undefined'", timeout=10000)
        assert page.evaluate("window._LOCALE['locale.code']") == "en"
        page.close()


class TestResolveLocale:
    def test_resolve_none_auto_detects(self):
        """resolve_locale(None) calls detect_language()."""
        result = resolve_locale(None)
        assert isinstance(result, LocaleConfig)

    def test_resolve_str(self):
        """resolve_locale('zh') returns a zh LocaleConfig."""
        result = resolve_locale("zh")
        assert result.code == "zh"

    def test_resolve_localeconfig(self):
        """resolve_locale(LocaleConfig) returns it unchanged."""
        cfg = LocaleConfig("zh")
        result = resolve_locale(cfg)
        assert result is cfg  # same object
        assert result.code == "zh"

    def test_resolve_none_with_no_match(self):
        """resolve_locale(None) with no matching locale returns English."""
        os.environ.pop("LANG", None)
        os.environ.pop("LC_ALL", None)
        os.environ.pop("LC_MESSAGES", None)
        result = resolve_locale(None)
        assert result.code == "en"
