// control/LayerControl/declaredParse — the scalar declared* readers behind one
// registry.
//
// Three per-layer foliplus declarations (border, icon_size, marker_color) share
// one mechanical shape: a scalar (one-key object, one number, one preset name)
// validated by a small parse and read through the shared readDeclaredKey
// skeleton. Border is the two-shaped one — a follow_fill / value / solid /
// original mode shell or the flat fill-isomorphic value form — but still one
// normalized outcome read through the same skeleton. This module owns those
// three parses and the key → parse registry, so a new scalar channel registers
// here instead of opening another file; the dimension-specific parse stays its
// own function (its own message, its own invalid accumulation) — only the file
// is shared.
//
// The read/cache/warn-once skeleton lives in {@link readDeclaredKey}; the
// module owns only the parses and the thin readers that dispatch on them.
// Public API names are unchanged (readDeclaredBorder / readDeclaredIconSize /
// readDeclaredMarkerColor) — callers are untouched except for the import path.
import { parseValueDeclaration } from "./declaredFill.js";
import { camelize, type RejectFn, readDeclaredKey } from "./declaredKey.js";
import { STYLE_MODE, type StyleMode, type ValueConfig } from "#core/layer/index.js";
import { MARKER_COLOR_PRESET_HEX } from "#core/leaflet/index.js";
import { isHexColor, normalizeHexColor } from "#platform/color.js";

/** The recognised border declaration mode literals (public API, snake_case).
 *  The JS internal literals are "followFill" / "value" / "solid" / "original";
 *  this reader maps them. */
const DECLARED_BORDER_MODE_FOLLOW_FILL = "follow_fill";
const DECLARED_BORDER_MODE_VALUE = "value";
const DECLARED_BORDER_MODE_SOLID = "solid";
const DECLARED_BORDER_MODE_ORIGINAL = "original";

const BORDER_MODE_LITERALS: ReadonlySet<string> = new Set([
  DECLARED_BORDER_MODE_FOLLOW_FILL,
  DECLARED_BORDER_MODE_VALUE,
  DECLARED_BORDER_MODE_SOLID,
  DECLARED_BORDER_MODE_ORIGINAL,
]);

/** The flat keys the border declaration recognizes: the mode switch, the two
 *  display sub-dimensions (color / weight) and the shared value-mode schema. */
const KNOWN_KEYS: ReadonlySet<string> = new Set([
  "mode",
  "field",
  "method",
  "classes",
  "scheme",
  "kind",
  "color",
  "weight",
]);

type DeclaredBorderRead = {
  /** The declared border mode, or undefined when absent/unbuildable. */
  declared?: StyleMode;
  /** The declared value config, present exactly when the mode is value. */
  declaredValue?: ValueConfig;
  /** The declared solid-mode colour (expanded, lowercased CSS hex). */
  declaredColor?: string;
  /** The declared stroke width in pixels; rides every mode. */
  declaredWeight?: number;
  /** One line per rejected key, already logged — kept for tests. */
  invalid: string[];
};

/** The declared marker icon pixel size, or undefined when absent/invalid. */
type DeclaredIconSize = number | undefined;

/** The declared marker chassis preset name, or undefined when absent/unknown. */
type DeclaredMarkerColor = string | undefined;

/** Empty read for a null/undefined layer (provisional, never cached). */
const EMPTY: DeclaredBorderRead = { invalid: [] };

/** A border weight is a positive pixel number; a bool is an object in JS but
 *  never a width, and a non-finite value has no stroke. */
const isPositiveWeight = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

