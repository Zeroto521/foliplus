Security
========

XSS
---

foliplus renders its own UI into a page it does not own, so the three sinks that
accept markup come from outside the author's control. Each one is covered.

``iconSvg``
  Layer metadata passed to ``LayerAPI.registerLayer()`` or ``LayerAPI.createLayers()``
  lands in an ``innerHTML`` sink on the type-icon column. It is cleaned once, at
  registration, so every consumer sees the same value and a re-registration cannot
  re-inject a payload the first pass rejected.

``registerHintIcon()``
  Hint icons are SVG. They are cleaned at registration, and the hint text is
  always a ``TextNode``, so a rogue locale value cannot turn a hint into markup.

Reverse-geocoded addresses
  The address in a location marker's popup comes from Nominatim — a third-party
  API the page never controls. The popup body is built as an element tree rather
  than a string, so Leaflet appends it as-is and a poisoned POI name can only
  ever be text.

The gate
--------

Sanitisation is an allowlist, not an escape hatch. ``common/sanitize.ts`` keeps
a small set of presentation attributes and drops everything with the capacity to
run code or reach the network.

Kept markup
  Any SVG element in the SVG namespace. Attributes are limited to geometry and
  paint values (``d``, ``points``, ``cx``, ``cy``, ``r``, ``rx``, ``ry``,
  ``x``, ``y``, ``transform``, ``viewBox``, ``fill``, ``stroke`` and their
  opacity/line variants, fonts, and ``class``, ``role``, ``aria-label``).

  ``xmlns`` is not in that list because it is not an attribute in the security
  sense — it is how a serialiser knows a subtree is SVG. It is always kept, with
  its value still checked for a scheme, because dropping it changes how the
  markup is written back out: a browser then re-declares the SVG namespace on
  every element, and an attribute such as ``class`` can stop matching its CSS
  rule. This is a serialisation concern with no security payoff, so the
  declaration is kept rather than treated as content.

Dropped markup
  ``script``, ``foreignObject``, ``iframe``, ``object``, ``embed``, and ``use``,
  every element in the HTML namespace, every ``on*`` handler, and any
  URL-valued attribute — external paint servers such as
  ``fill="url(http://…)"``, ``data:`` URIs, and protocol-relative ``//``
  references. A local ref such as ``fill="url(#g)"`` is ordinary SVG and stays.
  ``href`` survives only as a same-document ``#fragment``. A style block
  survives only as a pure rule with no ``javascript:`` and no ``<``.

Parsing happens as ``image/svg+xml``, which keeps the SVG namespace and the
``viewBox`` case intact and rejects an HTML breakout; a multi-root payload, a
degenerate ``<svg/>``, or an HTML root all yield an empty string.
