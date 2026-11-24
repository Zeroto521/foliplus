"""Tests for schema derivation (``foliplus._config_schema.derive``)."""

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
)


class TestSchemaCoverage:
    """Every control's signature must reflect to a non-empty schema."""

    def test_every_control_has_schema(self) -> None:
        for name in CONTROL_CLASSES:
            schema = _derived(name)
            assert schema, f"{name} reflected to an empty schema"

    def test_no_orphan_schemas(self) -> None:
        # Every shipped control is a foliplus-module subclass; reflection
        # covers exactly those, so a name that is neither a subclass nor in
        # CONTROL_CLASSES would be a stale entry.
        shipped = {
            c.__name__
            for c in BaseControl.__subclasses__()
            if c.__module__.startswith("foliplus.") and not c.__name__.startswith("_")
        }
        orphans = set(CONTROL_CLASSES) - shipped
        assert not orphans, (
            f"CONTROL_CLASSES has entries that are not foliplus-module "
            f"BaseControl subclasses: {sorted(orphans)}"
        )

    def test_every_basecontrol_subclass_has_a_schema(self) -> None:
        # Discover every BaseControl subclass reachable from foliplus and
        # require it to reflect to a non-empty schema. This is what catches a
        # NEW control added without an exportable ``__init__`` parameter —
        # derivation is keyed off the signature, so a control with no
        # signature parameters silently gets an empty ``_config_fields``
        # (nothing to export) and no ``default_js`` rather than a loud error.
        #
        # The control classes live in submodules (``foliplus.FullscreenControl``),
        # so the module check must be a prefix match — the earlier
        # ``== "foliplus"`` excluded every control and made this test a no-op.
        import foliplus

        for attr in dir(foliplus):
            obj = getattr(foliplus, attr)
            if (
                isinstance(obj, type)
                and issubclass(obj, BaseControl)
                and obj is not BaseControl
                and obj.__module__.startswith("foliplus.")
            ):
                schema = derive_schema(obj)
                assert schema, (
                    f"foliplus.{obj.__name__} reflected to an empty schema — "
                    f"declare its CONFIG fields as ``__init__`` parameters."
                )


class TestSchemaMatchesConfigFields:
    """Derived ``_config_fields`` must equal the schema's non-runtime keys."""

    @pytest.mark.parametrize("name", sorted(CONTROL_CLASSES))
    def test_schema_keys_match_config_fields(self, name: str) -> None:
        cls = CONTROL_CLASSES[name]
        derived = tuple(cls._config_fields)
        expected = config_fields(_derived(name))
        assert derived == expected, (
            f"{name}._config_fields = {derived!r}\n"
            f"  schema derives    {expected!r}\n"
            f"The tuple is derived from the signature; a mismatch means a "
            f"hand-written _config_fields survived in {name}."
        )

    @pytest.mark.parametrize("name", sorted(CONTROL_CLASSES))
    def test_derivation_is_not_empty_for_controls_with_fields(self, name: str) -> None:
        # Non-vacuity guard: the derivation must not be ground down to an
        # empty tuple. A control whose signature declares at least one
        # exportable parameter must expose it.
        schema = _derived(name)
        exportable = [k for k, f in schema.items() if not f.dynamic]
        if not exportable:
            pytest.skip(f"{name} declares no exportable fields")
        assert CONTROL_CLASSES[name]._config_fields, (
            f"{name} has {len(exportable)} exportable schema fields but an empty "
            f"_config_fields — derivation silently dropped them."
        )

    @pytest.mark.parametrize("name", sorted(CONTROL_CLASSES))
    def test_schema_key_order_matches_config_fields_order(self, name: str) -> None:
        cls = CONTROL_CLASSES[name]
        derived = tuple(cls._config_fields)
        expected = config_fields(_derived(name))
        # Same as the previous test but kept separate so the failure message
        # pins the exact position where ordering diverges.
        for i, (a, b) in enumerate(zip(derived, expected)):
            assert a == b, f"{name}._config_fields[{i}] = {a!r}, schema[{i}] = {b!r}"


class TestConfigKeyCollision:
    """Two parameters may not export the same CONFIG key.

    ``config_key`` is how a Python kwarg (``zoom_range``) reaches CONF under
    the shared name (``zoom_range``). It also makes a silent overwrite possible
    if a second parameter maps onto the same key, so derivation must fail loud
    rather than let one field disappear from ``_config_fields``.
    """

    def test_duplicate_config_key_raises(self) -> None:
        class Collision(BaseControl):
            def __init__(
                self,
                *,
                zoom: Annotated[
                    dict[str, Any] | None,
                    FieldSpec(ts="object", config_key="zoom_range"),
                ] = None,
                zoom_range: Annotated[
                    dict[str, Any] | None,
                    FieldSpec(ts="object", config_key="zoom_range"),
                ] = None,
            ) -> None:
                super().__init__()

        with pytest.raises(ValueError, match="exports CONFIG key 'zoom_range'"):
            derive_schema(Collision)


