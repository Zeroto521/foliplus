#!/usr/bin/env python3
"""Detect dead barrel/type exports with zero consumers repo-wide.

Scans ``foliplus/js/**/index.ts`` and ``foliplus/js/**/type.ts`` for every
export (named re-export, star re-export, ``export type { ... }``, and inline
definitions), builds a ``(file, symbol)`` dependency graph across all ``.ts``
files, and reports exports that have no reachable consumer.

A consumer is a file that **imports** the symbol (not just re-exports it) and
is a real code file, test file, or referenced by Python. Barrel chains
(``core/layer/index.ts`` → ``core/index.ts`` → real code) are resolved via
BFS reachability to a terminal consumer.

Exemptions (hard-coded — Python Jinja loads these at runtime):
- 8 IIFE component entry ``index.ts`` files (contain ``new XxxControl(...)``)
- ``config-schema.ts`` (Python ``_config_schema.py`` reads it)

Usage (called by pre-commit with ``pass_filenames: false``):
    python script/check/dead_barrel_export.py
"""

from __future__ import annotations

import builtins
import keyword
import os
import re
import sys
from collections import defaultdict, deque
from pathlib import Path

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]

# Directories to scan for .ts files (graph construction).
TS_SCAN_DIRS = ("foliplus/js", "test/js")
# Python directory for symbol string references.
PY_SCAN_DIR = "foliplus"

# Hard-coded exemptions.
CONFIG_SCHEMA = "foliplus/js/config-schema.ts"

# IIFE entry detection: ``new XxxControl(...)`` at the file bottom.
IIFE_ENTRY_RE = re.compile(r"new\s+\w+Control\s*\(")

# ---------------------------------------------------------------------------
# Regex patterns for parsing TS imports/exports
# ---------------------------------------------------------------------------

# Named import: `import { X, Y as Z } from "./g.js"` (with optional `type`)
IMPORT_NAMED_RE = re.compile(
    r'import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["\']([^"\']+)["\'];?',
    re.MULTILINE | re.DOTALL,
)
# Star import: `import * as ns from "./g.js"`
IMPORT_STAR_RE = re.compile(
    r'import\s+\*\s+as\s+\w+\s+from\s+["\']([^"\']+)["\'];?',
    re.MULTILINE | re.DOTALL,
)
# Default import: `import X from "./g.js"`
IMPORT_DEFAULT_RE = re.compile(
    r'import\s+(?!type\b)(?!type\s*\{)(\w+)\s+from\s+["\']([^"\']+)["\'];?',
    re.MULTILINE,
)

# Named re-export: `export { X, Y as Z } from "./g.js"` (with optional `type`)
EXPORT_RE_EXPORT_RE = re.compile(
    r'export\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["\']([^"\']+)["\'];?',
    re.MULTILINE | re.DOTALL,
)
# Star re-export: `export * from "./g.js"`
EXPORT_STAR_RE = re.compile(
    r'export\s+\*\s+from\s+["\']([^"\']+)["\'];?',
    re.MULTILINE | re.DOTALL,
)
# Named export (no `from`): `export { X, Y }` or `export type { X }`
EXPORT_NAMED_RE = re.compile(
    r"export\s+(?:type\s+)?\{([^}]+)\}\s*(?!\s*from)",
    re.MULTILINE | re.DOTALL,
)
# Inline export: `export const X`, `export function X`, `export class X`,
# `export interface X`, `export type X`, `export enum X`
INLINE_EXPORT_RE = re.compile(
    r"export\s+(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)",
    re.MULTILINE,
)

# ---------------------------------------------------------------------------
# Comment / string stripping for parsing
# ---------------------------------------------------------------------------


