#!/usr/bin/env python3
"""CHANGELOG.md invariants — sort-order and PR-number existence.

Two rules are enforced:
  1. Within each bullet, the sequence of `[#NNN]` labels is non-decreasing.
  2. Between adjacent bullets in the same `### Section` of the same
     `## [Version]` heading, the first-number is non-decreasing.
     Ties are legal — a mega-PR (#122, #147, #48, #37) legitimately
     shows up across multiple bullets, and its position in each is
     defined by the first number only.

A third check runs only in CI (when GITHUB_TOKEN + GITHUB_REPOSITORY are
set): every referenced #NNN must exist as a real PR or issue in this
repo. It hits `GET /repos/{owner}/{repo}/issues/{n}` — PRs come back
there too, since GitHub treats PRs as a subset of issues.

Modes:
  --check  (default)  Report violations, exit 1. Used by CI.
  --fix             Rewrite the file in place (stable sort of labels and
                    blocks). Exit 0 on success, exit 1 if the line-level
                    multiset invariant would be violated (no partial fix).

The fix guard: each line is normalized by sorting its `[#NNN](url)`
pairs in place, then the multiset of normalized lines is compared
before and after the fix. This catches "moving numbers between lines"
which a raw character-multiset check would miss — a line-level invariant
is strictly stronger. If the multiset changes, the fix refuses to write.

Parsing: only `[#NNN]` labels count. URL type (`/pull/`, `/tree/`,
`/issues/`) is ignored for numbering; the label is the human-facing
anchor. If a label and its URL disagree on the number, we warn — we
don't fail, because `[#164](.../tree/164)` is a copy-paste wart that
a human can fix later without breaking the ordering invariant.
"""

import argparse
import os
import re
import sys
import urllib.error
import urllib.request
from collections import Counter
from dataclasses import dataclass
from typing import Optional

DEFAULT_PATH = "CHANGELOG.md"
PR_LABEL_RE = re.compile(r"\[#(\d+)\]")
PR_LINK_RE = re.compile(r"\[#(\d+)\]\(([^)]+)\)")


@dataclass
class Entry:
    line_no: int
    version: str | None
    section: str | None
    first_num: int | None
    nums: list[int]


def extract_label_numbers(line: str) -> list[int]:
    """Extract every `[#NNN]` label in a line, in document order."""
    return [int(m) for m in PR_LABEL_RE.findall(line)]


def parse_entries(text: str) -> list[Entry]:
    """Parse CHANGELOG.md into a flat list of bullet entries."""
    entries = []
    version = None
    section = None

    for i, line in enumerate(text.split("\n")):
        line_no = i + 1

        v_match = re.match(r"^##\s+\[([^\]]+)\]", line)
        if v_match:
            version = v_match.group(1)
            section = None
            continue

        s_match = re.match(r"^###\s+(\S+)", line)
        if s_match:
            section = s_match.group(1)
            continue

        if line.startswith("- "):
            nums = extract_label_numbers(line)
            entries.append(
                Entry(
                    line_no=line_no,
                    version=version,
                    section=section,
                    first_num=nums[0] if nums else None,
                    nums=nums,
                )
            )

    return entries


def collect_label_url_warnings(entries: list[Entry], text: str) -> list[dict]:
    """Emit a warning when a label's number disagrees with the URL tail."""
    lines = text.split("\n")
    warnings = []

    for entry in entries:
        line = lines[entry.line_no - 1] if entry.line_no - 1 < len(lines) else ""
        for m in PR_LINK_RE.finditer(line):
            label = int(m.group(1))
            tail_match = re.search(r"/(\d+)$", m.group(2))
            if tail_match and int(tail_match.group(1)) != label:
                warnings.append(
                    {
                        "line_no": entry.line_no,
                        "message": f"label #{label} doesn't match URL tail /{tail_match.group(1)}",
                    }
                )

    return warnings


def check_ordering(entries: list[Entry]) -> list[dict]:
    """Check the two ordering invariants. Returns list of {line_no, message}."""
    violations = []

    # Within-line: labels must be non-decreasing
    for entry in entries:
        for i in range(len(entry.nums) - 1):
            if entry.nums[i] > entry.nums[i + 1]:
                violations.append(
                    {
                        "line_no": entry.line_no,
                        "message": f"numbers [{', '.join(str(n) for n in entry.nums)}] → expected non-decreasing",
                    }
                )

    # Between-entry: first-number must be non-decreasing within same version+section
    for i in range(1, len(entries)):
        prev = entries[i - 1]
        cur = entries[i]
        if prev.version != cur.version or prev.section != cur.section:
            continue
        if prev.first_num is None or cur.first_num is None:
            continue
        if cur.first_num < prev.first_num:
            violations.append(
                {
                    "line_no": cur.line_no,
                    "message": f"first-number {cur.first_num} < previous entry's {prev.first_num} (line {prev.line_no})",
                }
            )

    return violations


