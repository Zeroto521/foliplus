// control/LayerControl/declaredParse — the scalar declared* readers behind one
// registry.
//
// Three per-layer foliplus declarations (border, icon_size, marker_color) share
// one mechanical shape: a scalar (one-key object, one number, one preset name)
// validated by a small parse and read through the shared readDeclaredKey
// skeleton. This module owns those three parses and the key → parse registry, so
// a new scalar channel registers here instead of opening another file; the
// dimension-specific parse stays its own function (its own message, its own
// invalid accumulation) — only the file is shared.
//
// The read/cache/warn-once skeleton lives in {@link readDeclaredKey}; the
// module owns only the parses and the thin readers that dispatch on them.
// Public API names are unchanged (readDeclaredBorder / readDeclaredIconSize /
// readDeclaredMarkerColor) — callers are untouched except for the import path.
import { type RejectFn, readDeclaredKey } from "./declaredKey.js";
import { STYLE_MODE, type StyleMode } from "#core/layer/index.js";
import { MARKER_COLOR_PRESET_HEX } from "#core/leaflet/index.js";

/** The one recognised border declaration mode literal (public API, snake_case).
 *  The JS internal literal is "followFill"; this reader maps. */
const DECLARED_BORDER_MODE = "follow_fill";

type DeclaredBorderRead = {
  /** The declared border mode, or undefined when absent/unbuildable. */
  declared?: StyleMode;
  /** One line per rejected key, already logged — kept for tests. */
  invalid: string[];
};

/** The declared marker icon pixel size, or undefined when absent/invalid. */
type DeclaredIconSize = number | undefined;

/** The declared marker chassis preset name, or undefined when absent/unknown. */
type DeclaredMarkerColor = string | undefined;

/** Empty read for a null/undefined layer (provisional, never cached). */
const EMPTY: DeclaredBorderRead = { invalid: [] };

/** Parse the flat `border` declaration into a validated border mode.
 *
 *  A declaration names the ONE mode the author wants as the read-time default.
 *  A missing/unknown `mode`, or a non-object declaration, drops the whole
 *  declaration (read as "not declared" — the border stays on its derived
 *  default rather than painting a mode the author never saw validated).
 *  Unknown keys degrade one by one (warned once, the rest survives — the
 *  shape is single-key today, so any extra key is a typo to surface).
 *
 *  @param reject one rejected key: record it for the caller (tests) and warn
 *    once per (declared-key, layer, key) — the skeleton owns the dedup, the
 *    parse owns the message and the `invalid` accumulation. */
const parseBorder = (
  raw: unknown,
  layerId: string | undefined,
  reject: RejectFn,
): DeclaredBorderRead => {
  const invalid: string[] = [];
  /** Reject one key: record it for the caller, and warn once per scope. */
  const rejectKey = (key: string, message: string): void => {
    invalid.push(message);
    reject(
      `${layerId ?? ""}:${key}`,
      `declared border: ignoring ${message} on layer "${layerId ?? "<unregistered>"}"`,
    );
  };
  if (raw === null || raw === undefined) return EMPTY;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    rejectKey("border", `a non-object border declaration ${JSON.stringify(raw)}`);
    return { invalid };
  }
  const data = raw as Record<string, unknown>;

  // Unknown keys are ignored one by one; the rest of the declaration survives.
  for (const key of Object.keys(data)) {
    if (key !== "mode") {
      rejectKey(key, `an unknown border key ${JSON.stringify(key)} (expected mode)`);
    }
  }

  // mode is the one required key: without it there is no declaration.
  if (data.mode === undefined) {
    rejectKey("mode", "a border declaration without a border.mode");
    return { invalid };
  }
  if (data.mode !== DECLARED_BORDER_MODE) {
    rejectKey(
      "mode",
      `invalid border.mode ${JSON.stringify(data.mode)} (expected "follow_fill")`,
    );
    return { invalid };
  }
  return { declared: STYLE_MODE.FOLLOW_FILL, invalid };
};

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

/** Parse the raw `marker_color` declaration into a validated preset name.
 *
 *  A non-string (Python already gated the shape, but the namespace is a folium
 *  passthrough nothing validates at construction) or a blank name is rejected.
 *  A name outside MARKER_COLOR_PRESET_HEX is rejected too — an unknown preset
 *  would otherwise fall through to the derived blue and the author would never
 *  know their declaration was ignored. */
const parseMarkerColor = (
  raw: unknown,
  layerId: string | undefined,
  reject: (scope: string, message: string) => void,
): { declared?: DeclaredMarkerColor; invalid: string[] } => {
  const invalid: string[] = [];
  if (raw === undefined || raw === null) return { invalid };
  if (typeof raw !== "string" || !raw.trim()) {
    const message = `a non-string marker_color ${JSON.stringify(raw)}`;
    reject("shape", message);
    invalid.push(message);
    return { invalid };
  }
  const name = raw.trim();
  if (!(name in MARKER_COLOR_PRESET_HEX)) {
    const message = `an unknown marker_color preset ${JSON.stringify(name)} (expected one of ${Object.keys(MARKER_COLOR_PRESET_HEX).join(", ")})`;
    reject("preset", message);
    invalid.push(message);
    return { invalid };
  }
  return { declared: name, invalid };
};

/** The key → parse registry: a new scalar declared* channel registers here. */
const SCALAR_PARSES = {
  border: parseBorder,
  icon_size: parseIconSize,
  marker_color: parseMarkerColor,
} as const;

/** Read (and cache) the border declaration on one layer.
 *
 *  @param layer the carrier a control registered; `null`/undefined before the
 *    layer is linked — the read is then provisional and never cached.
 *  @param layerId the id used in warnings (the declaration itself is keyed by
 *    the layer object, which is stable once linked).
 */
const readDeclaredBorder = (layer: unknown, layerId?: string): DeclaredBorderRead => {
  if (layer === null || typeof layer !== "object") return EMPTY;
  return readDeclaredKey(layer, layerId, "border", SCALAR_PARSES.border);
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
        "icon_size",
        SCALAR_PARSES.icon_size,
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
        "marker_color",
        SCALAR_PARSES.marker_color,
        warn,
      )
    : { invalid: [] };

export { readDeclaredBorder, readDeclaredIconSize, readDeclaredMarkerColor };
