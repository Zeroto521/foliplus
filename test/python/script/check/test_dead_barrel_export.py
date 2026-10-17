"""Tests for ``script/check/dead_barrel_export.py`` — dead barrel/type.ts export detection.

The script scans all ``.ts`` files, builds a ``(file, symbol)`` dependency
graph, and reports barrel/type.ts exports that cannot reach a terminal
consumer (real code file, test file, IIFE entry, config-schema.ts, or
Python string reference). Barrel chains are resolved via BFS reachability.

Exemptions: 8 IIFE component entry ``index.ts`` files and ``config-schema.ts``.
"""

from __future__ import annotations

import os
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
        assert out.endswith(os.path.join("a", "util.ts"))

    def test_alias_common(self, tmp_path):
        _make(tmp_path, "foliplus/js/common/log.ts")
        fp = str(tmp_path / "foliplus" / "js" / "a" / "index.ts")
        out = mod._resolve_import(fp, "#common/log.js", str(tmp_path))
        assert out is not None

    def test_alias_core(self, tmp_path):
        _make(tmp_path, "foliplus/js/core/component.ts")
        fp = str(tmp_path / "foliplus" / "js" / "a" / "index.ts")
        out = mod._resolve_import(fp, "#core/component.js", str(tmp_path))
        assert out is not None

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


class TestMain:
    def test_main_on_repo_root(self, capsys, monkeypatch):
        exit_code = _run(capsys, monkeypatch)
        captured = capsys.readouterr()
        if exit_code == 1:
            assert "dead barrel export" in captured.out
            assert "dead barrel export(s)" in captured.err
