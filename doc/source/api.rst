API Reference
============

.. automodule:: foliplus
   :no-members:

.. autosummary::
   :toctree: api
   :recursive:

   BaseControl
   ExportControl
   FullscreenControl
   HeatmapControl
   LayerControl
   LocaleConfig
   LocateControl
   MeasureControl
   ScaleControl
   SearchControl
   locale

.. _layerapi-get-style:

LayerAPI.getStyle — read a layer's current effective style
===========================================================

``map.foliplus.LayerAPI.getStyle(id)`` returns a single snapshot of one
layer's current effective style — what the style panel publishes, aggregated
from the same per-dimension registry the panel itself reads. A host page or a
downstream control (legend, readout, print composer) calls it to learn "what
colour is this layer painting right now" without reaching into LayerControl
internals.

The method is optional on ``LayerAPI``: the lightweight stub returns
``null`` and callers fall back to their own defaults.

.. code-block:: javascript

    // After the map and LayerControl are wired, render a legend swatch for
    // one overlay by reading the layer's current fill colour.
    const api = map.foliplus.LayerAPI;
    const snapshot = api.getStyle("facility-points");
    if (!snapshot) return;
    const fill = snapshot.fill;
    if (!fill || fill.perFeature) {
        // Per-feature layers paint each leaf its own colour — a single
        // swatch would misrepresent them. Read the ramp via fill.value.
        return;
    }
    const color = fill.color;   // "#3388ff"
    const opacity = fill.opacity; // 0.6, or undefined when not stored
    // Render a legend item the way your page wants:
    const swatch = document.createElement("span");
    swatch.style.background = color;
    swatch.style.opacity = String(opacity ?? 1);
    swatch.textContent = "Facility Points";

Subscribe to ``foliplus:layer:style-change`` and re-read ``getStyle`` when the
panel commits — the event payload carries only the layer id, the snapshot is
the caller's to fetch:

.. code-block:: javascript

    map.foliplus.events.on("foliplus:layer:style-change", ({ id }) => {
        const snapshot = api.getStyle(id);
        updateLegend(id, snapshot);
    });

Delegated layers (Heatmap / Measure) merge their ``styleProvider`` values into
the same shape, so a host reads one shape regardless of who owns the paint.
