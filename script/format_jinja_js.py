#!/usr/bin/env python3
"""Format JS files containing Jinja2 template tags using prettier.

Strategy:
    1. Replace all Jinja2 tags ({{ }}, {% %}, {# #}) with unique placeholders.
    2. Run prettier on the cleaned JS file.
    3. Restore original Jinja2 tags.

Usage:
    python script/format_jinja_js.py  # format all JS files
    python script/format_jinja_js.py foliplus/js/LayerControl.js  # single file
    python script/format_jinja_js.py --check  # check-only mode
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
JS_DIR = REPO_ROOT / "foliplus" / "js"


def _jinja2_tags() -> list[tuple[re.Pattern[str], str]]:
    """Return (pattern, description) list of all Jinja2 tags to protect."""
    return [
        (re.compile(r"\{\{.*?\}\}"), "expr"),
        (re.compile(r"\{%-?\s*.*?\s*-?%\}", re.DOTALL), "block"),
        (re.compile(r"\{#.*?#\}"), "comment"),
    ]


def extract_jinja2(content: str) -> tuple[str, dict[str, str]]:
    """Replace Jinja2 tags with placeholders, return cleaned text + mapping."""
    placeholder_map: dict[str, str] = {}
    counter = 0

    def _replacer(match: re.Match[str]) -> str:
        nonlocal counter
        placeholder = f"__JINJA2_{counter:04d}__"
        placeholder_map[placeholder] = match.group(0)
        counter += 1
        return placeholder

    cleaned = content
    for pattern, _ in _jinja2_tags():
        cleaned = pattern.sub(_replacer, cleaned)

    return cleaned, placeholder_map


def restore_jinja2(cleaned: str, placeholder_map: dict[str, str]) -> str:
    """Restore original Jinja2 tags from placeholders."""
    result = cleaned
    for placeholder, original in placeholder_map.items():
        result = result.replace(placeholder, original)
    return result


def run_prettier(
    filepath: Path, check_only: bool = False
) -> subprocess.CompletedProcess:
    """Run prettier on a single file."""
    content = filepath.read_text(encoding="utf-8")
    cmd = ["npx", "prettier", "--stdin-filepath", str(filepath)]
    if check_only:
        cmd.append("--check")

    return subprocess.run(
        cmd, input=content, capture_output=True, text=True, cwd=REPO_ROOT
    )


def format_file(filepath: Path, check_only: bool = False) -> bool:
    """Format a single JS file. Returns True if successful."""
    original = filepath.read_text(encoding="utf-8")

    # Step 1: protect Jinja2 tags
    cleaned, placeholder_map = extract_jinja2(original)

    if not placeholder_map:
        # No Jinja2 tags — format directly via prettier
        result = run_prettier(filepath, check_only=check_only)
        if result.returncode != 0:
            rel = filepath.relative_to(REPO_ROOT)
            if check_only:
                print(f"[NOT FORMATTED] {rel}")
            else:
                print(f"[FAIL] {rel}")
            if result.stderr:
                print(result.stderr)
            return False
        if not check_only:
            filepath.write_text(result.stdout, encoding="utf-8")
            print(f"[OK] {rel}")
        return True

    # Step 2: write cleaned version to a temp file *under REPO_ROOT*
    # so prettier can find .prettierrc via path traversal
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".js", delete=False, encoding="utf-8", dir=REPO_ROOT
    ) as f:
        temp_path = Path(f.name)
        f.write(cleaned)

    try:
        # Step 3: run prettier, capture formatted output from stdout
        result = run_prettier(temp_path, check_only=check_only)

        if result.returncode != 0:
            rel = filepath.relative_to(REPO_ROOT)
            if check_only:
                print(f"[NOT FORMATTED] {rel}")
            else:
                print(f"[FAIL] {rel}")
            if result.stderr:
                print(result.stderr)
            return False

        if not check_only:
            # Step 4: restore Jinja2 tags from prettier's formatted output
            restored = restore_jinja2(result.stdout, placeholder_map)

            # Write back to original file
            filepath.write_text(restored, encoding="utf-8")
            print(f"[OK] {filepath.relative_to(REPO_ROOT)}")

    finally:
        temp_path.unlink(missing_ok=True)

    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Format JS files with Jinja2 tags")
    parser.add_argument(
        "files", nargs="*", help="Files to format (default: all JS files)"
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Check formatting without modifying files",
    )
    args = parser.parse_args()

    if args.files:
        files = [Path(f).resolve() for f in args.files]
    else:
        files = sorted(JS_DIR.glob("*.js"))

    success = True
    for filepath in files:
        if not filepath.exists():
            print(f"[SKIP] {filepath} does not exist")
            continue
        if not format_file(filepath, check_only=args.check):
            success = False

    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())
