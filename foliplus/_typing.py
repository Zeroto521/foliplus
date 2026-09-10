from typing import Annotated, Literal

from ._validate import Bound

Position = Literal["topleft", "topright", "bottomleft", "bottomright"]

# Constrained numbers. The base type stays plain ``int`` / ``float`` so editors
# and docs read normally; ``Bound`` adds the runtime check picked up by
# ``@validate`` (see ``foliplus/_validate.py``).
Zoom = Annotated[int, Bound(1, 18)]
ClassCount = Annotated[int, Bound(2, 9)]
PositiveInt = Annotated[int, Bound(0, None, exclusive_low=True)]
NonNegativeInt = Annotated[int, Bound(0, None)]
PositiveFloat = Annotated[float, Bound(0.0, None, exclusive_low=True)]
NonNegativeFloat = Annotated[float, Bound(0.0, None)]
Fraction = Annotated[float, Bound(0.0, 1.0)]
