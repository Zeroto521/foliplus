"""Base class for all foliplus controls: the render contract.

Every foliplus component (FullscreenControl, HeatmapControl, LayerControl, ...)
inherits from :class:`BaseControl`. This module owns the Python -> JS bridge:

* **Shared assets** -- the merged shared stylesheet (``css/common/*.css``),
  ``runtime.js`` (with ``runtime/*.js`` bundled), and the common locale tables
  (``_TABLES``) plus all per-component locale tables (``_COMPONENT_TABLES``)
  are emitted **once per map** into ``<head>`` by :meth:`BaseControl.render`,
  deduplicated by :data:`_SHARED_ASSETS_NAME`. The artifact pipeline itself lives
  in :mod:`foliplus._asset`; this module re-exports it so the historical
  ``foliplus.BaseControl`` import surface is unchanged.

* **Config serialization** -- each control's instance attributes are serialized into
  the JS ``CONFIG`` object. The static part is assembled by :meth:`BaseControl._build_config`
  (shared ``name``/``position`` keys + schema-derived :attr:`_config_fields` +
  dynamic :meth:`_extra_config` data), then :attr:`BaseControl._config_block` overlays
  the locale tables (custom strings only) and code.
"""

from __future__ import annotations

from typing import Any

from branca.element import Element, Figure
from folium import MacroElement
from folium.elements import JSCSSMixin
from jinja2 import Template

from ._asset import (
    _LINE_TERMINATORS,
    _SHARED_ASSETS_NAME,
    MANIFEST,
    MissingAssetsError,
    _build_component_template,
    _build_shared_header,
    _load_asset,
    _safe_json,
    control_assets,
    dist_dir,
    expected_artifacts,
    src_dir,
)
from ._cdn_loader import load_cdn
from ._config_schema import config_fields, derive_schema, schema_fingerprint
from ._package import version as _foliplus_version
from ._typing import ControlPosition
from ._validate import validate
from .locale import LocaleConfig, _load_component_tables, _load_tables, resolve_locale


