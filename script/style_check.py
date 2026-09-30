#!/usr/bin/env python3
"""Enforce code-style rules on foliplus/js/*.ts and foliplus/css/*.css files.

  1. One value export block at the end of the file, optionally followed by
     a single `export type { ... }` block. Inline type in a value export
     (`export { a, type B }`) must be split. Re-exports from another module
     are barrel-only (`export *` and `export { X } from`). Barrels
     (`index.ts`) and type-collection files (`type.ts` / `types.ts`) are
     exempt.

  2. Singular file names. Applies to `foliplus/js/*.ts` and build-tool
     modules (`script/*.{mjs,cjs,js}`). Whitelist: pelias, focus, canvas,
     EventBus, base, index, args, css, compress (proper nouns,
     abbreviations, or verbs — not plurals).

  3. American spelling in identifiers and string literals (colour → color,
     normalise → normalize, ...). Comments (English prose) are exempt.

  4. CSS custom properties must carry the `--foliplus-` namespace prefix.
     A bare `--token` breaks the namespace contract and can collide with the
     host page, so it is rejected in declarations, `var()` references, and
     JS string literals alike. Test files are out of scope (they use
     throwaway names like `--test-color`).

Note: `function` declarations and inline exports (`export const x`) are
covered by eslint's `func-style` and `no-restricted-syntax` rules — see
`eslint.config.js`. This script does not duplicate them.

Check-only: reports violations with `file:line: message` and exits 1 if
any. Cannot auto-fix — refactor in the editor.

Usage (called by pre-commit, filenames as arguments):
    python script/style_check.py file1 file2 ...
"""

from __future__ import annotations

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

# Rule 2: plural detection whitelist (proper nouns / abbreviations / verbs).
# Sorted; add new entries alphabetically.
PLURAL_WHITELIST = {
    "args",
    "base",
    "canvas",
    "compress",  # verb (script/compress.mjs), not a plural noun
    "css",
    "eventbus",
    "focus",
    "index",
    "js",
    "pelias",
    "ts",
}

# Extensions whose basenames are checked for plural names (rule 2).
NAME_CHECK_EXTS = (".ts", ".mjs", ".cjs", ".js")

# Rule 3: American spelling — identifiers and string literals only.
# Comments are exempt (English prose). Lowercase keys; matching is
# case-insensitive with word boundaries.
BRITISH_TO_AMERICAN = {
    "colour": "color",
    "colours": "colors",
    "coloured": "colored",
    "colouring": "coloring",
    "colourful": "colorful",
    "recolour": "recolor",
    "recoloured": "recolored",
    "normalise": "normalize",
    "normalised": "normalized",
    "normalises": "normalizes",
    "normalising": "normalizing",
    "behaviour": "behavior",
    "behaviours": "behaviors",
    "centred": "centered",
    "centring": "centering",
    "honoured": "honored",
    "honouring": "honoring",
    "recognised": "recognized",
    "recognise": "recognize",
    "recognises": "recognizes",
    "neighbour": "neighbor",
    "neighbours": "neighbors",
}
BRITISH_RE = re.compile(
    r"(?<![\w$])(?:"
    + "|".join(sorted(BRITISH_TO_AMERICAN, key=len, reverse=True))
    + r")(?![\w$])",
    re.IGNORECASE,
)

# File-name exemptions for Rule 1 (barrel + type-collection).
BARREL_RE = re.compile(r"(^|/)index\.ts$")
TYPE_FILE_RE = re.compile(r"(^|/)types?\.ts$")

# Rule 4: CSS custom properties must be namespaced as --foliplus-* AND
# definitions must live in token.css. Matches any `--name` custom property in
# declarations, `var()` calls, and JS string literals. The guard on foliplus/*
# source keeps the host-page override surface namespaced; test files are out
# of scope. Definitions outside token.css are rejected — the single source of
# truth for tokens is token.css, organized by tier with section comments.
BARE_CUSTOM_PROPERTY_RE = re.compile(r"--[a-zA-Z][\w-]*")
FOLIPLUS_PREFIX = "--foliplus-"
TOKEN_CSS = "foliplus/css/common/token.css"


