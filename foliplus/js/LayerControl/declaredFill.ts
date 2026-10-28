// declaredFill — the fill an author declared on the layer itself.
//
// `explore(foliplus={"fill": {...}})` in folium rides folium's unknown-kwargs
// passthrough onto `layer.options.foliplus` — the same per-layer namespace the
// annotation declaration uses. This module turns that raw declaration into a
// validated, cached {@link DeclaredFill}: the fill arm's author default.
//
// It is NOT user intent: nothing here touches the intent store. `fill.ts`
// merges the declaration under the user's stored choice (intent > declaration
// > the per-feature author paint > built-in default), so a later panel edit
// always wins and Reset — which clears the intent — shows the declaration
// through again.
//
// The declaration is a PURE ADDITIVE key, the same contract the per-feature
// `fillAuthor` payload follows: a layer that declares no `foliplus.fill` has
// no CONF change, no panel arm and no behaviour difference from before this
// reader existed; only a layer that names one gets the read-time default.
// Invalid keys degrade one by one (each rejected key is warned once and the
// rest of the declaration survives), and a declaration that names a ramp but
// no usable field is dropped whole rather than painted as a misleading solid
// face.
import { CLASS_COUNT, isClassifyMethod } from "#core/classify.js";
import type { FillRampConfig } from "#core/layer/intent.js";
import { createLogger } from "#common/log.js";
import * as CONST from "./const.js";

const log = createLogger("LayerControl");

/** The foliplus-owned slice of a layer's options. */
type FoliplusOptions = {
  foliplus?: { fill?: unknown } & Record<string, unknown>;
};

/** A validated fill declaration for one layer. */
type DeclaredFill = {
  /** The fill arm the author asked for. Declaring a ramp field without a mode
   *  reads as "ramp" — naming the field turns the arm on, the same rule the
   *  annotation declaration follows for its field. */
  mode: "solid" | "ramp";
  /** The complete ramp config, present only when a usable field was declared.
   *  Undeclared keys took the panel defaults, so a declaration and a later
   *  panel edit compare on the same shape. */
  ramp?: FillRampConfig;
};

type DeclaredFillRead = {
  declared?: DeclaredFill;
  /** One line per rejected key, already logged — kept for tests. */
  invalid: string[];
};

const EMPTY: DeclaredFillRead = { invalid: [] };

/** Per-layer-object cache. A layer object's options are final once it exists
 *  (folium builds them at construction), so both "declared" and "not declared"
 *  are cacheable — unlike the annotation reader, whose empty read can be
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

/** Validate one raw ramp object. A declared key that fails its own check is
 *  dropped with a warning while the remaining keys survive. Classes is kept
 *  exactly as declared, never clamped: "declared 12, painted 6" is the silent
 *  deviation this reader exists to prevent, so the editable 2..9 vocabulary is
 *  a panel constraint, not an author one. */
const parseRamp = (
  invalid: string[],
  raw: unknown,
  layerId: string | undefined,
): FillRampConfig | undefined => {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    reject(
      invalid,
      layerId,
      "ramp",
      `a non-object ramp declaration ${JSON.stringify(raw)}`,
    );
    return undefined;
  }
  const data = raw as Record<string, unknown>;

  let field: string | undefined;
  if (data.field !== undefined) {
    if (isName(data.field)) field = data.field;
    else {
      reject(
        invalid,
        layerId,
        "ramp.field",
        `invalid ramp.field ${JSON.stringify(data.field)} (expected a property name)`,
      );
    }
  }

  let method: FillRampConfig["method"] = CONST.RAMP.METHOD_DEFAULT;
  if (data.method !== undefined) {
    if (isClassifyMethod(data.method)) method = data.method;
    else {
      reject(
        invalid,
        layerId,
        "ramp.method",
        `invalid ramp.method ${JSON.stringify(data.method)} (expected jenks/quantile/equal/heads)`,
      );
    }
  }

  // The declared count is the author's, not the panel's: anything an
  // integer classifier can build is kept as-is (a declared 12 paints 12 and
  // the panel shows 12 as its own option). Only an unbuildable count is
  // rejected — non-integer, or below MIN where the classes stop meaning
  // anything. The write path clamps to the persisted 2..9 range, so the
  // first user edit converges; the declaration itself is never rewritten.
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
        "ramp.classes",
        `invalid ramp.classes ${JSON.stringify(data.classes)} (expected an integer >= ${CLASS_COUNT.MIN})`,
      );
    }
  }

  let scheme: string = CONST.RAMP.SCHEME_DEFAULT;
  if (data.scheme !== undefined) {
    if (isName(data.scheme)) scheme = data.scheme;
    else {
      reject(
        invalid,
        layerId,
        "ramp.scheme",
        `invalid ramp.scheme ${JSON.stringify(data.scheme)} (expected a palette name)`,
      );
    }
  }

  // No usable field: nothing to classify, so the ramp cannot be built. The
  // caller drops the declaration instead of painting a solid face under a
  // "ramp" panel state.
  return field === undefined
    ? undefined
    : { kind: "numeric", field, method, classes, scheme };
};

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

  let mode: "solid" | "ramp" | undefined;
  if (data.mode !== undefined) {
    if (data.mode === "solid" || data.mode === "ramp") mode = data.mode;
    else {
      reject(
        invalid,
        layerId,
        "mode",
        `invalid mode ${JSON.stringify(data.mode)} (expected "solid" or "ramp")`,
      );
    }
  }

  const ramp =
    data.ramp === undefined ? undefined : parseRamp(invalid, data.ramp, layerId);

  if (mode === "ramp" && ramp === undefined) {
    // An explicit "ramp" with no usable field: the whole declaration is
    // dropped rather than silently painted as solid.
    reject(invalid, layerId, "ramp", "a ramp declaration without a usable ramp.field");
    return { invalid };
  }
  if (mode === undefined) {
    if (ramp === undefined) return { invalid };
    // Naming the field is the instruction: the arm turns on.
    mode = "ramp";
  }

  return { declared: { mode, ...(ramp ? { ramp } : {}) }, invalid };
};

/** Read (and cache) the fill declaration on one layer.
 *
 *  Additive contract — the same one #781's `fillAuthor` payload follows:
 *  `fillAuthor` is a pure additive key. A layer that produces no payload
 *  (non-explore, `style_function`, single-colour explore) carries no CONF key,
 *  shows no Author arm, and behaves byte-identically to before; only a
 *  multi-colour explore layer gains the read-only Author state, and the map
 *  paint is not rewritten before the user edits. This reader adds nothing to
 *  CONF either: a layer without `foliplus.fill` is byte-identical, and a
 *  declaration only changes what the fill arm reads at load/Reset time.
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
export type { DeclaredFill };
