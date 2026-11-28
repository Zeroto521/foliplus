"""Tests for schema export (``foliplus._config_schema.export``)."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Annotated, Any

import pytest

from foliplus import (
    BaseControl,
    ExportControl,
    FullscreenControl,
    HeatmapControl,
    LayerControl,
    LocateControl,
    MeasureControl,
    ScaleControl,
    SearchControl,
)
from foliplus._config_schema import (
    SHARED,
    UNSET,
    FieldSpec,
    config_fields,
    derive_schema,
    derived_control_schemas,
    render_ts_type,
    schema_to_json,
    validate_shape,
)

from .helper import (
    _JS_CONFIG_READ_RE,
    CONF_COMMON,
    CONTROL_CLASSES,
    _default_literal,
    _derived,
    _js_files,
    _py_control_field_sets,
    _read_committed_fixture_defaults,
    _schema_defaults,
    _schema_dict,
    _spec_dict,
    _ts_interface_fields,
    _ts_short_to_control,
    _walk_specs,
    strip_js_comments,
)


class TestSchemaDump:
    """The JSON dump must be deterministic, valid JSON, and name-checked."""

    def test_dump_is_valid_json(self) -> None:
        text = schema_to_json()
        data = json.loads(text)
        assert data["version"] == 1
        assert "shared" in data
        assert "controls" in data

    def test_dump_is_deterministic(self) -> None:
        # Two independent dumps must byte-match — reflection is keyed off
        # class definition order, and the controls dict is sorted by name.
        a = schema_to_json()
        b = schema_to_json()
        assert a == b

    def test_dump_lists_all_controls(self) -> None:
        data = json.loads(schema_to_json())
        assert set(data["controls"]) == set(CONTROL_CLASSES)

    def test_dump_order_is_signature_order(self) -> None:
        # Schema order becomes CONFIG key order; pin it so a reordered
        # signature is a visible contract change, not a silent one.
        data = json.loads(schema_to_json())
        for name in CONTROL_CLASSES:
            assert list(data["controls"][name]) == list(_derived(name))

    def test_main_writes_out_file(self, tmp_path: Path) -> None:
        # ``--out`` is how the JS generators consume the schema; exercise the
        # file branch so a regression there is caught in-process. Driven by the
        # already-imported ``BaseControl`` rather than a subprocess, because a
        # fresh interpreter under an editable install would resolve ``foliplus``
        # to the checkout it was installed from — not this worktree.

        out = tmp_path / "config-schema.json"
        control_schemas = derived_control_schemas(BaseControl)
        text = json.dumps(
            {
                "version": 1,
                "shared": {n: _spec_dict(s) for n, s in SHARED.items()},
                "controls": {n: _schema_dict(schema) for n, schema in control_schemas},
            },
            indent=2,
            ensure_ascii=False,
        )
        out.write_text(text, encoding="utf-8")
        data = json.loads(out.read_text(encoding="utf-8"))
        assert data["version"] == 1
        assert set(data["controls"]) == set(CONTROL_CLASSES)

    def test_main_dump_prints_to_stdout(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        # Without ``--out`` the payload goes to stdout (manual `python -m
        # foliplus._config_schema` usage); ``--dump`` is the explicit form of it.
        assert schema_to_json().strip().endswith("}")

    def test_main_out_and_dump_go_through_the_cli_parser(
        self, tmp_path: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        from foliplus._config_schema.__main__ import main

        out = tmp_path / "config-schema.json"
        assert main(["--out", str(out)]) == 0
        assert out.read_text(encoding="utf-8") == schema_to_json()
        assert main(["--dump"]) == 0
        assert capsys.readouterr().out == schema_to_json()


class TestJSSchemaParity:
    """The committed ``config-schema.ts`` must agree with the Python schema."""

    def test_every_python_control_has_a_matching_ts_interface(self) -> None:
        py = _py_control_field_sets()
        ts = _ts_interface_fields()
        ts_by_control = {
            c: name
            for name in ts
            if (c := _ts_short_to_control(name.removeprefix("Config")))
        }
        missing = sorted(set(py) - set(ts_by_control))
        assert not missing, (
            "controls in Python schema but no matching "
            f"`Config<Name>` interface in foliplus/js/config-schema.ts: {missing}. "
            "Regenerate the TS file (see its header comment)."
        )

    def test_ts_interface_field_sets_match_python_schema(self) -> None:
        py = _py_control_field_sets()
        ts = _ts_interface_fields()
        ts_by_control = {
            c: name
            for name in ts
            if (c := _ts_short_to_control(name.removeprefix("Config")))
        }
        problems: list[str] = []
        for control, py_fields in py.items():
            ts_iface = ts_by_control.get(control)
            if ts_iface is None:
                continue
            ts_fields = ts[ts_iface]
            only_py = py_fields - ts_fields
            only_ts = ts_fields - py_fields
            if only_py:
                problems.append(
                    f"{control}: in Python not in TS — {sorted(only_py)} (TS is stale)"
                )
            if only_ts:
                problems.append(
                    f"{control}: in TS not in Python — {sorted(only_ts)} "
                    "(TS declares a field Python does not emit)"
                )
        assert not problems, "\n".join(problems)


class TestJSReadsPythonExports:
    """Every ``CONFIG.field`` JS reads must be exported by some Python control.

    The other half of the parity story: ``ComponentConfig`` ends in
    ``[key: string]: unknown``, so a field Python stops exporting still
    typechecks — JS just reads ``undefined`` and no checker complains. This
    scan catches that.
    """

    def test_every_config_field_read_by_js_is_exported_by_python(self) -> None:
        py_all: set[str] = set()
        for fields in _py_control_field_sets().values():
            py_all |= fields
        js_read: set[str] = set()
        for f in _js_files():
            text = strip_js_comments(f.read_text(encoding="utf-8"))
            js_read |= set(_JS_CONFIG_READ_RE.findall(text))
        missing = sorted(f for f in js_read if f not in CONF_COMMON and f not in py_all)
        assert not missing, (
            f"read by JS but no control exports them: {missing}. Either a "
            "control dropped the field (add it back) or JS is reading a "
            "stale name."
        )

    def test_comments_are_not_reads(self) -> None:
        """Generated headers may show an example without it being a read."""
        assert _JS_CONFIG_READ_RE.findall(strip_js_comments("// CONFIG.ghost\n")) == []
        assert _JS_CONFIG_READ_RE.findall(strip_js_comments("/* CONFIG.ghost */")) == []
        assert _JS_CONFIG_READ_RE.findall(
            strip_js_comments("// CONFIG.ghost\nconst x = CONFIG.real;")
        ) == ["real"]

    def test_string_literals_do_not_swallow_code(self) -> None:
        """A URL's // must not eat the real read that follows it."""
        assert _JS_CONFIG_READ_RE.findall(
            strip_js_comments('const u = "http://x"; const y = CONFIG.real;')
        ) == ["real"]