def strip_for_parsing(text: str) -> str:
    """Strip comments only (preserve string contents for import paths).

    Preserves newlines so line numbers survive. Strings are kept verbatim
    so import/export specifiers (``"./g.js"``) remain parseable.
    """
    result: list[str] = []
    i = 0
    n = len(text)
    in_block = False
    in_string: str | None = None
    while i < n:
        c = text[i]
        if in_block:
            if c == "*" and i + 1 < n and text[i + 1] == "/":
                result.append("  ")
                i += 2
                in_block = False
            else:
                result.append("\n" if c == "\n" else " ")
                i += 1
            continue
        if in_string:
            result.append(c)
            if c == "\\" and i + 1 < n:
                result.append(text[i + 1])
                i += 2
                continue
            if c == in_string:
                in_string = None
            i += 1
            continue
        if c in "\"'`":
            in_string = c
            result.append(c)
            i += 1
            continue
        if c == "/" and i + 1 < n:
            if text[i + 1] == "/":
                # Replace line comment with spaces (preserve length for offsets).
                result.append("  ")
                i += 2
                while i < n and text[i] != "\n":
                    result.append(" ")
                    i += 1
                # Preserve the newline so line numbers survive.
                if i < n:
                    result.append("\n")
                    i += 1
                continue
            if text[i + 1] == "*":
                result.append("  ")
                i += 2
                in_block = True
                continue
        result.append(c)
        i += 1
    return "".join(result)


# ---------------------------------------------------------------------------
# File analysis
# ---------------------------------------------------------------------------

# Per-file analysis result.
# exports: set of symbol names this file exports (defined or re-exported)
# exports_by_line: dict of symbol name → (line_no, export_kind)
#   export_kind: "define" | "re-export" | "star-re-export"
# named_imports: dict of symbol → (source_file, original_symbol)
#   original_symbol is the source-side name (differs from local on alias)
# star_imports: set of source files (import * as ns from ...)
# named_re_exports: dict of local_symbol → (source_file, source_symbol)
# star_re_exports: set of source files
# imports_any: set of all locally-imported symbol names (named + default)
# is_pure_barrel: True if file has only imports and re-exports (no code)
# is_iife_entry: True if file contains `new XxxControl(`
# is_test_file: True if in test/js/ or test/python/
# is_exempt: True if config-schema.ts


class FileAnalysis:
    __slots__ = (
        "filepath",
        "exports",
        "exports_by_line",
        "named_imports",
        "star_imports",
        "named_re_exports",
        "star_re_exports",
        "star_reexport_lines",
        "imports_any",
        "is_pure_barrel",
        "is_iife_entry",
        "is_test_file",
        "is_exempt",
        "is_barrel_scope",
    )

    def __init__(self, filepath: str):
        self.filepath = filepath
        self.exports: set[str] = set()
        # symbol → (lineno, kind) where kind ∈ {"define", "re-export", "star-re-export"}
        self.exports_by_line: dict[str, tuple[int, str]] = {}
        # local_symbol → (source_file, source_symbol)
        self.named_imports: dict[str, tuple[str, str]] = {}
        self.star_imports: set[str] = set()
        # local_symbol → (source_file, source_symbol)
        self.named_re_exports: dict[str, tuple[str, str]] = {}
        self.star_re_exports: set[str] = set()
        # source_file → lineno (for reporting star-reexported symbols)
        self.star_reexport_lines: dict[str, int] = {}
        # All locally-imported symbol names (for sink detection)
        self.imports_any: set[str] = set()
        self.is_pure_barrel = True
        self.is_iife_entry = False
        self.is_test_file = False
        self.is_exempt = False
        # Whether this file is in the barrel scan scope (index.ts or type.ts)
        self.is_barrel_scope = False


def _parse_symbol_list(text: str) -> list[tuple[str, str]]:
    """Parse a symbol list from ``{ X, Y as Z }`` → ``[(X, X), (Z, Y)]``.

    Returns list of (local_name, source_name) pairs.
    """
    pairs: list[tuple[str, str]] = []
    for part in text.split(","):
        part = part.strip()
        if not part:
            continue
        # Handle `type X` (inline type qualifier in named export)
        if part.startswith("type "):
            part = part[5:].strip()
        if " as " in part:
            source, local = [s.strip() for s in part.split(" as ", 1)]
            pairs.append((local, source))
        else:
            pairs.append((part, part))
    return pairs


