"""Component registration consistency.

A control must appear in every registration point the dual-stack build and
docs rely on. Discover the canonical set from the filesystem (Python control
modules + JS component dirs with an entry), then assert each point matches.

Missing one registration used to surface as an opaque unrelated failure later;
this test fails with an explicit checklist instead.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
PKG = ROOT / "foliplus"

#: Base class, not a public control component.
_NON_CONTROL_MODULES = frozenset({"BaseControl"})

#: JS dirs that are shared runtime, not control components (mirrors build.mjs).
_NON_COMPONENT_JS_DIRS = frozenset({"core", "common", "runtime", "type"})


def discover_python_controls() -> set[str]:
    names: set[str] = set()
    for path in PKG.glob("*Control.py"):
        stem = path.stem
        if stem in _NON_CONTROL_MODULES:
            continue
        names.add(stem)
    return names


def discover_js_components() -> set[str]:
    names: set[str] = set()
    js_root = PKG / "js"
    for entry in js_root.iterdir():
        if not entry.is_dir() or entry.name in _NON_COMPONENT_JS_DIRS:
            continue
        if (entry / "index.ts").is_file() or (entry / "index.js").is_file():
            names.add(entry.name)
    return names


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def controls() -> set[str]:
    py = discover_python_controls()
    js = discover_js_components()
    # A complete control exists on both sides; report each half separately
    # when they diverge.
    return py | js


class TestDiscovery:
    def test_python_and_js_sets_match(self):
        py = discover_python_controls()
        js = discover_js_components()
        assert py == js, (
            f"Python-only: {sorted(py - js)}; JS-only: {sorted(js - py)}\n"
            "Every *Control.py needs foliplus/js/<Name>/index.ts and vice versa."
        )

    def test_at_least_one_control(self):
        assert discover_python_controls(), "no controls discovered"


class TestPythonPackage:
    def test_exported_from_init(self, controls: set[str]):
        text = _read(PKG / "__init__.py")
        missing = [
            n
            for n in sorted(controls)
            if f"from .{n} import {n}" not in text or f'"{n}"' not in text
        ]
        assert not missing, (
            f"missing from foliplus/__init__.py: {missing}\n"
            "Add `from .{Name} import {Name}` and include it in __all__."
        )

    def test_locale_tables_exist(self, controls: set[str]):
        missing = []
        for name in sorted(controls):
            for code in ("en", "zh"):
                path = PKG / "locale" / f"{name}.{code}.json"
                if not path.is_file():
                    missing.append(str(path.relative_to(ROOT)))
        assert not missing, f"missing locale tables: {missing}"

    def test_locale_tables_have_code_and_name(self, controls: set[str]):
        """Each table must declare its language so resolve_locale can pick it up."""
        bad = []
        for name in sorted(controls):
            for code in ("en", "zh"):
                path = PKG / "locale" / f"{name}.{code}.json"
                table = json.loads(path.read_text(encoding="utf-8"))
                if table.get("locale.code") != code or not table.get("locale.name"):
                    bad.append(str(path.relative_to(ROOT)))
        assert not bad, f"locale tables missing locale.code/locale.name: {bad}"


class TestJsRegistries:
    def test_listed_in_components_constant(self, controls: set[str]):
        text = _read(PKG / "js" / "core" / "component.ts")
        missing = [n for n in sorted(controls) if f'{n}: "{n}"' not in text]
        assert not missing, (
            f"missing from core/component.ts COMPONENTS: {missing}\n"
            'Add `{Name}: "{Name}",` or run: node script/new-control.mjs <Name>'
        )


class TestDocs:
    def test_api_rst_lists_controls(self, controls: set[str]):
        text = _read(ROOT / "doc" / "source" / "api.rst")
        missing = [
            n for n in sorted(controls) if not re.search(rf"^\s+{n}\s*$", text, re.M)
        ]
        assert not missing, f"missing from doc/source/api.rst: {missing}"

    def test_readme_table_lists_controls(self, controls: set[str]):
        text = _read(ROOT / "README.md")
        missing = [n for n in sorted(controls) if f"**{n}**" not in text]
        assert not missing, f"missing from README.md features table: {missing}"


class TestPythonTests:
    def test_build_components_derived_from_package(self):
        """test_build.py must derive COMPONENTS from the package (not a hand list)."""
        text = _read(ROOT / "test" / "python" / "test_build.py")
        assert "glob" in text and "*Control.py" in text, (
            "test_build.py should discover COMPONENTS via "
            'Path(foliplus.__file__).parent.glob("*Control.py")'
        )

    def test_locale_used_keys_cover_control_prefixes(self, controls: set[str]):
        """Every control with locale tables must contribute at least one key
        to _JS_USED_KEYS, otherwise the unused-key test will fire oddly and
        new controls look registered while their strings are dead."""
        text = _read(ROOT / "test" / "python" / "test_locale.py")
        missing = [n for n in sorted(controls) if f'"{n}.' not in text]
        assert not missing, (
            f"no <Name>.* keys in test_locale.py::_JS_USED_KEYS for: {missing}\n"
            'Add the keys the JS actually uses (T("...") under CONST.name).'
        )


class TestVitestCoverageExcludes:
    def test_index_entries_excluded(self, controls: set[str]):
        text = _read(ROOT / "vitest.config.mjs")
        # Prefer a glob; fall back to per-control listing.
        if "foliplus/js/*/index.ts" in text or "foliplus/js/**/index.ts" in text:
            return
        missing = [
            n for n in sorted(controls) if f"foliplus/js/{n}/index.ts" not in text
        ]
        assert not missing, (
            f"vitest coverage exclude missing index.ts for: {missing}\n"
            "Add them or switch the exclude to the glob foliplus/js/*/index.ts."
        )


class TestScaffoldWiring:
    def test_npm_script_registered(self):
        text = _read(ROOT / "package.json")
        assert '"new-control"' in text and "script/new-control.mjs" in text

    def test_scaffold_uses_core_control_env(self):
        """After #289 createControlEnv lives in #core/controlEnv, not #common/guard."""
        text = _read(ROOT / "script" / "new-control.mjs")
        assert "#core/controlEnv.js" in text
        assert "#common/guard.js" not in text

    def test_scaffold_script_exists(self):
        assert (ROOT / "script" / "new-control.mjs").is_file()
