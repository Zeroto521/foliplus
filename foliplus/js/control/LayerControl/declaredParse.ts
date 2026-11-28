// control/LayerControl/declaredParse — the declared* readers behind one
// registry.
//
// Three per-layer foliplus declarations (border, icon_size, marker_color) share
// one mechanical scalar shape: a scalar (one-key object, one number, one preset
// name) validated by a small parse and read through the shared readDeclaredKey
// skeleton. Border is the two-shaped one — a follow_fill / value / solid /
// original mode shell or the flat fill-isomorphic value form — but still one
// normalized outcome read through the same skeleton. This module owns those
// three parses and the key → parse registry, so a new scalar channel registers
// here instead of opening another file; the dimension-specific parse stays its
// own function (its own message, its own invalid accumulation) — only the file
// is shared.
//
// The icon / marker face declarations ride the same skeleton with one extra
// step: their sub-key vocabulary (glyph / color / colorOpacity, plus the
// accepted snake spellings) is normalised by a single spelling map before the
// per-key validators run, so both faces and both consumers agree on canonical
// camelCase keys and an unknown sub-key warns instead of passing silently.
//
// The read/cache/warn-once skeleton lives in {@link readDeclaredKey}; the
// module owns only the parses and the thin readers that dispatch on them.
// Public API names are unchanged (readDeclaredBorder / readDeclaredIconSize /
// readDeclaredMarkerColor) — callers are untouched except for the import path.
import { parseValueDeclaration } from "./declaredFill.js";
import { type RejectFn, readDeclaredKey } from "./declaredKey.js";
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

/** The declared icon face after normalisation (canonical camelCase keys, only
 *  the sub-keys the author actually declared). */
type DeclaredIconFace = {
  glyph?: string;
  color?: string;
  colorOpacity?: number;
};

/** The declared marker face after normalisation (the chassis alpha only). */
type DeclaredMarkerFace = { colorOpacity?: number };

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

/** One sub-key of a face declaration: the canonical camelCase name it
 *  normalises to, the wire spellings that resolve to it (canonical first; the
 *  snake_case form is accepted because the Python declaration side writes snake
 *  and a hand-built namespace may keep it), and the validator that turns the raw
 *  value into the canonical value or a rejection message. */
type FaceKeySpec = {
  readonly spellings: readonly string[];
  readonly validate: (raw: unknown) => FaceKeyRead;
};

type FaceKeyRead =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly invalid: string };

/** The whitespace a declared string value is trimmed of, as explicit code
 *  points. This is the UNION of the two hosts' whitespace sets, not either
 *  host's default: Python's str.isspace() includes U+001C-U+001F / U+0085 that
 *  JavaScript keeps, JavaScript's WhiteSpace/LineTerminator set includes U+FEFF
 *  (a BOM pasted from a CSV) that Python keeps, and an author pasting from rich
 *  text or CJK input brings U+2000-U+200A, U+2028/U+2029, U+202F, U+205F or
 *  U+3000. KEEP IN STEP with DECLARED_TRIM_CODEPOINTS in
 *  foliplus/_declaration/paint.py - the cross-stack guard
 *  (test/python/guard/test_face_vocabulary.py) compares both literals and
 *  asserts the colour path never uses a host trim. */
const DECLARED_TRIM_CODEPOINTS: readonly number[] = [
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x85, 0xa0, 0x1680,
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009,
  0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
];
const DECLARED_TRIM_CLASS = DECLARED_TRIM_CODEPOINTS.map(
  codepoint => `\\u{${codepoint.toString(16)}}`,
).join("");
const DECLARED_TRIM_RE = new RegExp(
  `^[${DECLARED_TRIM_CLASS}]+|[${DECLARED_TRIM_CLASS}]+$`,
  "gu",
);

/** Trim a declared string value of the shared whitespace set only. */
const trimDeclaredString = (value: string): string =>
  value.replace(DECLARED_TRIM_RE, "");

/** The sub-keys the `icon` face recognises. One map, one vocabulary: a key not
 *  listed here is an unknown sub-key and warns (P1-2), and the spellings list is
 *  the ONLY place a snake spelling is translated. */
