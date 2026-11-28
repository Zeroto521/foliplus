"""Guard: the declared-string trim rule is one union set, and the colour path
uses it instead of a host strip().

A face declaration (foliplus={"icon": {...}}) is normalised twice: the Python
declaration channel normalises the author's raw dict, and the JS panel reader
normalises the namespace a rendered map or a hand-built layer carries. Two
literals must stay identical, and one host call must stay absent:

* the sub-key vocabulary - canonical camelCase key -> accepted spellings
  (foliplus/_declaration/face.py vs
  foliplus/js/control/LayerControl/declaredParse.ts);
* the whitespace a declared string is trimmed of, as explicit code points
  (DECLARED_TRIM_CODEPOINTS in foliplus/_declaration/paint.py and in
  declaredParse.ts). The set is the UNION of Python's str.isspace() and
  JavaScript's WhiteSpace/LineTerminator sets: the hosts disagree on
  U+001C-U+001F / U+0085 / U+FEFF, and an author pasting from rich text or CJK
  input brings U+2000-U+200A, U+2028/U+2029, U+202F, U+205F, U+3000. A union is
  the only set that makes one declaration mean the same thing on both stacks;
* no host trim remains on the colour path. `_declared_hex` used to follow the
  shared trim with its own `raw.strip()`, so a Unicode space outside the then
  shared set was accepted by Python and rejected by JS. This guard walks
  paint.py / face.py with the AST and fails on a no-argument `.strip()` call,
  and fails on a `.trim()` inside the JS face table.

Only comments used to keep the two tables in step, and comments are exactly the
drift mechanism this repo has paid for before. The teeth tests drive the
parsers with mutated source text (not mutated parsed dicts), so the parser
itself is proven to notice.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PYTHON_FACE = ROOT / "foliplus" / "_declaration" / "face.py"
PYTHON_PAINT = ROOT / "foliplus" / "_declaration" / "paint.py"
JS_PARSE = ROOT / "foliplus" / "js" / "control" / "LayerControl" / "declaredParse.ts"

_TABLE_NAMES = ("_ICON_FACE_KEYS", "_MARKER_FACE_KEYS")
_JS_TABLE_NAMES = ("ICON_FACE_KEYS", "MARKER_FACE_KEYS")
_TABLE_PAIRS = {
    "_ICON_FACE_KEYS": "ICON_FACE_KEYS",
    "_MARKER_FACE_KEYS": "MARKER_FACE_KEYS",
}

#: The ECMAScript WhiteSpace + LineTerminator code points (ECMA-262 12.2/12.3):
#: TAB, LF, VT, FF, CR, SP, NBSP, OGHAM SPACE MARK, EN QUAD..HAIR SPACE,
#: LINE/PARAGRAPH SEPARATOR, NARROW NO-BREAK SPACE, MEDIUM MATHEMATICAL SPACE,
#: IDEOGRAPHIC SPACE and the BOM. Kept explicit because Python cannot evaluate
#: the JS host's \s / trim() table.
_JS_WHITESPACE = frozenset(
    {
        0x09,
        0x0A,
        0x0B,
        0x0C,
        0x0D,
        0x20,
        0xA0,
        0x1680,
        0x2028,
        0x2029,
        0x202F,
        0x205F,
        0x3000,
        0xFEFF,
    }
    | set(range(0x2000, 0x200B))
)


def _normalise_newlines(text: str) -> str:
    """The parsers index by line, so a CRLF checkout must read like an LF one:
    the guard compares literals, not the file's line-ending convention."""
    return text.replace("\r\n", "\n").replace("\r", "\n")


def _python_face_source(source: str | None = None) -> str:
    text = source if source is not None else PYTHON_FACE.read_text(encoding="utf-8")
    return _normalise_newlines(text)


def _python_paint_source(source: str | None = None) -> str:
    text = source if source is not None else PYTHON_PAINT.read_text(encoding="utf-8")
    return _normalise_newlines(text)


def _js_source(source: str | None = None) -> str:
    text = source if source is not None else JS_PARSE.read_text(encoding="utf-8")
    return _normalise_newlines(text)