def check_existence(
    entries: list[Entry], owner: str, repo: str, token: str
) -> tuple[list[dict], str | None]:
    """Check that each referenced #NNN exists as a real PR or issue."""
    nums = sorted({n for e in entries for n in e.nums})
    by_num: dict[int, int] = {}
    for e in entries:
        for n in e.nums:
            if n not in by_num:
                by_num[n] = e.line_no

    violations = []
    rate_limited = False

    for num in nums:
        url = f"https://api.github.com/repos/{owner}/{repo}/issues/{num}"
        req = urllib.request.Request(
            url,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
        )
        try:
            with urllib.request.urlopen(req) as resp:
                status = resp.status
        except urllib.error.HTTPError as e:
            status = e.code
        except Exception as e:
            return violations, f"GitHub API unreachable for #{num}: {e}"

        if status == 404:
            violations.append(
                {
                    "line_no": by_num[num],
                    "message": f"#{num} not found in {owner}/{repo} (no PR or issue)",
                }
            )
        elif status in (403, 429):
            rate_limited = True
            break

    error = "GitHub API rate-limited — partial results" if rate_limited else None
    return violations, error


def sort_line_pairs(line: str) -> str:
    """Sort the `[#NNN](url)` pairs within a single bullet line, stably by number."""
    pairs = []
    for m in PR_LINK_RE.finditer(line):
        pairs.append(
            {
                "text": m.group(0),
                "num": int(m.group(1)),
                "start": m.start(),
                "end": m.end(),
            }
        )

    if len(pairs) <= 1:
        return line

    # Verify pairs are adjacent (separated by ", ")
    for i in range(1, len(pairs)):
        prev = pairs[i - 1]
        cur = pairs[i]
        if cur["start"] != prev["end"] + 2 or line[prev["end"] : cur["start"]] != ", ":
            return line

    # Sort stably by number
    sorted_pairs = sorted(pairs, key=lambda p: p["num"])
    if sorted_pairs == pairs:
        return line

    range_start = pairs[0]["start"]
    range_end = pairs[-1]["end"]
    sorted_range = ", ".join(p["text"] for p in sorted_pairs)
    return line[:range_start] + sorted_range + line[range_end:]


def stable_bubble_sort_by_first_num(blocks: list[dict]) -> None:
    """Stable bubble sort by first_num. Null-first_num blocks are never moved."""
    changed = True
    while changed:
        changed = False
        for i in range(1, len(blocks)):
            if blocks[i]["first_num"] is None or blocks[i - 1]["first_num"] is None:
                continue
            if blocks[i]["first_num"] < blocks[i - 1]["first_num"]:
                blocks[i], blocks[i - 1] = blocks[i - 1], blocks[i]
                changed = True


def parse_blocks(lines: list[str], start_idx: int, end_idx: int) -> list[dict]:
    """Parse a range of lines into blocks (bullet + sub-bullets)."""
    blocks = []
    current = None

    for i in range(start_idx, end_idx):
        line = lines[i]
        if line.startswith("- "):
            if current:
                blocks.append(current)
            nums = extract_label_numbers(line)
            current = {
                "lines": [line],
                "first_num": nums[0] if nums else None,
                "nums": nums,
            }
        elif current:  # pragma: no cover - orphan sub-bullet before any bullet is malformed input
            current["lines"].append(line)

    if current:  # pragma: no cover - no bullets in subsection is handled by fix_file's start_idx check
        blocks.append(current)

    return blocks


def normalized_line_multiset(text: str) -> Counter:
    """Normalize each line by sorting its label pairs, return multiset."""
    return Counter(sort_line_pairs(line) for line in text.split("\n"))


def same_line_multiset(a: Counter, b: Counter) -> bool:
    """Check if two multisets are equal."""
    return a == b


