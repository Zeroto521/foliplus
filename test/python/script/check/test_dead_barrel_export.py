"""Tests for ``script/check/dead_barrel_export.py`` — dead barrel/type.ts export detection.

The script scans all ``.ts`` files, builds a ``(file, symbol)`` dependency
graph, and reports barrel/type.ts exports that cannot reach a terminal
consumer (real code file, test file, IIFE entry, config-schema.ts, or
Python string reference). Barrel chains are resolved via BFS reachability.

Exemptions: 8 IIFE component entry ``index.ts`` files and ``config-schema.ts``.
"""

from __future__ import annotations

import runpy
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[3]
SCRIPT = REPO_ROOT / "script" / "check" / "dead_barrel_export.py"


class _ModuleView:
    def __init__(self, namespace: dict):
        self._ns = namespace

    def __getattr__(self, name: str):
        try:
            return self._ns[name]
        except KeyError as exc:
            raise AttributeError(name) from exc

    def __getitem__(self, name: str):
        return self._ns[name]

    def __setitem__(self, name: str, value):
        self._ns[name] = value

    def get(self, name: str, default=None):
        return self._ns.get(name, default)


mod = _ModuleView(runpy.run_path(str(SCRIPT)))


def _run(capsys, monkeypatch) -> int:
    monkeypatch.setattr(sys, "argv", ["dead_barrel_export.py"])
    return mod.main()


def _make(tmp_path: Path, rel: str, content: str = "") -> Path:
    f = tmp_path / rel
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(content, encoding="utf-8")
    return f


class TestStripForParsing:
    def test_line_comment_is_removed(self):
        assert "comment" not in mod.strip_for_parsing("a // comment")

    def test_block_comment_is_removed(self):
        out = mod.strip_for_parsing("a /* comment */ b")
        assert "comment" not in out
        assert "a" in out and "b" in out

    def test_multiline_block_comment(self):
        out = mod.strip_for_parsing("a /*\ncomment\n*/ b")
        assert "comment" not in out

    def test_string_content_is_preserved(self):
        assert 'import { x } from "./util.js";' in mod.strip_for_parsing(
            'import { x } from "./util.js";'
        )

    def test_slash_inside_string_is_kept(self):
        out = mod.strip_for_parsing('import { x } from "//server/path";')
        assert "//server/path" in out

    def test_code_outside_comment_is_kept(self):
        assert mod.strip_for_parsing("const x = 1;") == "const x = 1;"

    def test_empty_string(self):
        assert mod.strip_for_parsing("") == ""

    def test_slash_alone_is_kept(self):
        assert mod.strip_for_parsing("a / b") == "a / b"


class TestParseSymbolList:
    def test_single_symbol(self):
        assert mod._parse_symbol_list("X") == [("X", "X")]

    def test_multiple_symbols(self):
        assert mod._parse_symbol_list("X, Y") == [("X", "X"), ("Y", "Y")]

    def test_aliased_symbol(self):
        assert mod._parse_symbol_list("X as Y") == [("Y", "X")]

    def test_type_qualifier(self):
        assert mod._parse_symbol_list("type X") == [("X", "X")]

    def test_empty_string(self):
        assert mod._parse_symbol_list("") == []

    def test_trailing_comma(self):
        assert mod._parse_symbol_list("X, Y,") == [("X", "X"), ("Y", "Y")]


class TestResolveImport:
    def test_relative_path(self, tmp_path):
        _make(tmp_path, "a/util.ts")
        fp = str(tmp_path / "a" / "index.ts")
        out = mod._resolve_import(fp, "./util.js", str(tmp_path))
        assert out is not None
        assert Path(out).as_posix().endswith("a/util.ts")

    def test_alias_common(self, tmp_path):
        _make(tmp_path, "foliplus/js/platform/log.ts")
        fp = str(tmp_path / "foliplus" / "js" / "a" / "index.ts")
        out = mod._resolve_import(fp, "#platform/log.js", str(tmp_path))
        assert out is not None

    def test_alias_core(self, tmp_path):
        _make(tmp_path, "foliplus/js/core/component.ts")
        fp = str(tmp_path / "foliplus" / "js" / "a" / "index.ts")
        out = mod._resolve_import(fp, "#core/component.js", str(tmp_path))
        assert out is not None

    def test_alias_control(self, tmp_path):
        _make(tmp_path, "foliplus/js/control/LayerControl/const.ts")
        fp = str(tmp_path / "foliplus" / "js" / "a" / "index.ts")
        out = mod._resolve_import(fp, "#control/LayerControl/const.js", str(tmp_path))
        assert out is not None
        assert out.endswith(
            str(Path("foliplus") / "js" / "control" / "LayerControl" / "const.ts")
        )

    def test_alias_ui(self, tmp_path):
        # The #ui/ mapping (same shape as #platform/#core): the barrel
        # (#ui/index.js) re-exports the ui modules, so the graph must
        # resolve it or the barrel's re-exports are judged dead.
        _make(tmp_path, "foliplus/js/ui/panelChrome.ts")
        fp = str(tmp_path / "foliplus" / "js" / "a" / "index.ts")
        out = mod._resolve_import(fp, "#ui/panelChrome.js", str(tmp_path))
        assert out is not None
        assert out.endswith(str(Path("foliplus") / "js" / "ui" / "panelChrome.ts"))

    def test_external_module_returns_none(self, tmp_path):
        fp = str(tmp_path / "index.ts")
        assert mod._resolve_import(fp, "leaflet", str(tmp_path)) is None

    def test_nonexistent_returns_none(self, tmp_path):
        fp = str(tmp_path / "index.ts")
        assert mod._resolve_import(fp, "./nonexistent.js", str(tmp_path)) is None


