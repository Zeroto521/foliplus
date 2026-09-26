import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markRequest } from "#core/geocode/index.js";
import { AUTOCOMPLETE, MODE, ZOOM } from "#foliplus/SearchControl/const.js";
import {
  attachSearchDelIcon,
  buildSearchUrl,
  fetchSuggestions,
  initDebouncedFetch,
  positionPanel,
  removePanel,
  renderResults,
  searchAddress,
  searchCoord,
} from "#foliplus/SearchControl/logic/search.js";
import { Cache } from "#foliplus/common/cache.js";
import { ensureModes } from "#foliplus/core/mode.js";

// Module-level code captured window.foliplus and window.map from setup.js.
// Use vi.spyOn to track calls on those already-setup mocks.
// `vi.clearAllMocks()` runs globally from setup.ts (resetState) — no need
// to repeat here.
beforeEach(() => {
  // Reset the provider-wide request clock (shared module state) so a prior
  // test's suggestion/geocoder request never throttles this one.
  markRequest("nominatim", 0);
});

// A stub that records the URL of every fetch and holds each response until
// the test releases it — lets a test interleave a user edit between the
// request going out and it settling.
const createDeferredFetch = () => {
  const calls: unknown[] = [];
  const inflight: Array<() => void> = [];
  globalThis.fetch = vi.fn((url: unknown) => {
    calls.push(url);
    return new Promise<unknown>(resolve => {
      inflight.push(() =>
        resolve({
          json: () => Promise.resolve([{ lat: "30", lon: "120", display_name: "A" }]),
        }),
      );
    });
  }) as unknown as typeof fetch;
  const fetches = { calls, inflight };
  return fetches;
};

const tick = () => new Promise(r => setTimeout(r, 0));

// The shape fetchSuggestions needs. Fields the tests do not exercise stay at
// the same defaults as the other fixtures in this file.
const makeFixture = (extra: Record<string, unknown> = {}) =>
  ({
    mode: MODE.ADDR,
    cachedSuggestions: new Cache<string, object>(50),
    panelWrap: null,
    throttleTimer: null,
    selectedIdx: -1,
    lastSuggestFetch: 0,
    suggestSeq: 0,
    suggestAbortController: null,
    ctrl: {
      getBoundingClientRect: () => ({ left: 0, bottom: 50, width: 100 }),
    },
    ...extra,
  }) as any;

// A panel element already in the document — the fixture's default `panelWrap: null`
// means every one of these asserts the panel was removed, not that it never existed.
const attachedPanel = () => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
};

describe("removePanel", () => {
  it("removes panelWrap and resets state", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const ctrl: any = {
      panelWrap: el,
      throttleTimer: setTimeout(() => {}, 1000),
      selectedIdx: 2,
    };

    removePanel(ctrl);

    expect(document.body.contains(el)).toBe(false);
    expect(ctrl.panelWrap).toBeNull();
    expect(ctrl.throttleTimer).toBeNull();
    expect(ctrl.selectedIdx).toBe(-1);
  });

  it("handles null panelWrap without error", () => {
    const ctrl: any = {
      panelWrap: null,
      throttleTimer: null,
      selectedIdx: -1,
    };
    expect(() => removePanel(ctrl)).not.toThrow();
  });
});

describe("renderResults", () => {
  it("removes panel when results are empty", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const ctrl: any = {
      panelWrap: el,
      throttleTimer: null,
      selectedIdx: 0,
    };
    renderResults(ctrl, []);
    expect(ctrl.panelWrap).toBeNull();
    expect(ctrl.selectedIdx).toBe(-1);
  });

  it("writes data-query only for items that carry a query", () => {
    const ctrl: any = {
      panelWrap: null,
      throttleTimer: null,
      selectedIdx: -1,
      ctrl: {
        getBoundingClientRect: () => ({ left: 0, bottom: 50, width: 100 }),
      },
    };
    renderResults(ctrl, [
      // History item: carries its panel display as the re-entry value.
      {
        source: "history",
        icon: "",
        primaryText: "Shanghai, China",
        query: "121.4700, 31.2300",
        coordDisplay: "121.4700, 31.2300",
        onClick: () => false,
      },
      // Suggestion: no query — must NOT get the attribute, so keyboard nav
      // falls back to the display text.
      {
        source: "suggestion",
        icon: "",
        primaryText: "Paris, France",
        coordDisplay: null,
        onClick: () => false,
      },
    ]);
    const items = ctrl.panelWrap.querySelectorAll(".foliplus-search-result-item");
    expect(items).toHaveLength(2);
    expect(items[0].getAttribute("data-query")).toBe("121.4700, 31.2300");
    expect(items[1].hasAttribute("data-query")).toBe(false);
  });

  it("pins coordinates to six decimals instead of echoing the raw stored value", () => {
    // A history entry saved from "121.47" stores 121.47, so the panel used to show
    // "121.47, 31.23" where the measure chip shows 121.470000, 31.230000.
    const ctrl: any = {
      panelWrap: null,
      throttleTimer: null,
      selectedIdx: -1,
      ctrl: {
        getBoundingClientRect: () => ({ left: 0, bottom: 50, width: 100 }),
      },
    };
    renderResults(ctrl, [
      {
        source: "history",
        icon: "",
        primaryText: "Chongqing",
        query: "121.47,31.23",
        coordDisplay: "121.470000, 31.230000",
        onClick: () => false,
      },
    ]);
    const coord = ctrl.panelWrap.querySelector(".foliplus-search-result-coord");
    expect(coord?.textContent).toBe("121.470000, 31.230000");
  });

  it("keeps the retained array in lockstep with the DOM so Enter adopts the highlighted item", () => {
    // renderResults stores the same ResultItem[] it renders into ctrl.currentItems,
    // so the DOM RESULT_ITEM count and currentItems.length are always equal. The
    // Enter handler indexes currentItems by selectedIdx; any drift here would make
    // it adopt a different entry than the one the arrow keys highlighted.
    const ctrl: any = {
      panelWrap: null,
      throttleTimer: null,
      selectedIdx: -1,
      ctrl: {
        getBoundingClientRect: () => ({ left: 0, bottom: 50, width: 100 }),
      },
    };
    renderResults(ctrl, [
      {
        source: "suggestion",
        icon: "",
        primaryText: "One",
        coordDisplay: null,
        onClick: () => true,
      },
      {
        source: "suggestion",
        icon: "",
        primaryText: "Two",
        coordDisplay: null,
        onClick: () => true,
      },
      {
        source: "suggestion",
        icon: "",
        primaryText: "Three",
        coordDisplay: null,
        onClick: () => true,
      },
    ]);
    const domItems = ctrl.panelWrap.querySelectorAll(".foliplus-search-result-item");
    expect(domItems).toHaveLength(3);
    expect(ctrl.currentItems).toHaveLength(3);
    expect(ctrl.currentItems[1].primaryText).toBe("Two");
    // The dev-mode assertion in renderResults would throw on any mismatch; a
    // successful render with equal counts is the positive proof it holds.
  });
});

