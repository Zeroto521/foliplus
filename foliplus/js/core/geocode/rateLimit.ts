// Shared rate-limit primitives for geocoding.
//
// Every request to a provider — through the geocoder's strictly-serialized
// queue or through component paths (e.g. SearchControl's suggestions) —
// records a timestamp on a provider-wide, page-global table. The queue and
// component windows both consult that table, so a provider's rate limit is
// honoured across call paths and across maps, not per path (Nominatim's
// 1 req/s is a server-side global limit).
//
// Tasks are strictly serialized: the next task does not start until the
// previous one has settled.

// Provider-wide last-request timestamps (ms epoch). Shared by the throttle
// queue and by component throttle windows.
const lastRequests = new Map<string, number>();

/** Last recorded request time for a provider id (0 when none yet). */
const lastRequestAt = (id: string): number => lastRequests.get(id) ?? 0;

/** Record a request for a provider id; returns the timestamp stored. */
const markRequest = (id: string, at: number = Date.now()): number => {
  lastRequests.set(id, at);
  return at;
};

// Largest min-interval ever declared for a provider id. Multiple controls may
// configure the same id with different throttleMs (e.g. one with a 500ms
// override, another 2000ms); the queue must honour the strictest declaration
// seen so far, never the laxest, or the permissive instance would exceed its
// own upstream limit while sharing the queue.
const minIntervals = new Map<string, number>();

/**
 * Create a strictly-serialized throttle queue for one provider id.
 * Requests wait until `throttleMs` has passed since the provider-wide last
 * request (including component-path requests via `markRequest`).
 *
 * @param id - Provider id; the queue is shared per id across all callers.
 * @param throttleMs - Minimum interval between requests; the largest value
 *   declared for this id wins.
 */
const createThrottleQueue = (id: string, throttleMs: number) => {
  minIntervals.set(id, Math.max(minIntervals.get(id) ?? 0, throttleMs));
  const interval = () => minIntervals.get(id) ?? throttleMs;
  let chain: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    chain = chain.then(() => {
      const wait = Math.max(0, interval() - (Date.now() - lastRequestAt(id)));
      return new Promise(r => setTimeout(r, wait));
    });
    const run = chain.then(() => {
      markRequest(id);
      return fn();
    });
    // Track settlement (not just the delay) so an in-flight request is never
    // overlapped by the next one — Nominatim's limit is a hard 1 request/s.
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
};

export { createThrottleQueue, lastRequestAt, markRequest };
