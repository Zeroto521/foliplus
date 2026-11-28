"""Face declarations: one normalisation point for a face's declaration sub-keys.

A per-layer face declaration (`foliplus={"icon": {...}}`) carries the
sub-dimensions ONE paint face can set. Python reads the author's RAW dict, before
folium renders it, so it always sees the author's snake spelling
(`color_opacity`). The rendered namespace is version-dependent: newer folium
camelizes the nested dict keys (`colorOpacity`), 0.15.x keeps the author's
spelling - so a reader on either side that looks for one spelling only misses
the other, which is the defect this module closes. It is the one place that
decides the legal spellings of a face sub-key: both the camelCase and the
snake_case spelling are accepted (`colorOpacity` / `color_opacity`) and every
face is normalised to one canonical camelCase shape before any reader looks at
it. The rule mirrors `camelize` in the JS declared-key reader, which does the
same translation for the top-level keys - the two stacks must agree on exactly
one spelling, or a declaration that works in one is dead in the other.

A face declaration that is not a mapping is read as "not declared" WITHOUT a
warning here: the namespace shape gate
(`foliplus.control.LayerControl._layer.foliplus_namespace`) already reports that
defect once, and a second report for one mistake is noise. An unknown or
duplicated sub-key, and an unusable value, warn once and are dropped alone - the
rest of the face survives, so one typo never disables the other sub-dimensions.
"""

from __future__ import annotations

from collections.abc import Mapping

from .key import ICON_KEY, MARKER_KEY
from .opacity import normalise_color_opacity
from .paint import _declared_hex
from .warning import warn_foliplus

#: The whitespace a declared face string is trimmed of, as explicit code points.
#: KEEP IN STEP with FACE_TRIM_CODEPOINTS in
#: foliplus/js/control/LayerControl/declaredParse.ts - the cross-stack guard
#: (test/python/guard/test_face_vocabulary.py) compares both literals. This is
#: an explicit set, not str.strip(): Python strips U+001C-U+001F / U+0085 that
#: JavaScript trim() keeps, and JavaScript trims U+FEFF (a BOM pasted from a CSV)
#: that Python keeps - either spelling would be accepted on one stack and
#: missed or rejected on the other.
FACE_TRIM_CODEPOINTS: tuple[int, ...] = (
    0x20,  # space
    0x09,  # horizontal tab
    0x0A,  # line feed
    0x0D,  # carriage return
    0x0C,  # form feed
    0x0B,  # vertical tab
    0xA0,  # no-break space
    0x1C,  # file separator
    0x1D,  # group separator
    0x1E,  # record separator
    0x1F,  # unit separator
    0x85,  # next line (NEL)
    0xFEFF,  # zero-width no-break space (BOM)
)
_FACE_TRIM_CHARS = "".join(chr(codepoint) for codepoint in FACE_TRIM_CODEPOINTS)


def _trim_face_string(value: str) -> str:
    """Trim a declared face string of the shared whitespace set only."""
    return value.strip(_FACE_TRIM_CHARS)


#: The icon face sub-dimensions: canonical camelCase key -> accepted spellings
#: (canonical first). A multi-word key accepts the snake_case spelling because
#: the author writes the raw Python dict (and older folium keeps it as-is).
_ICON_FACE_KEYS: dict[str, tuple[str, ...]] = {
    "glyph": ("glyph",),
    "color": ("color",),
    "colorOpacity": ("colorOpacity", "color_opacity"),
}

#: The marker face carries the chassis alpha only; the chassis COLOUR is the
#: top-level `marker_color` declaration, not a face sub-key.
_MARKER_FACE_KEYS: dict[str, tuple[str, ...]] = {
    "colorOpacity": ("colorOpacity", "color_opacity"),
}


def _where(owner: str, subject: str | None) -> str:
    return f"{owner}: {subject}" if subject else owner


def normalise_face_keys(
    raw: object,
    *,
    keys: Mapping[str, tuple[str, ...]],
    name: str,
    owner: str,
    subject: str | None = None,
    source: str | None = None,
) -> dict[str, object] | None:
    """Normalise one face declaration's sub-keys to their canonical spelling.

    Returns the face keyed by the canonical camelCase names, or `None` for a
    face declaration that is absent / not a mapping ("not declared"). Every
    accepted spelling of a key (camel and snake) maps to the one canonical name,
    so a reader downstream never has to ask which spelling it got.

    `keys` is the face's vocabulary: canonical key -> accepted spellings,
    canonical spelling first. An unknown sub-key warns once and is dropped; the
    rest of the face survives. A key written twice (both spellings) warns and
    the first spelling in the author's dict wins, so the reader's answer never
    depends on which spelling the author happened to write first while both are
    present in an ambiguous order.
    """
    if raw is None or not isinstance(raw, Mapping):
        # The namespace shape gate owns the non-mapping warning (see the module
        # docstring); this reader reports "not declared" and stays silent.
        return None

    spellings = {
        spelling: canonical
        for canonical, accepted in keys.items()
        for spelling in accepted
    }
    canonical_names = list(keys)
    where = _where(owner, subject)
    declared = source or f"foliplus[{name!r}]"

    def reject_key(key: object, reason: str) -> None:
        warn_foliplus(
            f"{owner}:{subject or '-'}:{name}:{key}:{reason}",
            f"{where} declares {declared}[{key!r}] {reason} - ignored",
        )

    normalised: dict[str, object] = {}
    seen: set[str] = set()
    for key, value in raw.items():
        canonical = spellings.get(key) if isinstance(key, str) else None
        if canonical is None:
            reject_key(
                key,
                f"as an unknown {name} sub-key {key!r}; expected one of "
                f"{canonical_names}",
            )
            continue
        if canonical in seen:
            reject_key(
                key,
                f"as the second spelling of {canonical!r} (the face declares "
                "it twice); the first spelling wins",
            )
            continue
        seen.add(canonical)
        normalised[canonical] = value
    return normalised