/** Parse the `border` declaration into a validated border mode plus its
 *  display sub-dimensions.
 *
 *  A declaration names the ONE mode the author wants as the read-time default:
 *  `follow_fill` (the border follows the fill's paint), `value` (classify by
 *  a field), `solid` (one declared colour) or `original` (the author's own
 *  stroke). The flat fill-isomorphic form (`{"field": ...}`) is an implicit
 *  value mode and a lone `color`/`weight` is an implicit solid mode. mode,
 *  when present, is authoritative — a mode plus a key belonging to another
 *  mode is contradictory and invalid.
 *
 *  `color` (a CSS hex) is the solid mode's colour and `weight` (a positive
 *  pixel number) rides every mode — the two sub-dimensions the panel's border
 *  row can set. A malformed sub-key degrades alone (warned once, the mode
 *  survives); a contradiction or an unusable mode drops the whole declaration
 *  (read as "not declared" — the border stays on its derived default rather
 *  than painting a mode the author never saw validated).
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

  // Unknown keys are typos to surface; the rest of the declaration survives.
  for (const key of Object.keys(data)) {
    if (!KNOWN_KEYS.has(key)) {
      rejectKey(
        key,
        `an unknown border key ${JSON.stringify(key)} (expected mode/field/method/classes/scheme/kind/color/weight)`,
      );
    }
  }

  const hasField = data.field !== undefined;
  let mode: string;
  if (data.mode !== undefined) {
    if (typeof data.mode !== "string" || !BORDER_MODE_LITERALS.has(data.mode)) {
      rejectKey(
        "mode",
        `invalid border.mode ${JSON.stringify(data.mode)} (expected "follow_fill", "value", "solid" or "original")`,
      );
      return { invalid };
    }
    mode = data.mode;
  } else if (hasField) {
    mode = DECLARED_BORDER_MODE_VALUE;
  } else if (data.color !== undefined || data.weight !== undefined) {
    mode = DECLARED_BORDER_MODE_SOLID;
  } else {
    rejectKey(
      "mode",
      "a border declaration without border.mode, border.field, border.color or border.weight",
    );
    return { invalid };
  }

  // A mode and a key belonging to another mode is a contradiction, not a
  // silent merge: the author must see why the declaration cannot stand.
  if (mode !== DECLARED_BORDER_MODE_VALUE) {
    if (hasField) {
      rejectKey("field", `border.mode "${mode}" contradicts border.field`);
      return { invalid };
    }
    for (const key of ["method", "classes", "scheme", "kind"] as const) {
      if (data[key] !== undefined) {
        rejectKey(key, `border.mode "${mode}" does not classify by value`);
        return { invalid };
      }
    }
  } else if (!hasField) {
    rejectKey("field", "border.mode 'value' requires border.field");
    return { invalid };
  }
  if (mode !== DECLARED_BORDER_MODE_SOLID && data.color !== undefined) {
    rejectKey("color", `border.mode "${mode}" contradicts a solid color`);
    return { invalid };
  }

  let declaredColor: string | undefined;
  if (data.color !== undefined) {
    if (isHexColor(data.color)) {
      declaredColor = normalizeHexColor(data.color).toLowerCase();
    } else {
      rejectKey(
        "color",
        `invalid border.color ${JSON.stringify(data.color)} (expected a CSS hex)`,
      );
    }
  }
  let declaredWeight: number | undefined;
  if (data.weight !== undefined) {
    if (isPositiveWeight(data.weight)) declaredWeight = data.weight;
    else {
      rejectKey(
        "weight",
        `invalid border.weight ${JSON.stringify(data.weight)} (expected a positive number)`,
      );
    }
  }

  if (mode === DECLARED_BORDER_MODE_VALUE) {
    // value mode: validate the shared flat schema — the same parser fill uses,
    // so the two faces cannot drift.
    const config = parseValueDeclaration(data, rejectKey, "border");
    if (config === undefined) return { invalid };
    return {
      declared: STYLE_MODE.VALUE,
      declaredValue: config,
      ...(declaredWeight === undefined ? {} : { declaredWeight }),
      invalid,
    };
  }
  const declared =
    mode === DECLARED_BORDER_MODE_FOLLOW_FILL
      ? STYLE_MODE.FOLLOW_FILL
      : mode === DECLARED_BORDER_MODE_SOLID
        ? STYLE_MODE.SOLID
        : STYLE_MODE.ORIGINAL;
  return {
    declared,
    ...(declaredColor === undefined ? {} : { declaredColor }),
    ...(declaredWeight === undefined ? {} : { declaredWeight }),
    invalid,
  };
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
  if (typeof raw !== "string" || !raw.trim()) {
    const message = `a non-string marker_color ${JSON.stringify(raw)}`;
    reject("shape", message);
    invalid.push(message);
    return { invalid };
  }
  const name = raw.trim();
  if (name in MARKER_COLOR_PRESET_HEX) return { declared: name, invalid };
  if (isHexColor(name)) {
    return { declared: normalizeHexColor(name).toLowerCase(), invalid };
  }
  const message = `an unknown marker_color preset ${JSON.stringify(name)} (expected one of ${Object.keys(MARKER_COLOR_PRESET_HEX).join(", ")} or a CSS hex)`;
  reject("preset", message);
  invalid.push(message);
  return { invalid };
};

/** Parse the raw whole-layer `opacity` declaration (foliplus opacity,
 *  a 0-1 float) into a validated 0-1 number.
 *
 *  A bool is an object in JS but never a number; a non-finite value has no
 *  paint; a value outside [0, 1] is out of the Leaflet opacity unit. The
 *  reader owns the warn-once, so a rejected declaration is reported once and
 *  read as "not declared" — the panel keeps its derived default rather than
 *  showing a value the author never saw validated. */
const parseOpacity = (
  raw: unknown,
  layerId: string | undefined,
  reject: (scope: string, message: string) => void,
): { declared?: number; invalid: string[] } => {
  const invalid: string[] = [];
  if (raw === undefined || raw === null) return { invalid };
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > 1) {
    const message = `a non-finite or out-of-range opacity ${JSON.stringify(raw)} (expected a number from 0 to 1)`;
    reject("shape", message);
    invalid.push(message);
    return { invalid };
  }
  return { declared: raw, invalid };
};