class TestFileAnalysis:
    def test_iife_entry_detection(self, tmp_path):
        f = _make(tmp_path, "index.ts", "new FooControl({}).addTo(map);\n")
        fa = mod.parse_file(str(f), f.read_text(), str(tmp_path))
        assert fa.is_iife_entry

    def test_non_iife_entry(self, tmp_path):
        f = _make(tmp_path, "index.ts", "export { x } from './a.js';\n")
        fa = mod.parse_file(str(f), f.read_text(), str(tmp_path))
        assert not fa.is_iife_entry

    def test_barrel_scope_index(self, tmp_path):
        f = _make(tmp_path, "js/index.ts", "export { x } from './a.js';\n")
        fa = mod.parse_file(str(f), f.read_text(), str(tmp_path))
        assert fa.is_barrel_scope

    def test_barrel_scope_type(self, tmp_path):
        f = _make(tmp_path, "js/type.ts", "export type { X } from './a.js';\n")
        fa = mod.parse_file(str(f), f.read_text(), str(tmp_path))
        assert fa.is_barrel_scope

    def test_not_barrel_scope(self, tmp_path):
        f = _make(tmp_path, "util.ts", "const x = 1;\n")
        fa = mod.parse_file(str(f), f.read_text(), str(tmp_path))
        assert not fa.is_barrel_scope

    def test_config_schema_exempt(self, tmp_path):
        f = _make(
            tmp_path,
            "foliplus/js/config-schema.ts",
            "export type { X } from './a.js';\n",
        )
        fa = mod.parse_file(str(f), f.read_text(), str(tmp_path))
        assert fa.is_exempt

    def test_pure_barrel_detection(self, tmp_path):
        f = _make(
            tmp_path,
            "index.ts",
            "export { x } from './a.js';\nexport { y } from './b.js';\n",
        )
        fa = mod.parse_file(str(f), f.read_text(), str(tmp_path))
        assert fa.is_pure_barrel

    def test_non_pure_barrel_with_code(self, tmp_path):
        f = _make(
            tmp_path,
            "index.ts",
            "class Foo {\n  bar: string = 'x';\n}\nexport { Foo };\n",
        )
        fa = mod.parse_file(str(f), f.read_text(), str(tmp_path))
        assert not fa.is_pure_barrel