describe("initDebouncedFetch", () => {
  it("creates a debounced function on ctrl.debouncedFetch", () => {
    const ctrl: any = { inp: { value: "test" }, debouncedFetch: null };
    initDebouncedFetch(ctrl);
    expect(ctrl.debouncedFetch).toBeDefined();
    expect(typeof ctrl.debouncedFetch).toBe("function");
    expect(ctrl.debouncedFetch.cancel).toBeDefined();
  });

  it("debounced callback fires fetchSuggestions when invoked", async () => {
    try {
      vi.useFakeTimers();
      globalThis.fetch = vi.fn(() =>
        Promise.resolve({
          json: () =>
            Promise.resolve([{ lat: "30.0", lon: "120.0", display_name: "A" }]),
        }),
      ) as unknown as typeof fetch;
      const ctrl: any = {
        mode: "addr",
        inp: { value: "search" },
        debouncedFetch: null,
        cachedSuggestions: new Cache<string, object>(50),
        panelWrap: null,
        throttleTimer: null,
        selectedIdx: -1,
        lastSuggestFetch: 0,
        suggestSeq: 0,
        suggestAbortController: null,
        ctrl: {
          getBoundingClientRect: () => ({ left: 0, bottom: 50, width: 100 }),
        },
      };
      initDebouncedFetch(ctrl);
      expect(globalThis.fetch).not.toHaveBeenCalled();
      ctrl.debouncedFetch();
      await vi.advanceTimersByTime(AUTOCOMPLETE.DEBOUNCE_MS + 100);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      Reflect.deleteProperty(globalThis, "fetch");
    }
  });
});

describe("buildSearchUrl", () => {
  it("includes query, limit, and center coordinates", () => {
    const ctrl: any = {};
    const url = buildSearchUrl(ctrl, "test query", 5);
    expect(url).toContain("q=test+query");
    expect(url).toContain("limit=5");
    expect(url).toContain("lon=119.3");
    expect(url).toContain("lat=26.08");
    expect(url).toContain("nominatim.openstreetmap.org");
  });

  it("sends the active locale as accept-language so results match the UI language", () => {
    const original = window.CONF.locale_code;
    try {
      window.CONF = { ...window.CONF, locale_code: "zh" };
      const url = buildSearchUrl({} as any, "test", 5);
      expect(url).toContain("accept-language=zh");
    } finally {
      window.CONF = { ...window.CONF, locale_code: original };
    }
  });

  it("falls back to en when no locale is configured", () => {
    const original = window.CONF.locale_code;
    try {
      window.CONF = { ...window.CONF, locale_code: undefined };
      const url = buildSearchUrl({} as any, "test", 5);
      expect(url).toContain("accept-language=en");
    } finally {
      window.CONF = { ...window.CONF, locale_code: original };
    }
  });
});

describe("searchCoord", () => {
  it("shows hint and clears input for invalid coordinates", () => {
    const ctrl: any = { inp: { value: "" }, marker: null, searchHistory: [] };
    searchCoord(ctrl, "abc");
    expect(window.map.foliplus.showHint).toHaveBeenCalledWith(
      "SearchControl",
      "SearchControl.coord_error",
      4000,
    );
    expect(ctrl.inp.value).toBe("");
  });

  it("shows hint for out-of-range values", () => {
    const ctrl: any = { inp: { value: "" }, marker: null, searchHistory: [] };
    searchCoord(ctrl, "200,100");
    expect(window.map.foliplus.showHint).toHaveBeenCalled();
    expect(ctrl.inp.value).toBe("");
  });

  it("flies to valid coordinates", async () => {
    const ctrl: any = {
      inp: { value: "121.47,31.23" },
      marker: null,
      searchHistory: [],
    };
    searchCoord(ctrl, "121.47,31.23");
    expect(map.flyTo).toHaveBeenCalledWith([31.23, 121.47], 16);
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    expect(ctrl.searchHistory).toHaveLength(1);
  });
});

describe("searchAddress", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(globalThis, "fetch");
  });

  it("delegates to foliplus.geocode (single global cache)", async () => {
    const mockResult = {
      lat: 30.2,
      lng: 120.5,
      display_name: "X, Y",
    };
    (window.foliplus.geocode as any).mockResolvedValue(mockResult);
    const ctrl: any = {
      cachedAddress: {},
      addrAbortController: null,
      inp: { value: "X" },
      marker: null,
    };
    searchAddress(ctrl, "X");
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    expect(window.foliplus.geocode).toHaveBeenCalledWith(
      map,
      "X",
      "en",
      undefined,
      undefined,
    );
  });

  it("forwards a custom provider spec to foliplus.geocode", async () => {
    const original = window.CONF.provider;
    const originalCfg = window.CONF.provider_config;
    try {
      window.CONF = {
        ...window.CONF,
        provider: { id: "myapi", baseUrl: "https://x.example.com" },
        provider_config: null,
      };
      (window.foliplus.geocode as any).mockResolvedValue({
        lat: 1,
        lng: 2,
        display_name: "A",
      });
      const ctrl: any = {
        cachedAddress: {},
        addrAbortController: null,
        inp: { value: "X" },
        marker: null,
      };
      searchAddress(ctrl, "X");
      await new Promise(r => setTimeout(r, 0));
      await new Promise(r => setTimeout(r, 0));
      expect(window.foliplus.geocode).toHaveBeenCalledWith(
        map,
        "X",
        "en",
        { id: "myapi", baseUrl: "https://x.example.com" },
        null,
      );
    } finally {
      window.CONF = {
        ...window.CONF,
        provider: original,
        provider_config: originalCfg,
      };
    }
  });

  it("shows hint and clears input when geocode returns null", async () => {
    (window.foliplus.geocode as any).mockResolvedValue(null);
    const ctrl: any = {
      cachedAddress: {},
      addrAbortController: null,
      inp: { value: "abc" },
    };
    searchAddress(ctrl, "nowhere");
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    expect(window.map.foliplus.showHint).toHaveBeenLastCalledWith(
      "SearchControl",
      "SearchControl.addr_not_found",
      4000,
    );
    expect(ctrl.inp.value).toBe("");
  });

  it("flies to and marks the geocode result", async () => {
    const mockResult = {
      lat: 30.2,
      lng: 120.5,
      display_name: "X, Y",
    };
    (window.foliplus.geocode as any).mockResolvedValue(mockResult);
    const ctrl: any = {
      cachedAddress: {},
      addrAbortController: null,
      inp: { value: "X" },
      marker: null,
      searchHistory: [],
    };
    searchAddress(ctrl, "X");
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    expect(window.map.foliplus.hideHint).toHaveBeenCalledWith("SearchControl");
    expect(map.flyTo).toHaveBeenCalledWith([30.2, 120.5], expect.any(Number));
    expect(ctrl.marker).not.toBeNull();
  });

  it("loading hint is plain text, not an inline SVG string", async () => {
    (window.foliplus.geocode as any).mockResolvedValue(null);
    const ctrl: any = {
      cachedAddress: {},
      addrAbortController: null,
      inp: { value: "nowhere" },
    };
    searchAddress(ctrl, "nowhere");
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    // Hint text is rendered as a TextNode, so an inline SVG would appear as
    // source code instead of an icon; withLoadingIcon renders the built-in
    // spinner in the hint's icon slot instead.
    expect(window.map.foliplus.showHint).toHaveBeenCalledWith(
      "SearchControl",
      "SearchControl.popup_loading",
      0,
      undefined,
      undefined,
      true,
    );
  });
});