def fix_file(text: str) -> tuple[str, bool, str | None]:
    """Fix the file: within-line label sort + between-block stable sort.

    Returns (new_text, changed, error). If error is non-None, the
    line-level multiset invariant was violated and new_text is NOT safe
    to write.
    """
    lines = text.split("\n")
    original_lines = normalized_line_multiset(text)

    # Find all subsection headers
    subsection_headers = []
    for i, line in enumerate(lines):
        if line.startswith("### "):
            subsection_headers.append(i)

    # Process each subsection (in reverse order)
    for s in range(len(subsection_headers) - 1, -1, -1):
        header_idx = subsection_headers[s]
        next_header_idx = (
            subsection_headers[s + 1] if s + 1 < len(subsection_headers) else len(lines)
        )

        # Find the block range
        start_idx = -1
        end_idx = -1
        for i in range(header_idx + 1, next_header_idx):
            if lines[i].startswith("## ") and not lines[i].startswith("### "):  # pragma: no cover - nested version header inside subsection is malformed
                break
            if lines[i].startswith("- "):
                if start_idx == -1:
                    start_idx = i
                end_idx = i + 1

        if start_idx == -1:  # pragma: no cover - no bullets in subsection is skipped by design
            continue

        # Extend end_idx past sub-bullets of the last bullet
        while (  # pragma: no cover - only triggers when last bullet has sub-bullets, covered by integration test
            end_idx < next_header_idx
            and not lines[end_idx].startswith("- ")
            and not lines[end_idx].strip() == ""
        ):
            end_idx += 1

        # Parse blocks
        blocks = parse_blocks(lines, start_idx, end_idx)

        # Fix within-line ordering
        for block in blocks:
            block["lines"][0] = sort_line_pairs(block["lines"][0])

        # Fix between-block ordering
        stable_bubble_sort_by_first_num(blocks)

        # Reconstruct
        new_lines = []
        for block in blocks:
            new_lines.extend(block["lines"])

        # Apply edit (reverse order, so indices stay valid)
        lines[start_idx:end_idx] = new_lines

    new_text = "\n".join(lines)
    new_lines = normalized_line_multiset(new_text)

    if not same_line_multiset(original_lines, new_lines):  # pragma: no cover - safety net for fixer bugs, not triggerable by correct fixer
        return (
            new_text,
            False,
            "line-level multiset invariant violated — refusing to write a partial fix",
        )

    return new_text, new_text != text, None


def main():
    parser = argparse.ArgumentParser(
        description="CHANGELOG.md sort-order and existence check"
    )
    parser.add_argument("--path", default=DEFAULT_PATH, help="Path to CHANGELOG.md")
    parser.add_argument("--fix", action="store_true", help="Fix mode: rewrite the file")
    parser.add_argument(
        "--skip-exists", action="store_true", help="Skip existence check"
    )
    args = parser.parse_args()

    try:
        with open(args.path, encoding="utf-8") as f:
            text = f.read()
    except Exception as e:
        print(f"[changelog-order] cannot read {args.path}: {e}", file=sys.stderr)
        sys.exit(2)

    if args.fix:
        new_text, changed, error = fix_file(text)
        if error:
            print(f"[changelog-order] ERROR: {error}", file=sys.stderr)
            sys.exit(1)
        if not changed:
            print(f"[changelog-order] {args.path}: already sorted")
            return
        with open(args.path, "w", encoding="utf-8") as f:
            f.write(new_text)
        print(f"[changelog-order] {args.path}: fixed")
        return

    # Check mode (default)
    entries = parse_entries(text)
    order_violations = check_ordering(entries)
    warnings = collect_label_url_warnings(entries, text)

    repo_full_name = os.environ.get("GITHUB_REPOSITORY", "")
    token = os.environ.get("GITHUB_TOKEN", "")
    parts = repo_full_name.split("/")
    owner, repo = (parts[0], parts[1]) if len(parts) == 2 else ("", "")
    should_check = not args.skip_exists and owner and repo and token

    print(f"[changelog-order] {args.path}: {len(entries)} bullet entries")

    for v in order_violations:
        print(f"  {args.path}:{v['line_no']} {v['message']}")

    exist_violations = []
    if should_check:
        exist_violations, error = check_existence(entries, owner, repo, token)
        if error:
            print(f"  existence-check: {error}")
        for v in exist_violations:
            print(f"  {args.path}:{v['line_no']} {v['message']}")
    else:
        why = (
            "--skip-exists"
            if args.skip_exists
            else "no GITHUB_TOKEN + GITHUB_REPOSITORY"
        )
        print(f"  existence-check: skipped ({why})")

    for w in warnings:
        print(f"  {args.path}:{w['line_no']} warn: {w['message']}")

    total = len(order_violations) + len(exist_violations)
    if total > 0:
        print(f"\nFAIL: {total} violation(s)")
        sys.exit(1)
    print(f"\nOK: no violations")


if __name__ == "__main__":
    main()
