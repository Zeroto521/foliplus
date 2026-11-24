"""CLI: dump the CONFIG schema JSON (python -m foliplus._config_schema)."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .export import schema_to_json


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="foliplus._config_schema",
        description="Dump the CONFIG schema as JSON for pytest and manual regeneration.",
    )
    parser.add_argument(
        "--dump",
        action="store_true",
        help="Print the schema JSON to stdout (default when --out is omitted).",
    )
    parser.add_argument(
        "--out",
        metavar="PATH",
        help="Write the schema JSON to PATH instead of stdout.",
    )
    args = parser.parse_args(argv)
    text = schema_to_json()
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
        return 0
    sys.stdout.write(text)
    return 0


if __name__ == "__main__":  # pragma: no cover - entry point
    raise SystemExit(main())
