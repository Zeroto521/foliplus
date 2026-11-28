"""Guard: the declared-string trim rule is one union set, and every hex reader
is bound to the shared trim.

A face declaration (foliplus={"icon": {...}}) is normalised twice: the Python
declaration channel normalises the author's raw dict, and the JS panel reader
normalises the namespace a rendered map or a hand-built layer carries. Two
literals must stay identical, and the colour path must use one trim:

* the sub-key vocabulary - canonical camelCase key -> accepted spellings
  (foliplus/_declaration/face.py vs
  foliplus/js/control/LayerControl/declaredParse.ts);
* the whitespace a declared string is trimmed of, as explicit code points
  (DECLARED_TRIM_CODEPOINTS in foliplus/_declaration/paint.py and in
  foliplus/js/control/LayerControl/declaredTrim.ts). The set is the UNION of
  Python's str.isspace() and JavaScript's WhiteSpace/LineTerminator sets: the
  hosts disagree on U+001C-U+001F / U+0085 / U+FEFF, and an author pasting from
  rich text or CJK input brings U+2000-U+200A, U+2028/U+2029, U+202F, U+205F,
  U+3000. A union is the only set that makes one declaration mean the same
  thing on both stacks;
* no host trim remains on the colour path. The Python _declared_hex used to
  follow the shared trim with its own raw.strip(); this guard walks paint.py /
  face.py / marker.py with the AST and fails on a no-argument .strip() call;
* every hex read (isHexColor(...)) in declaredParse.ts (border colour, icon
  colour, marker_color) and declaredFill.ts (fill colour) binds its argument
  through trimDeclaredString. This is checked as a BINDING, not a text window:
  comments are stripped and the argument identifier is resolved to its own
  const/let initialiser inside the same top-level scope, so a comment that
  merely mentions the trim does not satisfy the guard, and a trim assigned
  several statements earlier (or inline isHexColor(trimDeclaredString(x)))
  does.

Only comments used to keep the two tables in step, and comments are exactly the
drift mechanism this repo has paid for before. The teeth tests drive the
parsers with mutated source text (not mutated parsed dicts), so the parser
itself is proven to notice - including the two false results a text-window
heuristic produced (a comment green-washing an untrimmed read, and a legal
multi-statement trim being reported red).
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PYTHON_FACE = ROOT / "foliplus" / "_declaration" / "face.py"
PYTHON_PAINT = ROOT / "foliplus" / "_declaration" / "paint.py"
PYTHON_MARKER = ROOT / "foliplus" / "_declaration" / "marker.py"
JS_PARSE = ROOT / "foliplus" / "js" / "control" / "LayerControl" / "declaredParse.ts"
JS_FILL = ROOT / "foliplus" / "js" / "control" / "LayerControl" / "declaredFill.ts"
JS_TRIM = ROOT / "foliplus" / "js" / "control" / "LayerControl" / "declaredTrim.ts"

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
#: the JS host's whitespace table.
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

#: A TS source line that opens a top-level declaration scope; used as the
#: boundary for identifier-binding resolution (an assignment is only visible to
#: hex reads in its own scope).
_TOP_LEVEL_DECL = re.compile(
    r"^(?:export\s+)?(?:async\s+)?(?:"
    r"function\s+\w+|const\s+\w+\s*=|let\s+\w+\s*=|type\s+\w+\s*="
    r"|interface\s+\w+|class\s+\w+)",
    re.M,
)
#: A simple const/let initialiser. The hex readers use short, semicolon-free
#: right-hand sides (ternary + call), which is all this needs to resolve.
_JS_ASSIGN = re.compile(r"\b(?:const|let|var)\s+(\w+)\s*=\s*([^;]*);", re.S)


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


def _python_marker_source(source: str | None = None) -> str:
    text = source if source is not None else PYTHON_MARKER.read_text(encoding="utf-8")
    return _normalise_newlines(text)


def _js_source(source: str | None = None) -> str:
    text = source if source is not None else JS_PARSE.read_text(encoding="utf-8")
    return _normalise_newlines(text)


def _js_fill_source(source: str | None = None) -> str:
    text = source if source is not None else JS_FILL.read_text(encoding="utf-8")
    return _normalise_newlines(text)


def _js_trim_source(source: str | None = None) -> str:
    text = source if source is not None else JS_TRIM.read_text(encoding="utf-8")
    return _normalise_newlines(text)


def strip_ts_comments(source: str) -> str:
    """Remove // and /* */ comments, keeping string/template contents intact.

    A guard that scans raw text cannot tell a real call from a sentence in a
    comment; the review proved both failure modes (a comment green-washing an
    untrimmed read, a JSDoc line reported as a .trim() call). Everything below
    analyses the stripped text.
    """
    out: list[str] = []
    index = 0
    length = len(source)
    quote: str | None = None
    while index < length:
        char = source[index]
        if quote is not None:
            out.append(char)
            if char == "\\" and index + 1 < length:
                out.append(source[index + 1])
                index += 2
                continue
            if char == quote:
                quote = None
            index += 1
            continue
        if char in ('"', "'", "\u0060"):
            quote = char
            out.append(char)
            index += 1
            continue
        if source.startswith("//", index):
            end = source.find("\n", index)
            index = length if end < 0 else end
            continue
        if source.startswith("/*", index):
            end = source.find("*/", index + 2)
            index = length if end < 0 else end + 2
            continue
        out.append(char)
        index += 1
    return "".join(out)


def _top_level_spans(text: str) -> list[tuple[int, int]]:
    """The [start, end) ranges of the file's top-level declarations."""
    starts = [match.start() for match in _TOP_LEVEL_DECL.finditer(text)]
    return [
        (start, starts[position + 1] if position + 1 < len(starts) else len(text))
        for position, start in enumerate(starts)
    ]


