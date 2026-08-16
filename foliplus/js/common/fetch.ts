// Shared fetch helpers for foliplus components.
// Pure helpers (no module-level state) — imported by geocode and SearchControl.

/**
 * How long a Nominatim request may take before being aborted.
 * Nominatim's own limit is generous (~30s); a 10s client-side timeout gives
 * a snappy UX when the network stalls.
 */
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Request headers sent with every outgoing fetch so the response is cacheable
 * by the browser and any intermediate proxy. `cache: "force-cache"` is
 * applied at the request level as a last-resort safety net when the upstream
 * does not advertise caching (Nominatim does, but older proxies sometimes
 * strip `Cache-Control` headers).
 *
 * NOTE: The application layer still owns the source of truth for fresh data
 * (the 24h TTL `Cache<K,V>` in `runtime/index.js` and `cachedAddress` /
 * `cachedSuggestions` in `SearchControl`). The browser cache only reduces
 * redundant network traffic.
 */
const HTTP_CACHE_HEADERS: Record<string, string> = {
  "Cache-Control": "max-age=86400",
  Expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toUTCString(),
};

interface FetchOptions extends RequestInit {
  /**
   * Optional caller-provided abort signal (e.g. from an AbortController used
   * to cancel a superseded request). Composed with the timeout signal so the
   * earlier of the two wins.
   */
  signal?: AbortSignal;
  /** Override the default timeout. Pass `0` to disable the timeout entirely. */
  timeoutMs?: number;
}

/**
 * Wrap a fetch with an automatic timeout and HTTP cache headers.
 *
 * Signal composition: if a `signal` is provided it is merged with a timeout
 * signal via `AbortSignal.any` when available, otherwise falls back to an
 * AbortController + setTimeout that fires on either abort.
 */
const fetchWithTimeout = (
  url: RequestInfo | URL,
  { signal, timeoutMs = DEFAULT_TIMEOUT_MS, ...opts }: FetchOptions = {},
): Promise<Response> => {
  const headersInit: HeadersInit = {
    ...HTTP_CACHE_HEADERS,
    ...(opts.headers || {}),
  };

  const abortSignal = timeoutMs > 0 ? composeSignal(signal, timeoutMs) : signal;

  return fetch(url, {
    ...opts,
    signal: abortSignal,
    headers: headersInit,
    cache: "force-cache",
  });
};

/**
 * Compose a caller-provided signal with a timeout. The earlier abort wins.
 * Uses `AbortSignal.any` when available, otherwise falls back to an
 * AbortController + setTimeout that fires on either abort.
 */
const composeSignal = (
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
): AbortSignal => {
  // If the parent signal is already aborted, pass it through directly
  // so fetch sees the abort immediately (event listeners cannot fire retroactively).
  if (parentSignal?.aborted) return parentSignal;

  const controller = new AbortController();

  const onTimeout = () => {
    cleanup();
    controller.abort();
  };
  const onParentAbort = () => {
    cleanup();
    controller.abort(parentSignal?.reason);
  };

  const timeoutHandle = setTimeout(onTimeout, timeoutMs);

  const cleanup = () => {
    clearTimeout(timeoutHandle);
    parentSignal?.removeEventListener("abort", onParentAbort);
  };

  parentSignal?.addEventListener("abort", onParentAbort);

  return controller.signal;
};

export { fetchWithTimeout, DEFAULT_TIMEOUT_MS as GEODECODE_TIMEOUT_MS };
