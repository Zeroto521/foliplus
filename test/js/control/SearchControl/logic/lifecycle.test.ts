import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markRequest } from "#core/geocode/index.js";
import { Cache } from "#foliplus/platform/cache.js";
import { createTimers } from "#platform/timer.js";
import { MODE } from "#control/SearchControl/const.js";
import { destroyControl } from "#control/SearchControl/logic/lifecycle.js";
import {
  fetchSuggestions,
  searchAddress,
  searchCoord,
} from "#control/SearchControl/logic/search.js";

// Control context properties the logic functions read via ctrl.config/ctrl.T/etc.
const ctx = () => ({
  config: { name: "SearchControl", locale_code: "en", zoom: 16 },
  T: (k: string) => `SearchControl.${k}`,
  _: (k: string) => k,
  log: {
    msg: (m: string) => m,
    warn: (...args: unknown[]) =>
      console.warn(`[SearchControl] ${args[0]}`, ...args.slice(1)),
    error: vi.fn(),
  },
  _map: window.map,
});

const tick = () => new Promise(r => setTimeout(r, 0));

/** A control with the fields teardown and both request paths touch. */
const makeControl = (extra: Record<string, unknown> = {}) => {
  const modeBtn = document.createElement("button");
  const clearBtn = document.createElement("button");
  const marker = { kind: "marker" } as unknown as L.Marker;
  const delIcon = { kind: "delIcon" } as unknown as L.Marker;
  const cache = new Cache<string, object>(50);
  cache.set("abc", [{ display_name: "cached" }]);
  return {
    ...ctx(),
    inp: { value: "B", focus: vi.fn() },
    mode: MODE.ADDR,
    modeBtn,
    clearBtn,
    marker,
    delIcon,
    ownedLayers: new Set<L.Layer>([marker, delIcon]),
    cachedSuggestions: cache,
    searchHistory: [],
    panelWrap: null,
    panelFloating: null,
    timers: createTimers(),
    selectedIdx: -1,
    currentItems: [],
    lastSuggestFetch: 0,
    suggestSeq: 0,
    addrSeq: 0,
    reverseSeq: 0,
    disposed: false,
    suggestAbortController: null,
    debouncedFetch: { cancel: vi.fn() },
    ctrl: {
      getBoundingClientRect: () => ({ left: 0, bottom: 50, width: 100 }),
    },
    ...extra,
  } as any;
};

beforeEach(() => {
  markRequest("nominatim", 0);
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(globalThis, "fetch");
});

