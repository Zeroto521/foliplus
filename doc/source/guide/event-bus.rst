Event bus
=========

.. currentmodule:: foliplus

foliplus controls do not wire directly to each other's internals. They
communicate through a single per-map **event bus** exposed at
``map.foliplus.events``, so a control can react to another control's state
without holding a reference to it. This page is the catalog of the events the
bus publishes and how to subscribe.

Why an event bus
----------------

The bus is the decoupling point between controls on the same map. Instead of
one control calling another's method, the producer *publishes* a named event
and any subscriber *listens*. The three reasons foliplus routes cross-control
communication through it:

* **Component decoupling.** A control never imports another control. LayerControl
  does not know HeatmapControl exists; it only knows the event name. A control
  can be added or removed without recompiling the others.
* **Cross-control coordination.** The panel, the measure tool, the heatmap and
  the export tool coordinate through events: the heatmap re-scans when
  LayerControl reports a layer change, LayerControl's label layer refreshes
  before an export, the mode registry tells every control who currently owns
  the map.
* **One shared vocabulary.** Events use a unified ``foliplus:<component>:<action>``
  naming, so the event name alone tells you who published it and what happened.

The bus is **per-map**. Two maps on one page have independent buses, and a
listener on one map never hears another map's events.

.. note::

   The bus is a **JavaScript-side API**. There is no Python-side event hook:
   ``map.foliplus.events`` exists only after the foliplus runtime has loaded in
   the browser, and the Python object you build (``LayerControl()``) has no
   ``on`` method. To observe events you add a small JS snippet to the map's
   HTML or a custom JS block (see :ref:`event-bus-listen`).

.. _event-bus-listen:

Subscribing
-----------

Subscribe with ``map.foliplus.events.on(name, handler)``. The handler receives
the payload (an object, or nothing for a void event) and, as a second argument,
the delivery metadata whose ``origin`` field answers *who initiated the event*
when the producer declared one.

.. code-block:: javascript

   const off = map.foliplus.events.on("foliplus:layer:style-change", (payload, meta) => {
     // payload: { id: string }
     console.log("style changed for layer", payload.id);
   });

   // later, to stop listening:
   off();

The handler runs **synchronously** in the same tick as the publish, before the
next animation frame. ``on`` returns an unsubscribe function, so a subscriber
that adds a listener from a page-level script should store it and call it when
the listener is no longer needed.

.. note::

   The events a handler reads are the **stable API** — their names are part of
   the public contract and should not change between releases. The **payload
   fields are implementation details**: they are documented here for the
   current release, but a consumer should treat a payload it does not
   recognise as opaque and should not assume a field it does not see. If you
   need a value that is not in the payload, read it from ``map.foliplus.LayerAPI``
   or the owning control rather than reconstructing it.

Event catalog
-------------