describe("positionPanel", () => {
  it("places wrap below the control", () => {
    const ctrl: any = {
      panelWrap: { style: {} },
      ctrl: {
        getBoundingClientRect: () => ({
          left: 10,
          top: 20,
          bottom: 100,
          width: 200,
        }),
      },
    };
    positionPanel(ctrl);
    expect(ctrl.panelWrap.style.left).toBe("10px");
    expect(ctrl.panelWrap.style.top).toBe("100px");
  });

  it("clips suggestions wrap to the right edge when it would overflow", () => {
    const originalWidth = window.innerWidth;
    try {
      // Narrow viewport so left + rect.width exceeds innerWidth
      Object.defineProperty(window, "innerWidth", {
        value: 300,
        configurable: true,
      });
      const ctrl: any = {
        panelWrap: { style: {} },
        ctrl: {
          getBoundingClientRect: () => ({
            left: 250,
            top: 20,
            bottom: 100,
            width: 200,
          }),
        },
      };
      positionPanel(ctrl);
      // Would normally be left=250, but clipped to 300-200=100
      expect(ctrl.panelWrap.style.left).toBe("100px");
      expect(ctrl.panelWrap.style.top).toBe("100px");
    } finally {
      Object.defineProperty(window, "innerWidth", {
        value: originalWidth,
        configurable: true,
      });
    }
  });
});

describe("fetchSuggestions", () => {
  it("removes suggestions when not in ADDR mode", () => {
    const ctrl: any = {
      mode: "coord",
      panelWrap: null,
      throttleTimer: null,
      selectedIdx: -1,
    };
    fetchSuggestions(ctrl, "abc");
    expect(ctrl.panelWrap).toBeNull();
  });

  it("ignores queries below min chars", () => {
    const ctrl: any = {
      mode: "addr",
      panelWrap: null,
      throttleTimer: null,
      selectedIdx: -1,
    };
    fetchSuggestions(ctrl, "ab");
    expect(ctrl.panelWrap).toBeNull();
  });

  it("renders cached suggestions without fetching", () => {
    globalThis.fetch = vi.fn();
    const cache = new Cache<string, object>(50);
    cache.set("abc", [{ display_name: "Cached" }]);
    const ctrl: any = {
      mode: "addr",
      cachedSuggestions: cache,
      panelWrap: null,
      throttleTimer: null,
      selectedIdx: -1,
      ctrl: {
        getBoundingClientRect: () => ({ left: 0, bottom: 50, width: 100 }),
      },
      inp: { value: "abc" },
    };
    fetchSuggestions(ctrl, "abc");
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(ctrl.panelWrap).not.toBeNull();
  });

  it("is blocked by MeasureControl active mode", () => {
    globalThis.fetch = vi.fn();
    // Simulate MeasureControl being in active mode
    ensureModes(window.map).setMode("MeasureControl", "distance");
    const ctrl: any = {
      mode: "addr",
      cachedSuggestions: new Cache<string, object>(50),
      panelWrap: null,
      throttleTimer: null,
      selectedIdx: -1,
      ctrl: {
        getBoundingClientRect: () => ({ left: 0, bottom: 50, width: 100 }),
      },
      inp: { value: "Paris" },
    };
    fetchSuggestions(ctrl, "Paris");
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(ctrl.panelWrap).toBeNull();
    ensureModes(window.map).setMode("MeasureControl", null);
  });

  it("formats suggestion display names with the active locale", () => {
    globalThis.fetch = vi.fn();
    const original = window.CONF.locale_code;
    try {
      window.CONF = { ...window.CONF, locale_code: "zh" };
      const ctrl: any = {
        mode: "addr",
        cachedSuggestions: (() => {
          const c = new Cache<string, object>(50);
          c.set("abc", [{ display_name: "Rue de Rivoli, 75001, Paris, France" }]);
          return c;
        })(),
        panelWrap: null,
        throttleTimer: null,
        selectedIdx: -1,
        ctrl: {
          getBoundingClientRect: () => ({ left: 0, bottom: 50, width: 100 }),
        },
        inp: { value: "abc" },
      };
      fetchSuggestions(ctrl, "abc");
      // zh: reverse order (large → small), postal code filtered
      expect(ctrl.panelWrap.textContent).toContain("France,Paris,Rue de Rivoli");
    } finally {
      window.CONF = { ...window.CONF, locale_code: original };
    }
  });

  it("fetches and renders results", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        json: () =>
          Promise.resolve([{ lat: "30.0", lon: "120.0", display_name: "A, Place" }]),
      }),
    ) as unknown as typeof fetch;
    const ctrl: any = {
      mode: "addr",
      cachedSuggestions: new Cache<string, object>(50),
      panelWrap: null,
      throttleTimer: null,
      selectedIdx: -1,
      lastSuggestFetch: 0,
      suggestSeq: 0,
      suggestAbortController: null,
      ctrl: {
        getBoundingClientRect: () => ({ left: 0, bottom: 50, width: 100 }),
      },
      inp: { value: "abc" },
    };
    fetchSuggestions(ctrl, "abc");
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    expect(globalThis.fetch).toHaveBeenCalled();
    expect(ctrl.cachedSuggestions.get("abc")).toHaveLength(1);
    expect(ctrl.panelWrap).not.toBeNull();
    // First suggestion is written into global geocode cache
    expect(window.foliplus.cacheSuggestion).toHaveBeenCalledWith(
      map,
      "abc",
      120.0,
      30.0,
      expect.any(String),
      undefined,
      undefined,
    );
  });

  it("falls back to Nominatim when the configured provider id is unknown", () => {
    const original = window.CONF.provider;
    try {
      window.CONF = { ...window.CONF, provider: "bogus" };
      const url = buildSearchUrl({} as any, "Paris", 5);
      expect(url).toContain("nominatim.openstreetmap.org/search");
    } finally {
      window.CONF = { ...window.CONF, provider: original };
    }
  });

  it("discards a suggestion response when the query changed meanwhile", async () => {
    globalThis.fetch = vi.fn(
      () =>
        new Promise(resolve =>
          setTimeout(
            () =>
              resolve({
                json: () =>
                  Promise.resolve([
                    { lat: "30.0", lon: "120.0", display_name: "Paris, France" },
                  ]),
              }),
            10,
          ),
        ),
    ) as unknown as typeof fetch;
    const cache = new Cache<string, object>(50);
    const ctrl: any = {
      mode: "addr",
      cachedSuggestions: cache,
      panelWrap: null,
      throttleTimer: null,
      selectedIdx: -1,
      lastSuggestFetch: 0,
      suggestSeq: 0,
      suggestAbortController: null,
      ctrl: {
        getBoundingClientRect: () => ({ left: 0, bottom: 50, width: 100 }),
      },
      inp: { value: "Paris" },
    };
    fetchSuggestions(ctrl, "Paris");
    ctrl.inp.value = "Rome"; // query changed before the response lands
    await new Promise(r => setTimeout(r, 30));
    expect(cache.get("Paris")).toBeUndefined(); // never cached
    expect(ctrl.panelWrap).toBeNull(); // never rendered
  });

  it("defers a suggestion when the provider-wide window is still cooling down", () => {
    globalThis.fetch = vi.fn();
    markRequest("nominatim", Date.now()); // a geocoder request just landed
    const ctrl: any = {
      mode: "addr",
      cachedSuggestions: new Cache<string, object>(50),
      panelWrap: null,
      throttleTimer: null,
      selectedIdx: -1,
      lastSuggestFetch: 0,
      ctrl: {
        getBoundingClientRect: () => ({ left: 0, bottom: 50, width: 100 }),
      },
      inp: { value: "abc" },
    };
    fetchSuggestions(ctrl, "abc");
    expect(globalThis.fetch).not.toHaveBeenCalled(); // deferred, not issued
    expect(ctrl.throttleTimer).not.toBeNull();
  });
});

