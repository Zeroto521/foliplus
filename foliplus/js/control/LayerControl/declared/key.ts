// control/LayerControl/declared/key — the shared skeleton behind the foliplus.*
// declaration readers.
//
// Every per-layer foliplus declaration (fill, border, label, ...) runs the same
// three mechanical steps: read the raw value off the layer's own `foliplus`
// namespace, warn once per (layer, key) on a rejected shape, and cache the
// parsed read per layer object. This module owns those steps; a caller owns
// only its parse — the business logic that validates what the author wrote and
// shapes the read. The next declared* reader never re-implements the skeleton.
//
// It is deliberately minimal: no schema, no key list. The one translation it
// does make is the casing of the key itself — see {@link rawDeclaredKeyOf}.
// A caller supplies a parse of the raw value and gets back a cached read. The
// parse returns `{ declared?, invalid }` — `invalid` one line per rejected key
// (already warned), kept for tests.
//
// A null layer is never cached: the declaration may still arrive with the
// late-linked carrier. A non-null layer's options are final once it exists
// (folium builds them at construction), so both "declared" and "not declared"
// are cacheable — a reader never re-parses the same layer object.
import { createLogger } from "#platform/log.js";

const log = createLogger("LayerControl");

/** The foliplus-owned slice of a layer's options. */
type FoliplusOptions = { foliplus?: Record<string, unknown> };

/** The lowerCamelCase spelling of one snake_case foliplus key, or null when the
 * key carries no underscore and needs no translation. It mirrors the `camelize
 * folium applies to every option key at render time: the two sides must agree
 * on exactly one spelling for a multi-word key, and this reader accepts both so
 * the channel works for a rendered map and for a hand-built namespace alike.
 *
 *  Only a multi-word key ever changes shape, so a single-word key (`fill`,
 *  `border`, `label`, `folder`, `filter`, `mode` ...) is untouched by the rule.
 */
const camelize = (key: string): string | null => {
  if (!key.includes("_")) return null;
  return key
    .split("_")
    .map((part, i) => (i === 0 ? part : part[0].toUpperCase() + part.slice(1)))
    .join("");
};

/** Read a raw declaration off a layer's own `foliplus` namespace.
 *
 *  Own options only, never a tree walk: folium stamps the namespace on the
 *  very layer it renders (the same object LayerControl registers), and the
 *  attach sweep reads every layer — a tree scan per layer is the exact cost
 *  the controller's "unattributed add scans no tree" invariant forbids.
 *
 *  `key` is the snake_case name the Python declaration side declares under.
 *  folium's renderer camelizes every option key, so a rendered namespace spells
 *  `foliplus={"icon_size": 50}` as `"iconSize": 50` — the camelCase spelling must
 *  be read too, or the whole channel is dead in a rendered map. This reader is
 *  the ONE convergence point that makes the translation, which is why it lives
 *  here and not in each declared* channel: a case translation copied into three
 *  readers is the same drift this module exists to prevent. A declaration
 *  spelled neither way is still an honest "not declared", so the snake_case
 *  spelling is tried first and the camelCase one only when that is absent.
 */
const rawDeclaredKeyOf = (layer: object, key: string): unknown => {
  const foliplus = (layer as { options?: FoliplusOptions }).options?.foliplus;
  if (!foliplus) return undefined;
  const declared = foliplus[key];
  if (declared !== undefined) return declared;
  const camel = camelize(key);
  return camel === null ? undefined : foliplus[camel];
};

/** Per-layer-object cache, keyed by (layer, declared-key). */
const caches = new WeakMap<object, Map<string, unknown>>();

/** Warn once per (layer, declared-key, key): a re-read of the same declaration
 *  must not flood the console on every apply, but two layers carrying the same
 *  mistake are two authoring errors and both must surface — the dedupe is per
 *  layer object, not process-wide. */
const warned = new WeakMap<object, Set<string>>();

/** Reject one key of a declaration: record it for the caller (tests), and warn
 *  once per (declared-key, layer, key). */
type RejectFn = (scope: string, message: string) => void;

/** One declared-key reader. The caller owns the parse (business logic); this
 *  function owns the cache + warn-once + raw-access skeleton.
 *
 *  @param layer the carrier a control registered; `null`/undefined before the
 *    layer is linked — the read is then provisional and never cached.
 *  @param layerId the id used in warnings.
 *  @param declaredKey the foliplus namespace key this reader owns (fill,
 *    border, ...).
 *  @param parse turns the raw value into a validated read; gets a `reject`
 *    callback to record a rejected key and warn once.
 *  @param warn the one-time warn sink (defaults to the `[LayerControl]` logger).
 */
const readDeclaredKey = <R, I>(
  layer: object | null | undefined,
  layerId: string | undefined,
  declaredKey: string,
  parse: (
    raw: unknown,
    layerId: string | undefined,
    reject: RejectFn,
  ) => { declared?: R; invalid: I[] },
  warn: (message: string) => void = message => log.warn(message),
  /** Override the raw read: a block sub-key reader passes the value it already
   *  extracted off its block, so the cache/warn-once skeleton still owns the
   *  dedup without re-reading a composite key off the namespace (which would
   *  always be undefined). */
  rawOf?: (layer: object) => unknown,
): { declared?: R; invalid: I[] } => {
  if (layer === null || layer === undefined) return { invalid: [] };
  let perLayer = caches.get(layer);
  if (!perLayer) {
    perLayer = new Map();
    caches.set(layer, perLayer);
  }
  const cached = perLayer.get(declaredKey);
  if (cached !== undefined) return cached as { declared?: R; invalid: I[] };
  let warnedOnLayer = warned.get(layer);
  if (!warnedOnLayer) {
    warnedOnLayer = new Set();
    warned.set(layer, warnedOnLayer);
  }
  const layerWarnings = warnedOnLayer;
  const reject: RejectFn = (scope, message) => {
    const fullScope = `${declaredKey}:${scope}`;
    if (layerWarnings.has(fullScope)) return;
    layerWarnings.add(fullScope);
    warn(message);
  };
  const result = parse(
    rawOf ? rawOf(layer) : rawDeclaredKeyOf(layer, declaredKey),
    layerId,
    reject,
  );
  perLayer.set(declaredKey, result);
  return result;
};

export { readDeclaredKey };
export type { RejectFn };
