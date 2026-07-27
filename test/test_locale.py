"""Tests for foliplus.locale — Localization support."""

from __future__ import annotations

import json
import os
import tempfile

import folium
import pytest

from foliplus.locale import (
    _LOCALE_DIR,
    _LOCALES_TABLES,
    LocaleConfig,
    _load_builtin_tables,
    resolve_locale,
)

# Locale keys used across all JS files (resolved from CONST.name patterns).
# Keep this list in sync with foliplus/js/*.js to catch missing translations.
_JS_USED_KEYS = {
    # FullscreenControl
    "FullscreenControl.title",
    "FullscreenControl.title_cancel",
    "FullscreenControl.enter",
    "FullscreenControl.exit",
    # HeatmapControl
    "HeatmapControl.title",
    "HeatmapControl.close_title",
    "HeatmapControl.section_data",
    "HeatmapControl.layer",
    "HeatmapControl.layer_placeholder",
    "HeatmapControl.agg_method",
    "HeatmapControl.agg_count",
    "HeatmapControl.agg_sum",
    "HeatmapControl.agg_avg",
    "HeatmapControl.agg_min",
    "HeatmapControl.agg_max",
    "HeatmapControl.field",
    "HeatmapControl.field_auto",
    "HeatmapControl.section_style",
    "HeatmapControl.class_method",
    "HeatmapControl.jenks",
    "HeatmapControl.quantile",
    "HeatmapControl.equal",
    "HeatmapControl.heads",
    "HeatmapControl.scheme",
    "HeatmapControl.border",
    "HeatmapControl.label",
    "HeatmapControl.clear",
    "HeatmapControl.confirm",
    "HeatmapControl.value_fallback",
    "HeatmapControl.h3_cell_fail",
    "HeatmapControl.h3_boundary_fail",
    "HeatmapControl.no_layer",
    "HeatmapControl.no_h3",
    "HeatmapControl.no_ss",
    "HeatmapControl.no_chroma",
    # LayerControl
    "LayerControl.toggle_title",
    "LayerControl.panel_title",
    "LayerControl.close_title",
    "LayerControl.base_map_label",
    "LayerControl.color_map_label",
    "LayerControl.reorder_group_only",
    "LayerControl.load_order_fail",
    "LayerControl.save_order_fail",
    "LayerControl.type_base",
    "LayerControl.type_custom",
    "LayerControl.type_polygon",
    "LayerControl.type_line",
    "LayerControl.type_point",
    "LayerControl.type_empty",
    "LayerControl.type_unknown",
    "LayerControl.id_required",
    "LayerControl.invalid_id",
    "LayerControl.data_layer_label",
    "LayerControl.fold_tooltip",
    "LayerControl.unfold_tooltip",
    # SearchControl
    "SearchControl.btn_title",
    "SearchControl.mode_coord",
    "SearchControl.coord_placeholder",
    "SearchControl.clear_title",
    "SearchControl.mode_addr",
    "SearchControl.addr_placeholder",
    "SearchControl.coord_error",
    "SearchControl.popup_title_coord",
    "SearchControl.popup_title_addr",
    "SearchControl.popup_loading",
    "SearchControl.popup_loc_label",
    "SearchControl.popup_addr_label",
    "SearchControl.addr_not_found",
    "SearchControl.addr_error",
    "SearchControl.gcoord_warn",
    # MeasureControl
    "MeasureControl.unit_km",
    "MeasureControl.unit_m",
    "MeasureControl.tool_toggle",
    "MeasureControl.tool_marker",
    "MeasureControl.tool_distance",
    "MeasureControl.tool_circle",
    "MeasureControl.tool_clear",
    "MeasureControl.hint_marker",
    "MeasureControl.hint_dist_start",
    "MeasureControl.hint_circle_start",
    "MeasureControl.hint_circle_radius",
    "MeasureControl.popup_title",
    "MeasureControl.popup_loading",
    "MeasureControl.popup_loc_label",
    "MeasureControl.popup_addr_label",
    "MeasureControl.dist_origin",
    "MeasureControl.geo_fail",
    # ScaleControl
    "ScaleControl.zoom_label",
}