describe("attachSearchDelIcon", () => {
  // A real DOM wrap so toggleDelIcon can flip the inner ✕'s visible class.
  // makeMarkerWithEl: each L.marker() call returns a fresh marker sharing the
  // same wrap element, so ctrl.marker and the del icon are distinct objects.
  const makeMarkerWithEl = () => {
    const span = document.createElement("span");
    span.setAttribute("data-del-icon", "");
    const wrap = document.createElement("div");
    wrap.appendChild(span);
    const makeMarker = () => ({
      bindPopup: vi.fn(),
      openPopup: vi.fn(),
      addTo: vi.fn(),
      getPopup: () => ({ isOpen: () => false }),
      on: vi.fn(),
      getElement: () => wrap,
    });
    window.L.marker = vi.fn(makeMarker);
    const marker = makeMarker();
    return { marker, span };
  };

  it("shows the ✕ while the popup is open, hides on close", () => {
    const { marker, span } = makeMarkerWithEl();
    const ctrl: any = {
      marker,
      delIcon: null,
      inp: { value: "abc", focus: vi.fn() },
    };
    attachSearchDelIcon(ctrl, [31.23, 121.47]);

    expect(ctrl.delIcon).not.toBeNull();
    expect(map.addLayer).toHaveBeenCalledWith(ctrl.delIcon);

    const popupOpen = marker.on.mock.calls.find(c => c[0] === "popupopen")?.[1];
    expect(popupOpen).toBeDefined();
    popupOpen();
    expect(span.classList.contains("visible")).toBe(true);

    const popupClose = marker.on.mock.calls.find(c => c[0] === "popupclose")?.[1];
    popupClose();
    expect(span.classList.contains("visible")).toBe(false);
  });

  it("keeps the ✕ hidden by default (only popupopen reveals it)", () => {
    // SearchControl opens the popup during creation, before the popupopen
    // listener is attached — the ✕ must stay hidden until the user actually
    // opens the popup again, matching MeasureControl / LocateControl.
    const { marker, span } = makeMarkerWithEl();
    const ctrl: any = {
      marker,
      delIcon: null,
      inp: { value: "abc", focus: vi.fn() },
    };
    attachSearchDelIcon(ctrl, [31.23, 121.47]);
    expect(span.classList.contains("visible")).toBe(false);

    const popupOpen = marker.on.mock.calls.find(c => c[0] === "popupopen")?.[1];
    popupOpen();
    expect(span.classList.contains("visible")).toBe(true);
  });

  it("clicking the ✕ removes the pin and clears the search input", () => {
    const { marker } = makeMarkerWithEl();
    const ctrl: any = {
      marker,
      delIcon: null,
      inp: { value: "abc", focus: vi.fn() },
    };
    attachSearchDelIcon(ctrl, [31.23, 121.47]);
    const delIcon = ctrl.delIcon;

    const delClick = delIcon.on.mock.calls.find(
      (c: unknown[]) => c[0] === "click",
    )?.[1];
    expect(delClick).toBeDefined();
    const x = document.createElement("span");
    x.setAttribute("data-del-icon", "");
    delClick({ originalEvent: { target: x } });

    expect(map.removeLayer).toHaveBeenCalledWith(marker);
    expect(map.removeLayer).toHaveBeenCalledWith(delIcon);
    expect(ctrl.marker).toBeNull();
    expect(ctrl.delIcon).toBeNull();
    expect(ctrl.inp.value).toBe("");
    expect(ctrl.inp.focus).toHaveBeenCalled();
  });

  it("replaces any previous del icon when called again", () => {
    const { marker } = makeMarkerWithEl();
    const ctrl: any = {
      marker,
      delIcon: null,
      inp: { value: "abc", focus: vi.fn() },
    };
    attachSearchDelIcon(ctrl, [31.23, 121.47]);
    const first = ctrl.delIcon;
    attachSearchDelIcon(ctrl, [31.24, 121.48]);
    expect(map.removeLayer).toHaveBeenCalledWith(first);
    expect(ctrl.delIcon).not.toBe(first);
  });
});

describe("searchCoord edge cases", () => {
  it("converts fullwidth comma to halfwidth", () => {
    const ctrl: any = { inp: { value: "" }, marker: null, searchHistory: [] };
    searchCoord(ctrl, "121，31");
    expect(map.flyTo).toHaveBeenCalledWith([31, 121], 16);
  });

  it("uses CONF.zoom when set", () => {
    const original = window.CONF.zoom;
    try {
      window.CONF = { ...window.CONF, zoom: 14 };
      const ctrl: any = {
        inp: { value: "121.47,31.23" },
        marker: null,
        searchHistory: [],
      };
      searchCoord(ctrl, "121.47,31.23");
      expect(map.flyTo).toHaveBeenCalledWith([31.23, 121.47], 14);
    } finally {
      window.CONF = { ...window.CONF, zoom: original };
    }
  });

  it("falls back to ZOOM.MAX when CONF.zoom is unset", () => {
    const original = window.CONF.zoom;
    try {
      window.CONF = { ...window.CONF, zoom: undefined };
      const ctrl: any = {
        inp: { value: "121.47,31.23" },
        marker: null,
        searchHistory: [],
      };
      searchCoord(ctrl, "121.47,31.23");
      expect(map.flyTo).toHaveBeenCalledWith([31.23, 121.47], ZOOM.MAX);
    } finally {
      window.CONF = { ...window.CONF, zoom: original };
    }
  });

  it("is blocked when MeasureControl is active", () => {
    ensureModes(window.map).setMode("MeasureControl", "distance");
    const ctrl: any = {
      inp: { value: "121.47,31.23" },
      marker: null,
      searchHistory: [],
    };
    searchCoord(ctrl, "121.47,31.23");
    expect(map.flyTo).not.toHaveBeenCalled();
    expect(window.map.foliplus.showHint).toHaveBeenCalledWith(
      "SearchControl",
      "SearchControl.blocked",
      expect.any(Number),
    );
    ensureModes(window.map).setMode("MeasureControl", null);
  });
});

