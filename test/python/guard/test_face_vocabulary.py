"""Guard: the face channel's two hand-mirrored rules agree on both stacks.

A face declaration (foliplus={"icon": {...}}) is normalised twice: the Python
declaration channel normalises the author's raw dict, and the JS panel reader
normalises the namespace a rendered map or a hand-built layer carries. Two
rules are stated as literals on both sides and must stay identical:

* the sub-key vocabulary - canonical camelCase key -> accepted spellings
  (foliplus/_declaration/face.py vs
  foliplus/js/control/LayerControl/declaredParse.ts);
* the whitespace a declared face string is trimmed of, as explicit code points
  (FACE_TRIM_CODEPOINTS on both sides). An explicit set matters because the
  host defaults disagree: Python's str.strip() strips U+001C-U+001F / U+0085
  that JavaScript's trim() keeps, and trim() drops U+FEFF (a BOM pasted from a
  CSV) that str.strip() keeps.

Only comments used to keep the two tables in step, and comments are exactly the
drift mechanism this repo has paid for before. This guard makes the contract
executable, and its teeth tests drive the parsers with mutated source text (not
mutated parsed dicts), so the parser itself is proven to notice.

The value rules are pinned by the two suites (trim, first occurrence wins, null
is declared-but-unusable on both sides). This module guards the shared
literals.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PYTHON_FACE = ROOT / "foliplus" / "_declaration" / "face.py"
JS_PARSE = ROOT / "foliplus" / "js" / "control" / "LayerControl" / "declaredParse.ts"

_TABLE_NAMES = ("_ICON_FACE_KEYS", "_MARKER_FACE_KEYS")
_JS_TABLE_NAMES = ("ICON_FACE_KEYS", "MARKER_FACE_KEYS")
_TABLE_PAIRS = {
    "_ICON_FACE_KEYS": "ICON_FACE_KEYS",
    "_MARKER_FACE_KEYS": "MARKER_FACE_KEYS",
}


def _normalise_newlines(text: str) -> str:
    """The parsers index by line, so a CRLF checkout must read like an LF one:
    the guard compares literals, not the file's line-ending convention."""
    return text.replace("\r\n", "\n").replace("\r", "\n")


def _python_source(source: str | None = None) -> str:
    text = source if source is not None else PYTHON_FACE.read_text(encoding="utf-8")
    return _normalise_newlines(text)


def _js_source(source: str | None = None) -> str:
    text = source if source is not None else JS_PARSE.read_text(encoding="utf-8")
    return _normalise_newlines(text)


def python_face_tables(
    source: str | None = None,
) -> dict[str, dict[str, tuple[str, ...]]]:
    """The two face vocabularies the Python normaliser ships."""
    tree = ast.parse(_python_source(source))
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
    references: dict[str, dict[str, str]] = {}
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
    """The explicit whitespace set the Python face normaliser trims."""
    tree = ast.parse(_python_source(source))
    for node in tree.body:
        if not isinstance(node, ast.AnnAssign):
            continue
        target = node.target
        if isinstance(target, ast.Name) and target.id == "FACE_TRIM_CODEPOINTS":
            assert node.value is not None, "FACE_TRIM_CODEPOINTS has no value"
            value = ast.literal_eval(node.value)
            return tuple(int(codepoint) for codepoint in value)
    raise AssertionError(
        "FACE_TRIM_CODEPOINTS not found in foliplus/_declaration/face.py"
    )


def js_trim_codepoints(source: str | None = None) -> tuple[int, ...]:
    """The explicit whitespace set the JS face reader trims."""
    text = _js_source(source)
    match = re.search(
        r"const FACE_TRIM_CODEPOINTS: readonly number\[\] = \[(.*?)\];",
        text,
        re.S,
    )
    assert match is not None, "FACE_TRIM_CODEPOINTS not found in declaredParse.ts"
    return tuple(
        int(token.strip(), 0) for token in match.group(1).split(",") if token.strip()
    )


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
        "the face whitespace set drifted between Python and JS:"
        f"\n  python: {[hex(cp) for cp in python_set]}"
        f"\n  js:     {[hex(cp) for cp in js_set]}"
    )
    # The set must cover both hosts' defaults, or the shared set is pointless:
    # U+001C-U+001F / U+0085 are the Python-only extras and U+FEFF the JS-only one.
    for codepoint in (0x1C, 0x1D, 0x1E, 0x1F, 0x85, 0xFEFF):
        assert codepoint in python_set, (
            f"the shared whitespace set is missing {hex(codepoint)}"
        )


def test_both_stacks_use_the_shared_set_instead_of_the_host_default() -> None:
    """A literal nothing calls is worse than no literal: the normalisers must
    route their trimming through the shared set, not str.strip() / trim()."""
    python_text = _python_source()
    js_text = _js_source()
    assert "_trim_face_string(glyph)" in python_text
    assert "_trim_face_string(color)" in python_text
    assert "glyph.strip()" not in python_text, (
        "face.py falls back to str.strip() for the glyph; use _trim_face_string"
    )
    assert 'const glyph = typeof raw === "string" ? trimFaceString(raw)' in js_text
    assert 'const color = typeof raw === "string" ? trimFaceString(raw)' in js_text


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
    mutated = _python_source().replace(
        "    0xFEFF,  # zero-width no-break space (BOM)\n", ""
    )
    assert mutated != _python_source(), "the teeth mutation did not apply"
    assert python_trim_codepoints(mutated) != original


def test_the_js_trim_parser_has_teeth() -> None:
    original = js_trim_codepoints()
    mutated = _js_source().replace("0xfeff", "0xfe", 1)
    assert mutated != _js_source(), "the teeth mutation did not apply"
    assert js_trim_codepoints(mutated) != original
