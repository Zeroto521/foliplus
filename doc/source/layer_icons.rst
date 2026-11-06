Layer Icons
============

The :class:`foliplus.LayerControl` style drawer offers an **Icon** row for
marker layers. It sets a single glyph for every marker in the layer — a
whole-layer choice, not a per-marker assignment.

How to open it
--------------

1. Open the :class:`foliplus.LayerControl` panel and find your marker layer.
2. Click the row's **Style** action (the ⋮ menu has it too).
3. The style drawer opens with an **Icon** row (only for marker layers).

What the row does
-----------------

- The trigger shows the layer's current glyph, or **原始 / Original** when the
  layer still shows the author's own icon.
- Clicking the trigger opens a **grid picker** — a 2D matrix of 40 Font
  Awesome 6 (solid) glyphs.
- Click a cell to apply it (the grid closes); the row and every marker in the
  layer update at once.
- Keyboard: arrows move 2D, Enter/Space applies, Home/End jump, Esc closes,
  and clicking outside closes.
- **Reset** restores every marker to the icon the layer author drew.

The whole layer, not one marker
-------------------------------

Choosing a glyph writes one **icon** intent for the layer and replays it across
every marker leaf. The author's original icon is captured on first write, so:

- **Reset** restores exactly what the author drew (a fresh author icon is
  rebuilt — never a re-read, which would restore your own last choice).
- A layer you never touched keeps exactly the author-declared icon.

Supported glyphs (Font Awesome 6)
---------------------------------

The panel provides a fixed set of **40 Font Awesome 6** glyph names. These are
the names the panel writes into the persisted layer state and renders as
``<i class="fa-solid fa-<name>">``. They are FA6 names — the panel paints the
``fa-solid`` family only.

.. list-table::
   :widths: auto
   :header-rows: 0

   * - ``circle`` ``square`` ``diamond`` ``star`` ``heart`` ``flag`` ``cross`` ``map-pin``
   * - ``location-dot`` ``location-arrow`` ``compass`` ``map`` ``globe`` ``plane`` ``paper-plane`` ``camera``
   * - ``tag`` ``bookmark`` ``bell`` ``book`` ``envelope`` ``fire`` ``leaf`` ``music``
   * - ``phone`` ``tree`` ``gear`` ``triangle-exclamation`` ``circle-info`` ``circle-check`` ``circle-xmark`` ``xmark``
   * - ``plus`` ``minus`` ``arrow-up`` ``arrow-down`` ``arrow-left`` ``arrow-right`` ``house`` ``magnifying-glass``

All 40 come from Font Awesome 6.2.0, the version folium loads on every page
(see `folium/folium.py`). No icon font or glyph data is bundled by foliplus —
the page already loads `@fortawesome/fontawesome-free@6.2.0/css/all.min.css`.

Matching your own folium.Icon
-----------------------------

When you write :class:`folium.Icon` with a FA6 solid name from the list above
and ``prefix="fa"``, the panel recognizes it as the layer's current glyph and
shows it in the trigger.

If you use a name that is **not** in the 40, the panel does **not** recognize
it (no alias table — `resolveGlyph` returns `null`). The row falls back to
**原始 / Original** and leaves the author's icon in place until you pick one
of the 40. This is the documented behavior, not a bug: the panel renders
exactly what it offers.

.. note::

   Folium's own ``Icon(prefix="fa")`` historically used **FA4** names (the
   awesome-markers era). The panel uses **FA6** names. There is **no alias
   compatibility** — an FA4 name such as ``map-marker`` is not in the 40 and
   will not be recognized.

FA4 → FA6 migration
-------------------

Font Awesome renamed many icons between FA4 (what most existing folium code
uses) and FA6 (what folium now loads). This panel uses **FA6 names**. Common
renames:

.. list-table::
   :widths: auto
   :header-rows: 1

   * - FA4 (old)
     - FA6 (new)
     - note
   * - ``map-marker``
     - ``map-location-dot`` / ``map-pin``
     - ``map-pin`` is in the panel's 40
   * - ``info-sign``
     - ``circle-info``
     - in the panel's 40
   * - ``star-o``
     - ``fa-regular fa-star``
     - regular family, **not** solid — not in panel
   * - ``heart-o``
     - ``fa-regular fa-heart``
     - regular family, **not** solid — not in panel
   * - ``check-circle-o``
     - ``fa-regular fa-circle-check``
     - regular family, **not** solid — not in panel
   * - ``pencil-square-o``
     - ``fa-pen-to-square``
     - not in panel
   * - ``bar-chart-o``
     - ``fa-chart-column``
     - not in panel
   * - ``trash-o``
     - ``fa-trash-can``
     - not in panel
   * - ``resize-full`` / ``resize-small``
     - ``fa-expand`` / ``fa-compress``
     - not in panel

.. warning::

   The FA4 **``-o``** (outline) names map to the FA6 **regular** family. The
   panel paints the ``fa-solid`` family, so a regular-only glyph name will
   **not** render in the panel. Use the solid replacement instead (e.g.
   ``star-o`` → ``star``).

Icon row vs. fill and labels
----------------------------

- The Icon row is **only for marker layers** — a layer whose leaves expose a
  runtime ``setIcon``. A polygon or line layer has no icon row.
- It is **separate** from **fill** (a polygon's color/ramp) and from **text
  labels** (the ``label`` annotation config). An icon is a marker's glyph;
  fill paints an area; a label draws text.

Quickstart example
------------------

The quickstart notebook (`doc/source/quickstart.ipynb`) uses an
``icon="map-pin"``, ``prefix="fa"`` marker. ``map-pin`` is one of the
panel's 40, so the panel recognizes it.

.. code-block:: python

   import folium

   m = folium.Map()
   folium.Marker(
       [31.23, 121.47],
       icon=folium.Icon(icon="map-pin", prefix="fa"),
   ).add_to(m)
   LayerControl().add_to(m)
   m.save("map.html")
