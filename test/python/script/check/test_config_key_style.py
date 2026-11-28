"""Tests for ``script/check/config_key_style.py`` — the CONFIG key spelling gate.

The gate has two subjects and both must be pinned:

* the committed ``foliplus/js/config-schema.ts`` (a hand edit there silently
  reintroduces camelCase without touching Python), checked by the pre-commit
  hook;
* a schema dump from ``python -m foliplus._config_schema --dump``, which carries
  the field names *and* the nested shape payload keys
  (``LayerData[].fill_author.per_feature``), checked by the CI
  ``config-schema-verify` target.

The zero-exception ruling is a test too: :data:`EXCEPTIONS` must stay empty, so a
future "just this one key" cannot be smuggled in.

Coverage target: every helper plus the CLI branches. The pure helpers take
source text / payload dicts directly; the CLI cases use ``tmp_path`` files.
"""

from __future__ import annotations

import json
import runpy
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[3]
SCRIPT = REPO_ROOT / "script" / "check" / "config_key_style.py"


class _ModuleView:
    """Attribute access over runpy globals for concise test calls."""

    def __init__(self, namespace: dict):
        self._ns = namespace

    def __getattr__(self, name: str):
        try:
            return self._ns[name]
        except KeyError as exc:
            raise AttributeError(name) from exc


mod = _ModuleView(runpy.run_path(str(SCRIPT)))


def _run(argv: list[str], *, monkeypatch) -> int:
    """Invoke ``main()`` with ``argv`` as ``sys.argv[1:]``."""
    monkeypatch.setattr(sys, "argv", ["config_key_style.py", *argv])
    return mod.main()


def _dump(tmp_path: Path, payload: object) -> Path:
    path = tmp_path / "schema.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


class TestTsProperties:
    """The generated declaration file's property keys."""

    def test_committed_schema_is_clean(self):
        source = (REPO_ROOT / "foliplus" / "js" / "config-schema.ts").read_text(
            encoding="utf-8"
        )
        assert mod.ts_property_violations(source, "schema.ts") == []

    def test_camel_property_is_reported_with_its_line(self):
        source = "type X = {\n  zoomRange?: string;\n};\n"
        assert mod.ts_property_violations(source, "schema.ts") == [
            "schema.ts:2: contract key 'zoomRange' is not snake_case"
        ]

    def test_inline_object_member_is_checked(self):
        source = "type X = { nested: { fillAuthor: string } };\n"
        violations = mod.ts_property_violations(source, "schema.ts")
        assert violations == [
            "schema.ts:1: contract key 'fillAuthor' is not snake_case"
        ]

    def test_readonly_camel_member_is_reported(self):
        source = "interface X {\n  readonly zoomRange?: string;\n}\n"
        assert mod.ts_property_violations(source, "schema.ts") == [
            "schema.ts:2: contract key 'zoomRange' is not snake_case"
        ]

    def test_comma_separated_camel_member_is_reported(self):
        source = "type X = { min: number, zoomRange?: string };\n"
        assert mod.ts_property_violations(source, "schema.ts") == [
            "schema.ts:1: contract key 'zoomRange' is not snake_case"
        ]

    def test_readonly_snake_member_passes(self):
        source = "interface X {\n  readonly zoom_range?: string;\n}\n"
        assert mod.ts_property_violations(source, "schema.ts") == []

    def test_modifier_word_as_a_member_name_passes(self):
        source = "type X = { readonly: boolean };\n"
        assert mod.ts_property_violations(source, "schema.ts") == []

    def test_known_boundary_non_declaration_shapes_are_reported(self):
        """Pin the deliberate text-pattern boundary, do not hide it.

        The gate only reads the generated declaration file, where a comma is
        always a member separator. On arbitrary TS the same anchor fires on
        function parameters and object-literal values; that false positive is
        accepted instead of teaching the check a TS grammar.
        """
        assert mod.ts_property_violations(
            "function f(a: string, zoomRange?: string) {}\n", "schema.ts"
        ) == ["schema.ts:1: contract key 'zoomRange' is not snake_case"]
        assert mod.ts_property_violations(
            "const x = { min: 1, zoomRange: 2 };\n", "schema.ts"
        ) == ["schema.ts:1: contract key 'zoomRange' is not snake_case"]

    def test_snake_properties_pass(self):
        source = "type X = {\n  zoom_range?: { min: number; max: number };\n};\n"
        assert mod.ts_property_violations(source, "schema.ts") == []

    def test_comments_are_not_checked(self):
        source = "// a camelCaseKey in prose is fine\ntype X = { ok: string };\n"
        assert mod.ts_property_violations(source, "schema.ts") == []

    def test_block_comments_keep_line_numbers(self):
        source = "/*\n * camelCaseKey\n */\ntype X = {\n  badKey: string;\n};\n"
        assert mod.ts_property_violations(source, "schema.ts") == [
            "schema.ts:5: contract key 'badKey' is not snake_case"
        ]

    def test_index_signature_is_not_a_property_key(self):
        source = "interface X {\n  [key: string]: unknown;\n}\n"
        assert mod.ts_property_violations(source, "schema.ts") == []

    def test_ternary_and_return_type_are_not_property_keys(self):
        source = "const f = (a: string): number => (a ? 1 : 2);\n"
        assert mod.ts_property_violations(source, "schema.ts") == []


