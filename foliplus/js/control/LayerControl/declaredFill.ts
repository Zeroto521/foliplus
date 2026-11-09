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
import * as CONST from "./const.js";
import type { ValueConfig } from "#core/layer/index.js";
import { CLASS_COUNT, METHOD_ORDER, isClassifyMethod } from "#core/value/classify.js";
import { VALUE_KIND, isValueKind } from "#core/valueKind.js";
import { createLogger } from "#platform/log.js";

const log = createLogger("LayerControl");

/** The foliplus-owned slice of a layer's options. */
type FoliplusOptions = {
  foliplus?: { fill?: unknown } & Record<string, unknown>;
};

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

/** Per-layer-object cache. A layer object's options are final once it exists
 *  (folium builds them at construction), so both "declared" and "not declared"
 *  are cacheable — unlike the label reader, whose empty read can be
 *  provisional because it may run before the layer's script attaches the
 *  namespace. A null layer is never cached: the declaration may still arrive
 *  with the late-linked carrier. */
const cache = new WeakMap<object, DeclaredFillRead>();

/** Warn once per (layer, key): a re-read of the same declaration must not
 *  flood the console on every fill apply. */
const warned = new Set<string>();

const isName = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

/** Reject one key: record it for the caller (tests), and warn once per
 *  (layer, key). */
const reject = (
  invalid: string[],
  layerId: string | undefined,
  key: string,
  message: string,
): void => {
  invalid.push(message);
  const scope = `${layerId ?? ""}:${key}`;
  if (warned.has(scope)) return;
  warned.add(scope);
  log.warn(
    `declared fill: ignoring ${message} on layer "${layerId ?? "<unregistered>"}"`,
  );
};

/** The raw `foliplus.fill` value on a layer.
 *
 *  Own options only, never a tree walk: folium stamps the namespace on the
 *  very layer it renders (the same object LayerControl registers), and the
 *  attach sweep reads every layer — a tree scan per layer is the exact cost
 *  the controller's "unattributed add scans no tree" invariant forbids. */
const rawFillOf = (layer: object): unknown =>
  (layer as { options?: FoliplusOptions }).options?.foliplus?.fill;

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
 *  editable 2..9 vocabulary is a panel constraint, not an author one. */
