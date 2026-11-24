Layer style change event
========================

.. currentmodule:: foliplus

This page documents the ``foliplus:layer:style-change`` event: when it
fires, what its payload carries, what a subscriber should do with it, and
how it differs from the neighbouring ``foliplus:layer:change`` event.

Quick reference
---------------

.. list-table::
   :header-rows: 1
   :widths: 22 78

   * - Field
     - Value
   * - Event name
     - ``foliplus:layer:style-change``
   * - Payload
     - ``{ id: string }`` -- the foliplus layer id
   * - Policy
     - Terminal (published as the last step of a style operation; a
       throwing handler cannot corrupt the style state already committed)
   * - Fires on
     - A style change through the **foliplus style write path** only

When it fires
-------------

``foliplus:layer:style-change`` is published **only** when a style change
goes through the foliplus style write path. That path is exercised by:

* ``LayerControl`` -- a style-panel commit of any dimension: fill, border,
  size, icon, icon-color, marker-color, label, opacity, or zoom-range.
* ``HeatmapControl`` -- aggregation mode, color scale, or opacity changes.
* ``MeasureControl`` -- style changes on measurement layers.
* ``styleBag.apply`` -- the shared style-bag write.
* The opacity projection -- a derived opacity write.

Programmatic ``layer.setStyle()`` calls on the underlying Leaflet layer
**bypass** the foliplus write path and therefore do **not** fire this
event. The same is true of any direct manipulation of the layer's options
object. If your code sets a style by reaching past foliplus, subscribers
will not be notified -- route the change through a style panel or
``styleBag.apply`` when you want the event to publish.

The event is published **after** the style is committed. The panel has
already re-rendered, the stored style record is already written, and the
map already reflects the new style when a handler runs. A subscriber
therefore reads a consistent world; it does not need to wait for a
follow-up event.

Payload
-------

.. code-block:: typescript

   interface LayerStyleChangePayload {
     id: string; // the foliplus layer id
   }

The payload is deliberately an **id-only carrier**. It names *which* layer
changed, not *what* the new style is. This is intentional and symmetric
with ``foliplus:layer:filter-change``:

* The style's owner (the component that declared ``styleSetters``) has
  already applied and rendered the change by the time the event publishes.
* A subscriber that needs the *value* of the change pulls it from the owner
  through the same channel the owner reads -- ``map.foliplus.LayerAPI``, or
  the component's own style accessor. It never reconstructs the value from
  the payload.
* Carrying only the id keeps the event cheap to publish on every settled
  input of a color picker or slider, where a full before/after snapshot
  would be wasteful.

Example:

.. code-block:: javascript

   map.foliplus.events.on("foliplus:layer:style-change", ({ id }) => {
     const layer = map.foliplus.LayerAPI.findLayer(id);
     if (!layer) return;
     // read the fresh style from the layer, not from the payload
     syncMyExternalLegend(layer);
   });

What a subscriber should do
---------------------------

.. rubric:: Do

* **Read the layer's current style** through ``LayerAPI`` or the owning
  component when you need the value. The payload gives you the *which*,
  not the *what*.
* **Debounce fan-out work.** A color-picker drag publishes on settled
  input, so a subscriber that re-renders a large legend should throttle on
  its side.
* **Treat the event as a notification, not a command.** The style is
  already applied; re-applying it from a handler is redundant and can
  fight the panel.

.. rubric:: Do not

* **Do not expect it from raw Leaflet writes.** ``layer.setStyle()`` and
  direct ``options`` mutation bypass the foliplus write path and publish
  nothing.
* **Do not use it to detect membership changes.** A style change does not
  add, remove, or reorder a layer -- that is ``foliplus:layer:change``.
* **Do not assume a specific dimension changed.** The payload does not say
  *which* style dimension moved (fill, border, opacity, ...). If you only
  care about one dimension, re-read it from the layer and compare against
  your last-known value.

vs ``foliplus:layer:change``
----------------------------

The two events are easy to confuse because both carry a small payload and
both are terminal. They answer different questions:

.. list-table::
   :header-rows: 1
   :widths: 30 35 35

   * -
     - ``foliplus:layer:change``
     - ``foliplus:layer:style-change``
   * - Question it answers
     - *Is this layer on the map, and what is it?*
     - *Did this layer's paint change?*
   * - Payload
     - ``{ id, kind }``
     - ``{ id }``
   * - Fires when
     - Registry/membership changes: registered, unregistered, reordered,
       toggled on/off, re-attached.
     - A style dimension moves through the foliplus write path.
   * - Semantic scope
     - **Effective** map membership after policy (focus, zoom range) is
       applied.
     - The **paint** of a layer that is already a member.
   * - Does NOT fire on
     - A pure style change (paint moved, membership did not).
     - A membership change (layer added/removed/reordered, paint
       unchanged).

A concrete walk-through: unchecking a layer's visibility checkbox fires
``foliplus:layer:change`` (membership flipped) but not
``foliplus:layer:style-change`` (paint unchanged). Recoloring that same
layer fires ``foliplus:layer:style-change`` but not
``foliplus:layer:change`` (membership unchanged). A single user action
that does both -- rare -- fires both.

There is also ``foliplus:layer:intent-change``, which carries the user's
*visibility intent* (``{ id, kind, intent: { visible } }``) separately
from effective membership. It exists because policy (zoom range, focus)
can gate the effective flip: a user who checks a box while the layer sits
outside its zoom range fires ``intent-change`` without a
``layer:change``. Style is a different dimension again and rides
``style-change``, not ``intent-change``.

Notes
-----

* The event is synchronous -- subscribers run in the same tick as the
  publish.
* The bus is per-map. Two maps on one page have independent buses, so an
  id is only meaningful within the map that published the event.
* A style change on a layer that is not (or no longer) registered still
  publishes with its id; guard ``LayerAPI.findLayer(id)`` returning null.