def _line_of_offset(text: str, offset: int) -> int:
    """Return 1-based line number of an offset in text."""
    return text.count("\n", 0, offset) + 1


def parse_file(filepath: str, text: str, repo_root: str) -> FileAnalysis:
    """Parse a .ts file into a FileAnalysis."""
    fa = FileAnalysis(filepath)

    # Detect IIFE entry, test file, exempt file, barrel scope
    fa.is_iife_entry = bool(IIFE_ENTRY_RE.search(text))
    rel = os.path.relpath(filepath, repo_root).replace(os.sep, "/")
    fa.is_test_file = rel.startswith("test/js/") or rel.startswith("test/python/")
    fa.is_exempt = rel == CONFIG_SCHEMA
    fa.is_barrel_scope = (
        rel in ("index.ts", "type.ts", "types.ts")
        or rel.endswith("/index.ts")
        or rel.endswith("/type.ts")
        or rel.endswith("/types.ts")
    )

    # Check if file is a pure barrel (only imports and re-exports)
    code = strip_for_parsing(text)

    # Remove import/export lines to check remaining code
    remaining = re.sub(
        r'import\s+(?:[^;]*|"[^"]*"|\'[^\']*\');?\s*',
        "",
        code,
        flags=re.MULTILINE | re.DOTALL,
    )
    remaining = re.sub(
        r'export\s+(?:\*|[^;]*|"[^"]*"|\'[^\']*\');?\s*',
        "",
        remaining,
        flags=re.MULTILINE | re.DOTALL,
    )
    remaining = re.sub(r"import\s", "", remaining)
    remaining = re.sub(r"export\s", "", remaining)
    remaining = re.sub(r"\s+", " ", remaining).strip()
    # A pure barrel has no remaining code
    fa.is_pure_barrel = remaining == ""

    # Parse named imports
    for m in IMPORT_NAMED_RE.finditer(code):
        symbols_text = m.group(1)
        specifier = m.group(2)
        source = _resolve_import(filepath, specifier, repo_root)
        if source is None:
            continue
        for local, source_sym in _parse_symbol_list(symbols_text):
            fa.named_imports[local] = (source, source_sym)
            fa.imports_any.add(local)

    # Parse star imports
    for m in IMPORT_STAR_RE.finditer(code):
        specifier = m.group(1)
        source = _resolve_import(filepath, specifier, repo_root)
        if source:
            fa.star_imports.add(source)

    # Parse default imports
    for m in IMPORT_DEFAULT_RE.finditer(code):
        local = m.group(1)
        specifier = m.group(2)
        source = _resolve_import(filepath, specifier, repo_root)
        if source:
            fa.named_imports[local] = (source, "default")
            fa.imports_any.add(local)

    # Parse named re-exports
    for m in EXPORT_RE_EXPORT_RE.finditer(code):
        symbols_text = m.group(1)
        specifier = m.group(2)
        source = _resolve_import(filepath, specifier, repo_root)
        if source is None:
            continue
        for local, source_sym in _parse_symbol_list(symbols_text):
            fa.named_re_exports[local] = (source, source_sym)
            fa.exports.add(local)
            if local not in fa.exports_by_line:
                fa.exports_by_line[local] = (
                    _line_of_offset(text, m.start()),
                    "re-export",
                )

    # Parse star re-exports
    for m in EXPORT_STAR_RE.finditer(code):
        specifier = m.group(1)
        source = _resolve_import(filepath, specifier, repo_root)
        if source:
            fa.star_re_exports.add(source)
            fa.star_reexport_lines[source] = _line_of_offset(text, m.start())

    # Parse named exports (no `from`)
    for m in EXPORT_NAMED_RE.finditer(code):
        symbols_text = m.group(1)
        for local, _ in _parse_symbol_list(symbols_text):
            fa.exports.add(local)
            if local not in fa.exports_by_line:
                fa.exports_by_line[local] = (
                    _line_of_offset(text, m.start()),
                    "define",
                )

    # Parse inline exports
    for m in INLINE_EXPORT_RE.finditer(code):
        sym = m.group(1)
        fa.exports.add(sym)
        if sym not in fa.exports_by_line:
            fa.exports_by_line[sym] = (
                _line_of_offset(text, m.start()),
                "define",
            )

    return fa