class TestSchemaDefaultsMatchPython:
    """Every schema `default` must equal the value a default-constructed
    control instance exposes, including explicit null defaults.

    Without this, changing a Python default (e.g. `zoom=15` → `zoom=16`)
    leaves the schema's default stale and the vitest fixture wrong, while
    every name/order test stays green. Runtime-only and dynamic fields are
    skipped — Python has no such attribute. Fields without a declared schema
    default (``UNSET``) are skipped.
    """

    @pytest.mark.parametrize("name", sorted(CONTROL_CLASSES))
    def test_default_constructed_instance_matches_schema(self, name: str) -> None:
        cls = CONTROL_CLASSES[name]
        instance = cls()  # default constructor args only
        for field_name, spec in _derived(name).items():
            if spec.dynamic:
                continue
            if spec.default is UNSET:
                continue
            assert getattr(instance, field_name) == spec.default, (
                f"{name} default {field_name}={getattr(instance, field_name)!r} "
                f"does not match schema default {spec.default!r} — update the "
                f"``__init__`` signature in foliplus/{name}.py."
            )

    @pytest.mark.parametrize("name", sorted(CONTROL_CLASSES))
    def test_explicit_null_defaults_are_serialized(self, name: str) -> None:
        # Regression for the sentinel fix: a field whose real default is None
        # (e.g. SearchControl.provider_config) must carry `default: null` in
        # the dump, not be treated as "no default declared".
        data = json.loads(schema_to_json())
        for field_name, spec in _derived(name).items():
            if spec.default is None:
                entry = data["controls"][name][field_name]
                assert "default" in entry and entry["default"] is None, (
                    f"{name}.{field_name} default=None must be serialized as "
                    f"JSON null (got entry without a default key)."
                )


class TestDynamicFields:
    """Dynamic fields are declared in schema but not in _config_fields."""

    def test_dynamic_fields_are_not_in_config_fields(self) -> None:
        for name in CONTROL_CLASSES:
            dynamic_in_schema = [k for k, f in _derived(name).items() if f.dynamic]
            declared = set(CONTROL_CLASSES[name]._config_fields)
            overlap = set(dynamic_in_schema) & declared
            assert not overlap, (
                f"{name} has dynamic fields in schema that are also in "
                f"_config_fields: {sorted(overlap)} — dynamic means Python "
                f"emits them via _extra_config, not as static fields."
            )


class TestRuntimeZeroChange:
    """Rendering CONFIG must not consult the schema at runtime.

    The schema is declaration-only at runtime: ``BaseControl._build_config``
    reads ``self._config_fields`` directly and never touches the schema. The
    tuple is derived once, at class-definition time, from the ``__init__``
    signature, so the emitted CONFIG JSON is unchanged. These tests pin the
    derived values against the tuples each control used to declare by hand.
    """

    def test_control_config_fields_unchanged(self) -> None:
        # Snapshot-style: ``_config_fields`` is now derived from the
        # signature. These tuples must still equal what each control declared
        # by hand before the derivation landed.
        assert FullscreenControl._config_fields == ("hide_self", "hide_others")
        assert ScaleControl._config_fields == ("show_zoom",)
        assert LocateControl._config_fields == ("zoom",)
        assert LayerControl._config_fields == (
            "label_collide",
            "collapse_on_outside",
            "icon_prefix",
            "folders",
            "roles",
        )
        # The full tuple for MeasureControl is asserted in the parametrized
        # derivation test above; this is a targeted snapshot for spot-check.
        assert "filename" in MeasureControl._config_fields
        assert "export_format" in MeasureControl._config_fields

    def test_out_of_package_subclass_with_colliding_name_is_not_overwritten(
        self,
    ) -> None:
        # A third-party subclass named the same as a foliplus control must not
        # be silently overwritten by foliplus's signature. The class is defined
        # in this test module, so its ``__module__`` does not start with
        # ``"foliplus."`` — the module guard in ``__init_subclass__`` skips it.
        class SearchControl(BaseControl):
            _config_fields = ("my_own_field",)
            default_js = []

        assert SearchControl._config_fields == ("my_own_field",)
        assert SearchControl.default_js == []

    def test_schema_module_does_not_touch_basecontrol(self) -> None:
        # the `_config_schema` package imports nothing from foliplus.* at module
        # level;
        # importing it must not alter BaseControl's behavior. Verified in a
        # subprocess so this test cannot mutate the test-runner's module state
        # (importlib.reload would redefine BaseControl in place and split class
        # identity).
        repo_root = Path(__file__).resolve().parents[3]
        probe = (
            "import foliplus\n"
            "from foliplus import FullscreenControl\n"
            "assert FullscreenControl._config_fields == ('hide_self', 'hide_others'), \\\n"
            "    FullscreenControl._config_fields\n"
        )
        result = subprocess.run(
            [sys.executable, "-X", "utf8", "-c", probe],
            cwd=repo_root,
            capture_output=True,
            text=True,
            check=False,
        )
        assert result.returncode == 0, (
            f"fresh interpreter failed to import foliplus cleanly:\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}"
        )

    def test_module_entry_point_dumps_the_schema(self) -> None:
        # The dump is consumed through ``python -m foliplus._config_schema``;
        # the entry point must resolve argparse's gettext import and print the
        # same JSON the in-process call produces. Verified in a subprocess so
        # the test does not depend on the test-runner's ``sys.path``.
        repo_root = Path(__file__).resolve().parents[3]
        result = subprocess.run(
            [sys.executable, "-X", "utf8", "-m", "foliplus._config_schema", "--dump"],
            cwd=repo_root,
            capture_output=True,
            text=True,
            check=False,
        )
        assert result.returncode == 0, result.stderr
        assert json.loads(result.stdout)["version"] == 1
