"""
Localization support for foliplus UI components.

Provides language-specific string tables for all frontend UI text and a helper to inject
the correct locale into Jinja2 templates.

Usage
-----
>>> from foliplus import HeatmapControl

# String input (recommended)
>>> HeatmapControl(locale="zh")
>>> HeatmapControl(locale="en")

# Load from external JSON
>>> from foliplus.locale import LocaleConfig
>>> HeatmapControl(locale=LocaleConfig.from_json("my_locale.json"))
"""

from __future__ import annotations

import locale as _stdlib_locale
import os
from dataclasses import dataclass, field
from json import dumps, loads
from pathlib import Path
from typing import Any, Self

# ===========================================================================
# Locale directory — used to locate built-in JSON locale files
# ===========================================================================
_LOCALE_DIR = Path(__file__).parent


# ===========================================================================
# Language code → string table (loaded from JSON files)
# ===========================================================================
def _load_builtin_tables() -> dict[str, dict[str, str]]:
    """Scan ``foliplus/locale/*.json`` and load each as a language table."""

    tables: dict[str, dict[str, str]] = {}
    for path in sorted(_LOCALE_DIR.glob("*.json")):
        table: dict[str, str] = loads(path.read_text(encoding="utf-8"))
        code = table.get("locale.code", path.stem)
        tables[code] = table

    return tables


LOCALE_TABLES: dict[str, dict[str, str]] = _load_builtin_tables()


# ===========================================================================
# Public helpers
# ===========================================================================
@dataclass
class LocaleConfig:
    """Locale configuration for a control instance.

    Stores the selected language code and provides string lookup.

    Parameters
    ----------
    language : str, default "en"
        Language code, e.g. ``"en"``, ``"zh"``. Falls back to English if the code is not
        in :data:`LOCALE_TABLES`.

    table : dict or None
        Optional custom string table (key → localized text).
        If provided, *language* is only used to set ``locale.code``.

    Examples
    --------
    >>> LocaleConfig("zh")
    >>> LocaleConfig("en")
    >>> LocaleConfig(table={"locale.code": "ja", "hello": "こんにちは"})
    """

    language: str = "en"
    _strings: dict[str, str] = field(default_factory=dict, init=False, repr=False)

    def __post_init__(self):
        table = LOCALE_TABLES.get(self.language, LOCALE_TABLES["en"])
        self._strings = dict(table)

    @classmethod
    def from_json(cls, path: str | Path) -> LocaleConfig:
        """Load locale strings from an external JSON file.

        The file must contain a flat dictionary of ``key: "translated text"`` entries,
        plus a ``locale.code`` key that identifies the language.

        Parameters
        ----------
        path : str or Path
            Path to a ``.json`` file.

        Returns
        -------
        LocaleConfig

        Examples
        --------
        >>> LocaleConfig.from_json("locales/ja.json")
        """
        if (path := Path(path)).suffix != ".json":
            raise ValueError(
                f"only .json locale files are supported, got '{path.suffix}'"
            )

        raw: dict[str, Any] = loads(path.read_text(encoding="utf-8"))
        code: str = raw.get("locale.code", "en")
        obj = cls(language=code)
        obj._strings = raw  # type: ignore[assignment]
        return obj

    def to_json(self, path: str | Path) -> None:
        """Export the current string table to a JSON file."""
        Path(path).write_text(
            dumps(self._strings, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def get(self, key: str, default: str | None = None) -> str:
        """Look up a localized string by key."""
        return self._strings.get(key, default or key)

    @property
    def code(self) -> str:
        return self._strings.get("locale.code", "en")


def resolve_locale(locale: str | LocaleConfig | None) -> LocaleConfig:
    """Normalise a ``locale`` parameter to a :class:`LocaleConfig` instance.

    * ``None`` → auto-detect via :func:`detect_language`
    * ``str`` → :class:`LocaleConfig` with that language code
    * ``LocaleConfig`` → returned as-is
    """
    if locale is None:
        return LocaleConfig(detect_language())
    if isinstance(locale, str):
        return LocaleConfig(language=locale)
    return locale


def detect_language(accept_language: str = "") -> str:
    """Detect user language from environment variables.

    Checks (in order):
    1. ``accept_language`` argument (HTTP header)
    2. Environment variables ``LANG``, ``LC_ALL``, ``LC_MESSAGES``
    3. :func:`locale.getlocale()`

    Note
    ----
    Server-side locale detection is unreliable across platforms (macOS, Docker, CI).
    For browser-based usage, the frontend JavaScript reads ``navigator.language`` at
    runtime and selects the correct locale table from ``_LOCALES`` — this function is
    only a fallback when no other locale is specified.

    Returns
    -------
    str
        Language code (e.g. ``"en"``, ``"zh"``).  Falls back to ``"en"``.
    """

    candidates: list[str] = []
    if accept_language:
        candidates.append(accept_language)

    for env_var in ("LANG", "LC_ALL", "LC_MESSAGES"):
        if val := os.environ.get(env_var, ""):
            candidates.append(val)

    try:
        sys_lang, _ = _stdlib_locale.getlocale()
        if sys_lang and sys_lang.lower() not in ("c", "posix"):
            candidates.append(sys_lang)
    except Exception:
        pass

    for c in candidates:
        lang = c.split(",")[0].split("-")[0].split("_")[0].strip().lower()
        if lang in LOCALE_TABLES:
            return lang

    return "en"
