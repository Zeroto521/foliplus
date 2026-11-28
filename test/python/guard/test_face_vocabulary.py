"""Guard: the face sub-key vocabulary is ONE table, mirrored on both stacks.

A face declaration (`foliplus={"icon": {...}}`) is normalised twice: the Python
declaration channel normalises the author's raw dict, and the JS panel reader
normalises the namespace a rendered map or a hand-built layer carries. Both
sides own a table of canonical sub-key -> accepted spellings
(`foliplus/_declaration/face.py` and
`foliplus/js/control/LayerControl/declaredParse.ts`). Only the Python table is
generated from a single literal per face, but the JS table is hand-written, and
"KEEP IN STEP" comments are exactly the drift mechanism this repo has paid for
before (see the fill/border hex regex comment). This guard makes the contract
executable: the two tables must be identical, canonical spelling first.

The value rules are pinned by the two suites (a padded string is trimmed on
both sides; the first spelling of a duplicated key decides even when its value
is unusable). This module guards the vocabulary itself, which is what an
unknown sub-key warning is derived from - if one stack learns a new spelling,
the other must learn it in the same commit or a declaration that works in
Python is dead in the panel.
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


def _python_tables() -> dict[str, dict[str, tuple[str, ...]]]:
    """The two face vocabularies the Python normaliser ships."""
    tree = ast.parse(PYTHON_FACE.read_text(encoding="utf-8"))
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


def _js_tables() -> dict[str, dict[str, tuple[str, ...]]]:
    """The two face vocabularies the JS panel normaliser ships.

    Parsed from the TypeScript literal rather than imported: the tables are
    module-private (no caller outside the reader needs them), and a guard that
    forced an export would trade a real encapsulation for a test hook.
    """
    source = JS_PARSE.read_text(encoding="utf-8")
    tables: dict[str, dict[str, tuple[str, ...]]] = {}
    references: dict[str, dict[str, str]] = {}
    for name in _JS_TABLE_NAMES:
        match = re.search(
            rf"const {name}: [^=]+= {{\n(.*?)\n\}};",
            source,
            re.S,
        )
        assert match is not None, f"{name} table not found in {JS_PARSE}"
        body = match.group(1)
        entries: dict[str, tuple[str, ...]] = {}
        refs: dict[str, str] = {}
        chunks = re.split(r"\n  \},\n", body + "\n")
        for chunk in chunks:
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


def test_the_two_stacks_share_one_face_vocabulary() -> None:
    python_tables = _python_tables()
    js_tables = _js_tables()
    assert set(python_tables) == set(_TABLE_NAMES), (
        "the Python face module no longer declares both face tables: "
        f"{sorted(python_tables)}"
    )
    pairs = {
        "_ICON_FACE_KEYS": "ICON_FACE_KEYS",
        "_MARKER_FACE_KEYS": "MARKER_FACE_KEYS",
    }
    for python_name, js_name in pairs.items():
        assert python_tables[python_name] == js_tables[js_name], (
            f"face vocabulary drifted between Python ({python_name}) and JS "
            f"({js_name}):\n  python: {python_tables[python_name]}\n  js:     "
            f"{js_tables[js_name]}"
        )


def test_every_face_table_keeps_the_canonical_spelling_first() -> None:
    """A spelling list is canonical-first on both stacks; the first spelling is
    what a warning's accepted list starts with and what the reader emits."""
    for table in _python_tables().values():
        for canonical, accepted in table.items():
            assert accepted[0] == canonical, (
                f"the Python table for {canonical} starts with {accepted[0]!r}"
            )
    for table in _js_tables().values():
        for canonical, accepted in table.items():
            assert accepted[0] == canonical, (
                f"the JS table for {canonical} starts with {accepted[0]!r}"
            )


def test_the_guard_has_teeth() -> None:
    """A drifted table must turn the guard red: mutate the parsed JS table and
    assert the comparison notices, so a later relaxation cannot pass silently."""
    python_tables = _python_tables()
    drifted = _js_tables()
    drifted["ICON_FACE_KEYS"]["glyph"] = ("glyph", "icon")
    assert python_tables["_ICON_FACE_KEYS"] != drifted["ICON_FACE_KEYS"]