class TestParseFile:
    def test_named_imports(self, tmp_path):
        _make(tmp_path, "a.ts", "export const a = 1;\n")
        _make(tmp_path, "b.ts", "export const b = 2;\n")
        f = _make(
            tmp_path,
            "index.ts",
            "import { a } from './a.js';\nimport { b } from './b.js';\n",
        )
        fa = mod.parse_file(str(f), f.read_text(), str(tmp_path))
        assert "a" in fa.named_imports
        assert "b" in fa.named_imports

    def test_named_imports_with_alias(self, tmp_path):
        _make(tmp_path, "a.ts", "export const a = 1;\n")
        f = _make(tmp_path, "index.ts", "import { a as b } from './a.js';\n")
        fa = mod.parse_file(str(f), f.read_text(), str(tmp_path))
        assert "b" in fa.named_imports
        assert fa.named_imports["b"][1] == "a"

    def test_type_imports(self, tmp_path):
        _make(tmp_path, "a.ts", "export type X = number;\n")
        f = _make(tmp_path, "index.ts", "import type { X } from './a.js';\n")
        fa = mod.parse_file(str(f), f.read_text(), str(tmp_path))
        assert "X" in fa.named_imports

    def test_star_imports(self, tmp_path):
        _make(tmp_path, "const.ts", "export const C = 1;\n")
        f = _make(tmp_path, "index.ts", "import * as CONST from './const.js';\n")
        fa = mod.parse_file(str(f), f.read_text(), str(tmp_path))
        assert len(fa.star_imports) == 1

    def test_named_re_exports(self, tmp_path):
        _make(tmp_path, "a.ts", "export const a = 1;\nexport const b = 2;\n")
        f = _make(tmp_path, "index.ts", "export { a, b } from './a.js';\n")
        fa = mod.parse_file(str(f), f.read_text(), str(tmp_path))
        assert "a" in fa.named_re_exports
        assert "b" in fa.named_re_exports
        assert "a" in fa.exports
        assert "b" in fa.exports

    def test_named_exports_no_from(self, tmp_path):
        f = _make(tmp_path, "util.ts", "const x = 1;\nexport { x };\n")
        fa = mod.parse_file(str(f), f.read_text(), str(tmp_path))
        assert "x" in fa.exports
        assert fa.exports_by_line["x"][1] == "define"

    def test_inline_exports(self, tmp_path):
        f = _make(
            tmp_path,
            "util.ts",
            "export const x = 1;\n"
            "export function foo() {}\n"
            "export class Bar {}\n"
            "export interface Baz {}\n"
            "export type Qux = number;\n"
            "export enum Foo { A, B }\n",
        )
        fa = mod.parse_file(str(f), f.read_text(), str(tmp_path))
        for sym in ["x", "foo", "Bar", "Baz", "Qux", "Foo"]:
            assert sym in fa.exports

    def test_exports_by_line(self, tmp_path):
        _make(tmp_path, "a.ts", "export const a = 1;\n")
        _make(tmp_path, "b.ts", "export const b = 2;\n")
        f = _make(
            tmp_path,
            "index.ts",
            "// comment\nexport { a } from './a.js';\nexport { b } from './b.js';\n",
        )
        fa = mod.parse_file(str(f), f.read_text(), str(tmp_path))
        assert fa.exports_by_line["a"][0] == 2
        assert fa.exports_by_line["b"][0] == 3


class TestBuildGraph:
    def test_import_edge(self, tmp_path):
        a = _make(tmp_path, "a.ts", "export const x = 1;\n")
        b = _make(tmp_path, "b.ts", "import { x } from './a.js';\n")
        analyses = {
            str(a): mod.parse_file(str(a), a.read_text(), str(tmp_path)),
            str(b): mod.parse_file(str(b), b.read_text(), str(tmp_path)),
        }
        graph = mod.build_graph(analyses, str(tmp_path))
        assert (str(a), "x") in graph
        assert (str(b), "x") in graph[(str(a), "x")]

    def test_reexport_edge(self, tmp_path):
        a = _make(tmp_path, "a.ts", "export const x = 1;\n")
        b = _make(tmp_path, "index.ts", "export { x } from './a.js';\n")
        analyses = {
            str(a): mod.parse_file(str(a), a.read_text(), str(tmp_path)),
            str(b): mod.parse_file(str(b), b.read_text(), str(tmp_path)),
        }
        graph = mod.build_graph(analyses, str(tmp_path))
        assert (str(a), "x") in graph
        assert (str(b), "x") in graph[(str(a), "x")]

    def test_star_reexport_expansion(self, tmp_path):
        a = _make(tmp_path, "a.ts", "export const x = 1;\nexport const y = 2;\n")
        b = _make(tmp_path, "index.ts", "export * from './a.js';\n")
        analyses = {
            str(a): mod.parse_file(str(a), a.read_text(), str(tmp_path)),
            str(b): mod.parse_file(str(b), b.read_text(), str(tmp_path)),
        }
        graph = mod.build_graph(analyses, str(tmp_path))
        assert (str(a), "x") in graph
        assert (str(b), "x") in graph[(str(a), "x")]
        assert (str(a), "y") in graph
        assert (str(b), "y") in graph[(str(a), "y")]


