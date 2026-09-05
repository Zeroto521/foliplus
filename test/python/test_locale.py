"""Tests for foliplus.locale — Localization support."""

from __future__ import annotations

import json
import os
import tempfile

import pytest

from foliplus.locale import _LOCALE_DIR, LocaleConfig, _load_tables, resolve_locale


def _load_merged_tables() -> dict[str, dict[str, str]]:
    """Merge all locale tables (common + per-component) by language code.

    Iterates over files directly (not via _load_tables) since _load_tables
    only keeps the last entry when multiple files share the same code.
    """
    merged: dict[str, dict[str, str]] = {}
    for p in sorted(_LOCALE_DIR.glob("*.json")):
        table: dict[str, str] = json.loads(p.read_text(encoding="utf-8"))
        code = table.get("locale.code", p.stem)
        merged.setdefault(code, {}).update(table)
    return merged


_TABLES = _load_merged_tables()

# Locale keys used across all JS files (resolved from CONST.name patterns).
# Keep this list in sync with foliplus/js/*.js to catch missing translations.
_JS_USED_KEYS = {
    "foliplus.addr_not_found",
    "foliplus.geo_fail",
    "foliplus.close_label",
    # FullscreenControl
    "FullscreenControl.title",
    "SearchControl.blocked",
    "LocateControl.blocked",
    "FullscreenControl.title_cancel",
    "FullscreenControl.enter",
    "FullscreenControl.exit",
    "FullscreenControl.zoom_in",
    "FullscreenControl.zoom_out",
    # ExportControl
    "ExportControl.btn_title",
    "ExportControl.btn_confirm",
    "ExportControl.btn_export",
    "ExportControl.btn_cancel",
    "ExportControl.hint_unlocked",
    "ExportControl.hint_locked",
    "ExportControl.hint_restore",
    "ExportControl.status_exporting",
    "ExportControl.status_loading_tiles",
    "ExportControl.status_success",
    "ExportControl.status_fail",
    "ExportControl.err_crop_too_small",
    "ExportControl.err_too_large",
    "ExportControl.err_svg_load",
    "ExportControl.err_canvas_load",
    "ExportControl.err_image_load",
    "ExportControl.err_load_bounds",
    "ExportControl.err_save_bounds",
    "ExportControl.err_render",
    "ExportControl.err_gen_fail",
    "ExportControl.err_render_fail",
    "ExportControl.err_geotiff_geo",
    "ExportControl.err_geotiff_canvas",
    "ExportControl.label_size_prefix",
    "ExportControl.label_size_suffix",
    "ExportControl.no_layercontrol",
    "ExportControl.blocked",
    "ExportControl.blocked_measure",
    "ExportControl.blocked_layer",
    "ExportControl.blocked_search",
    "ExportControl.blocked_locate",
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
    "HeatmapControl.no_layer",
    "HeatmapControl.no_layercontrol",
    # LayerControl
    "LayerControl.toggle_title",
    "LayerControl.panel_title",
    "LayerControl.close_title",
    "LayerControl.base_map_label",
    "LayerControl.color_map_label",
    "LayerControl.reorder_group_only",
    "LayerControl.reorder_top",
    "LayerControl.reorder_bottom",
    "LayerControl.type_base",
    "LayerControl.type_custom",
    "LayerControl.type_polygon",
    "LayerControl.type_line",
    "LayerControl.type_point",
    "LayerControl.type_empty",
    "LayerControl.type_unknown",
    "LayerControl.type_color_map",
    "LayerControl.id_required",
    "LayerControl.invalid_id",
    "LayerControl.require_canvas_id",
    "LayerControl.mapPane_not_available",
    "LayerControl.data_layer_label",
    "LayerControl.fold_tooltip",
    "LayerControl.unfold_tooltip",
    "LayerControl.toggle_all_select_tooltip",
    "LayerControl.toggle_all_deselect_tooltip",
    "LayerControl.select_tooltip",
    "LayerControl.deselect_tooltip",
    "LayerControl.drag_tooltip",
    "LayerControl.more_tooltip",
    "LayerControl.focus_layer",
    "LayerControl.focus_layer_tooltip",
    "LayerControl.focus_layer_hidden",
    "LayerControl.focus_cancelled",
    "LayerControl.rename_layer",
    "LayerControl.rename_layer_tooltip",
    "LayerControl.rename_hint",
    "LayerControl.rename_empty",
    "LayerControl.readonly_error",
    "LayerControl.readonly_del_error",
    "LayerControl.readonly_method_error",
    "LayerControl.blocked",
    "MeasureControl.tool_edit",
    "MeasureControl.hint_edit",
    "MeasureControl.hint_edit_empty",
    "MeasureControl.blocked",
    "MeasureControl.blocked_export",
    "MeasureControl.blocked_layer",
    "MeasureControl.blocked_search",
    "MeasureControl.blocked_locate",
    # LocateControl
    "LocateControl.title",
    "LocateControl.locating",
    "LocateControl.geo_error",
    "LocateControl.popup_title_geo",
    "LocateControl.popup_loc_label",
    "LocateControl.popup_addr_label",
    "LocateControl.popup_loading",
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
    # MeasureControl
    "MeasureControl.tool_toggle",
    "MeasureControl.tool_marker",
    "MeasureControl.tool_distance",
    "MeasureControl.tool_polygon",
    "MeasureControl.tool_circle",
    "MeasureControl.tool_clear",
    "MeasureControl.hint_marker",
    "MeasureControl.hint_dist_start",
    "MeasureControl.hint_polygon",
    "MeasureControl.hint_circle_start",
    "MeasureControl.hint_circle_radius",
    "MeasureControl.popup_title",
    "MeasureControl.popup_loading",
    "MeasureControl.popup_loc_label",
    "MeasureControl.popup_addr_label",
    "MeasureControl.geo_fail",
    "MeasureControl.no_layercontrol",
    "MeasureControl.del_tooltip",
    "MeasureControl.del_node",
    "MeasureControl.del_all",
    "MeasureControl.tool_export",
    "MeasureControl.name_marker",
    "MeasureControl.name_distance",
    "MeasureControl.name_polygon",
    "MeasureControl.name_circle",
    "MeasureControl.export_no_data",
    "MeasureControl.export_success",
    "MeasureControl.export_file",
    "MeasureControl.export_fail",
    "MeasureControl.err_export",
    "MeasureControl.export_paused",
    # ScaleControl
    "ScaleControl.zoom_label",
}


