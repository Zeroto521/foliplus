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
from pathlib import Path
from subprocess import CompletedProcess, run
from tempfile import NamedTemporaryFile
from types import SimpleNamespace

REPO_ROOT = Path(__file__).resolve().parent.parent
JS_DIR = REPO_ROOT / "foliplus" / "js"
_PRETTIER = REPO_ROOT / "node_modules" / ".bin" / "prettier"

STATUS = SimpleNamespace(OK="✓", FAIL="✗", SKIP="-")

_JINJA2_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\{\{.*?\}\}"),
    re.compile(r"\{%-?\s*.*?\s*-?%\}", re.DOTALL),
    re.compile(r"\{#.*?#\}"),
)


# ── helpers ──────────────────────────────────────────────────────────
def _ensure_prettier() -> None:
    if _PRETTIER.is_file():
        return
    print(
        "prettier not found. Run `npm install` from the project root.",
        file=sys.stderr,
    )
    sys.exit(1)


def _placehold(content: str) -> tuple[str, dict[str, str]]:
    """Replace Jinja2 tags with __JINJA2_NNNN__ placeholders."""
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


def _msg(status: str, filepath: Path, detail: str = "") -> None:
    rel = filepath.relative_to(REPO_ROOT)
    if detail:
        print(f"  {status} {rel}  {detail}")
    else:
        print(f"  {status} {rel}")


# ── core ─────────────────────────────────────────────────────────────
def _run_prettier(filepath: Path, check_only: bool = False) -> CompletedProcess:
    cmd = [str(_PRETTIER), "--stdin-filepath", str(filepath)]
    if check_only:
        cmd.append("--check")
    return run(
        cmd,
        input=filepath.read_text(encoding="utf-8"),
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
    )


def format_file(filepath: Path, check_only: bool = False) -> bool:
    original = filepath.read_text(encoding="utf-8")
    cleaned, mapping = _placehold(original)

    if not mapping:
        result = _run_prettier(filepath, check_only=check_only)
        if result.returncode != 0:
            _msg(STATUS.FAIL, filepath, (result.stdout or result.stderr).strip())
            return False
        if not check_only:
            filepath.write_text(result.stdout, encoding="utf-8")
            _msg(STATUS.OK, filepath)
        return True

    with NamedTemporaryFile(
        mode="w", suffix=".js", delete=False, encoding="utf-8", dir=REPO_ROOT
    ) as f:
        tmp = Path(f.name)
        f.write(cleaned)

    try:
        result = _run_prettier(tmp, check_only=check_only)
        if result.returncode != 0:
            _msg(STATUS.FAIL, filepath, (result.stdout or result.stderr).strip())
            return False
        if not check_only:
            restored = _restore(result.stdout, mapping)
            filepath.write_text(restored, encoding="utf-8")
            _msg(STATUS.OK, filepath)
    finally:
        tmp.unlink(missing_ok=True)

    return True


# ── cli ──────────────────────────────────────────────────────────────
def main() -> int:
    parser = ArgumentParser(description="Format JS files with Jinja2 tags")
    parser.add_argument(
        "files", nargs="*", help="Files to format (default: all JS files)"
    )
    parser.add_argument("--check", action="store_true", help="Check only, no write")
    args = parser.parse_args()
    _ensure_prettier()

    ok = True
    for fp in (
        [Path(f).resolve() for f in args.files]
        if args.files
        else sorted(JS_DIR.glob("*.js"))
    ):
        if not fp.exists():
            _msg(STATUS.SKIP, fp, "not found")
            continue
        if not format_file(fp, check_only=args.check):
            ok = False
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
