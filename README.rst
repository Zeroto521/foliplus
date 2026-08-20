foliplus
=======

.. rst-class:: center

   foliplus: the missing piece between "see the map" and "use the map."
   GeoPandas handles data, Folium renders it, foliplus brings it to life.

   |pypi| |versions| |tests| |coverage|

Features
--------

.. grid:: 1 2 2 3

   .. grid-item-card:: 📷 ExportControl
      :padding: 2
      :link: https://foliplus.readthedocs.io/en/latest/api/foliplus.ExportControl.html

      Capture a specific area of the map and export it as an image.

   .. grid-item-card:: 🖥️ FullscreenControl
      :padding: 2
      :link: https://foliplus.readthedocs.io/en/latest/api/foliplus.FullscreenControl.html

      Fullscreen toggle with auto-hide for other controls.

   .. grid-item-card:: 🔥 HeatmapControl
      :padding: 2
      :link: https://foliplus.readthedocs.io/en/latest/api/foliplus.HeatmapControl.html

      H3 hexbin heatmap with zoom-adaptive resolution and labeled hexagons.

   .. grid-item-card:: 🗂️ LayerControl
      :padding: 2
      :link: https://foliplus.readthedocs.io/en/latest/api/foliplus.LayerControl.html

      Drag-and-drop layer ordering with geometry icons, color picker, and panes.

   .. grid-item-card:: 🎯 LocateControl
      :padding: 2
      :link: https://foliplus.readthedocs.io/en/latest/api/foliplus.LocateControl.html

      Fly to the user's current position.

   .. grid-item-card:: 📏 MeasureControl
      :padding: 2
      :link: https://foliplus.readthedocs.io/en/latest/api/foliplus.MeasureControl.html

      Distance measurement, area measurement, circle drawing, and GPS marker with
      geocoding.

   .. grid-item-card:: 📐 ScaleControl
      :padding: 2
      :link: https://foliplus.readthedocs.io/en/latest/api/foliplus.ScaleControl.html

      Scale bar with metric or imperial units and optional zoom level display.

   .. grid-item-card:: 🔍 SearchControl
      :padding: 2
      :link: https://foliplus.readthedocs.io/en/latest/api/foliplus.SearchControl.html

      Coordinate and address search via Nominatim reverse geocoding.

Quick Start
-----------

.. code:: bash

   pip install foliplus

.. code:: python

   import folium
   import foliplus

   m = folium.Map(location=[31.23, 121.47], zoom_start=12)

   foliplus.MeasureControl().add_to(m)
   foliplus.ExportControl().add_to(m)
   foliplus.SearchControl().add_to(m)
   foliplus.HeatmapControl().add_to(m)
   foliplus.LayerControl().add_to(m)

   m.save("map.html")

Beyond Plugins
--------------

Traditional map component libraries treat each tool as an independent plugin. foliplus
was designed as a **platform** from the start:

- Components **communicate** with each other, instead of working in isolation
- Layers are **managed centrally**, instead of each tool creating its own DOM
- Conflicts are **resolved automatically**, instead of tools interfering with each other
- Third-party components can **plug into** the system, instead of being locked out

Built-in Coordination
---------------------

Every component in foliplus registers its canvas or layer through **LayerControl**,
which manages z-order, visibility, and lifecycle centrally.
This means all tools share a single layer stack—no z-index clashes, no orphaned DOM
elements.

On top of this shared layer foundation, tools coordinate further:

- While **measuring**, search and locate are blocked to prevent map interaction conflicts
- During **export**, measurement pauses, heatmap renders in full resolution, and layer
  order is synced for a complete screenshot
- When a layer is **deleted** from the layer panel, the component that owns it
  (e.g. measurement) auto-cleans its state
- When layers change, the heatmap refreshes automatically

All of this happens without manual wiring—the framework handles it internally.

.. |pypi| image:: https://img.shields.io/pypi/v/foliplus
.. |versions| image:: https://img.shields.io/pypi/pyversions/foliplus
.. |tests| image:: https://github.com/Zeroto521/foliplus/actions/workflows/test.yaml/badge.svg
.. |coverage| image:: https://codecov.io/gh/Zeroto521/foliplus/branch/main/graph/badge.svg
