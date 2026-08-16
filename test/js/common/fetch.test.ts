import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchWithTimeout,
  GEODECODE_TIMEOUT_MS,
} from "#common/fetch.js";

const jsonResponse = (data: unknown) =>
  ({ json: () => Promise.resolve(data) }) as Response;

/**
 * A mock fetch that stays pending until the composed signal aborts it.
 * Used by timeout-abort and caller-signal-abort tests so the abort fires
 * before any synchronous resolution.
 */
const pendingFetch = vi.fn((_input: RequestInfo | URL, opts: RequestInit) => {
  return new Promise<Response>((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    opts.signal?.addEventListener("abort", () => {
      reject(new DOMException("aborted", "AbortError"));
    });
    void resolve;
  });
});

beforeEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("fetchWithTimeout", () => {
  it("exports GEODECODE_TIMEOUT_MS as a numeric default", () => {
    expect(GEODECODE_TIMEOUT_MS).toBe(10_000);
    expect(typeof GEODECODE_TIMEOUT_MS).toBe("number");
  });

  it("passes through success responses and applies cache: force-cache", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      jsonResponse({ ok: true }),
    );
    await fetchWithTimeout("https://example.com/api");

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://example.com/api",
      expect.objectContaining({
        cache: "force-cache",
      }),
    );
  });

  it("sets HTTP cache headers on every request", async () => {
    (globalThis.fetch as any).mockResolvedValue(jsonResponse({}));
    await fetchWithTimeout("https://example.com/api");

    const call = (globalThis.fetch as any).mock.calls[0];
    const headers = (call[1] as any).headers;
    expect(headers["Cache-Control"]).toBe("max-age=86400");
    expect(typeof headers["Expires"]).toBe("string");
    expect(headers["Expires"]).toMatch(/GMT$/);
  });

  it("merges caller headers (caller values override defaults)", async () => {
    (globalThis.fetch as any).mockResolvedValue(jsonResponse({}));
    await fetchWithTimeout("https://example.com/api", {
      headers: { Authorization: "Bearer token" },
    });

    const headers = ((globalThis.fetch as any).mock.calls[0][1] as any)
      .headers;
    expect(headers["Cache-Control"]).toBe("max-age=86400");
    expect(headers["Authorization"]).toBe("Bearer token");
  });

  it("aborts the request when the timeout elapses", async () => {
    vi.useFakeTimers();
    (globalThis.fetch as any).mockImplementation(pendingFetch);

    const promise = fetchWithTimeout("https://example.com/api", {
      timeoutMs: 50,
    });
    // Advance fake timers past the 50ms timeout so onTimeout fires.
    vi.advanceTimersByTime(51);
    vi.runOnlyPendingTimers();

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("cancels the timeout when the request resolves in time", async () => {
    vi.useFakeTimers();
    (globalThis.fetch as any).mockResolvedValue(jsonResponse({ value: 1 }));

    await fetchWithTimeout("https://example.com/api", { timeoutMs: 10_000 });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(10_001);
    vi.runOnlyPendingTimers();
  });

  it("aborts via a caller-supplied AbortSignal", async () => {
    vi.useFakeTimers();
    (globalThis.fetch as any).mockImplementation(pendingFetch);

    const ac = new AbortController();
    const promise = fetchWithTimeout("https://example.com/api", {
      signal: ac.signal,
      timeoutMs: 10_000,
    });
    ac.abort(new DOMException("user cancel", "AbortError"));
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });

  it("aborts via a pre-aborted caller signal", async () => {
    vi.useFakeTimers();
    (globalThis.fetch as any).mockImplementation(pendingFetch);

    const ac = new AbortController();
    ac.abort();
    await expect(
      fetchWithTimeout("https://example.com/api", {
        signal: ac.signal,
        timeoutMs: 10_000,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("skips the timeout wrapper when timeoutMs is 0", async () => {
    (globalThis.fetch as any).mockResolvedValue(jsonResponse({}));

    await fetchWithTimeout("https://example.com/api", { timeoutMs: 0 });

    const call = (globalThis.fetch as any).mock.calls[0];
    const opts = call[1] as RequestInit;
    expect(opts.signal).toBeUndefined();
  });

  it("passes through caller timeoutMs override", async () => {
    (globalThis.fetch as any).mockResolvedValue(jsonResponse({}));
    await fetchWithTimeout("https://example.com/api", { timeoutMs: 3000 });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("preserves other RequestInit options (method, body)", async () => {
    (globalThis.fetch as any).mockResolvedValue(jsonResponse({}));
    await fetchWithTimeout("https://example.com/api", {
      method: "POST",
      body: "hello",
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://example.com/api",
      expect.objectContaining({
        method: "POST",
        body: "hello",
        cache: "force-cache",
      }),
    );
  });
});