class TestLocaleConfig:
    def test_default_locale_is_english(self):
        assert LocaleConfig("en").get("HeatmapControl.title") == "Hexbin Aggregation"

    def test_chinese_locale(self):
        assert LocaleConfig("zh").get("HeatmapControl.title") == "网格聚合"

    def test_missing_key_returns_key(self):
        assert LocaleConfig("en").get("nonexistent.key") == "nonexistent.key"

    def test_custom_locale_config(self):
        custom = LocaleConfig(language="ja")
        # Falls back to English table since "ja" is not in _LOCALES_TABLES
        assert custom.code == "en"
        assert custom.language == "ja"
        assert custom.get("HeatmapControl.title") == "Hexbin Aggregation"
        assert custom.get("nonexistent.key") == "nonexistent.key"

    def test_code_property(self):
        assert LocaleConfig("en").code == "en"
        assert LocaleConfig("zh").code == "zh"

    def test_all_english_keys_have_values(self):
        """Verify every locale key has a non-empty string."""
        table = _LOCALES_TABLES["en"]
        for key, value in table.items():
            assert isinstance(value, str) and value, f"en key '{key}' is empty"

    def test_all_chinese_keys_have_values(self):
        """Verify every ZH key has a non-empty string."""
        table = _LOCALES_TABLES["zh"]
        for key, value in table.items():
            assert isinstance(value, str) and value, f"ZH key '{key}' is empty"

    def test_zh_keys_match_en(self):
        """zh must have the exact same keys as en."""
        en_keys = set(_LOCALES_TABLES["en"].keys())
        zh_keys = set(_LOCALES_TABLES["zh"].keys())
        assert en_keys == zh_keys, (
            f"Missing: {en_keys - zh_keys}, Extra: {zh_keys - en_keys}"
        )


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
            assert loaded.get("HeatmapControl.title") == "网格聚合"
            assert loaded.get("FullscreenControl.enter") == "已进入全屏，按 Esc 退出"
        finally:
            os.unlink(tmp)
            os.rmdir(os.path.dirname(tmp))


class TestLocaleBrowserJS:
    """Browser-based tests for client-side locale detection."""

    def test_locales_all_tables_injected(self, base_map):
        """All locale tables are injected into the rendered HTML."""
        from foliplus import SearchControl

        SearchControl().add_to(base_map)
        html = base_map.get_root().render()
        assert '"locale.code":"en"' in html or '"locale.code": "en"' in html
        assert '"locale.code":"zh"' in html or '"locale.code": "zh"' in html

    def test_auto_detect_zh(self, browser, tmp_path):
        """navigator.language=zh-CN selects zh table."""
        import folium

        from foliplus import MapSearch

        m = folium.Map()
        SearchControl().add_to(m)
        html = m.get_root().render()
        dest = tmp_path / "map.html"
        dest.write_text(html, encoding="utf-8")

        page = browser.new_page(locale="zh-CN")
        page.goto(f"file://{dest}", wait_until="domcontentloaded")
        page.wait_for_function("typeof window._LOCALE !== 'undefined'", timeout=10000)
        assert page.evaluate("window._LOCALE['locale.code']") == "zh"
        assert page.evaluate("window._LOCALE['SearchControl.btn_title']") == "地图搜索"
        page.close()

    def test_auto_detect_en(self, browser, tmp_path):
        """navigator.language=en-US selects en table."""
        import folium

        from foliplus import MapSearch

        m = folium.Map()
        SearchControl().add_to(m)
        html = m.get_root().render()
        dest = tmp_path / "map.html"
        dest.write_text(html, encoding="utf-8")

        page = browser.new_page(locale="en-US")
        page.goto(f"file://{dest}", wait_until="domcontentloaded", timeout=15000)
        page.wait_for_function("typeof window._LOCALE !== 'undefined'", timeout=10000)
        assert page.evaluate("window._LOCALE['locale.code']") == "en"
        assert (
            page.evaluate("window._LOCALE['SearchControl.btn_title']") == "Map Search"
        )
        page.close()

    def test_fallback_unsupported(self, browser, tmp_path):
        """Unsupported navigator.language falls back to en."""
        import folium

        from foliplus import MapSearch

        m = folium.Map()
        SearchControl().add_to(m)
        html = m.get_root().render()
        dest = tmp_path / "map.html"
        dest.write_text(html, encoding="utf-8")

        page = browser.new_page(locale="fr-FR")
        page.goto(f"file://{dest}", wait_until="domcontentloaded")
        page.wait_for_function("typeof window._LOCALE !== 'undefined'", timeout=10000)
        assert page.evaluate("window._LOCALE['locale.code']") == "en"
        page.close()