describe("searchAddress error paths", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows addr_error hint on geocode rejection", async () => {
    (window.foliplus.geocode as any).mockRejectedValue(new Error("fail"));
    const ctrl: any = {
      cachedAddress: {},
      addrAbortController: null,
      inp: { value: "X" },
    };
    searchAddress(ctrl, "X");
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    expect(window.map.foliplus.hideHint).toHaveBeenCalledWith("SearchControl");
    expect(window.map.foliplus.showHint).toHaveBeenCalledWith(
      "SearchControl",
      "SearchControl.addr_error",
      4000,
    );
  });

  it("is blocked when MeasureControl is active", async () => {
    ensureModes(window.map).setMode("MeasureControl", "distance");
    (window.foliplus.geocode as any).mockResolvedValue({
      lat: 30,
      lng: 120,
      display_name: "X",
    });
    const ctrl: any = {
      cachedAddress: {},
      addrAbortController: null,
      inp: { value: "X" },
    };
    searchAddress(ctrl, "X");
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    expect(window.foliplus.geocode).not.toHaveBeenCalled();
    ensureModes(window.map).setMode("MeasureControl", null);
  });
});

describe("fetchSuggestions: throttle and abort", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve([{ lat: "30.0", lon: "120.0", display_name: "A" }]),
      }),
    ) as unknown as typeof fetch;
  });
  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(globalThis, "fetch");
  });

  it("fires the throttled fetch when the throttle timer elapses", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
    const ctrl: any = {
      mode: "addr",
      cachedSuggestions: new Cache<string, object>(50),
      panelWrap: null,
      throttleTimer: null,
      selectedIdx: -1,
      lastSuggestFetch: 0,
      suggestSeq: 0,
      suggestAbortController: null,
      ctrl: {
        getBoundingClientRect: () => ({ left: 0, bottom: 50, width: 100 }),
      },
      inp: { value: "abc" },
    };
    // First call — immediate fetch.
    fetchSuggestions(ctrl, "abc");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    // Second call — throttled, schedules a timer.
    fetchSuggestions(ctrl, "abc");
    expect(ctrl.throttleTimer).toBeDefined();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    // Advance time past throttle window → callback fires and re-invokes
    // fetchSuggestions. Cache hit → no second fetch.
    await vi.advanceTimersByTimeAsync(1000);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    // lastSuggestFetch updated by the callback's re-invocation.
    expect(ctrl.lastSuggestFetch).toBeGreaterThan(0);
  });

  it("clears the pending throttle timer when a third rapid call arrives", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
    const ctrl: any = {
      mode: "addr",
      cachedSuggestions: new Cache<string, object>(50),
      panelWrap: null,
      throttleTimer: null,
      selectedIdx: -1,
      lastSuggestFetch: 0,
      suggestSeq: 0,
      suggestAbortController: null,
      ctrl: {
        getBoundingClientRect: () => ({ left: 0, bottom: 50, width: 100 }),
      },
      inp: { value: "abc" },
    };
    // First call — immediate fetch.
    fetchSuggestions(ctrl, "abc");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    // Second call — throttled, schedules a timer.
    fetchSuggestions(ctrl, "abc");
    expect(ctrl.throttleTimer).toBeDefined();
    const timerBefore = ctrl.throttleTimer;
    // Third call before the timer fires — must clear the previous timer.
    fetchSuggestions(ctrl, "abc");
    expect(ctrl.throttleTimer).not.toBe(timerBefore);
  });

  it("aborts previous request when new query arrives", () => {
    const ctrl: any = {
      mode: "addr",
      cachedSuggestions: new Cache<string, object>(50),
      panelWrap: null,
      throttleTimer: null,
      selectedIdx: -1,
      lastSuggestFetch: 0,
      suggestSeq: 0,
      suggestAbortController: null,
      ctrl: {
        getBoundingClientRect: () => ({ left: 0, bottom: 50, width: 100 }),
      },
      inp: { value: "abc" },
    };
    fetchSuggestions(ctrl, "abc");
    const prev = ctrl.suggestAbortController;
    expect(prev).toBeInstanceOf(AbortController);
    // Move both clocks back so the second call passes the throttle window
    // (the first call also marked the provider-wide clock).
    ctrl.lastSuggestFetch = Date.now() - 2000;
    markRequest("nominatim", Date.now() - 2000);
    fetchSuggestions(ctrl, "def");
    expect(prev.signal.aborted).toBe(true);
  });

  it("ignores stale response when query changed", () => {
    const ctrl: any = {
      mode: "addr",
      cachedSuggestions: new Cache<string, object>(50),
      panelWrap: null,
      throttleTimer: null,
      selectedIdx: -1,
      lastSuggestFetch: 0,
      suggestSeq: 0,
      suggestAbortController: null,
      ctrl: {
        getBoundingClientRect: () => ({ left: 0, bottom: 50, width: 100 }),
      },
      inp: { value: "abc" },
    };
    fetchSuggestions(ctrl, "abc");
    ctrl.suggestSeq += 1;
    ctrl.inp.value = "xyz";
    expect(ctrl.panelWrap).toBeNull();
  });

  it("does not render or cache a response for a query the input no longer reads", async () => {
    // A request dispatched for "abc" can still be settling after the input
    // reads "def": with the debounce pending, no second request is issued and
    // suggestSeq never increments, so the seq guard alone cannot catch it.
    const fetches = createDeferredFetch();
    const ctrl: any = makeFixture({ inp: { value: "abc" } });
    fetchSuggestions(ctrl, "abc");
    expect(fetches.inflight).toHaveLength(1);
    // The user edits while the request was in flight: the debounce swallowed
    // the keystrokes, so no second request and no seq bump.
    ctrl.inp.value = "def";
    fetches.inflight[0]();
    await tick();
    // The stale response must not have opened a panel...
    expect(ctrl.panelWrap).toBeNull();
    // ...nor seeded the cache for a query the input no longer reads —
    // otherwise a later fetchSuggestions(ctrl, "abc") would render "abc"
    // results straight from cache without going to the network.
    expect(ctrl.cachedSuggestions.get("abc")).toBeUndefined();
    // The network was hit exactly once: no re-issue from the drop path.
    expect(fetches.calls).toHaveLength(1);
  });

  it("does not reopen a panel from a cache entry the input no longer reads", async () => {
    // The seq guard cannot catch a quiet user either: typing "abc" then
    // clearing the box never issues a second request, so nothing increments
    // suggestSeq. The cache is the only surviving copy of that response.
    const fetches = createDeferredFetch();
    const ctrl: any = makeFixture({
      searchHistory: [],
      inp: { value: "abc" },
    });
    fetchSuggestions(ctrl, "abc");
    fetches.inflight[0]();
    await tick();
    expect(ctrl.panelWrap).not.toBeNull();
    expect(ctrl.cachedSuggestions.get("abc")).toBeDefined();
    // User clears the input: no request, no seq bump.
    ctrl.inp.value = "";
    fetchSuggestions(ctrl, "");
    expect(ctrl.panelWrap).toBeNull();
    // Re-typing "abc" hits the cache. The entry must not resurrect the
    // panel for a context it no longer belongs to.
    fetchSuggestions(ctrl, "abc");
    expect(ctrl.panelWrap).toBeNull();
    // A cache hit is a no-network path, so nothing was re-issued here.
    expect(fetches.calls).toHaveLength(1);
  });

  it("retries the live input value, not the queued one", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
    const fetches = createDeferredFetch();
    const ctrl: any = makeFixture({ inp: { value: "abc" } });
    // First call passes the window and marks both clocks.
    fetchSuggestions(ctrl, "abc");
    // Second call lands inside the throttle window and schedules a retry.
    fetchSuggestions(ctrl, "abc");
    expect(ctrl.throttleTimer).toBeDefined();
    // The user keeps typing while the retry is pending.
    ctrl.inp.value = "defg";
    await vi.advanceTimersByTimeAsync(1000);
    // The retry must target what is actually in the box, not the value the
    // keystroke that queued it carried.
    expect(fetches.calls).toHaveLength(2);
    expect(String(fetches.calls[1])).toContain("defg");
    expect(String(fetches.calls[1])).not.toContain("abc");
    vi.useRealTimers();
  });

  it("refetches a cached suggestion once its TTL has lapsed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
    const fetches = createDeferredFetch();
    // A TTL-bearing cache, as SearchControl builds it from the consts. An
    // entry is only as good as the map view that produced it, so a stale one
    // must expire rather than paint suggestions for a bias the user has panned
    // away from.
    const ctrl: any = makeFixture({
      inp: { value: "abc" },
      cachedSuggestions: new Cache<string, object>(
        AUTOCOMPLETE.CACHE_MAX,
        AUTOCOMPLETE.CACHE_TTL_MS,
      ),
    });
    ctrl.cachedSuggestions.set("abc", [{ lat: "30", lng: "120", display_name: "A" }]);
    // Inside the TTL the entry still serves: no request, panel painted.
    fetchSuggestions(ctrl, "abc");
    expect(fetches.calls).toHaveLength(0);
    expect(ctrl.panelWrap).not.toBeNull();
    // Past the TTL the entry is retired on access, so the keystroke refetches.
    vi.setSystemTime(new Date(Date.now() + AUTOCOMPLETE.CACHE_TTL_MS + 60_000));
    fetchSuggestions(ctrl, "abc");
    expect(fetches.calls).toHaveLength(1);
    vi.useRealTimers();
  });
});

