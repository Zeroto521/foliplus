foliplus
========

foliplus: the missing piece between "see the map" and "use the map".
GeoPandas handles data, Folium renders it, foliplus brings it to life.

.. raw:: html

   <p align="center">
     <a href="quickstart.html#display-map">
       <img src="https://raw.githubusercontent.com/Zeroto521/foliplus/main/doc/source/_static/preview.png" alt="foliplus preview">
     </a>
   </p>

Scope
-----

Layer data passed to foliplus is read-only: no editing, upload, or deletion.

Data processing happens upstream. foliplus handles the map, not the data.

Features
--------

.. grid:: 1 2 2 3

   .. grid-item-card:: 📷 ExportControl
      :padding: 2
      :link: api/foliplus.ExportControl.html

      Capture a specific area of the map and export it as an image.

   .. grid-item-card:: 🖥️ FullscreenControl
      :padding: 2
      :link: api/foliplus.FullscreenControl.html

      Fullscreen toggle with auto-hide for other controls.

   .. grid-item-card:: 🔥 HeatmapControl
      :padding: 2
      :link: api/foliplus.HeatmapControl.html

      H3 hexbin heatmap with zoom-adaptive resolution and labeled hexagons.

   .. grid-item-card:: 🗂️ LayerControl
      :padding: 2
      :link: api/foliplus.LayerControl.html

      Layer panel to organize, inspect, and zoom to map layers.

   .. grid-item-card:: 🎯 LocateControl
      :padding: 2
      :link: api/foliplus.LocateControl.html

      Fly to the user's current position.

   .. grid-item-card:: 📏 MeasureControl
      :padding: 2
      :link: api/foliplus.MeasureControl.html

      Measure distances, areas, and circles; place geocoded markers; then edit
      by dragging nodes.

   .. grid-item-card:: 📐 ScaleControl
      :padding: 2
      :link: api/foliplus.ScaleControl.html

      Scale bar with metric units and optional zoom level display.

   .. grid-item-card:: 🔍 SearchControl
      :padding: 2
      :link: api/foliplus.SearchControl.html

      Coordinate and address search via Nominatim reverse geocoding.

.. toctree::
   :maxdepth: 1
   :caption: Quickstart

   quickstart

.. toctree::
   :maxdepth: 1
   :caption: API Reference

   api

.. toctree::
   :maxdepth: 1
   :caption: Advanced Guide

   security

.. toctree::
   :maxdepth: 1
   :caption: Changelog

   changelog