class TestComputeSinks:
    def test_iife_entry_is_sink(self, tmp_path):
        f = _make(tmp_path, "index.ts", "new FooControl({}).addTo(map);\n")
        analyses = {str(f): mod.parse_file(str(f), f.read_text(), str(tmp_path))}
        graph = mod.build_graph(analyses, str(tmp_path))
        sinks = mod.compute_sinks(analyses, graph, set())
        for sym in analyses[str(f)].exports:
            assert (str(f), sym) in sinks

    def test_real_code_import_is_sink(self, tmp_path):
        a = _make(tmp_path, "a.ts", "export const x = 1;\n")
        b = _make(tmp_path, "b.ts", "import { x } from './a.js';\nconst y = x;\n")
        analyses = {
            str(a): mod.parse_file(str(a), a.read_text(), str(tmp_path)),
            str(b): mod.parse_file(str(b), b.read_text(), str(tmp_path)),
        }
        graph = mod.build_graph(analyses, str(tmp_path))
        sinks = mod.compute_sinks(analyses, graph, set())
        assert (str(b), "x") in sinks

    def test_pure_barrel_import_is_not_sink(self, tmp_path):
        a = _make(tmp_path, "a.ts", "export const x = 1;\n")
        b = _make(tmp_path, "index.ts", "import { x } from './a.js';\nexport { x };\n")
        analyses = {
            str(a): mod.parse_file(str(a), a.read_text(), str(tmp_path)),
            str(b): mod.parse_file(str(b), b.read_text(), str(tmp_path)),
        }
        graph = mod.build_graph(analyses, str(tmp_path))
        sinks = mod.compute_sinks(analyses, graph, set())
        assert (str(b), "x") not in sinks

    def test_python_reference_is_sink(self, tmp_path):
        f = _make(tmp_path, "index.ts", "export const mySymbol = 1;\n")
        analyses = {str(f): mod.parse_file(str(f), f.read_text(), str(tmp_path))}
        graph = mod.build_graph(analyses, str(tmp_path))
        sinks = mod.compute_sinks(analyses, graph, {"mySymbol"})
        assert (str(f), "mySymbol") in sinks


class TestFindDeadExports:
    def test_dead_export_is_found(self, tmp_path):
        a = _make(tmp_path, "a.ts", "export const x = 1;\n")
        b = _make(tmp_path, "index.ts", "export { x } from './a.js';\n")
        analyses = {
            str(a): mod.parse_file(str(a), a.read_text(), str(tmp_path)),
            str(b): mod.parse_file(str(b), b.read_text(), str(tmp_path)),
        }
        graph = mod.build_graph(analyses, str(tmp_path))
        sinks = mod.compute_sinks(analyses, graph, set())
        barrel_files = {fp: fa for fp, fa in analyses.items() if fa.is_barrel_scope}
        dead = mod.find_dead_exports(barrel_files, graph, sinks)
        assert len(dead) == 1
        assert dead[0][0] == str(b)
        assert dead[0][2] == "x"

    def test_live_export_is_not_found(self, tmp_path):
        a = _make(tmp_path, "a.ts", "export const x = 1;\n")
        b = _make(tmp_path, "index.ts", "export { x } from './a.js';\n")
        c = _make(tmp_path, "c.ts", "import { x } from './index.js';\nconst y = x;\n")
        analyses = {
            str(a): mod.parse_file(str(a), a.read_text(), str(tmp_path)),
            str(b): mod.parse_file(str(b), b.read_text(), str(tmp_path)),
            str(c): mod.parse_file(str(c), c.read_text(), str(tmp_path)),
        }
        graph = mod.build_graph(analyses, str(tmp_path))
        sinks = mod.compute_sinks(analyses, graph, set())
        barrel_files = {fp: fa for fp, fa in analyses.items() if fa.is_barrel_scope}
        dead = mod.find_dead_exports(barrel_files, graph, sinks)
        assert len(dead) == 0

    def test_barrel_chain_reachability(self, tmp_path):
        a = _make(tmp_path, "a.ts", "export const x = 1;\n")
        b = _make(tmp_path, "index.ts", "export { x } from './a.js';\n")
        c = _make(tmp_path, "sub/index.ts", "export * from '../index.js';\n")
        d = _make(
            tmp_path, "sub/d.ts", "import { x } from './index.js';\nconst y = x;\n"
        )
        analyses = {
            str(a): mod.parse_file(str(a), a.read_text(), str(tmp_path)),
            str(b): mod.parse_file(str(b), b.read_text(), str(tmp_path)),
            str(c): mod.parse_file(str(c), c.read_text(), str(tmp_path)),
            str(d): mod.parse_file(str(d), d.read_text(), str(tmp_path)),
        }
        graph = mod.build_graph(analyses, str(tmp_path))
        sinks = mod.compute_sinks(analyses, graph, set())
        barrel_files = {fp: fa for fp, fa in analyses.items() if fa.is_barrel_scope}
        dead = mod.find_dead_exports(barrel_files, graph, sinks)
        assert len(dead) == 0

    def test_forwarding_edge_exists(self, tmp_path):
        """Re-export must create a forwarding edge (barrel -> source) for BFS."""
        a = _make(tmp_path, "a.ts", "export const x = 1;\n")
        b = _make(tmp_path, "index.ts", "export { x } from './a.js';\n")
        analyses = {
            str(a): mod.parse_file(str(a), a.read_text(), str(tmp_path)),
            str(b): mod.parse_file(str(b), b.read_text(), str(tmp_path)),
        }
        graph = mod.build_graph(analyses, str(tmp_path))
        # Forwarding edge: barrel -> source (for BFS to reach consumers)
        assert (str(b), "x") in graph
        assert (str(a), "x") in graph[(str(b), "x")]
        # Backward edge: source -> barrel (for barrel chains)
        assert (str(a), "x") in graph
        assert (str(b), "x") in graph[(str(a), "x")]

    def test_star_forwarding_edge_exists(self, tmp_path):
        """Star re-export must also create forwarding edges."""
        a = _make(tmp_path, "a.ts", "export const x = 1;\nexport const y = 2;\n")
        b = _make(tmp_path, "index.ts", "export * from './a.js';\n")
        analyses = {
            str(a): mod.parse_file(str(a), a.read_text(), str(tmp_path)),
            str(b): mod.parse_file(str(b), b.read_text(), str(tmp_path)),
        }
        graph = mod.build_graph(analyses, str(tmp_path))
        assert (str(b), "x") in graph
        assert (str(a), "x") in graph[(str(b), "x")]
        assert (str(b), "y") in graph
        assert (str(a), "y") in graph[(str(b), "y")]