class TestLocaleConfig:
    def test_default_locale_is_english(self):
        cfg = resolve_locale("en", "HeatmapControl")
        assert cfg.get("HeatmapControl.title") == "Hexbin Aggregation"

    def test_chinese_locale(self):
        cfg = resolve_locale("zh", "HeatmapControl")
        assert cfg.get("HeatmapControl.title") == "网格聚合"

    def test_missing_key_returns_key(self):
        cfg = resolve_locale("en", "HeatmapControl")
        assert cfg.get("nonexistent.key") == "nonexistent.key"

    def test_empty_localeconfig_defaults_to_en(self):
        # A bare LocaleConfig has no strings; code falls back to en.
        cfg = LocaleConfig()
        assert cfg.code == "en"
        assert cfg.get("HeatmapControl.title") == "HeatmapControl.title"

    def test_code_property(self):
        assert resolve_locale("en", "HeatmapControl").code == "en"
        assert resolve_locale("zh", "HeatmapControl").code == "zh"

    def test_all_english_keys_have_values(self):
        """Verify every locale key has a non-empty string."""
        table = _TABLES["en"]
        for key, value in table.items():
            assert isinstance(value, str) and value, f"en key '{key}' is empty"

    def test_all_chinese_keys_have_values(self):
        """Verify every ZH key has a non-empty string."""
        table = _TABLES["zh"]
        for key, value in table.items():
            assert isinstance(value, str) and value, f"ZH key '{key}' is empty"

    def test_zh_keys_match_en(self):
        """zh must have the exact same keys as en."""
        en_keys = set(_TABLES["en"].keys())
        zh_keys = set(_TABLES["zh"].keys())
        assert en_keys == zh_keys, (
            f"Missing: {en_keys - zh_keys}, Extra: {zh_keys - en_keys}"
        )

    def test_all_js_used_keys_in_tables(self):
        """Every key used in JS files must exist in all locale tables."""
        missing = _JS_USED_KEYS - set(_TABLES["en"].keys())
        assert not missing, (
            f"JS-used keys missing from locale tables: {missing}\n"
            "Add them to foliplus/locale/en.json and foliplus/locale/zh.json"
        )

    def test_no_unused_keys_in_tables(self):
        """Every locale key must be referenced in JS files (no dead keys)."""
        locale_keys = set(_TABLES["en"].keys())
        # Remove internal keys
        locale_keys -= {"locale.name", "locale.code"}
        unused = locale_keys - _JS_USED_KEYS
        assert not unused, (
            f"Unused locale keys (not in _JS_USED_KEYS): {unused}\n"
            "Either add them to _JS_USED_KEYS or remove from locale JSON files"
        )


