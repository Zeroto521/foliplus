Folium integration boundary
===========================

.. currentmodule:: foliplus

This page is the parameter-level boundary contract between folium's native
layer/control API and foliplus's panel: which folium channels the panel
reads honestly, which ones have a documented limit, and which folium
options the panel ignores. The layer-family overview lives on
:doc:`folium-integration`; this page goes one level deeper, into the
options foliplus inspects.

Recognised channels
-------------------

``foliplus={...}`` declaration
  A folium layer accepts an unknown keyword and forwards it into
  ``layer.options``; a custom or third-party layer may also carry the mapping
  on a ``foliplus`` attribute (``layer.foliplus = {...}``), which folium's
  ``Layer.__init__`` never consumes. Both channels are accepted
  (``foliplus/control/LayerControl/_layer.py``, ``foliplus_namespace`` -- the
  attribute wins when present) and the keys the panel owns are validated
  against ``FOLIPLUS_KEYS``:

  * ``fill``, ``border``, ``marker_color``, ``icon_size``, ``icon``,
    ``marker``, ``opacity`` -- read straight off the namespace by the JS
    panel; Python only shape-validates and warns once (``icon`` / ``marker``
    are the sub-dimension blocks, e.g. ``{"colorOpacity": 60}``).
  * ``zoom_range``, ``folder``, ``filter``, ``label`` -- normalised in
    Python into the CONF ``data[].zoom_range`` / ``data[].folder`` /
    ``data[].filter`` / ``data[].label``, so the visibility, grouping,
    filter and label policies each read one validated CONF fact instead of
    the raw namespace.

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
  author's glyph name from the rendered icon (``markerIcon.ts``
  ``authorGlyphName``) and the author's glyph paint from
  ``authorGlyphColorOf``, so a panel row starts from the glyph the author
  wrote rather than substituting one.

``Icon(color=)`` / ``icon_color=`` colour
  ``folium.Icon`` carries the marker chassis and glyph colours as options,
  and folium camelizes every option key at render (``folium/template.py``),
  so the browser receives ``markerColor`` / ``iconColor`` and the runtime
  reads those spellings. The snake_case spelling is accepted as a fallback
  for hand-built Leaflet icons, with camelCase winning when both are
  present; the contract is pinned by
  ``test/python/BaseControl/test_folium_camelize.py``. The author's
  ``Icon(color=...)`` paints the marker chassis and outranks a
  ``foliplus={"marker_color": ...}`` read-time default; the panel's own pick
  outranks both.

Channel limits
--------------

``foliplus={"marker_color": ...}`` hex
  The declaration accepts the runtime's 19 chassis preset names only; a hex
  value is rejected (warned once, read as undeclared). A hex colour belongs
  in folium's own ``Icon(color="#00A6A6")`` (accepted from folium
  ``1.0.0``), which also outranks the declaration.

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

``GroupedLayerControl`` / ``WebGL Earth 3D`` / ``PolyLineDecorator`` / ``BeautifyIcon`` / ``Geoman``
  Third-party folium plugins. foliplus does not integrate any of them;
  using one does not add a row to the panel and the plugin's own control
  must manage the layer.

``folium.GeoJson`` ``style_function`` / ``highlight_function``
  A folium ``style_function`` paints the layer outside the foliplus
  declaration channel: the per-feature metadata foliplus reads comes from
  geopandas' ``__folium_color`` property (``_fill_author/payload.py``),
  which a ``style_function`` layer does not have, so the panel starts from
  the layer's single-colour surface rather than the author's per-feature
  paint. Use the ``foliplus={"fill": ...}`` / ``{"border": ...}``
  declarations (or the panel) instead; the layer still gets its row.

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