class TestReverseValidation:
    """Reverse validation: real dead exports must be reported."""

    def test_defined_but_never_imported_is_reported(self, tmp_path):
        """Symbol defined in source, re-exported from barrel, but nobody
        imports it from the barrel — must be reported as dead."""
        a = _make(tmp_path, "a.ts", "export const deadSym = 1;\n")
        b = _make(tmp_path, "index.ts", "export { deadSym } from './a.js';\n")
        analyses = {
            str(a): mod.parse_file(str(a), a.read_text(), str(tmp_path)),
            str(b): mod.parse_file(str(b), b.read_text(), str(tmp_path)),
        }
        graph = mod.build_graph(analyses, str(tmp_path))
        sinks = mod.compute_sinks(analyses, graph, set())
        barrel_files = {fp: fa for fp, fa in analyses.items() if fa.is_barrel_scope}
        dead = mod.find_dead_exports(barrel_files, graph, sinks)
        assert len(dead) == 1
        assert dead[0][0] == str(b)
        assert dead[0][2] == "deadSym"

    def test_live_symbol_is_not_reported(self, tmp_path):
        """Symbol defined, re-exported from barrel, AND imported by a
        real code file — must NOT be reported."""
        a = _make(tmp_path, "a.ts", "export const liveSym = 1;\n")
        b = _make(tmp_path, "index.ts", "export { liveSym } from './a.js';\n")
        c = _make(
            tmp_path,
            "c.ts",
            "import { liveSym } from './index.js';\nconst z = liveSym;\n",
        )
        analyses = {
            str(a): mod.parse_file(str(a), a.read_text(), str(tmp_path)),
            str(b): mod.parse_file(str(b), b.read_text(), str(tmp_path)),
            str(c): mod.parse_file(str(c), c.read_text(), str(tmp_path)),
        }
        graph = mod.build_graph(analyses, str(tmp_path))
        sinks = mod.compute_sinks(analyses, graph, set())
        barrel_files = {fp: fa for fp, fa in analyses.items() if fa.is_barrel_scope}
        dead = mod.find_dead_exports(barrel_files, graph, sinks)
        assert len(dead) == 0

    def test_deep_barrel_chain_live_is_not_reported(self, tmp_path):
        """Symbol defined, re-exported through two barrels, AND imported
        by a real code file — must NOT be reported."""
        a = _make(tmp_path, "a.ts", "export const deepSym = 1;\n")
        b = _make(tmp_path, "index.ts", "export { deepSym } from './a.js';\n")
        c = _make(tmp_path, "sub/index.ts", "export * from '../index.js';\n")
        d = _make(
            tmp_path,
            "sub/d.ts",
            "import { deepSym } from './index.js';\nconst z = deepSym;\n",
        )
        analyses = {
            str(a): mod.parse_file(str(a), a.read_text(), str(tmp_path)),
            str(b): mod.parse_file(str(b), b.read_text(), str(tmp_path)),
            str(c): mod.parse_file(str(c), c.read_text(), str(tmp_path)),
            str(d): mod.parse_file(str(d), d.read_text(), str(tmp_path)),
        }
        graph = mod.build_graph(analyses, str(tmp_path))
        sinks = mod.compute_sinks(analyses, graph, set())
        barrel_files = {fp: fa for fp, fa in analyses.items() if fa.is_barrel_scope}
        dead = mod.find_dead_exports(barrel_files, graph, sinks)
        assert len(dead) == 0


