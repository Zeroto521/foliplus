// declaredFill — the fill an author declared on the layer itself.
//
// `explore(foliplus={"fill": {...}})` in folium rides folium's unknown-kwargs
// passthrough onto `layer.options.foliplus` — the same per-layer namespace the
// label declaration uses. This module turns that raw declaration into a
// validated, cached {@link DeclaredFill}: the fill mode's author default.
//
// The declaration is FLAT: `fill` accepts only `field` (required) plus the
// optional `method` / `classes` / `scheme` / `kind`. The old nested
// `fill.ramp` shell and the `fill.mode` switch are cancelled — those keys
// are now unknown, ignored one by one with a one-time warning, never re-read
// as a compat shape (no compat read, no version bump). A declaration that
// names a usable `field` turns the "color by value" mode on; one without is
// dropped whole rather than painted as a misleading solid face.
//
// `kind` selects the internal mode — `"numeric"` or `"category"` — and is an
// optional override. Absent, it reads as `"numeric"` here, but the parse
// layer deliberately leaves it out of the returned record so `fill.ts` can
// infer it from the layer's own values first (`inferFieldKind`, slice ②): the
// parse layer does not sample, it only validates what the author wrote.
//
// It is NOT user intent: nothing here touches the intent store. `fill.ts`
// merges the declaration under the user's stored choice (intent > declaration
// > the per-feature author paint > built-in default), so a later panel edit
// always wins and Reset — which clears the intent — shows the declaration
// through again.
//
// The declaration is a PURE ADDITIVE key, the same contract the per-feature
// `fillAuthor` payload follows: a layer that declares no `foliplus.fill` has
// no CONF change, no panel mode and no behaviour difference from before this
// reader existed; only a layer that names one gets the read-time default.
// Invalid keys degrade one by one (each rejected key is warned once and the
// rest of the declaration survives), and a declaration that names a ramp but
// no usable field is dropped whole rather than painted as a misleading solid
// face.
//
// The read/cache/warn-once skeleton lives in {@link readDeclaredKey}: this
// module supplies only the fill parse — the business logic that validates what
// the author wrote. The next declared* reader reuses the same skeleton instead
// of re-implementing it.
import * as CONST from "./const.js";
import { type RejectFn, readDeclaredKey } from "./declaredKey.js";
import type { ValueConfig } from "#core/layer/index.js";
import {
  CLASS_COUNT,
  METHOD_ORDER,
  VALUE_KIND,
  isClassifyMethod,
  isValueKind,
} from "#core/value/index.js";

/** A validated fill declaration for one layer.
 *
 *  The declaration is FLAT — there is no `mode`/ramp` shell. A present
 *  declaration always names a usable `field`, which is what turns the
 *  "color by value" mode on; `kind` is the optional override `fill.ts`
 *  resolves against the layer's own values when absent (the inference happens
 *  there, never in the parse layer). `method` / `classes` / `scheme` took
 *  the panel defaults where the author stayed silent, so a declaration and a
 *  later panel edit compare on the same shape. */
type DeclaredFill = ValueConfig;

type DeclaredFillRead = {
  declared?: DeclaredFill;
  /** One line per rejected key, already logged — kept for tests. */
  invalid: string[];
};

const EMPTY: DeclaredFillRead = { invalid: [] };

/** The flat keys the declaration recognizes. Anything else — including the
 *  cancelled nested `ramp` shell and the `mode` switch — is an unknown key,
 *  ignored one by one with a one-time warning. */
const KNOWN_KEYS: ReadonlySet<string> = new Set([
  "field",
  "method",
  "classes",
  "scheme",
  "kind",
]);

const isName = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

/** Parse a flat value-mode declaration (the fill schema) into a validated
 *  {@link ValueConfig}.
 *
 *  The shared value-mode parser: fill and border reuse the SAME flat schema —
 *  `field` (required) plus `method` / `classes` / `scheme` / `kind` — so an
 *  author learns one declaration shape and the two faces cannot drift on what
 *  they accept. `scope` ("fill" | "border") names the face in the messages
 *  ("invalid fill.field" vs "invalid border.field"), which keeps the fill
 *  warnings byte-identical while the border warnings read naturally.
 *
 *  `rejectKey` is the caller's already-prefixed rejection closure (it records
 *  the message for tests and warns once per scope); the "declared fill/border"
 *  warning prefix is the caller's, never this parser's.
 *
 *  Returns the validated config, or `undefined` when the declaration is
 *  unbuildable (no `field`, an unknown `kind`, or an explicit category without
 *  a `scheme`) — the caller then drops the whole declaration rather than
 *  painting a misleading solid face. `method`/`classes`/`scheme` take the panel
 *  defaults where the author stayed silent. `kind` is omitted from the numeric
 *  record (absent = numeric, inferred by the caller against the layer's own
 *  values); an explicit category is returned with its kind and a required
 *  scheme. */
