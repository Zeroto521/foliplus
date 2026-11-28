// control/LayerControl/declared/face — the icon / marker face declarations: one
// normalisation point for their sub-keys.
//
// A face is the part of an icon / marker declaration the panel exposes: the icon
// glyph / colour / alpha and the marker chassis alpha. Their sub-key vocabulary
// (glyph / color / colorOpacity, plus the accepted snake spellings) is
// normalised by a single spelling map before the per-key validators run, so both
// faces and both consumers agree on canonical camelCase keys and an unknown
// sub-key warns instead of passing silently.
//
// The read/cache/warn-once skeleton lives in {@link readDeclaredKey}; this
// module owns the face parses and their readers. Public API names are unchanged
// (readDeclaredIcon / readDeclaredMarker / readDeclaredIconColorOpacity /
// readDeclaredMarkerColorOpacity).
import { type RejectFn, readDeclaredKey } from "./key.js";
import { DECLARED_KEY } from "./declared-key.js";
import { trimDeclaredString } from "./trim.js";
import { isHexColor, normalizeHexColor } from "#platform/color.js";

/** The declared icon face after normalisation (canonical camelCase keys, only
 *  the sub-keys the author actually declared). */
type DeclaredIconFace = {
  glyph?: string;
  color?: string;
  colorOpacity?: number;
};

/** The declared marker face after normalisation (the chassis alpha only). */
type DeclaredMarkerFace = { colorOpacity?: number };

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
    DECLARED_KEY.ICON,
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
    DECLARED_KEY.MARKER,
    layerId,
    reject,
  );
  return Object.keys(values).length === 0
    ? { invalid }
    : { declared: values as DeclaredMarkerFace, invalid };
};

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
        DECLARED_KEY.ICON,
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
        DECLARED_KEY.MARKER,
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
  readDeclaredIcon,
  readDeclaredIconColorOpacity,
  readDeclaredMarker,
  readDeclaredMarkerColorOpacity,
};
export type { DeclaredIconFace };