const ICON_FACE_KEYS: Readonly<Record<string, FaceKeySpec>> = {
  glyph: {
    spellings: ["glyph"],
    validate: raw => {
      // Trim before the shape check and store the trimmed value: Python's
      // normaliser strips the author's string first, so " star " is the same
      // declared glyph there. Storing the raw padded string here would make
      // the glyph lookup miss a name the declaration guide calls accepted.
      const glyph = typeof raw === "string" ? trimDeclaredString(raw) : null;
      return glyph !== null && glyph !== ""
        ? { ok: true, value: glyph }
        : {
            ok: false,
            invalid: `an empty or non-string icon glyph ${JSON.stringify(raw)} (expected a non-empty string)`,
          };
    },
  },
  color: {
    spellings: ["color"],
    validate: raw => {
      // Trim before the shape check: Python's _declared_hex strips the string
      // before its hex regex, so a padded "#ff0000" is accepted there. Both
      // sides must accept the same spelling and store the same expanded
      // lowercase hex, or one stack paints a colour the other rejects.
      const color = typeof raw === "string" ? trimDeclaredString(raw) : raw;
      return typeof color === "string" && isHexColor(color)
        ? { ok: true, value: normalizeHexColor(color).toLowerCase() }
        : {
            ok: false,
            invalid: `a non-hex icon color ${JSON.stringify(raw)} (expected a CSS hex such as "#ff0000")`,
          };
    },
  },
  colorOpacity: {
    spellings: ["colorOpacity", "color_opacity"],
    validate: raw =>
      typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw <= 100
        ? { ok: true, value: raw }
        : {
            ok: false,
            invalid: `a non-integer or out-of-range colorOpacity ${JSON.stringify(raw)} (expected a whole number from 0 to 100)`,
          },
  },
};

/** The sub-keys the `marker` face recognises. The marker chassis carries the
 *  alpha only; the glyph and the chassis colour are the icon face's and the
 *  marker_color declaration's business (they warn here as unknown sub-keys). */
const MARKER_FACE_KEYS: Readonly<Record<string, FaceKeySpec>> = {
  colorOpacity: ICON_FACE_KEYS.colorOpacity,
};

/** One line naming the layer a face warning is about. The reader only knows
 *  the registry id — the author-facing layer name is a Python-side fact — so
 *  the id is the locator the panel and the console share. */
const warningTarget = (layerId: string | undefined): string =>
  `on layer "${layerId ?? "<unregistered>"}"`;

/** Normalise one declared face's sub-keys and validate their values.
 *
 *  This is the single convergence point for a face's spelling vocabulary: the
 *  caller supplies the accepted keys and gets canonical camelCase names back,
 *  so no reader writes its own if-chain and both sides (Python declaration,
 *  hand-built namespace) agree on exactly one output spelling. Each accepted
 *  spelling maps to one canonical key; the FIRST occurrence decides — a
 *  duplicate always warns and is dropped, even when the first value was
 *  unusable (the Python normaliser marks the canonical key seen before it
 *  validates, and this reader follows the same one-way rule, so the two stacks
 *  never disagree on which spelling won); an unknown sub-key warns and is
 *  dropped without touching its siblings; a malformed value is rejected alone.
 *  Every warning names the layer id, so a console line locates the authoring
 *  layer the same way the Python warning names it. */
const normaliseFaceKeys = (
  face: Record<string, unknown>,
  spec: Readonly<Record<string, FaceKeySpec>>,
  faceName: string,
  layerId: string | undefined,
  reject: RejectFn,
): { values: Record<string, unknown>; invalid: string[] } => {
  const values: Record<string, unknown> = {};
  const invalid: string[] = [];
  const canonicalOf = new Map<string, string>();
  const accepted: string[] = [];
  for (const [canonical, keySpec] of Object.entries(spec)) {
    for (const spelling of keySpec.spellings) {
      canonicalOf.set(spelling, canonical);
      accepted.push(spelling);
    }
  }
  const target = warningTarget(layerId);
  const rejectOne = (scope: string, message: string): void => {
    reject(`face.${scope}`, message);
    invalid.push(message);
  };
  const seen = new Set<string>();
  for (const [key, raw] of Object.entries(face)) {
    const canonical = canonicalOf.get(key);
    if (canonical === undefined) {
      rejectOne(
        key,
        `declared ${faceName}: ignoring unknown sub-key "${key}" ${target} (accepted: ${accepted.join(", ")})`,
      );
      continue;
    }
    if (seen.has(canonical)) {
      rejectOne(
        key,
        `declared ${faceName}: ignoring duplicate sub-key "${key}" ${target} (the canonical key "${canonical}" is already declared; the first spelling wins)`,
      );
      continue;
    }
    seen.add(canonical);
    const read = spec[canonical].validate(raw);
    if (read.ok) {
      values[canonical] = read.value;
    } else {
      rejectOne(canonical, `declared ${faceName}: ignoring ${read.invalid} ${target}`);
    }
  }
  return { values, invalid };
};

/** Parse the raw `icon` face declaration into its normalised default.
 *
 *  A non-mapping face is rejected with a shape warning — the one shape case the
 *  Python collection gate also reports, and the JS side keeps the two in step
 *  rather than trusting a silent read. An empty (or fully rejected) face reads
 *  as "not declared" so the panel keeps its author-derived default. */