def _resolve_import(from_file: str, specifier: str, repo_root: str) -> str | None:
    """Resolve an import specifier to an absolute file path.

    Handles:
    - Relative paths: ``./x.js``, ``../x.js``
    - Path aliases: ``#common/x.js``, ``#core/x.js``, ``#foliplus/x.js``
    - Extension: ``.js`` → ``.ts``
    - Directory: ``./x.js`` → ``./x/index.ts`` if x is a directory
    """
    if specifier.startswith("#common/"):
        base = os.path.join(repo_root, "foliplus/js/common")
        spec = specifier[len("#common/") :]
    elif specifier.startswith("#core/"):
        base = os.path.join(repo_root, "foliplus/js/core")
        spec = specifier[len("#core/") :]
    elif specifier.startswith("#foliplus/"):
        base = os.path.join(repo_root, "foliplus/js")
        spec = specifier[len("#foliplus/") :]
    elif specifier.startswith("#script/"):
        base = os.path.join(repo_root, "script")
        spec = specifier[len("#script/") :]
    elif specifier.startswith("./") or specifier.startswith("../"):
        base = os.path.dirname(from_file)
        spec = specifier
    else:
        return None  # External module (e.g., "leaflet", "lodash")

    # Resolve the path
    full_path = os.path.normpath(os.path.join(base, spec))

    # Try .ts extension (strip .js if present)
    if full_path.endswith(".js"):
        full_path = full_path[:-3]

    # Try direct .ts file
    ts_path = full_path + ".ts"
    if os.path.isfile(ts_path):
        return os.path.normpath(ts_path)

    # Try /index.ts (directory import)
    index_path = os.path.join(full_path, "index.ts")
    if os.path.isfile(index_path):
        return os.path.normpath(index_path)

    return None


# ---------------------------------------------------------------------------
# Graph construction
# ---------------------------------------------------------------------------


def find_ts_files(repo_root: str) -> set[str]:
    """Find all .ts files in the scan directories."""
    files: set[str] = set()
    for subdir in TS_SCAN_DIRS:
        path = os.path.join(repo_root, *subdir.split("/"))
        if os.path.isdir(path):
            for root, _dirs, filenames in os.walk(path):
                for fn in filenames:
                    if fn.endswith(".ts"):
                        files.add(os.path.join(root, fn))
    return files


def find_python_files(repo_root: str) -> set[str]:
    """Find all .py files in the foliplus/ directory."""
    files: set[str] = set()
    path = os.path.join(repo_root, PY_SCAN_DIR)
    if os.path.isdir(path):
        for fn in os.listdir(path):
            if fn.endswith(".py"):
                files.add(os.path.join(path, fn))
    return files


def collect_python_references(
    python_files: set[str],
) -> set[str]:
    """Collect symbol names referenced as strings in Python files.

    Crude heuristic: any TS identifier that appears as a whole word in a
    Python file is considered a reference. False positives are acceptable
    (they only prevent false negatives). Filters out short names (1-2 chars)
    and Python keywords/builtins to reduce noise — the stdlib set replaces a
    hand-maintained list that drifted (dupes, and builtins like ``eval`` /
    ``exec`` were missing).
    """
    _PY_KEYWORDS: frozenset[str] = frozenset(keyword.kwlist) | frozenset(dir(builtins))
    refs: set[str] = set()
    for pyfile in python_files:
        try:
            with open(pyfile, encoding="utf-8") as f:
                text = f.read()
        except OSError:
            continue
        for m in re.finditer(r"\b[A-Za-z_$][\w$]*\b", text):
            token = m.group(0)
            if len(token) >= 3 and token not in _PY_KEYWORDS:
                refs.add(token)
    return refs