def python_face_tables(
    source: str | None = None,
) -> dict[str, dict[str, tuple[str, ...]]]:
    """The two face vocabularies the Python normaliser ships."""
    tree = ast.parse(_python_face_source(source))
    tables: dict[str, dict[str, tuple[str, ...]]] = {}
    for node in tree.body:
        if not isinstance(node, ast.AnnAssign):
            continue
        target = node.target
        if not isinstance(target, ast.Name) or target.id not in _TABLE_NAMES:
            continue
        if node.value is None:
            continue
        literal = ast.literal_eval(node.value)
        tables[target.id] = {
            str(canonical): tuple(str(spelling) for spelling in accepted)
            for canonical, accepted in literal.items()
        }
    return tables


def js_face_tables(source: str | None = None) -> dict[str, dict[str, tuple[str, ...]]]:
    """The two face vocabularies the JS panel normaliser ships.

    Parsed from the TypeScript literal rather than imported: the tables are
    module-private (no caller outside the reader needs them), and a guard that
    forced an export would trade a real encapsulation for a test hook.
    """
    text = _js_source(source)
    tables: dict[str, dict[str, tuple[str, ...]]] = {}
    for name in _JS_TABLE_NAMES:
        match = re.search(
            rf"const {name}: [^=]+= \{{\n(.*?)\n\}};",
            text,
            re.S,
        )
        assert match is not None, f"{name} table not found in {JS_PARSE}"
        body = match.group(1)
        entries: dict[str, tuple[str, ...]] = {}
        refs: dict[str, str] = {}
        for chunk in re.split(r"\n  \},\n", body + "\n"):
            chunk = chunk.strip()
            if not chunk:
                continue
            head = re.match(r"(\w+): \{(.*)", chunk, re.S)
            if head is not None:
                canonical = head.group(1)
                spellings = re.search(r"spellings: \[([^\]]*)\]", chunk)
                assert spellings is not None, (
                    f"no spellings list for {name}.{canonical}"
                )
                entries[canonical] = tuple(
                    item.strip().strip('"').strip("'")
                    for item in spellings.group(1).split(",")
                    if item.strip()
                )
                continue
            reference = re.match(r"(\w+): (\w+)\.(\w+),$", chunk)
            if reference is not None:
                refs[reference.group(1)] = f"{reference.group(2)}.{reference.group(3)}"
        for canonical, target in refs.items():
            table_name, referenced = target.split(".", 1)
            source_table = tables.get(table_name)
            assert source_table is not None, (
                f"{name}.{canonical} references unknown table {table_name}"
            )
            entries[canonical] = source_table[referenced]
        tables[name] = entries
    return tables


def python_trim_codepoints(source: str | None = None) -> tuple[int, ...]:
    """The explicit whitespace set every declared-string reader trims."""
    tree = ast.parse(_python_paint_source(source))
    for node in tree.body:
        if not isinstance(node, ast.AnnAssign):
            continue
        target = node.target
        if isinstance(target, ast.Name) and target.id == "DECLARED_TRIM_CODEPOINTS":
            assert node.value is not None, "DECLARED_TRIM_CODEPOINTS has no value"
            value = ast.literal_eval(node.value)
            return tuple(int(codepoint) for codepoint in value)
    raise AssertionError(
        "DECLARED_TRIM_CODEPOINTS not found in foliplus/_declaration/paint.py"
    )


def js_trim_codepoints(source: str | None = None) -> tuple[int, ...]:
    """The explicit whitespace set the JS face reader trims."""
    text = _js_source(source)
    match = re.search(
        r"const DECLARED_TRIM_CODEPOINTS: readonly number\[\] = \[(.*?)\];",
        text,
        re.S,
    )
    assert match is not None, "DECLARED_TRIM_CODEPOINTS not found in declaredParse.ts"
    return tuple(
        int(token.strip(), 0) for token in match.group(1).split(",") if token.strip()
    )


def host_strip_calls(source: str) -> list[str]:
    """No-argument .strip() calls (the host default) in a Python source text.

    Walked through the AST so a docstring that mentions str.strip() is not a
    hit - only a real call on the declared-string path is.
    """
    tree = ast.parse(_normalise_newlines(source))
    found: list[str] = []
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "strip"
            and not node.args
        ):
            found.append(f"line {node.lineno}: a no-argument .strip() call")
    return found


def host_trim_in_js_face(text: str) -> list[str]:
    """No-argument .trim() calls inside the JS icon-face table (the colour path)."""
    match = re.search(r"const ICON_FACE_KEYS:.*?\n\};", text, re.S)
    assert match is not None, "ICON_FACE_KEYS table not found"
    return [line.strip() for line in match.group(0).splitlines() if ".trim()" in line]