class TestLoadBuiltinTables:
    def test_uses_filename_as_fallback_code(self):
        """If JSON has no locale.code, use the stem as language code."""
        tmp = _LOCALE_DIR / "zz.json"
        try:
            tmp.write_text('{"hello": "world"}', encoding="utf-8")
            tables = _load_tables("*.json")
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
        cfg = resolve_locale("zh", "HeatmapControl")
        tmp = os.path.join(tempfile.mkdtemp(), "test_zh.json")
        try:
            cfg.to_json(tmp)
            loaded = LocaleConfig.from_json(tmp)
            assert loaded.code == "zh"
            assert loaded.get("HeatmapControl.title") == "网格聚合"
            assert loaded.get("HeatmapControl.layer") == "图层"
        finally:
            os.unlink(tmp)
            os.rmdir(os.path.dirname(tmp))


class TestResolveLocale:
    def test_resolve_en(self):
        """resolve_locale('en') returns an en LocaleConfig."""
        result = resolve_locale("en", "HeatmapControl")
        assert result.code == "en"
        assert result.get("locale.name") == "English"

    def test_resolve_localeconfig(self):
        """resolve_locale(LocaleConfig) returns it unchanged."""
        cfg = LocaleConfig("zh")
        result = resolve_locale(cfg, "HeatmapControl")
        assert result is cfg  # same object

    def test_resolve_unsupported_raises_valueerror(self):
        """Unsupported locale string raises ValueError."""
        with pytest.raises(ValueError, match="unsupported locale"):
            resolve_locale("fr", "HeatmapControl")

    def test_resolve_invalid_type_raises_typeerror(self):
        """Non-str/LocaleConfig raises TypeError."""
        with pytest.raises(
            TypeError, match="locale must be a str, LocaleConfig, or None"
        ):
            resolve_locale(123, "HeatmapControl")  # type: ignore[arg-type]

    def test_resolve_zh(self):
        """resolve_locale('zh') returns a zh LocaleConfig."""
        result = resolve_locale("zh", "HeatmapControl")
        assert result.code == "zh"
        assert result.get("locale.name") == "中文"


class TestAllKeysCoverJS:
    """Verify that all locale keys used in JS files exist in both locale files."""

    def test_js_keys_exist_in_en(self):
        """Every JS-used key must have a non-empty value in en."""
        table = _TABLES["en"]
        missing = {k for k in _JS_USED_KEYS if k not in table}
        empty = {k for k in _JS_USED_KEYS if k in table and not table[k]}
        assert not missing, f"Keys missing from en: {sorted(missing)}"
        assert not empty, f"Keys with empty values in en: {sorted(empty)}"

    def test_js_keys_exist_in_zh(self):
        """Every JS-used key must have a non-empty value in zh."""
        table = _TABLES["zh"]
        missing = {k for k in _JS_USED_KEYS if k not in table}
        empty = {k for k in _JS_USED_KEYS if k in table and not table[k]}
        assert not missing, f"Keys missing from zh: {sorted(missing)}"
        assert not empty, f"Keys with empty values in zh: {sorted(empty)}"

    def test_no_old_style_keys_in_locale(self):
        """No old-style locale keys (without CONST.name prefix) remain."""
        table = _TABLES["en"]
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