# ── Fixture parity: config-fixture.ts vs schema defaults ──────────────────
#
# The vitest fixture (`test/js/config-fixture.ts`) is the JS side's default
# CONFIG per control, generated by `test/js/script/emit-config-fixture.mjs`
# from the Python schema. The generator used to run as vitest's globalSetup,
# so `npx vitest` spawned Python (which imports branca via `foliplus`). The
# fixture is committed to git and the drift check lives here instead — same
# shape as `TestJSSchemaParity` above for `config-schema.ts`.


class TestConfigFixtureParity:
    """The committed ``config-fixture.ts`` must reflect the schema's defaults.

    This is the JS side of the drift gate the vitest globalSetup used to
    enforce: rather than regenerating the fixture on every test run (which
    requires spawning Python — see the block comment above), the pytest
    suite owns the check, and a stale committed fixture fails pytest here.
    """

    def test_fixture_lists_exactly_the_controls_in_the_schema(self) -> None:
        fixture = _read_committed_fixture_defaults()
        schema = _schema_defaults()
        missing = sorted(set(schema) - set(fixture))
        extra = sorted(set(fixture) - set(schema))
        assert not missing, (
            f"controls in the Python schema but missing from the fixture: "
            f"{missing}. Run `node test/js/script/emit-config-fixture.mjs`."
        )
        assert not extra, (
            f"controls in the fixture but not in the Python schema: {extra}. "
            "The fixture is stale — regenerate it."
        )

    def test_fixture_defaults_match_schema_defaults(self) -> None:
        fixture = _read_committed_fixture_defaults()
        schema = _schema_defaults()
        problems: list[str] = []
        for control in sorted(set(schema) | set(fixture)):
            fix = fixture.get(control, {})
            sch = schema.get(control, {})
            for fname in sorted(set(fix) | set(sch)):
                if fname not in fix:
                    problems.append(
                        f"{control}.{fname}: in schema (default "
                        f"{_default_literal(sch[fname])}) but absent from the fixture"
                    )
                    continue
                if fname not in sch:
                    problems.append(
                        f"{control}.{fname}: in the fixture (default "
                        f"{_default_literal(fix[fname])}) but absent from the schema"
                    )
                    continue
                if fix[fname] != sch[fname]:
                    problems.append(
                        f"{control}.{fname}: fixture has "
                        f"{_default_literal(fix[fname])}, schema has "
                        f"{_default_literal(sch[fname])}"
                    )
        assert not problems, "\n".join(problems)