class BaseControl(JSCSSMixin, MacroElement):
    """Base class for all foliplus controls.

    Handles resource loading (CSS/JS), template injection, and localization. All
    foliplus components (FullscreenControl, HeatmapControl, LayerControl, etc.) inherit
    from this class.

    Subclasses declare their CONFIG surface in :mod:`foliplus._config_schema`; the
    :attr:`_config_fields` tuple each subclass exposes is derived from that table at
    class-definition time, and may be extended with dynamic render-time data by
    overriding :meth:`_extra_config`. The base class merges these with the shared
    ``name``/``position`` keys and the locale code into the ``CONFIG`` dict.
    Built-in component locale tables are injected once per map in
    ``window.foliplus._COMPONENT_TABLES``; only user-custom strings
    (:meth:`LocaleConfig.from_json`) ship per-instance in ``CONFIG.locale_tables``.

    Parameters
    ----------
    position : str, default "topleft"
        One of "topleft", "topright", "bottomleft", "bottomright".

    locale : str or LocaleConfig, optional
        Language code ("en", "zh") or a :class:`LocaleConfig` instance. If
        omitted, the browser's ``navigator.language`` is used at runtime to select the
        appropriate locale table, falling back to English.
    """

    #: Instance attributes re-exported as JS ``CONFIG`` keys (key name == attr name).
    #:
    #: For controls with a schema entry in ``foliplus._config_schema.SCHEMAS``
    #: this tuple is derived by :meth:`__init_subclass__` from the schema's
    #: non-runtime-only keys — the schema is the single source of truth and the
    #: tuple cannot drift from it. Each name is looked up via
    #: ``getattr(self, name)`` during :meth:`_build_config`, so the attribute
    #: must be set in ``__init__`` before the template is rendered. A name that
    #: does not resolve raises ``ValueError`` from :meth:`_build_config`
    #: (fail-fast) rather than failing later as a bare ``AttributeError``.
    _config_fields: tuple[str, ...] = ()

    #: CDN dependencies for the control, as ``[(name, url), ...]``.
    #:
    #: Derived by :meth:`__init_subclass__` from :mod:`foliplus._cdn_loader`
    #: for controls with a schema entry (which is every shipped control), so
    #: renaming a class cannot silently break its CDN wiring. Controls without
    #: a schema entry keep whatever they (or a base class) declared.
    default_js: list[tuple[str, str]] = []

    def __init_subclass__(cls, **kwargs: Any) -> None:
        """Derive ``_config_fields`` and ``default_js`` from the schema.

        For every subclass **defined in the ``foliplus`` package** and named in
        ``foliplus._config_schema.SCHEMAS`` — which is every shipped control —
        two class attributes are derived here at import time (``cls`` is being
        defined):

        * ``cls._config_fields`` — the schema's non-runtime-only keys, in
          declaration order. The schema is the single source of truth for
          the CONFIG contract, so the tuple cannot drift from it.
        * ``cls.default_js`` — the CDN dependency list for this control, keyed
          by class name (:func:`foliplus._cdn_loader.load_cdn`), so renaming
          a class cannot silently sever its CDN wiring.

        Subclasses outside the ``foliplus`` package are always left untouched,
        whether or not they have a schema entry: a third-party control named
        ``SearchControl`` in its own module keeps its declared
        ``_config_fields`` / ``default_js`` rather than being overwritten by
        foliplus's ``SearchControl`` schema. Folium-shipped controls are
        additionally gated on the schema table, so ``BaseControl`` itself and
        any foliplus-internal test double without a schema entry are untouched.
        The test suite's ``test_every_basecontrol_subclass_is_registered``
        catches a new shipped control without a schema entry at test time.
        """
        super().__init_subclass__(**kwargs)
        if not cls.__module__.startswith("foliplus."):
            return
        cls._config_fields = config_fields(derive_schema(cls))
        cls.default_js = load_cdn(cls.__name__)

    @validate
    def __init__(
        self,
        *,
        position: ControlPosition = "topleft",
        locale: str | LocaleConfig | None = None,
    ):
        super().__init__()
        self._name = self.__class__.__name__
        self.position = position
        self._locale = (
            resolve_locale(locale, self._name) if locale is not None else None
        )
        self._config: dict[str, object] = {}

    @property
    def _locale_code(self) -> str:
        """The resolved locale code, or ``""`` when unset (auto-detect at runtime).

        A lightweight assertion point: it exposes the resolved code without
        rendering, which would otherwise require the full Jinja2 + dist pipeline.
        """
        return self._locale.code if self._locale else ""

    @property
    def _config_block(self) -> str:
        """Render the JS ``CONFIG`` dict as a JSON string for IIFE injection.

        Builds on the static config from :meth:`_build_config` (cached on
        :attr:`_config`) and overlays the two render-time pieces only known when
        the template is rendered:

        * ``locale_tables`` — user-custom string table (only from
          :meth:`LocaleConfig.from_json`; built-in component tables are injected
          once per map in ``window.foliplus._COMPONENT_TABLES``).
        * ``locale_code`` — the resolved language code (``"en"``, ``"zh"``, ...).
        * ``__schema`` / ``__version`` — the diagnostic envelope: a short
          fingerprint of the CONFIG schema contract (see
          :func:`foliplus._config_schema.export.schema_fingerprint`) and the
          package version that emitted the block. Not part of the typed
          snake_case CONFIG surface; nothing in the JS components reads them.

        Returns ``"{}"`` when the config is empty, otherwise a JSON string safe for
        inline ``<script>`` injection.

        The JSON is escaped through :func:`_safe_json` rather than plain
        ``json.dumps``: config values can carry model-supplied strings (layer
        names, export filenames, ...), and a literal ``</script>`` inside them
        would otherwise close the inline script tag and let the rest of the
        string execute as script.
        """
        config = dict(self._build_config())
        # Built-in component tables are injected once per map in
        # window.foliplus._COMPONENT_TABLES. Only user-custom strings
        # (LocaleConfig.from_json) need to ship per-instance in CONFIG.
        code = self._locale.code if self._locale else ""
        strings = self._locale._strings if self._locale else {}
        builtins = _load_tables(f"{self._name}.*.json")
        custom = strings and strings != builtins.get(code, {})
        config["locale_tables"] = {code: strings} if custom else {}
        config["locale_code"] = code
        config["__schema"] = schema_fingerprint()
        config["__version"] = _foliplus_version
        # Diagnostic envelope: which CONFIG contract and which Python package
        # emitted this block. The dunder names keep them out of the snake_case
        # CONFIG contract on purpose — no component reads them; they exist so a
        # rendered page (and a mixed-version bug report) can name the schema
        # generation and the emitting version without guessing. `__schema` is
        # the short SHA-256 of the schema dump, stable for one contract and
        # changed by any FieldSpec/version bump.
        # config always contains at least name/position — never empty.
        return _safe_json(config)

    def _extra_config(self) -> dict[str, object]:
        """Return render-time config injected into the JS ``CONFIG`` object.

        Subclasses override this to supply data that is only known at render time
        (e.g. LayerControl's layer list collected from the parent map). The base
        implementation returns an empty dict.
        """
        return {}

    def _build_config(self) -> dict[str, object]:
        """Assemble the static part of the JS ``CONFIG`` dict.

        The merge order is:

        1. Shared keys — ``name`` and ``position`` (always present).
        2. Exported fields — every attribute named in :attr:`_config_fields`. A name
           that does not resolve to a real instance attribute raises ``ValueError``
           (fail-fast, naming the control and the offending field).
        3. Dynamic data — whatever :meth:`_extra_config` returns (render-time only,
           e.g. LayerControl's layer list).

        Later entries win on key conflicts. The result is cached on :attr:`_config` so
        tests can inspect exactly what gets serialized into the JS ``CONFIG`` object.
        :attr:`_config_block` copies this dict before adding the locale overlay, so
        the cache is never polluted with render-time keys.
        """
        config: dict[str, object] = {"name": self._name, "position": self.position}
        for f in self._config_fields:
            try:
                config[f] = getattr(self, f)
            except AttributeError:
                raise ValueError(
                    f"{self._name}._config_fields: '{f}' not set in __init__"
                ) from None
        config.update(self._extra_config())
        self._config = config
        return config

    def render(self, **kwargs: Any) -> str:
        """Inject the shared asset bundle into the figure header exactly once.

        The runtime JS, shared CSS, common locale tables, and per-component
        locale tables are identical for every control, so they are emitted a
        single time per map (deduplicated by :data:`_SHARED_ASSETS_NAME`)
        instead of being repeated in each control's template. Placing them in
        ``<head>`` also guarantees they load before any control's body script runs.
        """
        figure = self.get_root()
        if (
            isinstance(figure, Figure)
            and _SHARED_ASSETS_NAME not in figure.header._children
        ):
            figure.header.add_child(
                Element(_build_shared_header()), name=_SHARED_ASSETS_NAME
            )
        html: str = super().render(**kwargs)
        return html

    @property
    def _template(self) -> Template:
        """This control's Jinja2 template, built once and shared per class.

        ``_build_component_template`` is ``@cache``-d per component name, so every
        instance of a control shares one compiled ``Template`` — the template is
        identical for every instance (only the render-time CONFIG and map name
        differ, both resolved at render time). Each control therefore pays the
        compile cost exactly once per process.

        An explicit per-instance assignment still wins, so branca's ``Element``
        contract is intact: ``Element.__init__(template=...)`` and the
        ``__setstate__`` unpickling path both store into the instance dict and
        are honored. Pickling is unaffected either way — ``__getstate__`` pops
        ``_template`` from the instance dict, which is absent when the class
        cache is in use.
        """
        instance_template: Template | None = self.__dict__.get("_template")
        if instance_template is not None:
            return instance_template
        return _build_component_template(self._name)

    @_template.setter
    def _template(self, value: Template) -> None:
        self.__dict__["_template"] = value
