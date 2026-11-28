// control/LayerControl/declared/parse — the scalar declared readers behind one
// registry.
//
// Two per-layer foliplus declarations live here: `border` (the two-shaped one —
// a follow_fill / value / solid / original mode shell or the flat
// fill-isomorphic value form) and whole-layer `opacity` (a 0-1 float). Both are
// scalar channels: one small parse each, read through the shared
// {@link readDeclaredKey} skeleton and dispatched by the key → parse registry
// below, so a new scalar channel registers here instead of opening another file.
// The marker chassis scalars (icon_size, marker_color) keep the same shape but
// live in ./marker, and the icon / marker faces in ./face.
//
// The read/cache/warn-once skeleton lives in {@link readDeclaredKey}; the module
// owns only the parses and the thin readers that dispatch on them. Public API
// names are unchanged (readDeclaredBorder / readDeclaredOpacity) — callers
// import them through ./index.
import { DECLARED_KEY } from "./declared-key.js";
import { parseValueDeclaration } from "./fill.js";
import { type RejectFn, readDeclaredKey } from "./key.js";
import { trimDeclaredString } from "./trim.js";
import { STYLE_MODE, type StyleMode, type ValueConfig } from "#core/layer/index.js";
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
    rejectKey(
      DECLARED_KEY.BORDER,
      `a non-object border declaration ${JSON.stringify(raw)}`,
    );
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
    // Python's _declared_hex trims the author's string with the shared
    // declared-string set before its hex regex; trim here with the SAME
    // function or a padded border colour is accepted by one stack only.
    const color =
      typeof data.color === "string" ? trimDeclaredString(data.color) : data.color;
    if (isHexColor(color)) {
      declaredColor = normalizeHexColor(color).toLowerCase();
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
    const config = parseValueDeclaration(data, rejectKey, DECLARED_KEY.BORDER);
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

/** The key → parse registry: a new scalar declared* channel registers here. */
const SCALAR_PARSES = {
  border: parseBorder,
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
  return readDeclaredKey(layer, layerId, DECLARED_KEY.BORDER, SCALAR_PARSES.border);
};

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
        DECLARED_KEY.OPACITY,
        SCALAR_PARSES.opacity,
        warn,
      )
    : { invalid: [] };

export { readDeclaredBorder, readDeclaredOpacity };