class TestDump:
    """The schema dump: field names plus nested shape payload keys."""

    def test_control_class_names_are_not_contract_keys(self):
        payload = {"version": 1, "shared": {}, "controls": {"LayerControl": {}}}
        assert mod.dump_violations(payload, "dump") == []

    def test_camel_field_key_is_reported(self):
        payload = {
            "version": 1,
            "shared": {},
            "controls": {"HeatmapControl": {"zoomRange": {"ts": "object"}}},
        }
        assert mod.dump_violations(payload, "dump") == [
            "dump:controls.HeatmapControl.zoomRange: contract key 'zoomRange' "
            "is not snake_case"
        ]

    def test_camel_shape_key_is_reported(self):
        payload = {
            "version": 1,
            "shared": {},
            "controls": {
                "LayerControl": {
                    "data": {
                        "ts": "array",
                        "shape": [{"fillAuthor": {"ts": "object"}}],
                    }
                }
            },
        }
        violations = mod.dump_violations(payload, "dump")
        assert violations == [
            "dump:controls.LayerControl.data.shape[0].fillAuthor: contract key "
            "'fillAuthor' is not snake_case"
        ]

    def test_metadata_keys_are_skipped(self):
        payload = {
            "version": 1,
            "shared": {"name": {"ts": "string", "optional": False, "note": "x"}},
            "controls": {},
        }
        assert mod.dump_violations(payload, "dump") == []

    def test_wildcard_record_key_is_allowed(self):
        payload = {
            "version": 1,
            "shared": {},
            "controls": {
                "SearchControl": {
                    "provider_config": {"shape": {"headers": ({"*": "string"}, "?")}}
                }
            },
        }
        assert mod.dump_violations(payload, "dump") == []

    def test_literal_union_values_are_not_keys(self):
        payload = {
            "version": 1,
            "shared": {},
            "controls": {"X": {"field": {"values": ["zoomRange", "other"]}}},
        }
        assert mod.dump_violations(payload, "dump") == []

    def test_non_dict_shared_and_controls_stop_the_walk(self):
        # `{version: 1}` with no field maps is a valid dump shape; a malformed
        # one must be reported as having nothing to check, not raise.
        assert mod.dump_violations({"version": 1}, "dump") == []
        assert mod.dump_violations({"shared": "x", "controls": "y"}, "dump") == []

    def test_non_dict_control_fields_stop_the_walk(self):
        assert mod.dump_violations({"controls": {"X": "y", "Y": {}}}, "dump") == []

    def test_regenerated_dump_is_clean(self):
        result = subprocess.run(
            [sys.executable, "-m", "foliplus._config_schema", "--dump"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=True,
        )
        payload = json.loads(result.stdout)
        assert mod.dump_violations(payload, "dump") == []


class TestExceptions:
    """The zero-exception ruling is enforced, not documented and hoped for."""

    def test_exceptions_are_empty_in_the_script(self):
        assert mod.EXCEPTIONS == {}

    def test_a_smuggled_exception_fails_the_gate(self, tmp_path, monkeypatch, capsys):
        monkeypatch.setitem(mod.EXCEPTIONS, "zoomRange", "pretend this is fine")
        assert mod.main([]) == 1
        captured = capsys.readouterr()
        assert "exception 'zoomRange' is not allowed" in captured.out


class TestCli:
    """The CLI contract: exit codes and the two subjects."""

    def test_committed_schema_passes(self, monkeypatch):
        assert _run([], monkeypatch=monkeypatch) == 0

    def test_camel_dump_fails_and_names_the_key(self, tmp_path, monkeypatch, capsys):
        payload = {"version": 1, "shared": {}, "controls": {"X": {"baseUrl": {}}}}
        path = _dump(tmp_path, payload)
        assert _run(["--dump", str(path)], monkeypatch=monkeypatch) == 1
        assert "baseUrl" in capsys.readouterr().out

    def test_clean_dump_passes(self, tmp_path, monkeypatch):
        path = _dump(tmp_path, {"version": 1, "shared": {}, "controls": {}})
        assert _run(["--dump", str(path)], monkeypatch=monkeypatch) == 0

    def test_help_is_usage_error_free(self, monkeypatch, capsys):
        assert _run(["--help"], monkeypatch=monkeypatch) == 0
        assert "snake_case" in capsys.readouterr().out

    def test_dump_without_a_path_is_a_usage_error(self, monkeypatch, capsys):
        assert _run(["--dump"], monkeypatch=monkeypatch) == 2
        assert "--dump needs a path" in capsys.readouterr().err

    def test_stray_positional_is_a_usage_error(self, monkeypatch, capsys):
        assert _run(["src.ts"], monkeypatch=monkeypatch) == 2
        assert "unexpected arguments" in capsys.readouterr().err

    def test_unreadable_dump_is_a_usage_error(self, tmp_path, monkeypatch, capsys):
        assert (
            _run(["--dump", str(tmp_path / "missing.json")], monkeypatch=monkeypatch)
            == 2
        )
        assert "cannot read" in capsys.readouterr().err

    def test_unreadable_committed_schema_is_an_error(
        self, tmp_path, monkeypatch, capsys
    ):
        # Default mode reads the committed declaration file; if it is missing the
        # gate must fail loudly (exit 2) instead of passing with no subject.
        # runpy hands back a copy of the globals, so patch the function's own.
        monkeypatch.setitem(mod.main.__globals__, "SCHEMA_TS", tmp_path / "missing.ts")
        assert _run([], monkeypatch=monkeypatch) == 2
        assert "cannot read" in capsys.readouterr().err

    def test_malformed_dump_is_a_usage_error(self, tmp_path, monkeypatch, capsys):
        path = tmp_path / "broken.json"
        path.write_text("{not json", encoding="utf-8")
        assert _run(["--dump", str(path)], monkeypatch=monkeypatch) == 2
        assert "cannot read" in capsys.readouterr().err
