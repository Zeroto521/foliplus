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

from dataclasses import dataclass, field
from json import dumps, loads
from pathlib import Path
from typing import Any

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


_LOCALES_TABLES: dict[str, dict[str, str]] = _load_builtin_tables()


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
        in :data:`_LOCALES_TABLES`.

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
        table = _LOCALES_TABLES.get(self.language, _LOCALES_TABLES["en"])
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


def resolve_locale(locale: str | LocaleConfig) -> LocaleConfig:
    """Normalise a ``locale`` parameter to a :class:`LocaleConfig` instance.

    Parameters
    ----------
    locale : str or LocaleConfig
        Language code (``"en"``, ``"zh"``) or a :class:`LocaleConfig` instance.

    Returns
    -------
    LocaleConfig

    Raises
    ------
    ValueError
        If ``locale`` is a string not in ``_LOCALES_TABLES``, or if it is neither
        a string nor a :class:`LocaleConfig`.
    """
    if isinstance(locale, str):
        if locale not in _LOCALES_TABLES:
            raise ValueError(
                f"unsupported locale {locale!r}; available: {list(_LOCALES_TABLES)}"
            )
        return LocaleConfig(language=locale)
    if isinstance(locale, LocaleConfig):
        return locale
    raise TypeError(
        f"locale must be a str or LocaleConfig, got {type(locale).__name__!s}"
    )
