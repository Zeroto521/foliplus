#!/usr/bin/env python3
"""Format JS files containing Jinja2 template tags using prettier.

Strategy:
    1. Replace all Jinja2 tags ({{ }}, {% %}, {# #}) with unique placeholders.
    2. Run prettier on the cleaned JS file.
    3. Restore original Jinja2 tags.

Usage:
    python script/format_jinja_js.py                     # format all JS files
    python script/format_jinja_js.py foliplus/js/foo.js  # single file
    python script/format_jinja_js.py --check             # check-only mode
"""

from __future__ import annotations

import re
import sys
from argparse import ArgumentParser
from difflib import unified_diff
from pathlib import Path
from subprocess import run
from types import SimpleNamespace

REPO = Path(__file__).resolve().parent.parent
JS_DIR = REPO / "foliplus" / "js"
_PRETTIER = REPO / "node_modules" / ".bin" / "prettier"

STATUS = SimpleNamespace(OK="✓", FAIL="✗", SKIP="–")

_JINJA2_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\{\{.*?\}\}"),
    re.compile(r"\{%-?\s*.*?\s*-?%\}", re.DOTALL),
    re.compile(r"\{#.*?#\}"),
)


# ── helpers ──────────────────────────────────────────────────────────
def _check_prettier() -> None:
    if _PRETTIER.is_file():
        return
    # Auto-install if not present (works in pre-commit CI)
    ret = run(["npm", "install"], cwd=REPO, capture_output=True)
    if ret.returncode != 0 or not _PRETTIER.is_file():
        print("prettier not found. Run `npm install`.", file=sys.stderr)
        sys.exit(1)


def _placehold(content: str) -> tuple[str, dict[str, str]]:
    mapping: dict[str, str] = {}
    n = 0

    def _sub(m: re.Match[str]) -> str:
        nonlocal n
        key = f"__JINJA2_{n:04d}__"
        mapping[key] = m.group(0)
        n += 1
        return key

    cleaned = content
    for pat in _JINJA2_PATTERNS:
        cleaned = pat.sub(_sub, cleaned)
    return cleaned, mapping


def _restore(cleaned: str, mapping: dict[str, str]) -> str:
    for key, val in mapping.items():
        cleaned = cleaned.replace(key, val)
    return cleaned


def _fmt(status: str, filepath: Path, detail: str = "") -> str:
    rel = filepath.relative_to(REPO)
    return f"  {status} {rel}" + (f"  {detail}" if detail else "")


# ── core ─────────────────────────────────────────────────────────────
def _diff(original: str, formatted: str) -> str:
    return "".join(
        unified_diff(
            original.splitlines(keepends=True),
            formatted.splitlines(keepends=True),
            fromfile="original",
            tofile="formatted",
        )
    )


def _prettify(content: str, filepath: Path) -> str:
    """Run prettier on content, return formatted output."""
    result = run(
        [str(_PRETTIER), "--stdin-filepath", str(filepath)],
        input=content,
        capture_output=True,
        text=True,
        cwd=REPO,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip())
    return result.stdout


def format_file(filepath: Path, check_only: bool = False) -> bool:
    original = filepath.read_text(encoding="utf-8")
    cleaned, mapping = _placehold(original)

    try:
        formatted = _prettify(cleaned, filepath)
    except RuntimeError as e:
        print(_fmt(STATUS.FAIL, filepath, str(e)))
        return False

    if mapping:
        formatted = _restore(formatted, mapping)

    if formatted == original:
        if not check_only:
            print(_fmt(STATUS.OK, filepath))
        return True

    if check_only:
        print(_fmt(STATUS.FAIL, filepath, "needs formatting"))
        print(_diff(original, formatted))
        return False

    filepath.write_text(formatted, encoding="utf-8")
    print(_fmt(STATUS.OK, filepath))
    return True


# ── cli ──────────────────────────────────────────────────────────────
def main() -> int:
    parser = ArgumentParser(description="Format JS files with Jinja2 tags")
    parser.add_argument(
        "files", nargs="*", help="Files to format (default: all JS files)"
    )
    parser.add_argument("--check", action="store_true", help="Check only, no write")
    args = parser.parse_args()
    _check_prettier()

    ok = True
    for fp in (
        [Path(f).resolve() for f in args.files]
        if args.files
        else sorted(JS_DIR.glob("*.js"))
    ):
        if not fp.exists():
            print(_fmt(STATUS.SKIP, fp, "not found"))
            continue
        if not format_file(fp, check_only=args.check):
            ok = False
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