class TestResolveLocale:
    def test_resolve_en(self):
        """resolve_locale('en') returns an en LocaleConfig."""
        result = resolve_locale("en")
        assert result.code == "en"
        assert result.get("locale.name") == "English"

    def test_resolve_localeconfig(self):
        """resolve_locale(LocaleConfig) returns it unchanged."""
        cfg = LocaleConfig("zh")
        result = resolve_locale(cfg)
        assert result is cfg  # same object
        assert result.code == "zh"

    def test_resolve_unsupported_raises_valueerror(self):
        """Unsupported locale string raises ValueError."""
        with pytest.raises(ValueError, match="unsupported locale"):
            resolve_locale("fr")

    def test_resolve_invalid_type_raises_typeerror(self):
        """Non-str/LocaleConfig raises TypeError."""
        with pytest.raises(TypeError, match="locale must be a str or LocaleConfig"):
            resolve_locale(123)  # type: ignore[arg-type]

    def test_resolve_en(self):
        """resolve_locale('en') returns an en LocaleConfig."""
        result = resolve_locale("en")
        assert result.code == "en"
        assert result.get("locale.name") == "English"

    def test_resolve_zh(self):
        """resolve_locale('zh') returns a zh LocaleConfig."""
        result = resolve_locale("zh")
        assert result.code == "zh"
        assert result.get("locale.name") == "中文"


class TestAllKeysCoverJS:
    """Verify that all locale keys used in JS files exist in both locale files."""

    def test_js_keys_exist_in_en(self):
        """Every JS-used key must have a non-empty value in en.json."""
        table = _LOCALES_TABLES["en"]
        missing = {k for k in _JS_USED_KEYS if k not in table}
        empty = {k for k in _JS_USED_KEYS if k in table and not table[k]}
        assert not missing, f"Keys missing from en.json: {sorted(missing)}"
        assert not empty, f"Keys with empty values in en.json: {sorted(empty)}"

    def test_js_keys_exist_in_zh(self):
        """Every JS-used key must have a non-empty value in zh.json."""
        table = _LOCALES_TABLES["zh"]
        missing = {k for k in _JS_USED_KEYS if k not in table}
        empty = {k for k in _JS_USED_KEYS if k in table and not table[k]}
        assert not missing, f"Keys missing from zh.json: {sorted(missing)}"
        assert not empty, f"Keys with empty values in zh.json: {sorted(empty)}"

    def test_no_old_style_keys_in_locale(self):
        """No old-style locale keys (without CONST.name prefix) remain."""
        table = _LOCALES_TABLES["en"]
        old_style = {
            k
            for k in table
            if k.startswith("search.")
            or k.startswith("measure.")
            or k.startswith("layer.")
            or k.startswith("scale.")
            or k.startswith("heatmap.")
        }
        assert not old_style, f"Old-style keys still present: {sorted(old_style)}"

    def test_js_keys_have_correct_prefix(self):
        """Every JS-used key must start with its CONST.name prefix."""
        for key in _JS_USED_KEYS:
            # Global keys don't need prefix check
            if key.startswith(("num.", "load.", "gcoord.")):
                continue
            # Each control key must start with its component name
            assert (
                not key.startswith("search.")
                and not key.startswith("measure.")
                and not key.startswith("layer.")
                and not key.startswith("scale.")
                and not key.startswith("heatmap.")
            ), f"Old-style key: {key}"


class TestLocaleErrors:
    """Error/warning locale keys are injected into rendered HTML."""

    def test_heatmap_error_keys_in_html(self, base_map):
        """HeatmapControl error keys appear in rendered HTML."""
        from foliplus import HeatmapControl

        HeatmapControl().add_to(base_map)
        html = base_map.get_root().render()
        assert "HeatmapControl.value_fallback" in html
        assert "HeatmapControl.h3_cell_fail" in html
        assert "HeatmapControl.h3_boundary_fail" in html
        assert "HeatmapControl.close_title" in html

    def test_layer_error_keys_in_html(self, base_map):
        """LayerControl error keys appear in rendered HTML."""
        from foliplus import LayerControl

        LayerControl().add_to(base_map)
        html = base_map.get_root().render()
        assert "LayerControl.load_order_fail" in html
        assert "LayerControl.save_order_fail" in html

    def test_runtime_error_keys_present(self, base_map):
        """Runtime error keys (gcoord, load) appear in rendered HTML."""
        from foliplus import SearchControl

        SearchControl().add_to(base_map)
        html = base_map.get_root().render()
        assert "SearchControl.gcoord_warn" in html