describe("fetchSuggestions: empty query shows history", () => {
  it("renders history panel when query is empty and history exists", () => {
    const ctrl: any = {
      mode: "coord",
      panelWrap: null,
      throttleTimer: null,
      selectedIdx: -1,
      searchHistory: [
        {
          query: "121.47,31.23",
          type: "coord",
          coordDisplay: "121.4700, 31.2300",
          addrDisplay: "",
          lat: 31.23,
          lng: 121.47,
          ts: 1000,
          count: 1,
        },
      ],
      ctrl: {
        getBoundingClientRect: () => ({ left: 0, bottom: 50, width: 100 }),
      },
      inp: { value: "" },
    };
    fetchSuggestions(ctrl, "");
    expect(ctrl.panelWrap).not.toBeNull();
    expect(ctrl.panelWrap.textContent).toContain("121.4700, 31.2300");
  });

  it("removes panel when query is empty and history is empty", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const ctrl: any = {
      mode: "coord",
      panelWrap: el,
      throttleTimer: null,
      selectedIdx: 0,
      searchHistory: [],
      ctrl: {
        getBoundingClientRect: () => ({ left: 0, bottom: 50, width: 100 }),
      },
      inp: { value: "" },
    };
    fetchSuggestions(ctrl, "");
    expect(ctrl.panelWrap).toBeNull();
  });

  it("filters history by mode when query is empty", () => {
    const ctrl: any = {
      mode: "addr",
      panelWrap: null,
      throttleTimer: null,
      selectedIdx: -1,
      searchHistory: [
        {
          query: "121.47,31.23",
          type: "coord",
          coordDisplay: "121.4700, 31.2300",
          addrDisplay: "",
          lat: 31.23,
          lng: 121.47,
          ts: 1000,
          count: 1,
        },
      ],
      ctrl: {
        getBoundingClientRect: () => ({ left: 0, bottom: 50, width: 100 }),
      },
      inp: { value: "" },
    };
    // Addr mode with only coord history → panel removed
    fetchSuggestions(ctrl, "");
    expect(ctrl.panelWrap).toBeNull();
  });
});

