from typing import Annotated, Literal

from ._validate import Bound

Position = Literal["topleft", "topright", "bottomleft", "bottomright"]

# Constrained numbers shared by more than one control. The base type stays plain
# ``int`` / ``float`` so editors and docs read normally; ``Bound`` adds the runtime
# check picked up by ``@validate`` (see ``foliplus/_validate.py``). A bound used by
# a single control is written inline at that parameter instead of living here.
Zoom = Annotated[int, Bound(1, 18)]
PositiveInt = Annotated[int, Bound(0, None, exclusive_low=True)]
Fraction = Annotated[float, Bound(0.0, 1.0)]
