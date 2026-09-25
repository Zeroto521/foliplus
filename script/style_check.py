#!/usr/bin/env python3
"""Enforce two code-style rules on foliplus/js/*.ts files.

  1. One value export block at the end of the file, optionally followed by
     a single `export type { ... }` block. Inline type in a value export
     (`export { a, type B }`) must be split. Re-exports from another module
     are barrel-only (`export *` and `export { X } from`). Barrels
     (`index.ts`) and type-collection files (`type.ts` / `types.ts`) are
     exempt.

  2. Singular file / directory names. Whitelist: pelias, focus, canvas,
     EventBus, base, index (proper nouns or verbs, not plurals).

Note: `function` declarations and inline exports (`export const x`) are
covered by eslint's `func-style` and `no-restricted-syntax` rules — see
`eslint.config.js`. This script does not duplicate them.

Check-only: reports violations with `file:line: message` and exits 1 if
any. Cannot auto-fix — refactor in the editor.

Usage (called by pre-commit, filenames as arguments):
    python script/style_check.py file1 file2 ...
"""

import os
import re
import sys

# Rule 1: export blocks. `export { ... }` (value) vs `export type { ... }` (type).
BLOCK_EXPORT_RE = re.compile(r"^\s*export\s+(type\s+)?\{")
# Re-export from another module (`export { X } from "./x.js"`).
RE_EXPORT_RE = re.compile(r"^\s*export\s+(?:type\s+)?\{[^}]*\}\s+from\b")
STAR_EXPORT_RE = re.compile(r"^\s*export\s+\*\s+from\b")
# Inline `type X` mixed into a value export: `export { a, type B, c }`.
INLINE_TYPE_IN_EXPORT_RE = re.compile(r"\btype\s+[A-Za-z_$][\w$]*")

# Rule 2: plural detection whitelist (proper nouns / verbs, not plurals).
PLURAL_WHITELIST = {
    "pelias",
    "focus",
    "canvas",
    "eventbus",
    "base",
    "index",
    "js",
    "ts",
}

# File-name exemptions for Rule 1 (barrel + type-collection).
BARREL_RE = re.compile(r"(^|/)index\.ts$")
TYPE_FILE_RE = re.compile(r"(^|/)types?\.ts$")

# Words that end in `s` but are clearly singular (not plurals).
SINGULAR_S_SUFFIXES = (
    "is",
    "us",
    "os",
    "ss",
    "bus",
    "mas",
    "has",
    "das",
    "was",
    "cas",
    "bas",
    "las",
    "kas",
    "tas",
    "gas",
    "pas",
    "fas",
    "ras",
    "nas",
    "vas",
    "sas",
    "bus",
    "virus",
    "analysis",
    "basis",
    "thesis",
    "crisis",
    "axis",
)


def strip_comments_and_strings(line: str) -> str:
    """Blank out comments and string literals so brace counting and export
    matching aren't confused by `// export { }` or `"{"`.

    Handles `//` line comments and simple `"..."` / `'...'` / `` `...` ``
    strings. Block comments (`/* */`) are not supported — they don't appear
    in this codebase.
    """
    out: list[str] = []
    i = 0
    n = len(line)
    while i < n:
        c = line[i]
        if c == "/" and i + 1 < n and line[i + 1] == "/":
            break
        if c in "\"'`":
            quote = c
            out.append(" ")
            i += 1
            while i < n and line[i] != quote:
                if line[i] == "\\":
                    i += 2
                    continue
                out.append(" ")
                i += 1
            if i < n:
                out.append(" ")
                i += 1
            continue
        out.append(c)
        i += 1
    return "".join(out)


