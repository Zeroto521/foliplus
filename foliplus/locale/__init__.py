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

# LocaleConfig instance
>>> from foliplus.locale import ZH
>>> HeatmapControl(locale=ZH)

# Load from external JSON/YAML
>>> from foliplus.locale import LocaleConfig
>>> HeatmapControl(locale=LocaleConfig.from_file("my_locale.json"))
"""

from __future__ import annotations

import json
import locale as _stdlib_locale
import os
from dataclasses import dataclass, field
from pathlib import Path


# ===========================================================================
# Package root — used to locate built-in JSON locale files
# ===========================================================================
_LOCALE_DIR = Path(__file__).parent


# ===========================================================================
# Language code → string table (loaded from JSON files)
# ===========================================================================
def _load_builtin_tables() -> dict[str, dict[str, str]]:
    """Scan ``foliplus/locale/*.json`` and load each as a language table."""
    tables: dict[str, dict[str, str]] = {}
    for path in sorted(_LOCALE_DIR.glob("*.json")):
        if path.stem == "package":  # skip package metadata
            continue
        with open(path, encoding="utf-8") as f:
            table: dict[str, str] = json.load(f)
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
        Language code, e.g. ``"en"``, ``"zh"``. Falls back to English if
        the code is not in :data:`LOCALE_TABLES`.

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
    def from_file(cls, path: str | Path) -> LocaleConfig:
        """Load locale strings from an external JSON or YAML file.

        The file must contain a flat dictionary of ``key: "translated text"``
        entries, plus a ``locale.code`` key that identifies the language.

        Parameters
        ----------
        path : str or Path
            Path to a ``.json`` or ``.yaml`` / ``.yml`` file.

        Returns
        -------
        LocaleConfig

        Examples
        --------
        >>> LocaleConfig.from_file("locales/ja.json")
        >>> LocaleConfig.from_file("locales/fr.yaml")
        """
        path = Path(path)
        if path.suffix in (".yaml", ".yml"):
            try:
                import yaml  # type: ignore[import-untyped]
            except ImportError:
                raise ImportError(
                    "Loading YAML locale files requires PyYAML. "
                    "Install it with: pip install pyyaml"
                )
            raw: dict[str, str] = yaml.safe_load(path.read_text(encoding="utf-8"))
        elif path.suffix == ".json":
            raw = json.loads(path.read_text(encoding="utf-8"))
        else:
            raise ValueError(
                f"Unsupported locale file format: {path.suffix}. "
                "Use .json, .yaml, or .yml."
            )

        code = raw.get("locale.code", "en")
        obj = cls(language=code)
        obj._strings = raw
        return obj

    def to_file(self, path: str | Path) -> None:
        """Export the current string table to a JSON file."""
        path = Path(path)
        path.write_text(
            json.dumps(self._strings, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def get(self, key: str, default: str | None = None) -> str:
        """Look up a localized string by key."""
        return self._strings.get(key, default or key)

    def get_js_table(self) -> str:
        """Return the string table as a JavaScript object literal for injection."""
        return json.dumps(self._strings, ensure_ascii=False)

    @property
    def code(self) -> str:
        return self._strings.get("locale.code", "en")


# Pre-built instances for convenience
EN = LocaleConfig("en")
ZH = LocaleConfig("zh")


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
    """Detect user language from the environment.

    Checks (in order):
    1. ``accept_language`` argument (HTTP header)
    2. ``os.environ["LANG"]`` (Unix / WSL)
    3. ``os.environ["LC_ALL"]`` / ``os.environ["LC_MESSAGES"]``
    4. Python's ``locale.getdefaultlocale()``

    Falls back to ``"en"`` if none match.
    """
    candidates: list[str] = []

    if accept_language:
        candidates.append(accept_language)

    for env_var in ("LANG", "LC_ALL", "LC_MESSAGES"):
        val = os.environ.get(env_var, "")
        if val:
            candidates.append(val)

    try:
        sys_lang, _ = _stdlib_locale.getdefaultlocale()  # type: ignore[deprecated]
        if sys_lang:
            candidates.append(sys_lang)
    except Exception:
        pass

    for c in candidates:
        lang = c.split(",")[0].split("-")[0].split("_")[0].strip().lower()
        if lang in LOCALE_TABLES:
            return lang

    return "en"