def _iter_hex_calls(text: str):
    """Yield (offset, argument) for every isHexColor(...) call, balanced."""
    marker = "isHexColor("
    position = text.find(marker)
    while position >= 0:
        open_paren = position + len(marker) - 1
        depth = 0
        cursor = open_paren
        while cursor < len(text):
            if text[cursor] == "(":
                depth += 1
            elif text[cursor] == ")":
                depth -= 1
                if depth == 0:
                    break
            cursor += 1
        yield position, text[open_paren + 1 : cursor]
        position = text.find(marker, cursor)


def untrimmed_hex_reads(source: str) -> list[str]:
    """Hex reads whose validated value was not produced by the shared trim.

    A bare isHexColor(x) is a one-stack decision unless x was produced by
    trimDeclaredString first. The argument is resolved as a binding: either
    inline (isHexColor(trimDeclaredString(x))) or through a const/let
    initialiser for the same identifier inside the same top-level scope.
    Non-hex string channels (field names, folder names) are out of scope: their
    whitespace is semantic, not decorative.
    """
    text = strip_ts_comments(_normalise_newlines(source))
    problems: list[str] = []
    for start, end in _top_level_spans(text):
        chunk = text[start:end]
        initialisers: dict[str, str] = {}
        for match in _JS_ASSIGN.finditer(chunk):
            initialisers.setdefault(match.group(1), match.group(2))
        for offset, raw_argument in _iter_hex_calls(chunk):
            argument = raw_argument.strip()
            if "trimDeclaredString(" in argument:
                continue
            if re.fullmatch(r"\w+(?:\.\w+)*", argument):
                identifier = argument.split(".")[0]
                initialiser = initialisers.get(identifier)
                if initialiser is not None and "trimDeclaredString(" in initialiser:
                    continue
            line = text.count("\n", 0, start + offset) + 1
            problems.append(
                f"line {line}: isHexColor({argument}) is not bound to trimDeclaredString"
            )
    return problems


