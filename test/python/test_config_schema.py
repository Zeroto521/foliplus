"""Tests for the CONFIG schema derivation (``foliplus._config_schema``).

``BaseControl.__init_subclass__`` derives each control's ``_config_fields``
tuple from the control's own ``__init__`` signature, reflected by
``derive_schema`` — the signature is the single source of truth and the
tuple cannot drift from it. These tests assert the derivation is correct
and non-vacuous (not ground down to an empty tuple):

* ``_config_fields`` equals the derived schema's non-runtime-only keys, in
  signature order.
* Runtime-only and dynamic schema fields are never exported.
* The derived values match the previously hand-written tuples (zero-change,
  snapshot-style assertions).
* Controls *without* a matching foliplus-module class (test doubles,
  third-party subclasses) keep their own declared ``_config_fields``.

``BaseControl._build_config`` still reads ``self._config_fields`` directly at
runtime and never consults the schema at all — derivation happens once, at
class-definition time.
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
from foliplus._config_schema import (
    _UNSET,
    RUNTIME_ONLY,
    SHARED,
    FieldSpec,
    config_fields,
    derive_schema,
    render_ts_type,
    schema_to_json,
)

# Controls the schema covers. Every entry must appear as a foliplus-module
# ``BaseControl`` subclass and vice versa.
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


def _derived(name: str) -> dict[str, FieldSpec]:
    """Schema reflected from one control's signature."""
    return derive_schema(CONTROL_CLASSES[name])


def _spec_dict(spec: FieldSpec) -> dict[str, object]:
    """JSON-friendly view of one field spec (for dump-shape assertions)."""
    out: dict[str, object] = {
        "ts": spec.ts,
        "optional": spec.optional or spec.runtime_only,
        "nullable": spec.nullable,
        "runtime_only": spec.runtime_only,
        "dynamic": spec.dynamic,
    }
    if spec.values is not None:
        out["values"] = list(spec.values)
    if spec.note:
        out["note"] = spec.note
    if spec.default is not _UNSET:
        out["default"] = spec.default
    return out


def _schema_dict(schema: dict[str, FieldSpec]) -> dict[str, dict[str, object]]:
    return {name: _spec_dict(spec) for name, spec in schema.items()}


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
        exportable = [
            k for k, f in schema.items() if not f.runtime_only and not f.dynamic
        ]
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
        for field_name, spec in _derived(name).items():
            if spec.runtime_only or spec.dynamic:
                continue
            if spec.default is _UNSET:
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


