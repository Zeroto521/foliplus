from typing import Annotated, Literal

from ._validate import Bound

# ``ControlPosition`` is a ``Literal`` union whose TS type is Leaflet's
# ``ControlPosition`` — the Python name and the TS name are the same so the
# schema reflector maps them without an alias-metadata entry. It stays a
# bare Literal: wrapping it in ``Annotated`` would change what
# ``ControlPosition.__args__`` exposes (a public contract) and drop the
# runtime check ``@validate`` reads from a ``Literal``. The schema tag
# therefore lives in ``_config_schema.SHARED`` next to the other shared
# fields, where it belongs — the alias-metadata channel is for aliases
# that are private to one control module.
ControlPosition = Literal["topleft", "topright", "bottomleft", "bottomright"]

# Constrained numbers shared by more than one control. The base type stays plain
# ``int`` / ``float`` so editors and docs read normally; ``Bound`` adds the runtime
# check picked up by ``@validate`` (see ``foliplus/_validate.py``). A bound used by
# a single control is written inline at that parameter instead of living here.
Zoom = Annotated[int, Bound(1, 18)]
PositiveInt = Annotated[int, Bound(0, None, exclusive_low=True)]
Fraction = Annotated[float, Bound(0.0, 1.0)]