describe("destroyControl — owned resources", () => {
  it("drops a pending suggestion retry instead of firing it after destroy", () => {
    vi.useFakeTimers();
    try {
      const ctrl = makeControl({ inp: { value: "Beij", focus: vi.fn() } });
      // Inside the provider's throttle window: the retry is parked as a timer.
      markRequest("nominatim", Date.now());
      fetchSuggestions(ctrl, "Beij");
      expect(ctrl.timers.names()).toContain("suggest-retry");

      destroyControl(ctrl);

      // The retry is the control's timer: teardown disposes the owner, so it
      // cannot reopen a request against a control that is gone.
      expect(ctrl.timers.disposed).toBe(true);
      expect(ctrl.timers.names()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reclaims the pin and the ✕ the control created", () => {
    const ctrl = makeControl();
    const { marker, delIcon } = ctrl;

    destroyControl(ctrl);

    expect(map.removeLayer).toHaveBeenCalledWith(marker);
    expect(map.removeLayer).toHaveBeenCalledWith(delIcon);
    expect(ctrl.marker).toBeNull();
    expect(ctrl.delIcon).toBeNull();
    expect(ctrl.ownedLayers.size).toBe(0);
    // The request gates are retired: a late provider response can no longer
    // reach the map, the panel or the hint.
    expect(ctrl.disposed).toBe(true);
    expect(ctrl.cachedSuggestions.size).toBe(0);
  });

  it("is safe to run twice", () => {
    const ctrl = makeControl();
    destroyControl(ctrl);
    expect(() => destroyControl(ctrl)).not.toThrow();
  });

  it("isolates a throwing teardown step and reports it", () => {
    const warn = vi.fn();
    const ctrl = makeControl({
      log: { ...ctx().log, warn },
      panelFloating: {
        release: () => {
          throw new Error("boom");
        },
      },
    });
    const { marker, delIcon } = ctrl;

    destroyControl(ctrl);

    expect(warn).toHaveBeenCalledWith(
      'destroy step "remove-panel" threw',
      expect.any(Error),
    );
    // The steps behind the failure still ran: layers were reclaimed and the
    // caches dropped even though removePanel() threw.
    expect(map.removeLayer).toHaveBeenCalledWith(marker);
    expect(map.removeLayer).toHaveBeenCalledWith(delIcon);
    expect(ctrl.cachedSuggestions.size).toBe(0);
    expect(ctrl.searchHistory).toEqual([]);
  });
});

describe("destroyControl — late async results", () => {
  it("ignores an address result that arrives after destroy", async () => {
    const pending: Array<(value: unknown) => void> = [];
    (window.foliplus.geocode as any).mockImplementation(
      () => new Promise<unknown>(resolve => pending.push(resolve)),
    );
    const ctrl = makeControl();
    searchAddress(ctrl, "B");
    destroyControl(ctrl);
    (window.map.foliplus.hint.clear as any).mockClear();
    (map.flyTo as any).mockClear();

    pending[0]({ lat: 2, lng: 2, display_name: "B place" });
    await tick();
    await tick();

    expect(map.flyTo).not.toHaveBeenCalled();
    expect(ctrl.marker).toBeNull();
    expect(window.map.foliplus.hint.clear).not.toHaveBeenCalled();
  });

  it("ignores a suggestion response that arrives after destroy", async () => {
    const inflight: Array<() => void> = [];
    globalThis.fetch = vi.fn(
      () =>
        new Promise<unknown>(resolve => {
          inflight.push(() =>
            resolve({
              json: () =>
                Promise.resolve([{ lat: "30", lon: "120", display_name: "A" }]),
            }),
          );
        }),
    ) as unknown as typeof fetch;
    // The query must miss the seeded cache, otherwise the cache-hit path
    // renders synchronously and no request is ever in flight.
    const ctrl = makeControl({ inp: { value: "paris", focus: vi.fn() } });
    fetchSuggestions(ctrl, "paris");
    destroyControl(ctrl);

    inflight[0]();
    await tick();
    await tick();
    await tick();

    expect(ctrl.panelWrap).toBeNull();
    expect(ctrl.cachedSuggestions.size).toBe(0);
  });
});

describe("request gates — retired and superseded branches", () => {
  it("does not start an address search after destroy", () => {
    const ctrl = makeControl({ inp: { value: "B", focus: vi.fn() } });
    destroyControl(ctrl);
    (window.foliplus.geocode as any).mockClear();
    (window.map.foliplus.hint.set as any).mockClear();

    searchAddress(ctrl, "B");

    expect(window.foliplus.geocode).not.toHaveBeenCalled();
    expect(window.map.foliplus.hint.set).not.toHaveBeenCalled();
  });

  it("does not start a suggestion fetch after destroy", () => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    const ctrl = makeControl({ inp: { value: "paris", focus: vi.fn() } });
    destroyControl(ctrl);

    fetchSuggestions(ctrl, "paris");

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(ctrl.panelWrap).toBeNull();
  });

  it("releases a pending suggestion retry on destroy", () => {
    vi.useFakeTimers();
    try {
      const ctrl = makeControl();
      ctrl.timers.timeout("suggest-retry", () => undefined, 60_000);

      destroyControl(ctrl);

      // The retry is the control's timer: teardown disposes the owner, so the
      // pending callback is cancelled rather than left for the event loop.
      expect(ctrl.timers.disposed).toBe(true);
      expect(ctrl.timers.names()).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a rejection from an address search a newer query superseded", async () => {
    const pending: Array<{
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }> = [];
    (window.foliplus.geocode as any).mockImplementation(
      () =>
        new Promise<unknown>((resolve, reject) => {
          pending.push({ resolve, reject });
        }),
    );
    const ctrl = makeControl({ inp: { value: "B", focus: vi.fn() } });
    searchAddress(ctrl, "A");
    searchAddress(ctrl, "B");
    (window.map.foliplus.hint.set as any).mockClear();
    (window.map.foliplus.hint.clear as any).mockClear();

    pending[0].reject(new Error("late failure"));
    await tick();
    await tick();

    expect(window.map.foliplus.hint.set).not.toHaveBeenCalled();
    expect(window.map.foliplus.hint.clear).not.toHaveBeenCalled();
  });

  it("ignores a rejection from a suggestion fetch a newer query superseded", async () => {
    const pending: Array<{ reject: (error: Error) => void }> = [];
    globalThis.fetch = vi.fn(
      () =>
        new Promise<unknown>((_resolve, reject) => {
          pending.push({ reject });
        }),
    ) as unknown as typeof fetch;
    const warn = vi.fn();
    const ctrl = makeControl({
      inp: { value: "paris", focus: vi.fn() },
      log: { ...ctx().log, warn },
    });
    fetchSuggestions(ctrl, "paris");
    // A newer request retires this one before it settles.
    ctrl.suggestSeq += 1;

    pending[0].reject(new Error("late failure"));
    await tick();
    await tick();

    expect(warn).not.toHaveBeenCalled();
  });

  it("ignores a reverse geocode that lands after a newer coord search", async () => {
    const pending: Array<(value: string) => void> = [];
    (window.foliplus.reverseGeocode as any).mockImplementation(
      () => new Promise<string>(resolve => pending.push(resolve)),
    );
    const ctrl = makeControl({ inp: { value: "", focus: vi.fn() } });
    searchCoord(ctrl, "1,1");
    searchCoord(ctrl, "2,2");

    // The current (second) reverse settles first.
    pending[1]("Second addr");
    await tick();
    await tick();
    // The superseded (first) one arrives late and must not rewrite its entry.
    pending[0]("First addr");
    await tick();
    await tick();

    const first = ctrl.searchHistory.find(
      (entry: { lng: number; lat: number }) => entry.lng === 1 && entry.lat === 1,
    );
    expect(first?.addrDisplay).toBe("");
  });
});
