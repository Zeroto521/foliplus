Folium parameter boundary
=========================

.. currentmodule:: foliplus

This page is the parameter-level reference: which folium parameters the foliplus
panel reads, how each one is validated, and which options the panel ignores. For
the integration steps -- the supported layer families, the folium version
relationship, group rows and the plugin surface -- see :doc:`folium-integration`;
the two pages do not repeat each other.

Recognised parameters
---------------------

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
  ``folium.overlay`` maps one-to-one onto the row's ``role``
  (``_role.py`` ``layer_role``; the mapping itself is documented on
  :doc:`folium-integration`). ``folium.show`` is the row's initial
  visibility (``_collect.py`` ``show: bool(item.show)``) -- a ``show=False``
  layer is listed but hidden until the user toggles it.

``Icon`` glyph / prefix
  ``folium.Icon(icon=, prefix=)`` sets the glyph. foliplus reads the
  author's glyph name from the rendered icon (``markerIcon.ts``
  ``authorGlyphName``) and the author's glyph paint from
  ``authorGlyphColorOf``, so a panel row starts from the glyph the author
  wrote rather than substituting one. The chassis-colour precedence between
  ``Icon(color=)`` and ``foliplus={"marker_color": ...}`` is documented on
  :doc:`folium-integration`.

``name=`` and the row label
  ``folium``'s ``name`` is the row's display label (``_collect.py``
  ``name: item.layer_name``). When no name is given, folium derives one
  from the layer class (``layer_name``); foliplus never synthesises a
  label, it reads ``layer_name`` as-is.

Unsupported / ignored parameters
--------------------------------

``folium.GeoJson`` ``style_function`` / ``highlight_function``
  A folium ``style_function`` paints the layer outside the foliplus
  declaration channel: the per-feature metadata foliplus reads comes from
  geopandas' ``__folium_color`` property (``_fill_author/payload.py``),
  which a ``style_function`` layer does not have, so the panel starts from
  the layer's single-colour surface rather than the author's per-feature
  paint. Use the ``foliplus={"fill": ...}`` / ``{"border": ...}``
  declarations (or the panel) instead; the layer still gets its row.

Third-party plugins, folium's native ``LayerControl`` and LayerGroup sub-layer expansion
  These are outside the panel's surface. What each one does, and which plugins
  do compose, is documented once on :doc:`folium-integration`.

.. note::

   Every ``foliplus={...}`` key that is not one of ``FOLIPLUS_KEYS``
   warns once and is ignored (``unknown:{key}``). No folium option is
   silently dropped by foliplus -- if it is not read, it either warns or
   is outside the panel's surface (a ``style_function``, a third-party
   plugin).