const parse = (raw: unknown, layerId: string | undefined): DeclaredFillRead => {
  if (raw === null || raw === undefined) return EMPTY;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    const invalid: string[] = [];
    reject(
      invalid,
      layerId,
      "fill",
      `a non-object fill declaration ${JSON.stringify(raw)}`,
    );
    return { invalid };
  }
  const data = raw as Record<string, unknown>;
  const invalid: string[] = [];

  // Unknown keys (the cancelled `ramp` shell, the `mode` switch, a typo) are
  // ignored one by one; the rest of the declaration survives.
  for (const key of Object.keys(data)) {
    if (!KNOWN_KEYS.has(key)) {
      reject(
        invalid,
        layerId,
        key,
        `an unknown fill key ${JSON.stringify(key)} (expected field/method/classes/scheme/kind)`,
      );
    }
  }

  // field is the one required key: without it nothing can be classified, so
  // the declaration is dropped whole (reported as fill.field, the primary
  // key — a declaration missing both field and scheme warns about the field
  // only, which is the one that determines whether any ramp exists).
  let field: string | undefined;
  if (data.field !== undefined) {
    if (isName(data.field)) field = data.field;
    else {
      reject(
        invalid,
        layerId,
        "field",
        `invalid fill.field ${JSON.stringify(data.field)} (expected a property name)`,
      );
    }
  }
  if (field === undefined) {
    reject(invalid, layerId, "field", "a fill declaration without a fill.field");
    return { invalid };
  }

  // kind is the optional override that picks the mode. Absent reads as
  // "numeric" (the pre-kind record shape, resolved by inference in fill.ts);
  // an unrecognized kind drops the declaration whole — the persistence reader
  // applies the same rule, so a kind this client cannot build is never
  // misapplied as a numeric ramp.
  if (data.kind !== undefined && !isValueKind(data.kind)) {
    reject(
      invalid,
      layerId,
      "kind",
      `invalid fill.kind ${JSON.stringify(data.kind)} (expected "numeric" or "category")`,
    );
    return { invalid };
  }

  if (data.kind === VALUE_KIND.CATEGORY) {
    // A categorical mode needs its qualitative palette — the one key beyond the
    // field a category ramp cannot build without. A missing scheme is a hard
    // rejection for an *explicit* category: the author chose the mode, so there
    // is no ordered method to fall back to. Only an *inferred* category fills a
    // default (CATEGORY_SCHEME_DEFAULT in fill.ts, slice ②), where the author
    // did not pick a kind at all. method/classes are irrelevant (a category is
    // not ordered, so "classify" has no meaning) and deliberately not
    // validated, the same rule isValueConfig applies to a persisted
    // category record; they are kept at the type level so the union stays
    // assignable to the numeric RampConfig.
    if (data.scheme === undefined) {
      reject(
        invalid,
        layerId,
        "scheme",
        "a category fill declaration without a fill.scheme",
      );
      return { invalid };
    }
    if (!isName(data.scheme)) {
      reject(
        invalid,
        layerId,
        "scheme",
        `invalid fill.scheme ${JSON.stringify(data.scheme)} (expected a palette name)`,
      );
      return { invalid };
    }
    return {
      declared: {
        kind: VALUE_KIND.CATEGORY,
        field,
        method: CONST.FILL_VALUE.METHOD_DEFAULT,
        classes: CLASS_COUNT.DEFAULT,
        scheme: data.scheme,
      },
      invalid,
    };
  }

  // numeric (kind absent or "numeric"): validate the classifier inputs, each
  // key degrading on its own with defaults where the author stayed silent.
  let method: ValueConfig["method"] = CONST.FILL_VALUE.METHOD_DEFAULT;
  if (data.method !== undefined) {
    if (isClassifyMethod(data.method)) method = data.method;
    else {
      reject(
        invalid,
        layerId,
        "method",
        `invalid fill.method ${JSON.stringify(data.method)} (expected ${METHOD_ORDER.join("/")})`,
      );
    }
  }

  // The declared count is the author's, not the panel's: anything an integer
  // classifier can build is kept as-is (a declared 12 paints 12 and the panel
  // shows 12 as its own option). Only an unbuildable count is rejected —
  // non-integer, or below MIN where the classes stop meaning anything. The
  // write path clamps to the persisted 2..9 range, so the first user edit
  // converges; the declaration itself is never rewritten.
  let classes: number = CLASS_COUNT.DEFAULT;
  if (data.classes !== undefined) {
    if (
      typeof data.classes === "number" &&
      Number.isInteger(data.classes) &&
      data.classes >= CLASS_COUNT.MIN
    ) {
      classes = data.classes;
    } else {
      reject(
        invalid,
        layerId,
        "classes",
        `invalid fill.classes ${JSON.stringify(data.classes)} (expected an integer >= ${CLASS_COUNT.MIN})`,
      );
    }
  }

  let scheme: string = CONST.FILL_VALUE.SCHEME_DEFAULT;
  if (data.scheme !== undefined) {
    if (isName(data.scheme)) scheme = data.scheme;
    else {
      reject(
        invalid,
        layerId,
        "scheme",
        `invalid fill.scheme ${JSON.stringify(data.scheme)} (expected a palette name)`,
      );
    }
  }

  // kind is deliberately omitted (absent = numeric): fill.ts infers it from
  // the layer's values and fills the category scheme default only when the
  // inference lands on category.
  return { declared: { field, method, classes, scheme }, invalid };
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
  const key = layer as object;
  const cached = cache.get(key);
  if (cached) return cached;
  const result = parse(rawFillOf(key), layerId);
  cache.set(key, result);
  return result;
};

export { readDeclaredFill };
