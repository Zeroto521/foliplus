"""Tests for the CONF schema drift guard (``foliplus._schema``).

The schema table in ``foliplus/_schema.py`` is a mirror of every control's
``BaseControl._config_fields`` tuple. These tests fail if:

* A control declares a field in ``_config_fields`` that the schema does not
  know about (Python added it, schema forgotten).
* The schema declares a non-runtime-only field that the control does not
  export (schema declared it, control forgot to serialize it).
* A control with no ``_config_fields`` has a schema entry (should have no
  schema, or an all-runtime-only schema).

Values/behavior zero-change is upheld by the pre-existing ``test_BaseControl``
tests, which snapshot the emitted ``_config_block`` JSON byte-for-byte; the
schema is a declaration-only mirror and cannot affect serialization.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

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
from foliplus._schema import (
    _UNSET,
    RUNTIME_ONLY,
    SCHEMAS,
    SHARED,
    FieldSpec,
    config_fields,
    render_ts_type,
    schema_to_json,
)

# Controls the schema covers. Every entry in SCHEMAS must appear here and
# have a matching Python class.
CONTROL_CLASSES: dict[str, type[BaseControl]] = {
    "FullscreenControl": FullscreenControl,
    "ScaleControl": ScaleControl,
    "LocateControl": LocateControl,
    "LayerControl": LayerControl,
    "MeasureControl": MeasureControl,
    "SearchControl": SearchControl,
    "HeatmapControl": HeatmapControl,
    "ExportControl": ExportControl,
}


class TestSchemaCoverage:
    """Every control must have a schema entry, and vice versa."""

    def test_every_control_has_schema(self) -> None:
        for name in CONTROL_CLASSES:
            assert name in SCHEMAS, f"{name} has no entry in foliplus._schema.SCHEMAS"

    def test_no_orphan_schemas(self) -> None:
        orphans = set(SCHEMAS) - set(CONTROL_CLASSES)
        assert not orphans, (
            f"SCHEMAS has entries for unknown controls: {sorted(orphans)}"
        )

    def test_every_basecontrol_subclass_is_registered(self) -> None:
        # Discover every BaseControl subclass reachable from foliplus and
        # require it to be in SCHEMAS (or BaseControl itself). This is what
        # catches a NEW control added without a schema entry — the drift guard
        # runs over declared schemas only, so a fresh module with a new
        # _config_fields tuple would silently pass without this check.
        #
        # The control classes live in submodules (`foliplus.FullscreenControl`),
        # so the module check must be a prefix match — the earlier `== "foliplus"`
        # excluded every control and made this test a no-op.
        import foliplus

        for attr in dir(foliplus):
            obj = getattr(foliplus, attr)
            if (
                isinstance(obj, type)
                and issubclass(obj, BaseControl)
                and obj is not BaseControl
                and obj.__module__.startswith("foliplus.")
            ):
                assert obj.__name__ in SCHEMAS, (
                    f"foliplus.{obj.__name__} is a BaseControl subclass without "
                    f"a schema entry in foliplus._schema.SCHEMAS — add one "
                    f"before shipping."
                )


class TestSchemaMatchesConfigFields:
    """Schema keys must equal the control's ``_config_fields`` (non-runtime)."""

    @pytest.mark.parametrize("name", sorted(CONTROL_CLASSES))
    def test_schema_keys_match_config_fields(self, name: str) -> None:
        cls = CONTROL_CLASSES[name]
        declared = tuple(cls._config_fields)
        expected = config_fields(SCHEMAS[name])
        assert declared == expected, (
            f"{name}._config_fields = {declared!r}\n"
            f"  schema declares  {expected!r}\n"
            f"Add/remove a field in one place without the other; the drift guard "
            f"is the two sides of the same coin."
        )

    @pytest.mark.parametrize("name", sorted(CONTROL_CLASSES))
    def test_schema_key_order_matches_config_fields_order(self, name: str) -> None:
        cls = CONTROL_CLASSES[name]
        declared = tuple(cls._config_fields)
        expected = config_fields(SCHEMAS[name])
        # Same as the previous test but kept separate so the failure message
        # pins the exact position where ordering diverges.
        for i, (a, b) in enumerate(zip(declared, expected)):
            assert a == b, f"{name}._config_fields[{i}] = {a!r}, schema[{i}] = {b!r}"