def build_graph(
    analyses: dict[str, FileAnalysis],
    repo_root: str,
) -> dict[tuple[str, str], list[tuple[str, str]]]:
    """Build the dependency graph: (source_file, source_symbol) → [(dest_file, dest_symbol), ...].

    Edges represent "source provides symbol to dest":
    - Import edge: dest imports symbol from source
    - Re-export edge: dest re-exports symbol from source

    Star imports/re-exports are expanded to named symbols via fixed-point
    iteration.
    """
    # First, compute the transitive closure of exports for each file
    # (needed to expand star exports/re-exports).
    file_exports: dict[str, set[str]] = {}
    for fp, fa in analyses.items():
        file_exports[fp] = set(fa.exports)

    # Fixed-point: expand star re-exports
    changed = True
    while changed:
        changed = False
        for fp, fa in analyses.items():
            for source in fa.star_re_exports:
                if source in file_exports:
                    for sym in file_exports[source]:
                        if sym not in file_exports[fp]:
                            file_exports[fp].add(sym)
                            changed = True

    # Write the star-reexport closure back into FileAnalysis.exports so
    # find_dead_exports checks symbols forwarded via `export * from` too
    # (they are invisible in parse_file, which cannot know the target's
    # exports yet). Line info comes from the star statement itself.
    for fp, fa in analyses.items():
        for source in fa.star_re_exports:
            if source in file_exports and source in fa.star_reexport_lines:
                lineno = fa.star_reexport_lines[source]
                for sym in file_exports[source]:
                    fa.exports.add(sym)
                    fa.exports_by_line.setdefault(sym, (lineno, "star-re-export"))

    # Now build the adjacency list
    graph: dict[tuple[str, str], list[tuple[str, str]]] = defaultdict(list)

    # Import edges: source provides symbol to dest
    for fp, fa in analyses.items():
        for local_sym, (source, source_sym) in fa.named_imports.items():
            graph[(source, source_sym)].append((fp, local_sym))

        for source in fa.star_imports:
            if source in file_exports:
                for sym in file_exports[source]:
                    graph[(source, sym)].append((fp, sym))

    # Re-export edges: source provides symbol to dest (re-exporter).
    # Two directions needed for BFS:
    #   (source, sym) → (barrel, sym)  — source feeds barrel (for barrel chains)
    #   (barrel, sym) → (source, sym)  — barrel forwards to source (for BFS to
    #       reach consumers via the source file's import edges)
    for fp, fa in analyses.items():
        for local_sym, (source, source_sym) in fa.named_re_exports.items():
            graph[(source, source_sym)].append((fp, local_sym))
            graph[(fp, local_sym)].append((source, source_sym))

        for source in fa.star_re_exports:
            if source in file_exports:
                for sym in file_exports[source]:
                    graph[(source, sym)].append((fp, sym))
                    graph[(fp, sym)].append((source, sym))

    return dict(graph)


# ---------------------------------------------------------------------------
# Sink computation
# ---------------------------------------------------------------------------


