Reference
=========

Selected design and audit references that guide the internal architecture
slices. Each design is complete; the implementation lives on the task card
named in the entry.

.. note::

   The design/audit documents sit in ``.foliplus/`` — a local scratch
   directory that git does not track, next to the task board that produced
   them. Each entry also names the tracked source it governs, so the
   reference can be followed from a fresh checkout.

UI toolbox
----------

Extract ``foliplus/js/ui/`` — the shared panel "appearance-composition layer
+ public façade" — in five slices (S1..S5) that fix the layer rule
``common ← ui ← core/leaflet`` and the public surface.

- Design reference: ``.foliplus/zeta/task-31-ui-toolbox-design.md``
- Working notes: ``.foliplus/zeta/task-31-working-notes.md``
- Source: ``foliplus/js/ui/`` (the shared overlay engines, ``dropdown``/``form``/``listbox``/``placement``/``schemePicker``/``slider`` after the #900 move)
- Implements: task-31 (completed)

PanelController
---------------

Unify panel behaviour and ownership: ``createPanel``/``attachPanel``, the
three-state ``dismiss`` (``escape`` / ``outsidePress`` /
``internalCloseClick``), ``closeFromClick`` vs ``swallowClick``, and
``exclusiveGroup``.

- Design reference: ``.foliplus/task-47-m2-panel-controller.md``
- Source: ``foliplus/js/core/leaflet/panel.ts``
- Implements: task-47

Dropdown consolidation
----------------------

One self-built dropdown engine (``ui/listbox.ts``) with six shape slots;
the native dropdown becomes a downgrade adapter and the scheme picker
migrates onto the engine.

- Design reference: ``.foliplus/zeta/dropdown-consolidation-design.md``
- Source: ``foliplus/js/ui/listbox.ts``
- Implements: task-77

Docstring consistency audit
---------------------------

Unify every control docstring to the ``LayerControl`` template: grid tables,
Google section order S → P → E → N, ``code-block`` examples, and the
bare-quote convention.

- Audit reference: ``.foliplus/zeta/docstring-consistency-audit.md``
- Template: :doc:`api/foliplus.LayerControl`
- Source: ``foliplus/control/LayerControl/``
- Status: historical audit — the docstring gate now lives in ``script/check/docstring_check.py`` (verified in CI)