class TestMain:
    def test_main_on_repo_root(self, capsys, monkeypatch):
        exit_code = _run(capsys, monkeypatch)
        captured = capsys.readouterr()
        if exit_code == 1:
            assert "dead barrel export" in captured.out
            assert "dead barrel export(s)" in captured.err

    def test_main_reports_dead_on_tmp_repo(self, tmp_path, capsys, monkeypatch):
        """main() over a tiny repo with a dead export exits 1 and reports it."""
        _make(tmp_path, "foliplus/js/a.ts", "export const deadSym = 1;\n")
        _make(
            tmp_path,
            "foliplus/js/index.ts",
            "export { deadSym } from './a.js';\n",
        )
        # A corrupt .ts file must be skipped, not fatal (UnicodeDecodeError
        # path in the read loop).
        (tmp_path / "foliplus" / "js" / "bad.ts").write_bytes(b"\xff\xfe\x00bad")
        monkeypatch.setitem(mod["main"].__globals__, "REPO_ROOT", tmp_path)
        monkeypatch.setattr(sys, "argv", ["dead_barrel_export.py"])
        rc = mod.main()
        captured = capsys.readouterr()
        assert rc == 1
        assert "dead barrel export 'deadSym'" in captured.out
        assert "dead barrel export(s)" in captured.err
        assert "index.ts:" in captured.out

    def test_main_returns_zero_on_tmp_repo(self, tmp_path, monkeypatch):
        """main() over a small repo with a live export chain exits 0."""
        _make(tmp_path, "foliplus/js/a.ts", "export const liveSym = 1;\n")
        _make(
            tmp_path,
            "foliplus/js/index.ts",
            "export { liveSym } from './a.js';\n",
        )
        _make(
            tmp_path,
            "foliplus/js/c.ts",
            "import { liveSym } from './index.js';\nconst z = liveSym;\n",
        )
        monkeypatch.setitem(mod["main"].__globals__, "REPO_ROOT", tmp_path)
        monkeypatch.setattr(sys, "argv", ["dead_barrel_export.py"])
        rc = mod.main()
        assert rc == 0


class TestCoverageGaps:
    """Targeted tests for defensive/resilience branches."""

    def test_default_import_handled(self, tmp_path):
        _make(tmp_path, "a.ts", "export default 1;\n")
        f = _make(tmp_path, "index.ts", "import X from './a.js';\n")
        fa = mod.parse_file(str(f), f.read_text(), str(tmp_path))
        assert "X" in fa.named_imports
        assert fa.named_imports["X"][1] == "default"

    def test_find_ts_files_missing_dir(self, tmp_path):
        assert mod.find_ts_files(str(tmp_path)) == set()

    def test_find_python_files_missing_dir(self, tmp_path):
        assert mod.find_python_files(str(tmp_path)) == set()

    def test_collect_python_references_missing_file(self, tmp_path):
        """A path that cannot be opened is skipped, not fatal."""
        assert mod.collect_python_references({str(tmp_path / "nope.py")}) == set()

    def test_duplicate_reexport_symbol(self, tmp_path):
        """Re-exporting the same symbol twice keeps the first line number."""
        _make(tmp_path, "a.ts", "export const x = 1;\n")
        f = _make(
            tmp_path,
            "index.ts",
            "export { x } from './a.js';\nexport { x } from './a.js';\n",
        )
        fa = mod.parse_file(str(f), f.read_text(), str(tmp_path))
        assert len(fa.exports_by_line) == 1

    def test_star_to_unanalysed_source(self, tmp_path):
        """Star re-exports/imports whose source is not in the analyses dict
        are skipped in graph/sink construction."""
        provider = _make(tmp_path, "sub/provider.ts", "export const p = 1;\n")
        idx = _make(
            tmp_path,
            "index.ts",
            "export * from './sub/provider.js';\n",
        )
        consumer = _make(
            tmp_path,
            "consumer.ts",
            "import * as NS from './sub/provider.js';\nconst z = NS.p;\n",
        )
        # provider.ts exists on disk but is deliberately excluded from the
        # analyses dict — its star edges must be skipped, not crash.
        analyses = {
            str(idx): mod.parse_file(str(idx), idx.read_text(), str(tmp_path)),
            str(consumer): mod.parse_file(
                str(consumer), consumer.read_text(), str(tmp_path)
            ),
        }
        graph = mod.build_graph(analyses, str(tmp_path))
        sinks = mod.compute_sinks(analyses, graph, set())
        # The barrel has no exports of its own (star target is unanalysed).
        barrel_files = {fp: fa for fp, fa in analyses.items() if fa.is_barrel_scope}
        dead = mod.find_dead_exports(barrel_files, graph, sinks)
        assert len(dead) == 0
        assert str(provider) not in str(graph)

    def test_bfs_cycle_hits_visited(self, tmp_path):
        """A diamond star-re-export (two paths into one target) enqueues the
        target twice — BFS must skip the already-visited node instead of
        re-walking, then report the dead export."""
        n = _make(tmp_path, "n.ts", "export const z = 1;\n")
        x = _make(tmp_path, "x.ts", "export * from './n.js';\n")
        y = _make(tmp_path, "y.ts", "export * from './n.js';\n")
        b = _make(
            tmp_path,
            "index.ts",
            "export * from './x.js';\nexport * from './y.js';\n",
        )
        analyses = {
            str(f): mod.parse_file(str(f), f.read_text(), str(tmp_path))
            for f in (n, x, y, b)
        }
        graph = mod.build_graph(analyses, str(tmp_path))
        sinks = mod.compute_sinks(analyses, graph, set())
        barrel_files = {fp: fa for fp, fa in analyses.items() if fa.is_barrel_scope}
        dead = mod.find_dead_exports(barrel_files, graph, sinks)
        assert len(dead) == 1
        assert dead[0][0] == str(b)
        assert dead[0][2] == "z"