class TestSchemaDefaultsMatchPython:
    """Every schema `default` must equal the value a default-constructed
    control instance exposes, including explicit null defaults.

    Without this, changing a Python default (e.g. `zoom=15` → `zoom=16`)
    leaves the schema's default stale and the vitest fixture wrong, while
    every name/order test stays green. Runtime-only and dynamic fields are
    skipped — Python has no such attribute. Fields without a declared schema
    default (``_UNSET``) are skipped.
    """

    @pytest.mark.parametrize("name", sorted(CONTROL_CLASSES))
    def test_default_constructed_instance_matches_schema(self, name: str) -> None:
        cls = CONTROL_CLASSES[name]
        instance = cls()  # default constructor args only
        for field_name, spec in SCHEMAS[name].items():
            if spec.runtime_only or spec.dynamic:
                continue
            if spec.default is _UNSET:
                continue
            assert getattr(instance, field_name) == spec.default, (
                f"{name} default {field_name}={getattr(instance, field_name)!r} "
                f"does not match schema default {spec.default!r} — update the "
                f"schema entry in foliplus/_schema.py."
            )

    @pytest.mark.parametrize("name", sorted(CONTROL_CLASSES))
    def test_explicit_null_defaults_are_serialized(self, name: str) -> None:
        # Regression for the sentinel fix: a field whose real default is None
        # (e.g. SearchControl.provider_config) must carry `default: null` in
        # the dump, not be treated as "no default declared".
        data = json.loads(schema_to_json())
        for field_name, spec in SCHEMAS[name].items():
            if spec.default is None:
                entry = data["controls"][name][field_name]
                assert "default" in entry and entry["default"] is None, (
                    f"{name}.{field_name} default=None must be serialized as "
                    f"JSON null (got entry without a default key)."
                )


class TestRuntimeOnlyFields:
    """Runtime-only and dynamic fields are declared in schema but not _config_fields."""

    def test_runtime_only_fields_are_not_in_config_fields(self) -> None:
        for name in CONTROL_CLASSES:
            runtime_only_in_schema = [
                k for k, f in SCHEMAS[name].items() if f.runtime_only
            ]
            declared = set(CONTROL_CLASSES[name]._config_fields)
            overlap = set(runtime_only_in_schema) & declared
            assert not overlap, (
                f"{name} has runtime_only fields in schema that are also in "
                f"_config_fields: {sorted(overlap)} — runtime_only means Python "
                f"must NOT emit them."
            )

    def test_dynamic_fields_are_not_in_config_fields(self) -> None:
        for name in CONTROL_CLASSES:
            dynamic_in_schema = [k for k, f in SCHEMAS[name].items() if f.dynamic]
            declared = set(CONTROL_CLASSES[name]._config_fields)
            overlap = set(dynamic_in_schema) & declared
            assert not overlap, (
                f"{name} has dynamic fields in schema that are also in "
                f"_config_fields: {sorted(overlap)} — dynamic means Python "
                f"emits them via _extra_config, not as static fields."
            )

    def test_runtime_only_global_fields_never_emit(self) -> None:
        for name in CONTROL_CLASSES:
            declared = set(CONTROL_CLASSES[name]._config_fields)
            for runtime_key in RUNTIME_ONLY:
                assert runtime_key not in declared, (
                    f"{name}._config_fields contains runtime_only key {runtime_key!r} "
                    f"— Python must not serialize runtime-only fields."
                )