/** Parse the raw `colorOpacity` sub-key off one `icon`/`marker` declaration
 *  block (0-100 integer percent, the panel unit).
 *
 *  A non-mapping block is read as "not declared" (the shape gate warns at
 *  Python collection; here the block is simply absent for the reader). A
 *  non-integer, non-finite or out-of-range value is rejected — a fractional
 *  percent is not meaningful and a value outside [0, 100] would leave the
 *  row showing a number the author never validated. */
const parseColorOpacity = (
  raw: unknown,
  layerId: string | undefined,
  reject: (scope: string, message: string) => void,
): { declared?: number; invalid: string[] } => {
  const invalid: string[] = [];
  if (raw === undefined || raw === null) return { invalid };
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw > 100) {
    const message = `a non-integer or out-of-range colorOpacity ${JSON.stringify(raw)} (expected a whole number from 0 to 100)`;
    reject("shape", message);
    invalid.push(message);
    return { invalid };
  }
  return { declared: raw, invalid };
};

/** The key → parse registry: a new scalar declared* channel registers here. */
const SCALAR_PARSES = {
  border: parseBorder,
  icon_size: parseIconSize,
  marker_color: parseMarkerColor,
  opacity: parseOpacity,
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

/** Read (and cache) the whole-layer opacity declared on one layer.
 *
 *  @param layer the carrier a control registered; `null`/undefined before the
 *    layer is linked — the read is then provisional and never cached.
 *  @param layerId the id used in warnings (the declaration itself is keyed by
 *    the layer object, which is stable once linked).
 */
const readDeclaredOpacity = (
  layer: unknown,
  layerId?: string,
  warn?: (message: string) => void,
): { declared?: number; invalid: string[] } =>
  typeof layer === "object" && layer !== null
    ? readDeclaredKey<number, string>(
        layer,
        layerId,
        "opacity",
        SCALAR_PARSES.opacity,
        warn,
      )
    : { invalid: [] };

/** Read the raw `icon`/`marker` declaration block off one layer, or undefined
 *  when the layer has no namespace / the block is not a mapping (the Python
 *  collection gate warns on the non-mapping shape; the reader stays silent so
 *  the JS panel does not double-report). */
const declaredBlockOf = (
  layer: unknown,
  layerId: string | undefined,
  blockKey: string,
): Record<string, unknown> | undefined => {
  if (typeof layer !== "object" || layer === null) return undefined;
  const foliplus = (layer as { options?: { foliplus?: unknown } }).options
    ?.foliplus as Record<string, unknown> | undefined;
  if (!foliplus) return undefined;
  const block = foliplus[blockKey] ?? foliplus[camelize(blockKey) ?? blockKey];
  if (typeof block !== "object" || block === null || Array.isArray(block)) {
    return undefined;
  }
  return block as Record<string, unknown>;
};

/** Read (and cache) the icon glyph alpha declared on one layer
 *  (`foliplus={"icon": {"colorOpacity": 60}}`), 0-100 integer percent.
 *
 *  The block reader is NOT a scalar channel: it reads the `colorOpacity`
 *  sub-key off the `icon` block, so it cannot ride the SCALAR_PARSES registry
 *  (which keys by one flat key). It reuses the same read/cache/warn-once
 *  skeleton through `readDeclaredKey` with a composite declared-key that
 *  scopes the cache and warning per (layer, block, sub-key). */
const readDeclaredIconColorOpacity = (
  layer: unknown,
  layerId?: string,
  warn?: (message: string) => void,
): { declared?: number; invalid: string[] } => {
  if (typeof layer !== "object" || layer === null) return { invalid: [] };
  const block = declaredBlockOf(layer, layerId, "icon");
  if (!block) return { invalid: [] };
  const raw = block.colorOpacity;
  return readDeclaredKey<number, string>(
    layer,
    layerId,
    "icon:colorOpacity",
    (_v, _id, reject) => parseColorOpacity(raw, layerId, reject),
    warn,
    () => raw,
  );
};

/** Read (and cache) the marker chassis alpha declared on one layer
 *  (`foliplus={"marker": {"colorOpacity": 60}}`), 0-100 integer percent.
 *
 *  Mirrors `readDeclaredIconColorOpacity` — the same block read, the same
 *  composite declared-key scoping. */
const readDeclaredMarkerColorOpacity = (
  layer: unknown,
  layerId?: string,
  warn?: (message: string) => void,
): { declared?: number; invalid: string[] } => {
  if (typeof layer !== "object" || layer === null) return { invalid: [] };
  const block = declaredBlockOf(layer, layerId, "marker");
  if (!block) return { invalid: [] };
  const raw = block.colorOpacity;
  return readDeclaredKey<number, string>(
    layer,
    layerId,
    "marker:colorOpacity",
    (_v, _id, reject) => parseColorOpacity(raw, layerId, reject),
    warn,
    () => raw,
  );
};

export {
  readDeclaredBorder,
  readDeclaredIconColorOpacity,
  readDeclaredIconSize,
  readDeclaredMarkerColor,
  readDeclaredMarkerColorOpacity,
  readDeclaredOpacity,
};
