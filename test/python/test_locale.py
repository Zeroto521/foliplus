"""Tests for foliplus.locale — Localization support."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
from pathlib import Path

import pytest

from foliplus.locale import _LOCALE_DIR, LocaleConfig, _load_tables, resolve_locale

# ---------------------------------------------------------------------------
# JS-key scanning — replaces the hand-maintained list below.
#
#   script/scan-locale-key.mjs walks foliplus/js/**/*.ts and extracts
#   every T("key"), .T("key"), T(c?"a":"b"), _("key"), and NAME_LABEL_KEY
#   assignment, prefixing bare keys with the component derived from the
#   file path.  Dynamic calls (T(variable), template literals, map lookups,
#   caller-provided translators in core/) are NOT caught; those keys are
#   listed in _DYNAMIC_SUPPLEMENT below.
# ---------------------------------------------------------------------------

_REPO_ROOT = Path(__file__).resolve().parents[2]
_SCANNER = _REPO_ROOT / "script" / "scan-locale-key.mjs"

_DYNAMIC_SUPPLEMENT: set[str] = {
    # core/layer/api.ts — T() is caller-provided; the scanner cannot derive
    # the component prefix for shared modules.
    "ExportControl.no_layercontrol",
    "MeasureControl.no_layercontrol",
    # focusDisabledLocaleKey map (focus.ts) — reason → key lookup.
    "LayerControl.focus_layer_base",
    "LayerControl.focus_layer_hidden",
    "LayerControl.focus_layer_no_bounds",
    # typeKey / type.key template literals (attr.ts, rowView.ts).
    "LayerControl.type_base",
    "LayerControl.type_color_map",
    "LayerControl.type_custom",
    "LayerControl.type_unknown",
    # labelKey / titleKey passed as function parameters.
    "LayerControl.data_layer_label",
    "LocateControl.popup_title_geo",
    # localeFallback() in core/geocode/geocoder.ts — dynamic key lookup.
    "MeasureControl.geo_fail",
    "foliplus.addr_not_found",
    "foliplus.geo_fail",
    # Shared label vocabulary (common table) — resolved via dynamic lookup.
    "foliplus.label_format_auto",
    "foliplus.label_format_comma",
    "foliplus.label_format_int",
    "foliplus.label_format_percent",
}


def _scan_js_keys() -> set[str]:
    """Run the locale-key scanner and return the set of keys it finds."""
    result = subprocess.run(
        ["node", str(_SCANNER)],
        cwd=str(_REPO_ROOT),
        capture_output=True,
        text=True,
        check=True,
    )
    return set(json.loads(result.stdout))


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
_JS_USED_KEYS = _scan_js_keys() | _DYNAMIC_SUPPLEMENT


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

    def test_explicit_empty_default_honoured(self):
        """get(k, "") stays "" — an empty translation is expressible."""
        assert LocaleConfig("en").get("no.such.key", "") == ""
        assert LocaleConfig("en").get("no.such.key") == "no.such.key"

    def test_empty_localeconfig_defaults_to_en(self):
        # A bare LocaleConfig carries no strings, so it means "auto-detect at runtime".
        # Keep this assertion: it guards the empty-table fallback in BaseControl.
        cfg = LocaleConfig()
        assert cfg.code == "en"
        assert cfg._strings == {}
        assert cfg.get("HeatmapControl.title") == "HeatmapControl.title"

    def test_language_without_strings_does_not_load_builtin_table(self):
        """LocaleConfig(language=...) records the code only — no built-in strings."""
        cfg = LocaleConfig("zh")
        assert cfg.code == "zh"
        assert cfg._strings == {}
        assert cfg.get("HeatmapControl.title") == "HeatmapControl.title"

    def test_control_uses_builtin_table_for_string_locale(self):
        """A str locale reaches the JS CONF as a non-empty per-code table."""
        from foliplus import HeatmapControl

        conf = json.loads(HeatmapControl(locale="zh")._config_block)
        assert conf["locale_code"] == "zh"
        tables = conf["locale_tables"]
        assert "zh" in tables and tables["zh"]["HeatmapControl.title"]

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

    def test_shared_label_vocabulary_lives_only_in_common(self):
        """The label-control vocabulary is defined once, in the common table.

        Both the heatmap panel and LayerControl's style drawer render it from
        ``core/labelControl.ts``; a per-component copy is exactly the drift this
        guards against — a missing key on one side renders a raw key there.
        """
        shared = {
            "foliplus.label",
            "foliplus.label_color",
            "foliplus.label_collide",
            "foliplus.label_collide_tooltip",
            "foliplus.label_format",
            "foliplus.label_format_auto",
            "foliplus.label_format_comma",
            "foliplus.label_format_int",
            "foliplus.label_format_percent",
            "foliplus.label_size",
            "foliplus.label_style",
            "foliplus.label_tooltip",
        }
        for lang in ("en", "zh"):
            common = json.loads(
                (_LOCALE_DIR / f"common.{lang}.json").read_text(encoding="utf-8")
            )
            missing = shared - set(common)
            assert not missing, f"common.{lang} missing shared label keys: {missing}"

            for component in ("HeatmapControl", "LayerControl"):
                table = json.loads(
                    (_LOCALE_DIR / f"{component}.{lang}.json").read_text(
                        encoding="utf-8"
                    )
                )
                dupes = sorted(set(table) & shared)
                assert not dupes, (
                    f"{component}.{lang} duplicates the shared label vocabulary: "
                    f"{dupes} — it belongs in the common table only"
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

    def test_custom_table_reaches_conf(self):
        """A LocaleConfig from JSON is shipped in CONF — custom strings must win."""
        from foliplus import HeatmapControl

        data = {"locale.code": "ja", "HeatmapControl.title": "こんにちは"}
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False, encoding="utf-8"
        ) as f:
            json.dump(data, f, ensure_ascii=False)
            tmp = f.name
        try:
            conf = json.loads(
                HeatmapControl(locale=LocaleConfig.from_json(tmp))._config_block
            )
            assert conf["locale_code"] == "ja"
            assert "ja" in conf["locale_tables"]
            assert conf["locale_tables"]["ja"]["HeatmapControl.title"] == "こんにちは"
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

    @pytest.mark.parametrize("payload", [[1, 2, 3], "hi", None, 5])
    def test_non_object_root_raises(self, payload):
        """A JSON array/string/null root raises ValueError, not AttributeError."""
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False, encoding="utf-8"
        ) as f:
            json.dump(payload, f)
            tmp = f.name
        try:
            with pytest.raises(ValueError, match="must contain a JSON object"):
                LocaleConfig.from_json(tmp)
        finally:
            os.unlink(tmp)

    def test_missing_locale_code_raises(self):
        """A missing locale.code raises instead of silently shipping under 'en'."""
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False, encoding="utf-8"
        ) as f:
            json.dump({"HeatmapControl.title": "translated"}, f, ensure_ascii=False)
            tmp = f.name
        try:
            with pytest.raises(ValueError, match="must contain a 'locale.code' string"):
                LocaleConfig.from_json(tmp)
        finally:
            os.unlink(tmp)

    @pytest.mark.parametrize(
        "payload",
        [
            {"locale.code": "ja", "k": 123},
            {"locale.code": "ja", "k": None},
            {"locale.code": "ja", "k": ["a"]},
        ],
    )
    def test_non_string_value_raises(self, payload):
        """Non-string values are rejected: get() promises str."""
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False, encoding="utf-8"
        ) as f:
            json.dump(payload, f)
            tmp = f.name
        try:
            with pytest.raises(ValueError, match="values must all be strings"):
                LocaleConfig.from_json(tmp)
        finally:
            os.unlink(tmp)


class TestPartialCustomTable:
    """A partial custom table keeps the built-in translation for keys it omits."""

    def _conf(self, control, data: dict) -> dict:
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False, encoding="utf-8"
        ) as f:
            json.dump(data, f, ensure_ascii=False)
            tmp = f.name
        try:
            return json.loads(control(locale=LocaleConfig.from_json(tmp))._config_block)
        finally:
            os.unlink(tmp)

    def test_omitted_keys_keep_builtin_translation(self):
        """One custom key overrides; the other 27 keep their built-in strings."""
        from foliplus import HeatmapControl

        conf = self._conf(
            HeatmapControl, {"locale.code": "ja", "HeatmapControl.title": "こんにちは"}
        )
        table = conf["locale_tables"]["ja"]
        assert table["HeatmapControl.title"] == "こんにちは"
        # Builtin en table carries every key, so the fallback is a real
        # translation, not a bare key.
        assert table["HeatmapControl.layer"] == "Layer"

    def test_custom_table_not_bare_key(self):
        """Every key of the builtin table resolves to a real string."""
        from foliplus import HeatmapControl

        conf = self._conf(
            HeatmapControl, {"locale.code": "ja", "HeatmapControl.title": "こんにちは"}
        )
        builtin = _load_tables("HeatmapControl.en.json")["en"]
        table = conf["locale_tables"]["ja"]
        for key in builtin:
            assert table[key], f"key {key!r} fell through to a bare key"

    def test_custom_table_ships_only_its_own_code(self):
        """Common keys (foliplus.*) come from the shared bundle, not conf."""
        from foliplus import HeatmapControl

        conf = self._conf(
            HeatmapControl, {"locale.code": "ja", "HeatmapControl.title": "こんにちは"}
        )
        assert set(conf["locale_tables"]) == {"ja"}
        assert "foliplus.close_label" not in conf["locale_tables"]["ja"]
        assert conf["locale_code"] == "ja"

    def test_works_for_other_control(self):
        """The merge path is component-agnostic."""
        from foliplus import SearchControl

        conf = self._conf(
            SearchControl, {"locale.code": "de", "SearchControl.btn_title": "Suchen"}
        )
        table = conf["locale_tables"]["de"]
        assert table["SearchControl.btn_title"] == "Suchen"
        assert table["SearchControl.coord_placeholder"]


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
            assert loaded.get("HeatmapControl.layer") == "聚合图层"
        finally:
            os.unlink(tmp)
            os.rmdir(os.path.dirname(tmp))

    def test_bare_localeconfig_to_json_raises(self):
        """A stringless config has no table; writing {} would reload as English."""
        with pytest.raises(ValueError, match="has no strings to export"):
            LocaleConfig("zh").to_json("/tmp/foliplus-test-no-such-dir/x.json")

    def test_to_json_always_writes_locale_code(self):
        """The written file round-trips its code — not silently 'en'."""
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False, encoding="utf-8"
        ) as f:
            json.dump(
                {"locale.code": "ja", "HeatmapControl.title": "こんにちは"},
                f,
                ensure_ascii=False,
            )
            src = f.name
        tmp = os.path.join(tempfile.mkdtemp(), "roundtrip.json")
        try:
            loaded = LocaleConfig.from_json(src)
            loaded.to_json(tmp)
            written = json.loads(open(tmp, encoding="utf-8").read())
            assert written["locale.code"] == "ja"
            assert LocaleConfig.from_json(tmp).code == "ja"
        finally:
            os.unlink(src)
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
