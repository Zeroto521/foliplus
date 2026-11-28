// control/LayerControl/declared/marker — the marker chassis scalars: icon size
// and marker colour.
//
// Both ride the shared {@link readDeclaredKey} skeleton (read / cache /
// warn-once); this module owns the two parses and their readers. The face
// channel (icon / marker sub-key maps) lives in ./face, the border and opacity
// scalars in ./parse.
import { readDeclaredKey } from "./key.js";
import { DECLARED_KEY } from "./declared-key.js";
import { trimDeclaredString } from "./trim.js";
import { MARKER_COLOR_PRESET_HEX } from "#core/leaflet/index.js";
import { isHexColor, normalizeHexColor } from "#platform/color.js";

/** The declared marker icon pixel size, or undefined when absent/invalid. */
type DeclaredIconSize = number | undefined;

/** The declared marker chassis preset name, or undefined when absent/unknown. */
type DeclaredMarkerColor = string | undefined;

/** Parse the raw `icon_size` declaration into a validated pixel size.
 *
 *  A non-integer, non-finite, zero or negative value is rejected (a marker icon
 *  scales as a box: a fractional pixel is not meaningful and a non-positive one
 *  would hide the marker). `readDeclaredKey` owns the warn-once, so a rejected
 *  declaration is reported once and read as "not declared". */
const parseIconSize = (
  raw: unknown,
  layerId: string | undefined,
  reject: (scope: string, message: string) => void,
): { declared?: DeclaredIconSize; invalid: string[] } => {
  const invalid: string[] = [];
  if (raw === undefined || raw === null) return { invalid };
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0) {
    const message = `a non-positive-integer icon_size ${JSON.stringify(raw)} (expected a whole number of pixels > 0)`;
    reject("shape", message);
    invalid.push(message);
    return { invalid };
  }
  return { declared: raw, invalid };
};

/** Parse the raw `marker_color` declaration into a validated preset name
 *  or a CSS hex.
 *
 *  A non-string (Python already gated the shape, but the namespace is a folium
 *  passthrough nothing validates at construction) or a blank name is rejected.
 *  A name outside MARKER_COLOR_PRESET_HEX and a malformed hex are rejected too
 *  — an unknown preset or bad hex would otherwise fall through to the derived
 *  blue and the author would never know their declaration was ignored. A
 *  valid hex is normalised (#rgb → #rrggbb, lowercased) and read as the
 *  chassis colour directly (the flat mask path paints any hex). */
const parseMarkerColor = (
  raw: unknown,
  layerId: string | undefined,
  reject: (scope: string, message: string) => void,
): { declared?: DeclaredMarkerColor; invalid: string[] } => {
  const invalid: string[] = [];
  if (raw === undefined || raw === null) return { invalid };
  // marker_color accepts preset names and CSS hex, so Python's normaliser
  // trims it before deciding; route the trim through the shared function so a
  // BOM / CJK space is not accepted on one stack only. The shape and the blank
  // case are separate messages, matching Python's wording: a blank string is
  // not a non-string.
  if (typeof raw !== "string") {
    const message = `a non-string marker_color ${JSON.stringify(raw)}`;
    reject("shape", message);
    invalid.push(message);
    return { invalid };
  }
  const name = trimDeclaredString(raw);
  if (!name) {
    const message =
      "an empty or whitespace-only marker_color; expected a non-empty string";
    reject("shape", message);
    invalid.push(message);
    return { invalid };
  }
  if (name in MARKER_COLOR_PRESET_HEX) return { declared: name, invalid };
  if (isHexColor(name)) {
    return { declared: normalizeHexColor(name).toLowerCase(), invalid };
  }
  const message = `an unknown marker_color preset ${JSON.stringify(name)} (expected one of ${Object.keys(MARKER_COLOR_PRESET_HEX).join(", ")} or a CSS hex)`;
  reject("preset", message);
  invalid.push(message);
  return { invalid };
};

/** Read (and cache) the icon pixel size declared on one layer.
 *
 *  @param layer the carrier a control registered; `null`/undefined before the
 *    layer is linked — the read is then provisional and never cached.
 *  @param layerId the id used in warnings (the declaration itself is keyed by
 *    the layer object, which is stable once linked).
 */
const readDeclaredIconSize = (
  layer: unknown,
  layerId?: string,
  warn?: (message: string) => void,
): { declared?: DeclaredIconSize; invalid: string[] } =>
  typeof layer === "object" && layer !== null
    ? readDeclaredKey<DeclaredIconSize, string>(
        layer,
        layerId,
        DECLARED_KEY.ICON_SIZE,
        parseIconSize,
        warn,
      )
    : { invalid: [] };

/** Read (and cache) the marker chassis preset declared on one layer.
 *
 *  @param layer the carrier a control registered; `null`/undefined before the
 *    layer is linked — the read is then provisional and never cached.
 *  @param layerId the id used in warnings (the declaration itself is keyed by
 *    the layer object, which is stable once linked).
 */
const readDeclaredMarkerColor = (
  layer: unknown,
  layerId?: string,
  warn?: (message: string) => void,
): { declared?: DeclaredMarkerColor; invalid: string[] } =>
  typeof layer === "object" && layer !== null
    ? readDeclaredKey<DeclaredMarkerColor, string>(
        layer,
        layerId,
        DECLARED_KEY.MARKER_COLOR,
        parseMarkerColor,
        warn,
      )
    : { invalid: [] };

export { readDeclaredIconSize, readDeclaredMarkerColor };