class TestSchemaTypes:
    """FieldSpec must render to a valid TS type and the tag must be known."""

    def test_all_shared_and_control_specs_render(self) -> None:
        specs: list[tuple[str, FieldSpec]] = []
        for name, field in SHARED.items():
            specs.append((f"SHARED.{name}", field))
        for name, field in RUNTIME_ONLY.items():
            specs.append((f"RUNTIME_ONLY.{name}", field))
        for control, schema in SCHEMAS.items():
            for field_name, field in schema.items():
                specs.append((f"{control}.{field_name}", field))
        for where, spec in specs:
            try:
                ts = render_ts_type(spec)
            except ValueError as exc:
                pytest.fail(f"{where} rendered with error: {exc}")
            assert ts, f"{where} rendered to empty TS type"

    def test_runtime_only_is_always_optional(self) -> None:
        for where, spec in _walk_specs():
            if spec.runtime_only:
                assert spec.optional, f"{where} is runtime_only but not optional"


class TestSchemaDump:
    """The JSON dump must be deterministic and valid JSON."""

    def test_dump_is_valid_json(self) -> None:
        text = schema_to_json()
        data = json.loads(text)
        assert data["version"] == 1
        assert "shared" in data
        assert "runtime_only" in data
        assert "controls" in data

    def test_dump_is_deterministic(self) -> None:
        # Two independent dumps must byte-match — the schema module has no
        # dict ordering surprises because we sort at the registry level.
        a = schema_to_json()
        b = schema_to_json()
        assert a == b

    def test_dump_lists_all_controls(self) -> None:
        data = json.loads(schema_to_json())
        assert set(data["controls"]) == set(SCHEMAS)


class TestRuntimeZeroChange:
    """Rendering CONF must not consult the schema at runtime.

    The schema is a declaration-only mirror: ``BaseControl._build_config``
    reads ``self._config_fields`` directly and never touches ``SCHEMAS``.
    These tests assert the control's ``_config_fields`` tuple is unchanged
    and that importing the schema module does not perturb the base class.
    """

    def test_control_config_fields_unchanged(self) -> None:
        # Snapshot-style: ``_config_fields`` is a class attribute set at
        # import time by each control module. The schema is a mirror and
        # must not mutate it.
        assert FullscreenControl._config_fields == ("hide_self", "hide_others")
        assert ScaleControl._config_fields == ("show_zoom",)
        assert LocateControl._config_fields == ("zoom",)
        assert LayerControl._config_fields == (
            "label_collide",
            "collapse_on_outside",
        )
        # The full tuple for MeasureControl is asserted in the parametrized
        # drift test above; this is a targeted snapshot for spot-check.
        assert "filename" in MeasureControl._config_fields
        assert "export_format" in MeasureControl._config_fields

    def test_schema_module_does_not_touch_basecontrol(self) -> None:
        # _schema.py imports nothing from foliplus.*; importing it must not
        # alter BaseControl's behaviour. Verified in a subprocess so this test
        # cannot mutate the test-runner's module state (importlib.reload would
        # redefine BaseControl in place and split class identity).
        repo_root = Path(__file__).resolve().parents[2]
        probe = (
            "import foliplus\n"
            "from foliplus.FullscreenControl import FullscreenControl\n"
            "assert FullscreenControl._config_fields == ('hide_self', 'hide_others'), \\\n"
            "    FullscreenControl._config_fields\n"
        )
        result = subprocess.run(
            [sys.executable, "-c", probe],
            cwd=repo_root,
            capture_output=True,
            text=True,
            check=False,
        )
        assert result.returncode == 0, (
            f"fresh interpreter failed to import foliplus cleanly:\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}"
        )


def _walk_specs() -> list[tuple[str, FieldSpec]]:
    """Iterate every FieldSpec in the schema table (for parametrize helpers)."""
    out: list[tuple[str, FieldSpec]] = []
    for name, field in SHARED.items():
        out.append((f"SHARED.{name}", field))
    for name, field in RUNTIME_ONLY.items():
        out.append((f"RUNTIME_ONLY.{name}", field))
    for control, schema in SCHEMAS.items():
        for field_name, field in schema.items():
            out.append((f"{control}.{field_name}", field))
    return out