describe("fetchSuggestions: render behavior", () => {
  it("renders suggestions with data-index attributes", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        json: () =>
          Promise.resolve([
            { lat: "30.0", lon: "120.0", display_name: "First" },
            { lat: "31.0", lon: "121.0", display_name: "Second" },
          ]),
      }),
    ) as unknown as typeof fetch;
    const ctrl: any = {
      mode: "addr",
      cachedSuggestions: new Cache<string, object>(50),
      panelWrap: null,
      throttleTimer: null,
      selectedIdx: -1,
      lastSuggestFetch: 0,
      suggestSeq: 0,
      suggestAbortController: null,
      ctrl: {
        getBoundingClientRect: () => ({ left: 0, bottom: 50, width: 100 }),
      },
      inp: { value: "abc" },
    };
    fetchSuggestions(ctrl, "abc");
    await new Promise(r => setTimeout(r, 0));
    expect(ctrl.panelWrap.querySelectorAll("[data-index='0']")).toHaveLength(1);
    expect(ctrl.panelWrap.querySelectorAll("[data-index='1']")).toHaveLength(1);
  });

  it("does not cache a suggestion when the result list is empty", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve([]) }),
    ) as unknown as typeof fetch;
    const el = document.createElement("div");
    document.body.appendChild(el);
    const ctrl: any = {
      mode: "addr",
      cachedSuggestions: new Cache<string, object>(50),
      panelWrap: el,
      throttleTimer: null,
      selectedIdx: -1,
      lastSuggestFetch: 0,
      suggestSeq: 0,
      suggestAbortController: null,
      ctrl: {
        getBoundingClientRect: () => ({ left: 0, bottom: 50, width: 100 }),
      },
      inp: { value: "abc" },
    };
    fetchSuggestions(ctrl, "abc");
    await new Promise(r => setTimeout(r, 50));
    // No first result → cacheSuggestion is not called.
    expect(window.foliplus.cacheSuggestion).not.toHaveBeenCalled();
    expect(ctrl.panelWrap).toBeNull();
  });

  it("accepts lng-based suggestion payloads as well as lon", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        json: () =>
          Promise.resolve([{ lat: "48.8", lng: "2.3", display_name: "Paris" }]),
      }),
    ) as unknown as typeof fetch;
    const ctrl: any = {
      mode: "addr",
      cachedSuggestions: new Cache<string, object>(50),
      panelWrap: null,
      throttleTimer: null,
      selectedIdx: -1,
      lastSuggestFetch: 0,
      suggestSeq: 0,
      suggestAbortController: null,
      ctrl: {
        getBoundingClientRect: () => ({ left: 0, bottom: 50, width: 100 }),
      },
      inp: { value: "paris" },
    };
    fetchSuggestions(ctrl, "paris");
    await new Promise(r => setTimeout(r, 50));
    // The lng fallback was used and the suggestion was cached with lng=2.3.
    expect(window.foliplus.cacheSuggestion).toHaveBeenCalledWith(
      map,
      "paris",
      2.3,
      48.8,
      expect.any(String),
      undefined,
      undefined,
    );
    expect(
      ctrl.panelWrap.querySelectorAll(".foliplus-search-result-item"),
    ).toHaveLength(1);
  });

  it("falls back to the raw query when the suggestion address is unformattable", async () => {
    // A purely numeric display_name gets filtered to "" by formatAddress, so
    // the fetch handler's cacheSuggestion call uses the query fallback.
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        json: () =>
          Promise.resolve([{ lat: "30.0", lon: "120.0", display_name: "12345" }]),
      }),
    ) as unknown as typeof fetch;
    const cacheSuggestionSpy = vi.spyOn(window.foliplus, "cacheSuggestion");
    const ctrl: any = {
      mode: "addr",
      cachedSuggestions: new Cache<string, object>(50),
      panelWrap: null,
      throttleTimer: null,
      selectedIdx: -1,
      lastSuggestFetch: 0,
      suggestSeq: 0,
      suggestAbortController: null,
      ctrl: {
        getBoundingClientRect: () => ({ left: 0, bottom: 50, width: 100 }),
      },
      inp: { value: "abc" },
    };
    fetchSuggestions(ctrl, "abc");
    await new Promise(r => setTimeout(r, 50));
    expect(cacheSuggestionSpy).toHaveBeenCalledWith(
      map,
      "abc",
      120,
      30,
      "abc", // formatAddress("12345") returns "" → falls back to the query
      undefined,
      undefined,
    );
    cacheSuggestionSpy.mockRestore();
  });

  it("onmousedown on suggestion item triggers renderAddressResult and records history", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        json: () =>
          Promise.resolve([
            {
              lat: "30.0",
              lon: "120.0",
              display_name: "A, Place",
            },
          ]),
      }),
    ) as unknown as typeof fetch;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctrl: any = {
      mode: "addr",
      cachedSuggestions: new Cache<string, object>(50),
      panelWrap: null,
      throttleTimer: null,
      selectedIdx: -1,
      lastSuggestFetch: 0,
      suggestSeq: 0,
      suggestAbortController: null,
      ctrl: {
        getBoundingClientRect: () => ({ left: 0, bottom: 50, width: 100 }),
      },
      inp: { value: "abc" },
      marker: null,
      searchHistory: [],
    };
    fetchSuggestions(ctrl, "abc");
    await new Promise(r => setTimeout(r, 0));
    const item = ctrl.panelWrap.querySelector("[data-index='0']");
    expect(item).not.toBeNull();
    const evt = { stopPropagation: vi.fn(), preventDefault: vi.fn() };
    (item as HTMLElement).onmousedown!(evt as unknown as MouseEvent);
    expect(evt.stopPropagation).toHaveBeenCalled();
    expect(evt.preventDefault).toHaveBeenCalled();
    expect(ctrl.marker).not.toBeNull();
    expect(ctrl.searchHistory).toHaveLength(1);
    expect(ctrl.searchHistory[0].query).toBe("abc");
    expect(ctrl.searchHistory[0].type).toBe("addr");
    vi.restoreAllMocks();
  });

  it("catches non-abort fetch errors and clears suggestions", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.reject(new TypeError("Network error")),
    ) as unknown as typeof fetch;
    const el = attachedPanel();
    const ctrl = makeFixture({ panelWrap: el, inp: { value: "abc" } });
    fetchSuggestions(ctrl, "abc");
    // Wait for the promise chain (fetch → then → catch) to settle so the
    // removePanel call in the non-abort catch handler actually executes.
    await new Promise(r => setTimeout(r, 50));
    expect(ctrl.panelWrap).toBeNull();
  });

  it("silently ignores AbortError fetch errors without clearing the panel", async () => {
    const abortErr = new Error("Aborted");
    abortErr.name = "AbortError";
    globalThis.fetch = vi.fn(() => Promise.reject(abortErr)) as unknown as typeof fetch;
    const el = attachedPanel();
    const ctrl = makeFixture({ panelWrap: el, inp: { value: "abc" } });
    fetchSuggestions(ctrl, "abc");
    await new Promise(r => setTimeout(r, 50));
    // AbortError is expected (user typed faster) — do not remove the panel.
    expect(ctrl.panelWrap).toBe(el);
  });

  it("still clears the panel when the catch handler itself throws", async () => {
    // The chain is fire-and-forget, so a handler that threw instead of settling
    // escaped as an unhandled rejection. Assert on the observable side effect of
    // the finally, not on the log, and use a rejection that lands here
    // (malformed body) — the AbortError early return never reaches the handler.
    // buildSearchUrl reaches toWgs84 before the fetch, and ensureGcoord warns
    // on the gcoord fallback, so the warn mock must absorb that first call and
    // only throw on the handler's own — otherwise it trips on the URL build.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation((message: string) => {
      if (typeof message === "string" && message.includes("suggestion fetch")) {
        throw new Error("console failed");
      }
    });
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ json: () => Promise.reject(new SyntaxError("bad json")) }),
    ) as unknown as typeof fetch;
    const el = attachedPanel();
    const ctrl = makeFixture({ panelWrap: el, inp: { value: "abc" } });
    fetchSuggestions(ctrl, "abc");
    await new Promise(r => setTimeout(r, 50));
    // The panel still closed despite the log throwing, which proves the reject
    // settled through the finally rather than out the chain.
    expect(ctrl.panelWrap).toBeNull();
    expect(document.body.contains(el)).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("suggestion fetch failed"),
      expect.anything(),
    );
    warnSpy.mockRestore();
  });

  it("treats a non-list suggestion payload as no results, not as a failure", async () => {
    // Every provider's normalizeSuggest guards Array.isArray and returns [] for
    // anything else, so a valid-JSON-but-not-a-list body settles through the
    // success path with an empty list. No warn, no panel (the empty-results
    // branch already removed it) — and crucially no unhandled rejection.
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve({ features: [] }) }),
    ) as unknown as typeof fetch;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const el = attachedPanel();
    const ctrl = makeFixture({ panelWrap: el, inp: { value: "abc" } });
    fetchSuggestions(ctrl, "abc");
    await new Promise(r => setTimeout(r, 50));
    // Only the gcoord fallback warn fires (from toWgs84 in buildSearchUrl, before
    // the fetch); no suggestion-failure warn.
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("suggestion fetch failed"),
      expect.anything(),
    );
    expect(ctrl.panelWrap).toBeNull();
    warnSpy.mockRestore();
  });

  it("warns on a malformed suggestion payload instead of dropping it", async () => {
    // Malformed body: r.json() rejects. The panel must still close so the
    // search input is not left looking live on a dead request.
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ json: () => Promise.reject(new SyntaxError("bad json")) }),
    ) as unknown as typeof fetch;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const el = attachedPanel();
    const ctrl = makeFixture({ panelWrap: el, inp: { value: "abc" } });
    fetchSuggestions(ctrl, "abc");
    await new Promise(r => setTimeout(r, 50));
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("suggestion fetch failed"),
      expect.anything(),
    );
    expect(ctrl.panelWrap).toBeNull();
    warnSpy.mockRestore();
  });

  it("clears panelWrap when results are empty", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve([]) }),
    ) as unknown as typeof fetch;
    const el = document.createElement("div");
    document.body.appendChild(el);
    const ctrl: any = {
      mode: "addr",
      cachedSuggestions: new Cache<string, object>(50),
      panelWrap: el,
      throttleTimer: null,
      selectedIdx: -1,
      lastSuggestFetch: 0,
      suggestSeq: 0,
      suggestAbortController: null,
      ctrl: {
        getBoundingClientRect: () => ({ left: 0, bottom: 50, width: 100 }),
      },
      inp: { value: "abc" },
    };
    fetchSuggestions(ctrl, "abc");
    await new Promise(r => setTimeout(r, 0));
    expect(ctrl.panelWrap).toBeNull();
  });

  it("stops click events on suggestions wrap from bubbling", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        json: () =>
          Promise.resolve([
            {
              lat: "30.0",
              lon: "120.0",
              display_name: "A, Place",
            },
          ]),
      }),
    ) as unknown as typeof fetch;
    const ctrl: any = {
      mode: "addr",
      cachedSuggestions: new Cache<string, object>(50),
      panelWrap: null,
      throttleTimer: null,
      selectedIdx: -1,
      lastSuggestFetch: 0,
      suggestSeq: 0,
      suggestAbortController: null,
      ctrl: {
        getBoundingClientRect: () => ({ left: 0, bottom: 50, width: 100 }),
      },
      inp: { value: "abc" },
    };
    fetchSuggestions(ctrl, "abc");
    await new Promise(r => setTimeout(r, 0));
    expect(ctrl.panelWrap).not.toBeNull();
    const evt = new MouseEvent("click", { bubbles: true });
    const stopSpy = vi.spyOn(evt, "stopPropagation");
    ctrl.panelWrap.dispatchEvent(evt);
    expect(stopSpy).toHaveBeenCalled();
  });
});