def check_custom_property_prefix(lines: list[str], filename: str = "") -> list[tuple[int, str]]:
    """Rule 4: report bare (non-`--foliplus-`) custom property names, and
    definitions outside token.css."""
    violations: list[tuple[int, str]] = []
    is_token = filename.endswith("token.css")
    for lineno, raw in enumerate(lines, 1):
        for m in BARE_CUSTOM_PROPERTY_RE.finditer(raw):
            name = m.group(0)
            if name.startswith(FOLIPLUS_PREFIX):
                # Check if this is a definition (property followed by a colon).
                # A definition is allowed only in token.css.
                end = m.end()
                # Skip whitespace to check for a colon.
                while end < len(raw) and raw[end] in " \t":
                    end += 1
                if end < len(raw) and raw[end] == ":":
                    if not is_token:
                        violations.append(
                            (
                                lineno,
                                f"CSS custom property definition `{name}` must live in {TOKEN_CSS} — move it there with its tier section.",
                            )
                        )
                continue
            violations.append(
                (
                    lineno,
                    f"CSS custom property `{name}` is missing the "
                    f"`--foliplus-` prefix — rename to `--foliplus-{name[2:]}`",
                )
            )
    return violations


def _scan_line(line: str, in_block: bool, blank_strings: bool) -> tuple[str, bool]:
    """Scan one line for comments and strings, returning (code, in_block).

    Both callers share this single pass:
      - ``strip_comments_and_strings`` blanks string contents and truncates
        at a ``//`` line comment — used to keep export matching honest.
      - ``strip_comments_line`` keeps string literals verbatim (their content
        is checked for spelling) and tracks ``/* */`` block comments across
        lines.
    ``in_block`` is True when the previous line opened a block comment that
    this line continues; its value is carried through and returned.
    """
    out: list[str] = []
    i = 0
    n = len(line)
    while i < n:
        c = line[i]
        if in_block:
            if c == "*" and i + 1 < n and line[i + 1] == "/":
                i += 2
                in_block = False
            else:
                i += 1
            continue
        if c in "\"'`":
            quote = c
            out.append(" " if blank_strings else c)
            i += 1
            while i < n and line[i] != quote:
                if line[i] == "\\" and i + 1 < n:
                    if not blank_strings:
                        out.append(line[i : i + 2])
                    i += 2
                    continue
                out.append(" " if blank_strings else line[i])
                i += 1
            if i < n:
                out.append(" " if blank_strings else line[i])
                i += 1
            continue
        if c == "/" and i + 1 < n:
            if line[i + 1] == "/":
                break
            if line[i + 1] == "*":
                i += 2
                in_block = True
                continue
        out.append(c)
        i += 1
    return "".join(out), in_block


def strip_comments_and_strings(line: str) -> str:
    """Blank out comments and string literals so brace counting and export
    matching aren't confused by `// export { }` or `"{"`."""
    code, _ = _scan_line(line, False, True)
    return code


def strip_comments_line(line: str, in_block: bool) -> tuple[str, bool]:
    """Strip comments from one line, tracking multi-line block comments.

    String literals are kept verbatim so spelling checks cover user-facing
    strings. Returns (code, in_block_after_line) — `in_block` tells the
    caller whether the previous line opened a `/*` that this line continues.
    """
    return _scan_line(line, in_block, False)


def check_spelling(lines: list[str]) -> list[tuple[int, str]]:
    """Rule 3: report British spellings in identifiers and string literals."""
    violations: list[tuple[int, str]] = []
    in_block = False
    for lineno, raw in enumerate(lines, 1):
        code, in_block = strip_comments_line(raw, in_block)
        for m in BRITISH_RE.finditer(code):
            word = m.group(0)
            fix = BRITISH_TO_AMERICAN[word.lower()]
            violations.append((lineno, f"British spelling `{word}` — use `{fix}`"))
    return violations