def host_strip_calls(source: str) -> list[str]:
    """No-argument .strip() calls (the host default) in a Python source text.

    Walked through the AST so a docstring that mentions the host strip is not a
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


def host_trim_in_js(text: str) -> list[str]:
    """Real no-argument .trim() calls in a TS source text (comments stripped).

    A hex reader must route through trimDeclaredString; a bare trim() is the
    host default that disagrees with Python on U+001C-U+001F / U+0085 / U+FEFF.
    trimDeclaredString itself lives in declaredTrim.ts and is exempt.
    """
    stripped = strip_ts_comments(text)
    return [
        line.strip() for line in stripped.splitlines() if re.search(r"\.trim\(\)", line)
    ]


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


def js_face_tables(
    source: str | None = None,
) -> dict[str, dict[str, tuple[str, ...]]]:
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
                    item.strip().strip(chr(34)).strip(chr(39))
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
    """The explicit whitespace set the JS declared-string reader trims."""
    text = _js_trim_source(source)
    match = re.search(
        r"const DECLARED_TRIM_CODEPOINTS: readonly number\[\] = \[(.*?)\];",
        text,
        re.S,
    )
    assert match is not None, "DECLARED_TRIM_CODEPOINTS not found in declaredTrim.ts"
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
        "the declared-string whitespace set drifted between Python and JS:"
        f"\n  python: {[hex(cp) for cp in python_set]}"
        f"\n  js:     {[hex(cp) for cp in js_set]}"
    )


def test_the_shared_whitespace_set_is_the_host_union() -> None:
    """The set is neither host's default: it is their union, so a declaration
    is accepted identically on both stacks. Python's str.isspace() is computed
    from the running interpreter; the JS table is the ECMAScript spec set."""
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
    marker_text = _python_marker_source()
    assert host_strip_calls(paint_text) == []
    assert host_strip_calls(face_text) == []
    assert host_strip_calls(marker_text) == []
    assert "trim_declared_string(raw)" in paint_text
    assert "trim_declared_string(glyph)" in face_text
    assert "trim_declared_string(raw)" in marker_text
    assert "trimDeclaredString(raw)" in _js_source()
    assert host_trim_in_js(_js_source()) == []


def test_the_fill_name_channel_keeps_its_host_trim_on_purpose() -> None:
    """declaredFill.ts has ONE deliberate host trim: the empty-check for the
    non-hex name channels (role/folder names). Their whitespace is semantic -
    the value is tested for emptiness but stored as written - so they are
    exempt; a hex reader that adds a trim of its own has no such excuse."""
    stripped = strip_ts_comments(_js_fill_source())
    host_trims = [
        line.strip() for line in stripped.splitlines() if re.search(r"\.trim\(\)", line)
    ]
    assert len(host_trims) == 1, (
        "declaredFill.ts should keep exactly one intentional host trim (the "
        f"non-hex name empty-check), found: {host_trims}"
    )
    assert "value.trim().length > 0" in host_trims[0]


def test_every_hex_reader_trims_with_the_shared_function() -> None:
    """Python trims every colour before its hex regex (_declared_hex); the JS
    readers of border / fill / marker_color / icon colour must bind their hex
    argument through the SAME function, or a padded colour is accepted on one
    stack only."""
    trim_text = _js_trim_source()
    assert "export { trimDeclaredString }" in trim_text
    assert untrimmed_hex_reads(_js_source()) == []
    assert untrimmed_hex_reads(_js_fill_source()) == []


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
    mutated = _js_trim_source().replace("0x2003,", "0x2004,", 1)
    assert mutated != _js_trim_source(), "the teeth mutation did not apply"
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


def test_the_hex_reader_trim_scan_has_teeth() -> None:
    """Removing the shared trim from a JS hex reader must turn this guard red."""
    fill_text = _js_fill_source()
    assert untrimmed_hex_reads(fill_text) == []
    mutated = fill_text.replace("trimDeclaredString(data.color)", "data.color", 1)
    assert mutated != fill_text, "the teeth mutation did not apply"
    assert untrimmed_hex_reads(mutated) != []


def test_a_comment_cannot_satisfy_the_hex_reader_guard() -> None:
    """The previous text-window heuristic returned [] for a comment that merely
    mentioned trimDeclaredString next to an untrimmed isHexColor read."""
    source = """const readBorder = (data: { color: unknown }) => {
  // trimDeclaredString(data.color) is applied by the caller
  if (isHexColor(data.color)) return data.color;
  return null;
};
"""
    assert untrimmed_hex_reads(source) != []


def test_a_distant_trim_binding_satisfies_the_hex_reader_guard() -> None:
    """The previous heuristic reported a legal trim as red when the assignment
    sat across blank lines / other statements from the hex read."""
    source = """const readBorder = (data: { color: string }) => {
  const padded = "  " + data.color + "  ";
  const trimmedColor = trimDeclaredString(padded);
  const untouched = "not the colour";
  const weight = 2;
  const mode = "solid";

  if (isHexColor(trimmedColor)) return trimmedColor;
  return null;
};
"""
    assert untrimmed_hex_reads(source) == []


def test_the_js_host_trim_scan_ignores_comments() -> None:
    """A JSDoc line that mentions a host trim is documentation, not a call."""
    source = """/**
 * Never call .trim() on a declared value; use trimDeclaredString.
 */
const read = (value: string) => value;
"""
    assert host_trim_in_js(source) == []
    assert host_trim_in_js("const x = value.trim();") != []


def test_the_marker_host_strip_scan_has_teeth() -> None:
    source = _python_marker_source()
    assert host_strip_calls(source) == []
    mutated = source.replace("trim_declared_string(raw)", "raw.strip()", 1)
    assert mutated != source, "the teeth mutation did not apply"
    assert host_strip_calls(mutated) != []