class TestPathlibHelpers:
    """Direct unit tests for the pathlib helper functions."""

    @pytest.mark.parametrize(
        "spec,expected",
        [
            ("./x.js", "x.js"),
            ("../y.js", "../y.js"),
            ("./a/../b/c.js", "b/c.js"),
            ("x/../../d.ts", "../d.ts"),
            ("a/./b", "a/b"),
            (".", "."),
            ("", "."),
        ],
    )
    def test_normpath_lexical(self, spec, expected):
        """_normpath collapses . and resolves inner ..; leading .. preserved."""
        result = mod._normpath(spec)
        assert result.as_posix() == expected

    def test_normpath_absolute_climbs_clamp_to_anchor(self):
        """_normpath clamps absolute-path '..' at the root/drive anchor.

        A leading '..' must not pop the anchor (os.path.normpath keeps it):
        ``/a/../..`` -> ``/`` and ``C:/a/../../b`` -> ``C:/b``. Drive forms
        only exist under Windows drive semantics; skip them elsewhere.
        """
        import os

        specs = ["/..", "/a/../..", "/a/../../b", "/a/../../.."]
        if Path("C:/").anchor:  # Windows drive semantics
            specs += ["C:/a/../..", "C:/a/../../b", "C:/a/../b", "C:/a/../../.."]
        for spec in specs:
            mine = mod._normpath(spec).as_posix()
            expected = os.path.normpath(spec).replace(os.sep, "/")
            assert mine == expected, f"{spec!r}: {mine!r} != {expected!r}"

    def test_normpath_unc_pins_observed_behavior(self):
        """'//a/../b' collapses to '//b' on both platforms.

        On Windows '//a/..' is a UNC server root: Path.parts keeps the whole
        '\\\\a\\..\\' as one anchor part, so no '..' segment is seen and the
        path is returned unchanged ('//a/../b'), matching os.path.normpath.
        On POSIX the leading '//' is a prefix but '..' is a real segment; the
        anchor clamp then pops 'a' (leaving '//'), so the '..' is clamped and
        the path collapses to '//b'. Verified equal to posixpath.normpath,
        which also gives '//b'. The unified assertion holds on both platforms.
        """
        import os

        mine = mod._normpath("//a/../b").as_posix()
        expected = os.path.normpath("//a/../b").replace(os.sep, "/")
        assert mine == expected

    def test_normpath_matches_os_path(self, tmp_path):
        """_normpath agrees with os.path.normpath on realistic repo paths."""
        import os

        base = tmp_path / "foliplus" / "js" / "common"
        for spec in ["./log.js", "../core/x.js", "x/../y/z.js", "./a/../../b.ts"]:
            mine = mod._normpath(str(base / spec)).as_posix()
            expected = os.path.normpath(os.path.join(str(base), spec)).replace(
                os.sep, "/"
            )
            assert mine == expected

    def test_relpath_subpath(self, tmp_path):
        """_relpath yields forward-slash relative path for a descendant."""
        base = tmp_path / "repo"
        target = base / "a" / "b" / "c.ts"
        result = mod._relpath(str(target), str(base))
        assert result == "a/b/c.ts"

    def test_relpath_matches_os_relpath(self, tmp_path):
        """_relpath agrees with os.path.relpath(...).replace(os.sep, '/')."""
        import os

        base = tmp_path / "repo"
        target = base / "foliplus" / "js" / "control" / "x.ts"
        mine = mod._relpath(str(target), str(base))
        expected = os.path.relpath(str(target), str(base)).replace(os.sep, "/")
        assert mine == expected

    def test_relpath_raises_on_unrelated(self, tmp_path):
        """_relpath raises ValueError when path is not under base (no fallback)."""
        base = tmp_path / "repo"
        other = tmp_path / "elsewhere" / "x.ts"
        with pytest.raises(ValueError):
            mod._relpath(str(other), str(base))

    def test_alias_foliplus(self, tmp_path):
        _make(tmp_path, "foliplus/js/foo.ts")
        fp = str(tmp_path / "a" / "index.ts")
        out = mod._resolve_import(fp, "#foliplus/foo.js", str(tmp_path))
        assert out is not None

    def test_alias_script(self, tmp_path):
        _make(tmp_path, "script/check/x.ts")
        fp = str(tmp_path / "a" / "index.ts")
        out = mod._resolve_import(fp, "#script/check/x.js", str(tmp_path))
        assert out is not None

    def test_find_ts_files_collects_only_ts(self, tmp_path):
        """find_ts_files collects .ts recursively, ignores .js and hidden dirs."""
        _make(tmp_path, "foliplus/js/a/one.ts")
        _make(tmp_path, "foliplus/js/a/two.js")
        _make(tmp_path, "foliplus/js/.hidden/three.ts")
        _make(tmp_path, "test/js/b/four.ts")
        found = mod.find_ts_files(str(tmp_path))
        names = {Path(p).as_posix() for p in found}
        assert any(p.endswith("foliplus/js/a/one.ts") for p in names)
        assert any(p.endswith("test/js/b/four.ts") for p in names)
        assert not any(p.endswith("two.js") for p in names)
        # os.walk (old) descended into .hidden too; rglob keeps that behavior.
        assert any(p.endswith(".hidden/three.ts") for p in names)

    def test_find_python_files_collects_only_py(self, tmp_path):
        """find_python_files collects .py directly under foliplus/, ignores others."""
        _make(tmp_path, "foliplus/one.py")
        _make(tmp_path, "foliplus/two.txt")
        _make(tmp_path, "foliplus/three.py")
        found = mod.find_python_files(str(tmp_path))
        names = {Path(p).name for p in found}
        assert names == {"one.py", "three.py"}