def compute_sinks(
    analyses: dict[str, FileAnalysis],
    graph: dict[tuple[str, str], list[tuple[str, str]]],
    python_refs: set[str],
) -> set[tuple[str, str]]:
    """Compute the set of sink nodes.

    A node (file, symbol) is a sink if:
    1. The file is an IIFE entry (Python Jinja loads it).
    2. The file is config-schema.ts (Python Jinja reads it).
    3. The file is a test file AND the file imports the symbol.
    4. The file is a real code file (not pure barrel) AND imports the symbol.
    5. The symbol appears in Python references.
    """
    sinks: set[tuple[str, str]] = set()

    for fp, fa in analyses.items():
        # Rule 1: IIFE entry — any export is a sink
        if fa.is_iife_entry:
            for sym in fa.exports:
                sinks.add((fp, sym))

        # Rule 2: config-schema.ts — any export is a sink
        if fa.is_exempt:
            for sym in fa.exports:
                sinks.add((fp, sym))

        # Rule 3: test file — imports are sinks
        if fa.is_test_file:
            for local_sym in fa.named_imports:
                sinks.add((fp, local_sym))
            for source in fa.star_imports:
                pass  # Star imports in tests: handled below

        # Rule 4: real code file — imports are sinks
        if not fa.is_pure_barrel and not fa.is_iife_entry and not fa.is_exempt:
            for local_sym in fa.named_imports:
                sinks.add((fp, local_sym))
            for source in fa.star_imports:
                pass  # Star imports: handled below

    # Handle star imports in real code / test files
    for fp, fa in analyses.items():
        if fa.is_iife_entry or fa.is_exempt:
            continue
        if fa.is_test_file or not fa.is_pure_barrel:
            for source in fa.star_imports:
                if source in analyses:
                    for sym in analyses[source].exports:
                        sinks.add((fp, sym))

    # Rule 5: Python references — any (file, symbol) where symbol is in refs
    for fp, fa in analyses.items():
        for sym in fa.exports:
            if sym in python_refs:
                sinks.add((fp, sym))

    return sinks


# ---------------------------------------------------------------------------
# Reachability
# ---------------------------------------------------------------------------


def find_dead_exports(
    barrel_files: dict[str, FileAnalysis],
    graph: dict[tuple[str, str], list[tuple[str, str]]],
    sinks: set[tuple[str, str]],
) -> list[tuple[str, int, str, str]]:
    """Find dead exports in barrel files via BFS reachability.

    Returns list of (filepath, lineno, symbol, kind) for dead exports.
    """
    dead: list[tuple[str, int, str, str]] = []

    for fp, fa in barrel_files.items():
        # Skip exempt files
        if fa.is_exempt or fa.is_iife_entry:
            continue

        for sym in fa.exports:
            node = (fp, sym)

            # Check if the node itself is a sink
            if node in sinks:
                continue

            # BFS to find a sink
            visited: set[tuple[str, str]] = set()
            queue = deque([node])
            found = False
            while queue:
                current = queue.popleft()
                if current in sinks:
                    found = True
                    break
                if current in visited:
                    continue
                visited.add(current)
                for neighbor in graph.get(current, []):
                    if neighbor not in visited:
                        queue.append(neighbor)

            if not found:
                lineno, kind = fa.exports_by_line.get(sym, (0, "unknown"))
                dead.append((fp, lineno, sym, kind))

    return dead


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    repo_root = str(REPO_ROOT)

    # Find and parse all .ts files
    ts_files = find_ts_files(repo_root)
    analyses: dict[str, FileAnalysis] = {}
    for filepath in ts_files:
        try:
            with open(filepath, encoding="utf-8") as f:
                text = f.read()
        except (OSError, UnicodeDecodeError):
            continue
        analyses[filepath] = parse_file(filepath, text, repo_root)

    # Find Python references
    py_files = find_python_files(repo_root)
    python_refs = collect_python_references(py_files)

    # Build graph
    graph = build_graph(analyses, repo_root)

    # Compute sinks
    sinks = compute_sinks(analyses, graph, python_refs)

    # Filter barrel files (index.ts and type.ts)
    barrel_files = {fp: fa for fp, fa in analyses.items() if fa.is_barrel_scope}

    # Find dead exports
    dead = find_dead_exports(barrel_files, graph, sinks)

    # Sort by file path, then line number
    dead.sort(key=lambda d: (d[0], d[1]))

    if not dead:
        return 0

    # Report
    for filepath, lineno, sym, kind in dead:
        rel = os.path.relpath(filepath, repo_root).replace(os.sep, "/")
        loc = f"{rel}:{lineno}" if lineno else rel
        print(
            f"{loc}: dead barrel export '{sym}' — "
            f"no consumer found. Remove export or the symbol."
        )

    print(
        f"\n{len(dead)} dead barrel export(s). "
        "A barrel/type.ts export is alive only if reachable via "
        "import/re-export chain to a real code file, test file, "
        "IIFE entry, config-schema.ts, or Python string reference.",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