def check_export_blocks(lines: list[str], filepath: str) -> list[tuple[int, str]]:
    """Rule 1: report files with >1 value export block, inline type in a
    value export, or re-exports in non-barrel files."""
    violations: list[tuple[int, str]] = []
    basename = os.path.basename(filepath)
    if BARREL_RE.search(basename) or TYPE_FILE_RE.search(basename):
        return violations  # barrel / type-collection — exempt

    value_blocks = 0
    type_blocks = 0
    first_value_lineno = 0
    first_type_lineno = 0

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
                if type_blocks == 0:
                    first_type_lineno = lineno
                type_blocks += 1
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
                if type_blocks == 0:
                    first_type_lineno = lineno
                type_blocks += 1
            else:
                if INLINE_TYPE_IN_EXPORT_RE.search(stripped):
                    violations.append(
                        (
                            lineno,
                            "inline `type X` in value export — split into "
                            "`export { ... }` then `export type { ... }`",
                        )
                    )
                if value_blocks == 0:
                    first_value_lineno = lineno
                value_blocks += 1
            continue

    if value_blocks > 1:
        violations.append(
            (
                first_value_lineno,
                f"{value_blocks} value export blocks — collapse into one "
                "`export { a, b, c }` block at file end",
            )
        )
    if type_blocks > 1:
        violations.append(
            (
                first_type_lineno,
                f"{type_blocks} type export blocks — collapse into one "
                "`export type { ... }` block",
            )
        )

    return violations


def check_plural_names(filepath: str) -> list[tuple[int, str]]:
    """Rule 2: report plural-looking file names (basename only)."""
    violations: list[tuple[int, str]] = []
    basename = os.path.basename(filepath)
    base = basename
    for ext in NAME_CHECK_EXTS:
        if basename.lower().endswith(ext):
            base = basename[: -len(ext)]
            break
    lower = base.lower()
    if lower in PLURAL_WHITELIST:
        return violations
    # Compound basenames whose last segment is an allowed abbreviation
    # (`merge-css`, `bundle-size` is not — size is not whitelisted) are
    # not plurals: the trailing `s` belongs to the abbreviation.
    last = lower.rsplit("-", 1)[-1]
    if last in PLURAL_WHITELIST:
        return violations
    if lower.endswith("s"):
        violations.append((0, f"name `{base}` looks plural — use singular"))
    return violations


def check_file(filepath: str) -> list[tuple[int, str]]:
    try:
        with open(filepath, encoding="utf-8") as f:
            lines = f.readlines()
    except (OSError, UnicodeDecodeError):
        return []

    if filepath.endswith(".css"):
        # CSS: the whole line is scanned — declarations, `var()` references,
        # and comments alike, since a bare token anywhere is a namespace break.
        return check_custom_property_prefix(lines, filepath)

    # TS: check custom properties only in code (string literals), not comment
    # prose, so an em-dash or a descriptive "the --x token" note is exempt.
    code_lines: list[str] = []
    in_block = False
    for raw in lines:
        code, in_block = strip_comments_line(raw, in_block)
        code_lines.append(code)

    return (
        check_export_blocks(lines, filepath)
        + check_plural_names(filepath)
        + check_spelling(lines)
        + check_custom_property_prefix(code_lines, filepath)
    )


def main() -> int:
    if len(sys.argv) < 2:
        return 0

    total = 0
    for filepath in sys.argv[1:]:
        if filepath.endswith(".css") or filepath.endswith(".ts"):
            violations = check_file(filepath)
        elif filepath.endswith((".mjs", ".cjs", ".js")):
            # Build-tool modules: singular names only. Export/spelling/custom
            # property rules stay scoped to foliplus JS/TS and CSS.
            violations = check_plural_names(filepath)
        else:
            continue
        for lineno, msg in violations:
            loc = f"{filepath}:{lineno}" if lineno else filepath
            print(f"{loc}: {msg}")
            total += 1

    if total:
        print(
            f"\n{total} code-style violation(s). Rules: (1) one value export "
            "block at file end + optional `export type { ... }`, "
            "(2) singular file names, (3) American spelling in code/strings, "
            "(4) CSS custom properties namespaced as `--foliplus-*`. "
            "Function declarations and inline exports are covered by eslint "
            "(func-style, no-restricted-syntax).",
            file=sys.stderr,
        )
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