class TestControlEntryDiscovery:
    r"""C3: IIFE entry detection must be path-based, not content-regex only.

    The old content-only regex (``new\s+\w+Control\s*\(``) silently stopped
    matching when a control was renamed or when a 9th control used a
    different naming shape. The fix enumerates ``foliplus/js/control/`` from
    disk so the exemption set is discovered, not maintained by hand.
    """

    def test_control_entry_paths_discovers_all_8(self):
        """The set contains all 8 shipped control entry paths."""
        entries = mod._control_entry_paths()
        expected_controls = {
            "ExportControl",
            "FullscreenControl",
            "HeatmapControl",
            "LayerControl",
            "LocateControl",
            "MeasureControl",
            "ScaleControl",
            "SearchControl",
        }
        for name in expected_controls:
            expected = f"foliplus/js/control/{name}/index.ts"
            assert expected in entries, (
                f"{expected} missing from _control_entry_paths(); got {sorted(entries)}"
            )

    def test_control_entry_paths_missing_dir(self, tmp_path, monkeypatch):
        """A missing control/ directory returns an empty set, not a crash."""
        empty_root = tmp_path / "emptyrepo"
        empty_root.mkdir()
        monkeypatch.setitem(
            mod._control_entry_paths.__globals__, "REPO_ROOT", empty_root
        )
        assert mod._control_entry_paths() == set()

    def test_renamed_control_is_detected(self, tmp_path, monkeypatch):
        """A renamed control's new index.ts is still discovered as an entry."""
        control_dir = tmp_path / "foliplus" / "js" / "control"
        (control_dir / "RenamedControl").mkdir(parents=True)
        (control_dir / "RenamedControl" / "index.ts").write_text("")
        monkeypatch.setitem(mod._control_entry_paths.__globals__, "REPO_ROOT", tmp_path)
        entries = mod._control_entry_paths()
        assert "foliplus/js/control/RenamedControl/index.ts" in entries

    def test_path_based_detection_beats_content_regex_for_renamed(
        self, tmp_path, monkeypatch
    ):
        """A file at a discovered entry path is iife_entry even if its content
        does not match the old regex (e.g. the rename also changed the class name)."""
        fake = tmp_path / "foliplus/js/control/RenamedControl/index.ts"
        fake.parent.mkdir(parents=True)
        fake.write_text("export { init } from './a.js';\n")
        # Both globals must point at tmp_path: the entry set for path match,
        # and repo_root for _relpath inside parse_file.
        monkeypatch.setitem(mod._control_entry_paths.__globals__, "REPO_ROOT", tmp_path)
        monkeypatch.setitem(mod.parse_file.__globals__, "REPO_ROOT", tmp_path)
        fa = mod.parse_file(str(fake), fake.read_text(), str(tmp_path))
        # Path is in the discovered set, so is_iife_entry is True even
        # though the content regex would not match.
        assert fa.is_iife_entry, "path-based detection failed for renamed control"