def test_the_two_stacks_share_one_face_vocabulary() -> None:
    python_tables = python_face_tables()
    js_tables = js_face_tables()
    assert set(python_tables) == set(_TABLE_NAMES), (
        "the Python face module no longer declares both face tables: "
        f"{sorted(python_tables)}"
    )
    for python_name, js_name in _TABLE_PAIRS.items():
        assert python_tables[python_name] == js_tables[js_name], (
            f"face vocabulary drifted between Python ({python_name}) and JS "
            f"({js_name}):\n  python: {python_tables[python_name]}\n  js:     "
            f"{js_tables[js_name]}"
        )


def test_every_face_table_keeps_the_canonical_spelling_first() -> None:
    """A spelling list is canonical-first on both stacks; the first spelling is
    what a warning's accepted list starts with and what the reader emits."""
    for table in python_face_tables().values():
        for canonical, accepted in table.items():
            assert accepted[0] == canonical, (
                f"the Python table for {canonical} starts with {accepted[0]!r}"
            )
    for table in js_face_tables().values():
        for canonical, accepted in table.items():
            assert accepted[0] == canonical, (
                f"the JS table for {canonical} starts with {accepted[0]!r}"
            )


def test_the_two_stacks_trim_the_same_whitespace_set() -> None:
    python_set = python_trim_codepoints()
    js_set = js_trim_codepoints()
    assert python_set == js_set, (
        "the declared-string whitespace set drifted between Python and JS:"
        f"\n  python: {[hex(cp) for cp in python_set]}"
        f"\n  js:     {[hex(cp) for cp in js_set]}"
    )


def test_the_shared_whitespace_set_is_the_host_union() -> None:
    """The set is neither host's default: it is their union, so a declaration is
    accepted identically on both stacks. Python's str.isspace() is computed from
    the running interpreter; the JS table is the ECMAScript spec set."""
    python_isspace = frozenset(
        codepoint for codepoint in range(0x110000) if chr(codepoint).isspace()
    )
    expected = python_isspace | _JS_WHITESPACE
    actual = set(python_trim_codepoints())
    assert actual == expected, (
        "the declared-string whitespace set is not the two hosts' union:"
        f"\n  missing: {sorted(hex(cp) for cp in expected - actual)}"
        f"\n  extra:   {sorted(hex(cp) for cp in actual - expected)}"
    )


def test_the_colour_path_has_no_host_strip() -> None:
    """The shared trim must be the only trim: a second, host-default strip()
    silently accepted spellings outside the shared set on Python alone."""
    paint_text = _python_paint_source()
    face_text = _python_face_source()
    assert host_strip_calls(paint_text) == []
    assert host_strip_calls(face_text) == []
    assert "trim_declared_string(raw)" in paint_text
    assert "trim_declared_string(glyph)" in face_text
    assert "trimDeclaredString(raw)" in _js_source()
    assert host_trim_in_js_face(_js_source()) == []


def test_the_vocabulary_parser_has_teeth() -> None:
    """Mutate the SOURCE text, not the parsed dict: a future relaxation of the
    parser must fail here, not pass quietly."""
    original = js_face_tables()
    mutated = _js_source().replace(
        'spellings: ["glyph"]',
        'spellings: ["glyph", "icon"]',
        1,
    )
    assert mutated != _js_source(), "the teeth mutation did not apply"
    assert js_face_tables(mutated) != original


def test_the_python_trim_parser_has_teeth() -> None:
    original = python_trim_codepoints()
    mutated = _python_paint_source().replace("    0x2003,  # em space\n", "")
    assert mutated != _python_paint_source(), "the teeth mutation did not apply"
    assert python_trim_codepoints(mutated) != original


def test_the_js_trim_parser_has_teeth() -> None:
    original = js_trim_codepoints()
    mutated = _js_source().replace("0x2003,", "0x2004,", 1)
    assert mutated != _js_source(), "the teeth mutation did not apply"
    assert js_trim_codepoints(mutated) != original


def test_the_host_strip_scan_has_teeth() -> None:
    """Put the host strip back into the colour path as text and the scan must
    notice - the guard itself must not be a comment that can never go red."""
    source = _python_paint_source()
    assert host_strip_calls(source) == []
    mutated = source.replace(
        "color = trim_declared_string(raw)",
        "color = raw.strip()",
        1,
    )
    assert mutated != source, "the teeth mutation did not apply"
    assert host_strip_calls(mutated) != []
