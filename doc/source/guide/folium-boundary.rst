Folium integration boundary
===========================

.. currentmodule:: foliplus

This page is the parameter-level boundary contract between folium's native
layer/control API and foliplus's panel: which folium channels the panel
reads honestly, which ones have a documented pitfall, and which folium
options the panel ignores. The layer-family overview lives on
:doc:`folium-integration`; this page goes one level deeper, into the
options foliplus inspects.

Recognised channels
-------------------

``foliplus={...}`` declaration
  A folium layer accepts an unknown keyword and forwards it into
  ``layer.options``. The panel reads ``layer.options["foliplus"]`` (see
  ``foliplus/control/LayerControl/_layer.py``, ``foliplus_namespace``) and
  validates the keys it owns against ``FOLIPLUS_KEYS``:

  * ``fill``, ``label``, ``border``, ``filter`` -- read straight off
    ``layer.options.foliplus`` by the JS panel (Python only shape-validates
    and warns).
  * ``zoom_range``, ``folder`` -- normalised here into the CONF
    ``data[].zoom_range`` / ``data[].folder`` so the visibility and
    grouping policies read one fact instead of the raw namespace.
  * ``marker_color``, ``icon_size`` -- shape-validated at collection time
    and read by the JS panel straight off the namespace (the preset/hex
    vocabulary lives in the JS reader).

  An unknown key warns once (``unknown:{key}``) and is ignored; a
  non-mapping ``foliplus=`` value warns and is ignored too.

``overlay=`` / ``show=``
  ``folium.overlay`` is the native grouping flag (a data layer is an
  overlay, a basemap is not). foliplus reads it verbatim as its ``role``
  (``_role.py`` ``layer_role``): ``overlay=True`` becomes an overlay row,
  ``False`` a basemap row. ``folium.show`` is read as the row's initial
  visibility (``_collect.py`` ``show: bool(item.show)``) -- a ``show=False``
  layer is listed but hidden until the user toggles it.

``LayerGroup`` (folium ``>=1.0.0``)
  ``folium.LayerGroup`` is now a ``Layer`` subclass, so the panel's
  ``isinstance(item, Layer)`` gate admits it automatically and it renders
  as **one group row** (see :ref:`group_rows`). Its sub-layers are not
  expanded -- a container is its own unit. foliplus needs no change to
  accept it.

``Icon`` glyph / prefix
  ``folium.Icon(icon=, prefix=)`` sets the glyph. foliplus reads the
  author's glyph from the rendered icon (``markerIcon.ts``
  ``authorGlyphColorOf``) and the glyph name rides in the panel as the
  author surface.

Pitfall channels
----------------

``Icon(color=)`` / ``icon_color=`` colour
  **Before the ``fix/folium-icon-color-compat`` fix (current ``origin/main``
  state):** folium emits the colour as ``options.marker_color`` /
  ``options.icon_color`` (snake_case), but the JS runtime reads the
  camelCase ``markerColor`` / ``iconColor``. The two vocabularies never
  met, so the colour folium wrote was a **dead value** in the browser:
  ``L.AwesomeMarkers.icon(options)`` reads ``markerColor`` (and the panel's
  ``authorGlyphColorOf`` reads ``iconColor``), neither of which folium
  populates. The marker falls back to the default blue.

  A hex colour is the same story: folium ``1.0.0`` accepts
  ``Icon(color="#00A6A6")`` (``is_hex`` path, ``map.py:440-446``), but the
  value only reaches ``options.marker_color`` and is never read back.

  **After** that fix lands (task-216, PR ``#1361``): foliplus reads the
  snake_case keys too, so ``Icon(color=...)`` paints what the author wrote.
  This page should be updated to the ``after`` wording once the PR merges.

``name=`` and the row label
  ``folium``'s ``name`` is the row's display label (``_collect.py``
  ``name: item.layer_name``). When no name is given, folium derives one
  from the layer class (``layer_name``); foliplus never synthesises a
  label, it reads ``layer_name`` as-is.

Unsupported / ignored list
--------------------------

foliplus does not integrate these folium / third-party options. Each is
listed with what happens when you use it.

``folium.LayerControl``
  foliplus ships its own panel. Using folium's native ``LayerControl``
  alongside foliplus's renders **two** layer toggles -- do not combine
  them. ``LayerControl`` from foliplus is the one to use.

``GroupedLayerControl`` / ``WebGL Earth 3D`` / ``PolyLineDecorator`` /
``BeautifyIcon``
  Third-party folium plugins. foliplus does not integrate any of them;
  using one does not add a row to the panel and the plugin's own control
  must manage the layer.

``folium.GeoJson`` ``style_function`` / ``highlight_function``
  A folium ``style_function`` paints the layer outside the foliplus style
  write path, so the panel's style rows do **not** reflect it and the
  ``style-change`` event does **not** fire for it. Use the
  ``foliplus={"fill": ...}`` / ``{"border": ...}`` declarations (or the
  panel) instead.

LayerGroup sub-layer expansion
  A ``LayerGroup`` renders as one row; its children are **not** exposed
  as panel rows. That is the documented graceful-degradation stance (see
  :ref:`group_rows`), not a bug -- a tree view is future design, not
  supported today.

.. note::

   Every ``foliplus={...}`` key that is not one of ``FOLIPLUS_KEYS``
   warns once and is ignored (``unknown:{key}``). No folium option is
   silently dropped by foliplus -- if it is not read, it either warns or
   is outside the panel's surface (a ``style_function``, a third-party
   plugin).