const parseValueDeclaration = (
  data: Record<string, unknown>,
  rejectKey: (key: string, message: string) => void,
  scope: "fill" | "border",
): ValueConfig | undefined => {
  let field: string | undefined;
  if (data.field !== undefined) {
    if (isName(data.field)) field = data.field;
    else {
      rejectKey(
        "field",
        `invalid ${scope}.field ${JSON.stringify(data.field)} (expected a property name)`,
      );
    }
  }
  if (field === undefined) {
    rejectKey("field", `a ${scope} declaration without a ${scope}.field`);
    return undefined;
  }
  if (data.kind !== undefined && !isValueKind(data.kind)) {
    rejectKey(
      "kind",
      `invalid ${scope}.kind ${JSON.stringify(data.kind)} (expected "numeric" or "category")`,
    );
    return undefined;
  }
  if (data.kind === VALUE_KIND.CATEGORY) {
    if (data.scheme === undefined) {
      rejectKey("scheme", `a category ${scope} declaration without a ${scope}.scheme`);
      return undefined;
    }
    if (!isName(data.scheme)) {
      rejectKey(
        "scheme",
        `invalid ${scope}.scheme ${JSON.stringify(data.scheme)} (expected a palette name)`,
      );
      return undefined;
    }
    return {
      kind: VALUE_KIND.CATEGORY,
      field,
      method: CONST.FILL_VALUE.METHOD_DEFAULT,
      classes: CLASS_COUNT.DEFAULT,
      scheme: data.scheme,
    };
  }
  let method: ValueConfig["method"] = CONST.FILL_VALUE.METHOD_DEFAULT;
  if (data.method !== undefined) {
    if (isClassifyMethod(data.method)) method = data.method;
    else {
      rejectKey(
        "method",
        `invalid ${scope}.method ${JSON.stringify(data.method)} (expected ${METHOD_ORDER.join("/")})`,
      );
    }
  }
  let classes: number = CLASS_COUNT.DEFAULT;
  if (data.classes !== undefined) {
    if (
      typeof data.classes === "number" &&
      Number.isInteger(data.classes) &&
      data.classes >= CLASS_COUNT.MIN
    ) {
      classes = data.classes;
    } else {
      rejectKey(
        "classes",
        `invalid ${scope}.classes ${JSON.stringify(data.classes)} (expected an integer >= ${CLASS_COUNT.MIN})`,
      );
    }
  }
  let scheme: string = CONST.FILL_VALUE.SCHEME_DEFAULT;
  if (data.scheme !== undefined) {
    if (isName(data.scheme)) scheme = data.scheme;
    else {
      rejectKey(
        "scheme",
        `invalid ${scope}.scheme ${JSON.stringify(data.scheme)} (expected a palette name)`,
      );
    }
  }
  return { field, method, classes, scheme };
};

/** Parse the flat `fill` declaration into a validated {@link DeclaredFill}.
 *
 *  One declaration, one "color by value" instruction: naming a usable `field`
 *  turns the mode on, and the remaining keys configure it. Invalid keys degrade
 *  one by one (each rejected key is warned once and the rest survives), except
 *  where a missing piece makes the declaration unbuildable — no `field`, an
 *  unknown `kind`, or an explicit category without a `scheme` — in which case
 *  the whole declaration is dropped rather than painted as a misleading solid
 *  face. `classes` is kept exactly as declared, never clamped: "declared 12,
 *  painted 6" is the silent deviation this reader exists to prevent, so the
 *  editable 2..9 vocabulary is a panel constraint, not an author one.
 *
 *  @param reject one rejected key: record it for the caller (tests) and warn
 *    once per (declared-key, layer, key) — the skeleton owns the dedup, the
 *    parse owns the message and the `invalid` accumulation. */
const parse = (
  raw: unknown,
  layerId: string | undefined,
  reject: RejectFn,
): DeclaredFillRead => {
  const invalid: string[] = [];
  /** Reject one key: record it for the caller, and warn once per scope. */
  const rejectKey = (key: string, message: string): void => {
    invalid.push(message);
    reject(
      `${layerId ?? ""}:${key}`,
      `declared fill: ignoring ${message} on layer "${layerId ?? "<unregistered>"}"`,
    );
  };
  if (raw === null || raw === undefined) return EMPTY;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    rejectKey("fill", `a non-object fill declaration ${JSON.stringify(raw)}`);
    return { invalid };
  }
  const data = raw as Record<string, unknown>;

  // Unknown keys (the cancelled `ramp` shell, the `mode` switch, a typo) are
  // ignored one by one; the rest of the declaration survives.
  for (const key of Object.keys(data)) {
    if (!KNOWN_KEYS.has(key)) {
      rejectKey(
        key,
        `an unknown fill key ${JSON.stringify(key)} (expected field/method/classes/scheme/kind)`,
      );
    }
  }

  // The flat value fields are validated by the shared parser: the one
  // declaration schema fill and border reuse (field required; method/classes/
  // scheme/kind optional). A hard drop (no field, unknown kind, category
  // without scheme) returns undefined and drops the whole declaration; the
  // config is the declared read-time default.
  const config = parseValueDeclaration(data, rejectKey, "fill");
  if (config === undefined) return { invalid };
  return { declared: config, invalid };
};

/** Read (and cache) the fill declaration on one layer.
 *
 *  Additive contract — the same one #781's `fillAuthor` payload follows:
 *  `fillAuthor` is a pure additive key. A layer that produces no payload
 *  (non-explore, `style_function`, single-color explore) carries no CONF key,
 *  shows no Author mode, and behaves byte-identically to before; only a
 *  multi-color explore layer gains the read-only Author state, and the map
 *  paint is not rewritten before the user edits. This reader adds nothing to
 *  CONF either: a layer without `foliplus.fill` is byte-identical, and a
 *  declaration only changes what the fill mode reads at load/Reset time.
 *
 *  @param layer the carrier a control registered; `null`/undefined before the
 *    layer is linked — the read is then provisional and never cached.
 *  @param layerId the id used in warnings (the declaration itself is keyed by
 *    the layer object, which is stable once linked).
 */
const readDeclaredFill = (layer: unknown, layerId?: string): DeclaredFillRead => {
  if (layer === null || typeof layer !== "object") return EMPTY;
  return readDeclaredKey(layer, layerId, "fill", parse);
};

export { readDeclaredFill, parseValueDeclaration };
