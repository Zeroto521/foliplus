"""
Localization support for foliplus UI components.

Provides language-specific string tables for all frontend UI text. Controls select a
table by passing ``locale=`` to their constructor — the resolved config is serialised
into the JS ``CONF`` by :class:`foliplus.BaseControl`.

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
from functools import cache
from json import dumps, loads
from pathlib import Path
from typing import Any

# ===========================================================================
# Locale directory — used to locate built-in JSON locale files
# ===========================================================================
_LOCALE_DIR = Path(__file__).parent


# ===========================================================================
# Locale table loading
# ===========================================================================
@cache
def _load_tables(pattern: str) -> dict[str, dict[str, str]]:
    """Load locale tables matching a glob pattern.

    Parameters
    ----------
    pattern : str
        Glob pattern, e.g. ``"common.*.json"`` or ``"HeatmapControl.*.json"``.

    Returns
    -------
    dict[str, dict[str, str]]
        Language code → string table.
    """
    tables: dict[str, dict[str, str]] = {}
    for path in sorted(_LOCALE_DIR.glob(pattern)):
        table: dict[str, str] = loads(path.read_text(encoding="utf-8"))
        code = table.get("locale.code", path.stem)
        tables[code] = table
    return tables


def resolve_locale(locale: str | LocaleConfig | None, component: str) -> LocaleConfig:
    """Normalise a ``locale`` parameter to a :class:`LocaleConfig` instance.

    Parameters
    ----------
    locale : str or LocaleConfig or None
        Language code (``"en"``, ``"zh"``) or a :class:`LocaleConfig` instance.
        ``None`` yields an empty (auto-detect) config.
    component : str
        Component name used to load the per-component tables.

    Returns
    -------
    LocaleConfig

    Raises
    ------
    ValueError
        If ``locale`` is a string not available for the component.
    """
    if locale is None:
        return LocaleConfig(language="")
    if isinstance(locale, str):
        tables = _load_tables(f"{component}.*.json")
        if locale not in tables:
            raise ValueError(
                f"unsupported locale {locale!r} for {component}; "
                f"available: {list(tables)}"
            )
        obj = LocaleConfig(language="")
        obj._strings = dict(tables[locale])
        return obj

    if isinstance(locale, LocaleConfig):
        return locale
    raise TypeError(
        f"locale must be a str, LocaleConfig, or None, got {type(locale).__name__!s}"
    )


# ===========================================================================
# Public helpers
# ===========================================================================
@dataclass
class LocaleConfig:
    """Locale configuration for a control instance.

    Stores a language code and a custom string table. The ``language`` argument only
    records the code — it does **not** load the built-in string table, so a bare
    ``LocaleConfig("zh")`` carries no strings. At render time a stringless config means
    "auto-detect at runtime": the control ships the built-in tables and lets the browser
    pick the language. Pass a ``str`` code (``HeatmapControl(locale="zh")``) for a
    built-in language, or :meth:`from_json` for a custom one — only then do translated
    strings actually reach the page.

    A custom table need not be complete: keys it omits fall back to the built-in
    translation for that language (English when the language itself is new), so
    ``{"locale.code": "ja", "HeatmapControl.title": "こんにちは"}`` overrides one label
    while the other 27 keep their built-in strings.

    Parameters
    ----------
    language : str, default "en"
        Language code, e.g. ``"en"``, ``"zh"``. Custom codes such as ``"fr"`` are
        accepted as-is; without strings from :meth:`from_json` they select no table,
        so the control falls back to the browser's language at runtime.

    Examples
    --------
    >>> from foliplus import HeatmapControl
    >>> HeatmapControl(locale="zh")
    >>> HeatmapControl(locale=LocaleConfig.from_json("my_locale.json"))
    """

    language: str = "en"
    _strings: dict[str, str] = field(default_factory=dict, init=False, repr=False)

    @classmethod
    def from_json(cls, path: str | Path) -> LocaleConfig:
        """Load locale strings from an external JSON file.

        The file must contain a flat dictionary of ``key: "translated text"`` entries,
        plus a ``locale.code`` key that identifies the language.

        A missing ``locale.code`` raises rather than defaulting to ``"en"``, because
        shipping translated strings under an English code is the same defect class as
        the silent-fallback bug this module exists to fix. Non-string values are
        rejected for the same reason: :meth:`get` promises ``str``.

        Parameters
        ----------
        path : str or Path
            Path to a ``.json`` file.

        Returns
        -------
        LocaleConfig

        Raises
        ------
        ValueError
            If the file is not ``.json``, its root is not an object, it has no
            ``locale.code``, or any value is not a string.

        Examples
        --------
        >>> LocaleConfig.from_json("locales/ja.json")
        """
        if (path := Path(path)).suffix != ".json":
            raise ValueError(
                f"only .json locale files are supported, got '{path.suffix}'"
            )
        raw: Any = loads(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError(
                f"locale file must contain a JSON object, got "
                f"{type(raw).__name__!s}: {path}"
            )
        if not isinstance(raw.get("locale.code"), str):
            raise ValueError(
                f"locale file must contain a 'locale.code' string, got "
                f"{raw.get('locale.code')!r}: {path}"
            )
        bad = {k: v for k, v in raw.items() if not isinstance(v, str)}
        if bad:
            raise ValueError(
                f"locale values must all be strings, got non-string entries: "
                f"{sorted(bad)}: {path}"
            )
        obj = cls(language=raw["locale.code"])
        obj._strings = dict(raw)
        return obj

    def to_json(self, path: str | Path) -> None:
        """Export the current string table to a JSON file.

        Always writes ``locale.code`` so the file round-trips through
        :meth:`from_json`. A bare ``LocaleConfig("zh")`` has no strings and therefore
        no table to export; raising here keeps that from writing a ``{}`` that would
        reload as English.
        """
        if not self._strings:
            raise ValueError(
                f"{type(self).__name__!s} has no strings to export — resolve_locale() "
                f"or from_json() returns a table, the constructor does not"
            )
        out = dict(self._strings)
        out["locale.code"] = self.code
        Path(path).write_text(
            dumps(out, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def get(self, key: str, default: str | None = None) -> str:
        """Look up a localized string by key, falling back to the key itself.

        An explicit ``default=""`` is honoured (an empty translation is valid),
        so the key fallback only applies when ``default`` is ``None``.
        """
        if default is not None:
            return self._strings.get(key, default)
        return self._strings.get(key, key)

    @property
    def code(self) -> str:
        return self._strings.get("locale.code", self.language)