def normalise_icon_face(
    raw: object,
    *,
    owner: str,
    subject: str | None = None,
    source: str | None = None,
) -> dict[str, object] | None:
    """Normalise one `foliplus={"icon": {...}}` face declaration.

    Returns the canonical record (`glyph`, `color`, `colorOpacity` - only the
    keys the author declared and every one of them usable) when the face is a
    mapping, else `None`. "Not declared" and "declared but unusable" are the
    same state downstream: the panel keeps its derived icon face rather than
    showing a value the author never saw validated.

    The SHAPE is gated here - a non-empty glyph name, a CSS hex (expanded and
    lowered exactly as the JS reader normalises it), a 0-100 integer percent.
    The glyph VOCABULARY is the JS panel's verdict (the FontAwesome stylesheet
    it probes), so an unknown glyph name survives this reader and is surfaced by
    the panel - the same split marker_color follows for its preset table.
    """
    face = normalise_face_keys(
        raw,
        keys=_ICON_FACE_KEYS,
        name=ICON_KEY,
        owner=owner,
        subject=subject,
        source=source,
    )
    if face is None:
        return None

    where = _where(owner, subject)
    declared = source or f"foliplus[{ICON_KEY!r}]"

    def reject(key: str, reason: str) -> None:
        warn_foliplus(
            f"{owner}:{subject or '-'}:{ICON_KEY}:{key}:{reason}",
            f"{where} declares {declared}[{key!r}] {reason} - ignored",
        )

    normalised: dict[str, object] = {}
    if "glyph" in face:
        glyph = face["glyph"]
        if isinstance(glyph, str) and _trim_face_string(glyph):
            normalised["glyph"] = _trim_face_string(glyph)
        else:
            reject("glyph", f"as {glyph!r}; expected a non-empty string")
    if "color" in face:
        color = face["color"]
        if color is None:
            # A null colour is a declared-but-unusable value, not "absent": the
            # JS reader warns on it, and a silent drop here would be exactly the
            # one-side-warns/one-side-silent split this channel retired.
            reject("color", "as None; expected a CSS hex (#rgb or #rrggbb)")
        else:
            if isinstance(color, str):
                color = _trim_face_string(color)
            normalised_color = _declared_hex(
                color, lambda reason: reject("color", reason)
            )
            if normalised_color is not None:
                normalised["color"] = normalised_color
    if "colorOpacity" in face:
        opacity = face["colorOpacity"]
        if opacity is None:
            reject(
                "colorOpacity",
                "as None; expected a whole number from 0 to 100",
            )
        else:
            normalised_opacity = normalise_color_opacity(
                opacity,
                owner=owner,
                subject=subject,
                source=f"{declared}['colorOpacity']",
            )
            if normalised_opacity is not None:
                normalised["colorOpacity"] = normalised_opacity
    return normalised


def normalise_marker_face(
    raw: object,
    *,
    owner: str,
    subject: str | None = None,
    source: str | None = None,
) -> dict[str, object] | None:
    """Normalise one `foliplus={"marker": {...}}` face declaration.

    The marker face carries the chassis alpha only: the chassis COLOUR is the
    top-level `marker_color` declaration, so a face-level `color` is a
    misspelling and warns instead of silently reading as "not declared".
    """
    face = normalise_face_keys(
        raw,
        keys=_MARKER_FACE_KEYS,
        name=MARKER_KEY,
        owner=owner,
        subject=subject,
        source=source,
    )
    if face is None:
        return None

    where = _where(owner, subject)
    declared = source or f"foliplus[{MARKER_KEY!r}]"
    normalised: dict[str, object] = {}
    if "colorOpacity" in face:
        opacity = face["colorOpacity"]
        if opacity is None:
            # Declared but unusable, not absent - the JS reader warns too.
            reason = "as None; expected a whole number from 0 to 100"
            warn_foliplus(
                f"{owner}:{subject or '-'}:{MARKER_KEY}:colorOpacity:{reason}",
                f"{where} declares {declared}['colorOpacity'] {reason} - ignored",
            )
        else:
            normalised_opacity = normalise_color_opacity(
                opacity,
                owner=owner,
                subject=subject,
                source=f"{declared}['colorOpacity']",
            )
            if normalised_opacity is not None:
                normalised["colorOpacity"] = normalised_opacity
    return normalised
