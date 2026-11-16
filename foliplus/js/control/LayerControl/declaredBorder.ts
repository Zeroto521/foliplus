// declaredBorder — the border mode an author declared on the layer itself.
//
// `foliplus={"border": {"mode": "follow_fill"}}` in folium rides folium's
// unknown-kwargs passthrough onto `layer.options.foliplus` — the same
// per-layer namespace the fill/label declarations use. This module turns
// that raw declaration into a validated, cached border mode default: the
// author's declaration that the border follows the fill's colour.
//
// The declaration is a MODE default, not a value config: `border` accepts
// only `mode`, and the only recognised literal is "follow_fill". The JS
// `STYLE_MODE.FOLLOW_FILL` is "followFill" (camelCase, the internal/persisted
// literal), so this reader maps the public snake_case declaration onto it.
//
// It is NOT user intent: nothing here touches the intent store. `border.ts`
// merges the declaration under the user's stored choice (intent > declaration
// > the derived default), so a later panel edit always wins and Reset — which
// clears the intent — shows the declaration through again.
//
// The declaration is a PURE ADDITIVE key, the same contract the fill
// declaration follows: a layer that declares no `foliplus.border` has no
// behaviour difference from before this reader existed; only a layer that
// names one gets the read-time default. A malformed declaration is warned
// once and read as "not declared" — never as a reason to hide the border.
import { STYLE_MODE, type StyleMode } from "#core/layer/index.js";
import { createLogger } from "#platform/log.js";

const log = createLogger("LayerControl");

/** The one recognised declaration mode literal (public API, snake_case).
 *  The JS internal literal is "followFill"; this reader maps. */
const DECLARED_BORDER_MODE = "follow_fill";

type DeclaredBorderRead = {
  /** The declared border mode, or undefined when absent/unbuildable. */
  declared?: StyleMode;
  /** One line per rejected key, already logged — kept for tests. */
  invalid: string[];
};

const EMPTY: DeclaredBorderRead = { invalid: [] };

/** Per-layer-object cache. A layer object's options are final once it exists
 *  (folium builds them at construction), so both "declared" and "not declared"
 *  are cacheable. A null layer is never cached: the declaration may still
 *  arrive with the late-linked carrier. */
const cache = new WeakMap<object, DeclaredBorderRead>();

/** Warn once per (layer, key): a re-read of the same declaration must not
 *  flood the console on every border apply. */
const warned = new Set<string>();

/** The raw `foliplus.border` value on a layer.
 *
 *  Own options only, never a tree walk: folium stamps the namespace on the
 *  very layer it renders (the same object LayerControl registers), and the
 *  attach sweep reads every layer — a tree scan per layer is the exact cost
 *  the controller's "unattributed add scans no tree" invariant forbids. */
const rawBorderOf = (layer: object): unknown =>
  (layer as { options?: { foliplus?: Record<string, unknown> } }).options?.foliplus
    ?.border;

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
    `declared border: ignoring ${message} on layer "${layerId ?? "<unregistered>"}"`,
  );
};

/** Parse the flat `border` declaration into a validated border mode.
 *
 *  A declaration names the ONE mode the author wants as the read-time default.
 *  A missing/unknown `mode`, or a non-object declaration, drops the whole
 *  declaration (read as "not declared" — the border stays on its derived
 *  default rather than painting a mode the author never saw validated).
 *  Unknown keys degrade one by one (warned once, the rest survives — the
 *  shape is single-key today, so any extra key is a typo to surface). */
const parse = (raw: unknown, layerId: string | undefined): DeclaredBorderRead => {
  if (raw === null || raw === undefined) return EMPTY;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    const invalid: string[] = [];
    reject(
      invalid,
      layerId,
      "border",
      `a non-object border declaration ${JSON.stringify(raw)}`,
    );
    return { invalid };
  }
  const data = raw as Record<string, unknown>;
  const invalid: string[] = [];

  // Unknown keys are ignored one by one; the rest of the declaration survives.
  for (const key of Object.keys(data)) {
    if (key !== "mode") {
      reject(
        invalid,
        layerId,
        key,
        `an unknown border key ${JSON.stringify(key)} (expected mode)`,
      );
    }
  }

  // mode is the one required key: without it there is no declaration.
  if (data.mode === undefined) {
    reject(invalid, layerId, "mode", "a border declaration without a border.mode");
    return { invalid };
  }
  if (data.mode !== DECLARED_BORDER_MODE) {
    reject(
      invalid,
      layerId,
      "mode",
      `invalid border.mode ${JSON.stringify(data.mode)} (expected "follow_fill")`,
    );
    return { invalid };
  }
  return { declared: STYLE_MODE.FOLLOW_FILL, invalid };
};

/** Read (and cache) the border declaration on one layer.
 *
 *  @param layer the carrier a control registered; `null`/undefined before the
 *    layer is linked — the read is then provisional and never cached.
 *  @param layerId the id used in warnings (the declaration itself is keyed by
 *    the layer object, which is stable once linked).
 */
const readDeclaredBorder = (layer: unknown, layerId?: string): DeclaredBorderRead => {
  if (layer === null || typeof layer !== "object") return EMPTY;
  const key = layer as object;
  const cached = cache.get(key);
  if (cached) return cached;
  const result = parse(rawBorderOf(key), layerId);
  cache.set(key, result);
  return result;
};

export { readDeclaredBorder };