.. list-table::
   :header-rows: 1
   :widths: 30 12 58

   * - Event name
     - Policy
     - Payload and when it fires
   * - ``foliplus:layer:change``
     - terminal
     - ``{ id, kind }`` — a layer's **effective** map membership flipped: registered, unregistered, reordered, toggled on/off, or re-attached, after policy (focus, zoom range) has been applied. The user's own intent is a separate channel (see ``foliplus:layer:intent-change``).
   * - ``foliplus:layer:intent-change``
     - terminal
     - ``{ id, kind, intent: { visible } }`` — the user's stored visibility choice moved, independent of whether the effective membership also changed. Fires from the executor's intent diff, so every write path (API, panel checkbox, bulk toggle) reaches the bus through one point.
   * - ``foliplus:layer:removed``
     - terminal
     - ``{ id }`` — a layer left the registry through the generic teardown (``unregisterLayer``); the id stays registerable. Never read it as "the user deleted this".
   * - ``foliplus:layer:deleted``
     - terminal
     - ``{ id }`` — the user deleted a component-owned layer from the panel (``deleteLayer`` for layers owning ``styleSetters``). Disjoint from ``foliplus:layer:removed`` per deletion path.
   * - ``foliplus:mode:change``
     - notification
     - ``{ component, mode }`` — a component's active mode changed (measurement start/stop, export crop/export, LayerControl focus). ``mode`` is ``null`` when the component released the map.
   * - ``foliplus:export:before``
     - notification
     - ``{ component }`` — export process started (crop locked / download initiated).
   * - ``foliplus:export:after``
     - terminal
     - ``{ component }`` — export completed (success, failure or abort).
   * - ``foliplus:layer:item-count-change``
     - terminal
     - ``{ id }`` — a layer's feature count changed (data update / feature add or remove).
   * - ``foliplus:layer:style-change``
     - terminal
     - ``{ id }`` — a layer's style value changed through the **foliplus style write path** (style panel, ``styleBag.apply``, the opacity projection, or a Heatmap/Measure setter). Programmatic ``layer.setStyle()`` on the underlying Leaflet layer bypasses this path and does **not** fire it. The event carries the id only; pull the fresh value from the layer's ``styleProvider``.
   * - ``foliplus:control:attached``
     - notification
     - ``{ component }`` — a control finished attaching to the map (``onAdd`` complete). Lets LayerControl run its init pass from a ready signal instead of a timer.
   * - ``foliplus:layer:item-added``
     - terminal
     - ``{ id }`` — a new row entered the panel (the registry accepted a fresh id and the list needs to insert a row for it).
   * - ``foliplus:layer:item-updated``
     - terminal
     - ``{ id }`` — an existing row was re-registered: its content or metadata changed and the row needs updating.
   * - ``foliplus:layer:item-refreshed``
     - terminal
     - ``{ id }`` — a row's cells should re-render from the current state; the checkbox, type icon, count and label columns re-read the layer's live values.
   * - ``foliplus:layer:capability-changed``
     - notification
     - ``{ id }`` — a surface's capability projection changed during an ordering pass (a foreign leaf left a registered tree, or a mixed tree degraded an axis). Separate from ``foliplus:layer:item-refreshed`` because it is raised inside the ordering pass.
   * - ``foliplus:layer:item-removed``
     - terminal
     - ``{ id }`` — a row left the panel through the generic teardown path (``unregisterLayer``); wider reach than ``foliplus:layer:removed`` for the UI subscribers.
   * - ``foliplus:layer:role-count-changed``
     - terminal
     - ``{ role }`` — the role's row count shifted (a row joined or left, the toggle-all checkbox tri-state may have changed).
   * - ``foliplus:layer:list-rebuild``
     - terminal
     - ``(void)`` — the panel's row **order** changed (``bringLayerToFront``, ``moveLayerUp``/``moveLayerDown``, drag drop). The name is historical: the signal means "order changed", not "rebuild".
   * - ``foliplus:layer:no-basemap-changed``
     - terminal
     - ``(void)`` — the solid-color basemap row's state changed; the panel's no-basemap hint / row state needs recomputing.
   * - ``foliplus:layer:overlay-clear``
     - notification
     - ``(void)`` — a floating overlay is being opened; every peer overlay (menu, attrs, style, rename, focus, and Leaflet's popups) tears itself down. Each peer decides for itself whether to close and how.
   * - ``foliplus:layer:filter-change``
     - notification
     - ``{ id }`` — a component's filter changed (stage 2, component-internal). The filter's owner has already applied and re-rendered when this publishes; observers pull the fresh model through the same ``filterProvider``. This is *not* a public intent event — the public intent channel (``foliplus:layer:intent-change``) carries ``{ visible }``.

Policy
------

Each event declares one publish policy, resolved once and stored with the
event's listeners — a dispatcher cannot choose a different contract at a call
site:

* **terminal** — the event is the operation's last step. Every listener runs;
  the first failure is raised to the producer once the fan-out is done.
* **notification** — the event sits *inside* a producer's transaction. Every
  listener still runs, but a consumer failure is recorded to the diagnostic log
  instead of being thrown, so an observer cannot interrupt the producer's
  remaining local work.

Both policies run **every** listener; they differ only in what happens to a
throwing one. The ``origin`` metadata (``user``/``programmatic``/``system``)
answers *who initiated* an event when the producer declared one; a void event
carries the origin as its only argument.

Examples
--------

The two examples below use the same idea: a subscriber reacts to a change
without being the producer.

**React to a style change (JavaScript).** ``foliplus:layer:style-change`` fires
after the style is committed; read the fresh value from the layer, not from
the payload.

.. code-block:: javascript

   map.foliplus.events.on("foliplus:layer:style-change", ({ id }) => {
     const layer = map.foliplus.LayerAPI.findLayer(id);
     if (!layer) return;
     // read the fresh style from the layer, not from the payload
     syncMyExternalLegend(layer);
   });

**React to a visibility toggle (JavaScript).** ``foliplus:layer:intent-change``
fires when the user's *stored choice* moved, even if policy kept the layer off
the map. Subscribers that mirror the user's intent (checkboxes, sliders,
controls) ride this channel, not ``foliplus:layer:change``.

.. code-block:: javascript

   map.foliplus.events.on("foliplus:layer:intent-change", ({ id, intent }) => {
     if (!intent.visible) return;
     const layer = map.foliplus.LayerAPI.findLayer(id);
     if (layer) bringToFront(layer);
   });

There is no Python-side ``on`` — the bus is JavaScript-only. If you are writing
a notebook and want to observe an event, add a small JS block to the map:

.. code-block:: python

   import folium
   from foliplus import LayerControl

   m = folium.Map(location=[31.23, 121.47], zoom_start=10)
   LayerControl().add_to(m)
   # Observe a foliplus event from Python by injecting a JS listener:
   m.get_root().html.add_child(folium.Element("""
     <script>
       m.on('load', function () {
         var bus = m.foliplus && m.foliplus.events;
         if (bus) bus.on('foliplus:layer:style-change', function (payload) {
           console.log('style changed for layer', payload.id);
         });
       });
     </script>
   """))
   m

The map is built explicitly here because there is no data layer to hand to
``explore``. If your data is a GeoDataFrame, start from ``gdf.explore(...)``
instead and inject the same script into the map it returns.

Contract boundary
-----------------

The **event names are the stable API.** foliplus treats them as a public
contract: a consumer may subscribe to any name in the catalog above and rely
on it firing with the documented payload shape. The **payload fields are
implementation details** — they are typed and documented per release, but a
subscriber should not treat a field it has not seen as guaranteed, and should
never reconstruct a value it can read from ``LayerAPI`` or the owning control.
Void events (``foliplus:layer:list-rebuild``, ``foliplus:layer:no-basemap-changed``,
``foliplus:layer:overlay-clear``) carry no payload at all — their handler
receives only the origin metadata.
