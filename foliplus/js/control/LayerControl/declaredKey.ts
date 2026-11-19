// declaredKey — the shared skeleton behind the foliplus.* declaration readers.
//
// Every per-layer foliplus declaration (fill, border, label, ...) runs the same
// three mechanical steps: read the raw value off the layer's own `foliplus`
// namespace, warn once per (layer, key) on a rejected shape, and cache the
// parsed read per layer object. This module owns those steps; a caller owns
// only its parse — the business logic that validates what the author wrote and
// shapes the read. The next declared* reader never re-implements the skeleton.
//
// It is deliberately minimal: no schema, no key list, no normalisation. A
// caller supplies a parse of the raw value and gets back a cached read. The
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

/** Read a raw declaration off a layer's own `foliplus` namespace.
 *
 *  Own options only, never a tree walk: folium stamps the namespace on the
 *  very layer it renders (the same object LayerControl registers), and the
 *  attach sweep reads every layer — a tree scan per layer is the exact cost
 *  the controller's "unattributed add scans no tree" invariant forbids. */
const rawDeclaredKeyOf = (layer: object, key: string): unknown =>
  (layer as { options?: FoliplusOptions }).options?.foliplus?.[key];

/** Per-layer-object cache, keyed by (layer, declared-key). */
const caches = new WeakMap<object, Map<string, unknown>>();

/** Warn once per (layer, key): a re-read of the same declaration must not
 *  flood the console on every apply. */
const warned = new Set<string>();

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
): { declared?: R; invalid: I[] } => {
  if (layer === null || layer === undefined) return { invalid: [] };
  let perLayer = caches.get(layer);
  if (!perLayer) {
    perLayer = new Map();
    caches.set(layer, perLayer);
  }
  const cached = perLayer.get(declaredKey);
  if (cached !== undefined) return cached as { declared?: R; invalid: I[] };
  const reject: RejectFn = (scope, message) => {
    const fullScope = `${declaredKey}:${scope}`;
    if (warned.has(fullScope)) return;
    warned.add(fullScope);
    warn(message);
  };
  const result = parse(rawDeclaredKeyOf(layer, declaredKey), layerId, reject);
  perLayer.set(declaredKey, result);
  return result;
};

export { readDeclaredKey };
export type { RejectFn };