const parseIconFace = (
  raw: unknown,
  layerId: string | undefined,
  reject: RejectFn,
): { declared?: DeclaredIconFace; invalid: string[] } => {
  if (raw === undefined || raw === null) return { invalid: [] };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    const message = `declared icon: ignoring a non-mapping icon face ${JSON.stringify(raw)} ${warningTarget(layerId)} (expected an object with glyph / color / colorOpacity)`;
    reject("shape", message);
    return { invalid: [message] };
  }
  const { values, invalid } = normaliseFaceKeys(
    raw as Record<string, unknown>,
    ICON_FACE_KEYS,
    "icon",
    layerId,
    reject,
  );
  return Object.keys(values).length === 0
    ? { invalid }
    : { declared: values as DeclaredIconFace, invalid };
};

/** Parse the raw `marker` face declaration (chassis alpha only). Mirrors the
 *  icon face: one normalisation point, one canonical output. */
const parseMarkerFace = (
  raw: unknown,
  layerId: string | undefined,
  reject: RejectFn,
): { declared?: DeclaredMarkerFace; invalid: string[] } => {
  if (raw === undefined || raw === null) return { invalid: [] };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    const message = `declared marker: ignoring a non-mapping marker face ${JSON.stringify(raw)} ${warningTarget(layerId)} (expected an object with colorOpacity)`;
    reject("shape", message);
    return { invalid: [message] };
  }
  const { values, invalid } = normaliseFaceKeys(
    raw as Record<string, unknown>,
    MARKER_FACE_KEYS,
    "marker",
    layerId,
    reject,
  );
  return Object.keys(values).length === 0
    ? { invalid }
    : { declared: values as DeclaredMarkerFace, invalid };
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

/** Read (and cache) the icon face the panel's glyph / colour / alpha
 *  dimensions default to (`foliplus={"icon": {"glyph": "star", "color":
 *  "#ff0000", "colorOpacity": 60}}`).
 *
 *  The face is a read-time default, not a paint instruction: it feeds the
 *  panel row and every re-derivation, so a glyph/colour write carries it and
 *  Reset returns to it. Both spellings of a multi-word sub-key are accepted and
 *  normalised to camelCase here; an unknown sub-key warns once and is dropped
 *  (P1-2) so a typo cannot pass silently on the JS side. */
const readDeclaredIcon = (
  layer: unknown,
  layerId?: string,
  warn?: (message: string) => void,
): { declared?: DeclaredIconFace; invalid: string[] } =>
  typeof layer === "object" && layer !== null
    ? readDeclaredKey<DeclaredIconFace, string>(
        layer,
        layerId,
        "icon",
        parseIconFace,
        warn,
      )
    : { invalid: [] };

/** Read (and cache) the marker face (chassis alpha only). Mirrors
 *  {@link readDeclaredIcon} — same normalisation point, same warn-once scope. */
const readDeclaredMarker = (
  layer: unknown,
  layerId?: string,
  warn?: (message: string) => void,
): { declared?: DeclaredMarkerFace; invalid: string[] } =>
  typeof layer === "object" && layer !== null
    ? readDeclaredKey<DeclaredMarkerFace, string>(
        layer,
        layerId,
        "marker",
        parseMarkerFace,
        warn,
      )
    : { invalid: [] };

/** Read (and cache) the icon glyph alpha declared on one layer
 *  (`foliplus={"icon": {"colorOpacity": 60}}`), 0-100 integer percent.
 *
 *  A thin projection of {@link readDeclaredIcon}: the face reader owns the
 *  normalisation, this facade keeps the narrow alpha-only shape its callers
 *  (the controller snapshot and the row default) already consume. */
const readDeclaredIconColorOpacity = (
  layer: unknown,
  layerId?: string,
  warn?: (message: string) => void,
): { declared?: number; invalid: string[] } => {
  const read = readDeclaredIcon(layer, layerId, warn);
  return read.declared?.colorOpacity === undefined
    ? { invalid: read.invalid }
    : { declared: read.declared.colorOpacity, invalid: read.invalid };
};

/** Read (and cache) the marker chassis alpha declared on one layer. Mirrors
 *  {@link readDeclaredIconColorOpacity}. */
const readDeclaredMarkerColorOpacity = (
  layer: unknown,
  layerId?: string,
  warn?: (message: string) => void,
): { declared?: number; invalid: string[] } => {
  const read = readDeclaredMarker(layer, layerId, warn);
  return read.declared?.colorOpacity === undefined
    ? { invalid: read.invalid }
    : { declared: read.declared.colorOpacity, invalid: read.invalid };
};

export {
  readDeclaredBorder,
  readDeclaredIcon,
  readDeclaredIconColorOpacity,
  readDeclaredIconSize,
  readDeclaredMarker,
  readDeclaredMarkerColor,
  readDeclaredMarkerColorOpacity,
  readDeclaredOpacity,
};
export type { DeclaredIconFace };