describe("mode-lock guard: suggestion click when a mode is held", () => {
  it("suggestion click is blocked and panel stays open when a mode is held", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        json: () =>
          Promise.resolve([
            {
              lat: "30.0",
              lon: "120.0",
              display_name: "Blocked Place",
            },
          ]),
      }),
    ) as unknown as typeof fetch;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctrl: any = {
      mode: "addr",
      cachedSuggestions: new Cache<string, object>(50),
      panelWrap: null,
      throttleTimer: null,
      selectedIdx: -1,
      lastSuggestFetch: 0,
      suggestSeq: 0,
      suggestAbortController: null,
      ctrl: {
        getBoundingClientRect: () => ({ left: 0, bottom: 50, width: 100 }),
      },
      inp: { value: "abc" },
      marker: null,
      searchHistory: [],
    };
    // Render the panel first without a held mode.
    fetchSuggestions(ctrl, "abc");
    await new Promise(r => setTimeout(r, 0));
    const item = ctrl.panelWrap.querySelector("[data-index='0']");
    expect(item).not.toBeNull();

    // Now hold a mode and click — the click should be blocked.
    ensureModes(window.map).setMode("MeasureControl", "distance");
    const evt = { stopPropagation: vi.fn(), preventDefault: vi.fn() };
    (item as HTMLElement).onmousedown!(evt as unknown as MouseEvent);
    // Panel stays open — blocked click must not remove it.
    expect(ctrl.panelWrap).not.toBeNull();
    // No marker placed, no history recorded.
    expect(ctrl.marker).toBeNull();
    expect(ctrl.searchHistory).toHaveLength(0);
    expect(window.map.foliplus.showHint).toHaveBeenCalledWith(
      "SearchControl",
      "SearchControl.blocked",
      expect.any(Number),
    );
    ensureModes(window.map).setMode("MeasureControl", null);
    vi.restoreAllMocks();
  });
});

describe("fetchSuggestions — empty input renders history", () => {
  it("renders search history when input is empty and history exists", () => {
    const ctrl: any = {
      mode: "addr",
      panelWrap: null,
      throttleTimer: null,
      selectedIdx: -1,
      ctrl: {
        getBoundingClientRect: () => ({ left: 0, bottom: 50, width: 100 }),
      },
      inp: { value: "" },
      searchHistory: [
        {
          query: "Paris",
          type: "addr",
          coordDisplay: "2.3, 48.8",
          addrDisplay: "Paris, France",
          lat: 48.8,
          lng: 2.3,
          ts: 1000,
        },
      ],
    };
    fetchSuggestions(ctrl, "");
    expect(ctrl.panelWrap).not.toBeNull();
    expect(ctrl.panelWrap.innerHTML).toContain("Paris, France");
    expect(
      ctrl.panelWrap.querySelector(".foliplus-search-result-content"),
    ).not.toBeNull();
  });

  it("removes suggestions when input is empty and history is empty", () => {
    const ctrl: any = {
      mode: "addr",
      panelWrap: null,
      throttleTimer: null,
      selectedIdx: -1,
      searchHistory: [],
    };
    fetchSuggestions(ctrl, "");
    expect(ctrl.panelWrap).toBeNull();
  });

  it("removes history panel when switching to coord mode", () => {
    const ctrl: any = {
      mode: "addr",
      panelWrap: null,
      throttleTimer: null,
      selectedIdx: -1,
      ctrl: {
        getBoundingClientRect: () => ({ left: 0, bottom: 50, width: 100 }),
      },
      inp: { value: "" },
      searchHistory: [
        {
          query: "A",
          type: "addr",
          coordDisplay: "",
          addrDisplay: "A",
          lat: 0,
          lng: 0,
          ts: 1,
          count: 1,
        },
      ],
    };
    fetchSuggestions(ctrl, "");
    expect(ctrl.panelWrap).not.toBeNull();
    ctrl.mode = "coord";
    fetchSuggestions(ctrl, "");
    expect(ctrl.panelWrap).toBeNull();
  });
});

describe("fetchSuggestions — history does not interfere with suggestions", () => {
  it("shows suggestions instead of history when input has text", () => {
    const cache = new Cache<string, object>(50);
    cache.set("abc", [{ display_name: "Result" }]);
    const ctrl: any = {
      mode: "addr",
      cachedSuggestions: cache,
      panelWrap: null,
      throttleTimer: null,
      selectedIdx: -1,
      ctrl: {
        getBoundingClientRect: () => ({ left: 0, bottom: 50, width: 100 }),
      },
      inp: { value: "abc" },
      searchHistory: [
        {
          query: "Old",
          type: "addr",
          coordDisplay: "",
          addrDisplay: "Old",
          lat: 0,
          lng: 0,
          ts: 1,
          count: 1,
        },
      ],
    };
    fetchSuggestions(ctrl, "abc");
    expect(ctrl.panelWrap.innerHTML).toContain("Result");
    expect(
      ctrl.panelWrap.querySelector(".foliplus-search-history-group-header"),
    ).toBeNull();
  });
});