def check_export_blocks(lines: list[str], filepath: str) -> list[tuple[int, str]]:
    """Rule 1: report files with >1 value export block, inline type in a
    value export, or re-exports in non-barrel files."""
    violations: list[tuple[int, str]] = []
    basename = os.path.basename(filepath)
    if BARREL_RE.search(basename) or TYPE_FILE_RE.search(basename):
        return violations  # barrel / type-collection — exempt

    value_blocks = 0
    type_blocks = 0
    last_value_lineno = 0
    last_type_lineno = 0

    for lineno, raw in enumerate(lines, 1):
        stripped = strip_comments_and_strings(raw).strip()

        # Re-export from another module.
        #   `export { X } from "./x.js"`   — value re-export, barrel-only.
        #   `export type { X } from "./x"` — type re-export, allowed in
        #     non-barrels as the single type block (e.g. LayerFactory.ts).
        if STAR_EXPORT_RE.match(stripped):
            violations.append(
                (
                    lineno,
                    "`export * from` in non-barrel file — use a barrel (`index.ts`)",
                )
            )
            continue
        if RE_EXPORT_RE.match(stripped):
            is_type_reexport = stripped.startswith("export type")
            if is_type_reexport:
                type_blocks += 1
                last_type_lineno = lineno
            else:
                violations.append(
                    (
                        lineno,
                        "`export { ... } from` (value re-export) in non-barrel "
                        "file — collect symbols locally or move to `index.ts`",
                    )
                )
            continue

        m = BLOCK_EXPORT_RE.match(stripped)
        if m:
            is_type = bool(m.group(1))
            if is_type:
                type_blocks += 1
                last_type_lineno = lineno
            else:
                # Detect inline `type X` mixed into a value export:
                # `export { a, type B, c }`.
                if INLINE_TYPE_IN_EXPORT_RE.search(stripped):
                    violations.append(
                        (
                            lineno,
                            "inline `type X` in value export — split into "
                            "`export { ... }` then `export type { ... }`",
                        )
                    )
                value_blocks += 1
                last_value_lineno = lineno
            continue

    if value_blocks > 1:
        violations.append(
            (
                last_value_lineno,
                f"{value_blocks} value export blocks — collapse into one "
                "`export { a, b, c }` block at file end",
            )
        )
    if type_blocks > 1:
        violations.append(
            (
                last_type_lineno,
                f"{type_blocks} type export blocks — collapse into one "
                "`export type { ... }` block",
            )
        )

    return violations


def check_plural_names(filepath: str) -> list[tuple[int, str]]:
    """Rule 2: report plural-looking file names (basename only)."""
    violations: list[tuple[int, str]] = []
    basename = os.path.basename(filepath)
    base = basename[:-3] if basename.endswith(".ts") else basename
    lower = base.lower()
    if lower in PLURAL_WHITELIST:
        return violations
    if lower.endswith("ies") or lower.endswith(("ses", "xes", "zes", "ches", "shes")):
        is_plural = True
    elif lower.endswith("s"):
        is_plural = not lower.endswith(SINGULAR_S_SUFFIXES)
    else:
        is_plural = False
    if is_plural:
        violations.append((0, f"name `{base}` looks plural — use singular"))
    return violations


def check_file(filepath: str) -> list[tuple[int, str]]:
    try:
        with open(filepath, encoding="utf-8") as f:
            lines = f.readlines()
    except (OSError, UnicodeDecodeError):
        return []

    return check_export_blocks(lines, filepath) + check_plural_names(filepath)


def main() -> int:
    if len(sys.argv) < 2:
        return 0

    total = 0
    for filepath in sys.argv[1:]:
        if not filepath.endswith(".ts"):
            continue
        for lineno, msg in check_file(filepath):
            loc = f"{filepath}:{lineno}" if lineno else filepath
            print(f"{loc}: {msg}")
            total += 1

    if total:
        print(
            f"\n{total} code-style violation(s). Rules: (1) one value export "
            "block at file end + optional `export type { ... }`, "
            "(2) singular file/dir names. Function declarations and inline "
            "exports are covered by eslint (func-style, no-restricted-syntax).",
            file=sys.stderr,
        )
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