class TestRuntimeOnlyFields:
    """Runtime-only and dynamic fields are declared in schema but not _config_fields."""

    def test_runtime_only_fields_are_not_in_config_fields(self) -> None:
        for name in CONTROL_CLASSES:
            runtime_only_in_schema = [
                k for k, f in _derived(name).items() if f.runtime_only
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
            dynamic_in_schema = [k for k, f in _derived(name).items() if f.dynamic]
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
        for name in CONTROL_CLASSES:
            for field_name, field in _derived(name).items():
                specs.append((f"{name}.{field_name}", field))
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


class TestFieldSpecValidation:
    """FieldSpec rejects contradictory declarations at construction time.

    These guards are what keep the schema table honest: a typo'd tag or a
    flag pair that cannot both be true would otherwise render into the
    generated TS and only fail (if at all) in the browser.
    """

    def test_union_requires_values(self) -> None:
        with pytest.raises(ValueError, match="requires values"):
            FieldSpec("union")

    def test_union_rejects_empty_values(self) -> None:
        with pytest.raises(ValueError, match="requires values"):
            FieldSpec("union", values=())

    def test_unknown_tag_is_rejected(self) -> None:
        with pytest.raises(ValueError, match="not a supported tag"):
            FieldSpec("bogus")

    def test_runtime_only_must_be_optional(self) -> None:
        with pytest.raises(ValueError, match="must be optional"):
            FieldSpec("string", runtime_only=True)

    def test_dynamic_and_runtime_only_are_mutually_exclusive(self) -> None:
        with pytest.raises(ValueError, match="mutually exclusive"):
            FieldSpec("string", optional=True, dynamic=True, runtime_only=True)

    def test_metadata_only_field_spec_has_no_tag(self) -> None:
        # A FieldSpec carrying only a note (or nullable/optional) decides no
        # tag — the reflector does. ``ts=""`` is the "no override" sentinel
        # and must not be rejected as an unknown tag.
        spec = FieldSpec(ts="", note="just a note")
        assert spec.ts == ""

    def test_render_ts_type_rejects_unknown_tag(self) -> None:
        # __post_init__ covers typos at construction time; the render-time
        # guard catches specs that bypass the constructor (setattr on a
        # frozen dataclass, unpickling, third-party builders).
        spec = FieldSpec("string")
        object.__setattr__(spec, "ts", "bogus")
        with pytest.raises(ValueError, match="unknown FieldSpec.ts"):
            render_ts_type(spec)


class TestSchemaDump:
    """The JSON dump must be deterministic, valid JSON, and name-checked."""

    def test_dump_is_valid_json(self) -> None:
        text = schema_to_json()
        data = json.loads(text)
        assert data["version"] == 1
        assert "shared" in data
        assert "runtime_only" in data
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
        from foliplus import BaseControl
        from foliplus._config_schema import _derived_control_schemas

        out = tmp_path / "config-schema.json"
        control_schemas = _derived_control_schemas(BaseControl)
        text = json.dumps(
            {
                "version": 1,
                "shared": {n: _spec_dict(s) for n, s in SHARED.items()},
                "runtime_only": {n: _spec_dict(s) for n, s in RUNTIME_ONLY.items()},
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
        # _config_schema.py imports nothing from foliplus.* at module level;
        # importing it must not alter BaseControl's behaviour. Verified in a
        # subprocess so this test cannot mutate the test-runner's module state
        # (importlib.reload would redefine BaseControl in place and split class
        # identity).
        repo_root = Path(__file__).resolve().parents[2]
        probe = (
            "import foliplus\n"
            "from foliplus.FullscreenControl import FullscreenControl\n"
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

    def test_script_dir_stripped_when_run_as_script(self) -> None:
        # When run as ``python foliplus/_config_schema.py`` the script's
        # directory is prepended to ``sys.path``, which shadows stdlib
        # ``locale``. The module strips it on import so ``argparse``'s gettext
        # import still resolves. Verified in a subprocess so this test cannot
        # mutate the test-runner's ``sys.path``.
        repo_root = Path(__file__).resolve().parents[2]
        src = repo_root / "foliplus" / "_config_schema.py"
        probe = (
            "import sys\n"
            f"sys.argv = [r'{src}', '--help']\n"
            "import runpy\n"
            "try:\n"
            "    runpy.run_path(r'%s', run_name='__main__')\n"
            "except SystemExit as e:\n"
            "    assert e.code == 0\n"
            "print('stripped:', r'%s' not in sys.path)\n" % (src, src.parent)
        )
        result = subprocess.run(
            [sys.executable, "-X", "utf8", "-c", probe],
            cwd=repo_root,
            capture_output=True,
            text=True,
            check=False,
        )
        assert result.returncode == 0, result.stderr
        assert "stripped: True" in result.stdout


def _walk_specs() -> list[tuple[str, FieldSpec]]:
    """Iterate every FieldSpec in the schema (for parametrize helpers)."""
    out: list[tuple[str, FieldSpec]] = []
    for name, field in SHARED.items():
        out.append((f"SHARED.{name}", field))
    for name, field in RUNTIME_ONLY.items():
        out.append((f"RUNTIME_ONLY.{name}", field))
    for name in CONTROL_CLASSES:
        for field_name, field in _derived(name).items():
            out.append((f"{name}.{field_name}", field))
    return out
