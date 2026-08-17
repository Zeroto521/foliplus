{% set underline = "=" * (fullname|length) %}
{{ fullname }}
{{ underline }}

.. currentmodule:: {{ module }}

.. autoclass:: {{ objname }}
   :members:
   :undoc-members:
   :inherited-members:
   :show-inheritance:
   :special-members: __init__