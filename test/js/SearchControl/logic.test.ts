import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachSearchDelIcon,
  buildSearchUrl,
  fetchSuggestions,
  initDebouncedFetch,
  positionSuggestions,
  removeSuggestions,
  searchAddress,
  searchCoord,
} from "#foliplus/SearchControl/logic.js";
import { Cache } from "#foliplus/common/cache.js";
import { ensureModes } from "#foliplus/core/mode.js";

// Module-level code captured window.foliplus and window.map from setup.js.
// Use vi.spyOn to track calls on those already-setup mocks.
beforeEach(() => {
  vi.clearAllMocks();
});

describe("removeSuggestions", () => {
  it("removes suggestionsWrap and resets state", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const ctrl: any = {
      suggestionsWrap: el,
      suggestionsThrottleTimer: setTimeout(() => {}, 1000),
      selectedSuggestionIdx: 2,
    };

    removeSuggestions(ctrl);

    expect(document.body.contains(el)).toBe(false);
    expect(ctrl.suggestionsWrap).toBeNull();
    expect(ctrl.suggestionsThrottleTimer).toBeNull();
    expect(ctrl.selectedSuggestionIdx).toBe(-1);
  });

  it("handles null suggestionsWrap without error", () => {
    const ctrl: any = {
      suggestionsWrap: null,
      suggestionsThrottleTimer: null,
      selectedSuggestionIdx: -1,
    };
    expect(() => removeSuggestions(ctrl)).not.toThrow();
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows hint and clears input for invalid coordinates", () => {
    const ctrl: any = { inp: { value: "" }, marker: null };
    searchCoord(ctrl, "abc");
    expect(window.map.foliplus.showHint).toHaveBeenCalledWith(
      "SearchControl",
      "SearchControl.coord_error",
      4000,
    );
    expect(ctrl.inp.value).toBe("");
  });

  it("shows hint for out-of-range values", () => {
    const ctrl: any = { inp: { value: "" }, marker: null };
    searchCoord(ctrl, "200,100");
    expect(window.map.foliplus.showHint).toHaveBeenCalled();
    expect(ctrl.inp.value).toBe("");
  });

  it("flies to valid coordinates", () => {
    const ctrl: any = {
      inp: { value: "121.47,31.23" },
      marker: null,
    };
    searchCoord(ctrl, "121.47,31.23");
    expect(map.flyTo).toHaveBeenCalledWith([31.23, 121.47], 16);
  });
});

describe("searchAddress", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete globalThis.fetch;
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
    expect(window.foliplus.geocode).toHaveBeenCalledWith(map, "X", "en");
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
    };
    searchAddress(ctrl, "X");
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    expect(window.map.foliplus.hideHint).toHaveBeenCalledWith("SearchControl");
    expect(map.flyTo).toHaveBeenCalledWith([30.2, 120.5], expect.any(Number));
    expect(ctrl.marker).not.toBeNull();
  });
});

describe("positionSuggestions", () => {
  it("places wrap below the control", () => {
    const ctrl: any = {
      suggestionsWrap: { style: {} },
      ctrl: {
        getBoundingClientRect: () => ({
          left: 10,
          top: 20,
          bottom: 100,
          width: 200,
        }),
      },
    };
    positionSuggestions(ctrl);
    expect(ctrl.suggestionsWrap.style.left).toBe("10px");
    expect(ctrl.suggestionsWrap.style.top).toBe("100px");
  });
});

describe("fetchSuggestions", () => {
  it("removes suggestions when not in ADDR mode", () => {
    const ctrl: any = {
      mode: "coord",
      suggestionsWrap: null,
      suggestionsThrottleTimer: null,
      selectedSuggestionIdx: -1,
    };
    fetchSuggestions(ctrl, "abc");
    expect(ctrl.suggestionsWrap).toBeNull();
  });

  it("ignores queries below min chars", () => {
    const ctrl: any = {
      mode: "addr",
      suggestionsWrap: null,
      suggestionsThrottleTimer: null,
      selectedSuggestionIdx: -1,
    };
    fetchSuggestions(ctrl, "ab");
    expect(ctrl.suggestionsWrap).toBeNull();
  });

  it("renders cached suggestions without fetching", () => {
    globalThis.fetch = vi.fn();
    const cache = new Cache<string, object>(50);
    cache.set("abc", [{ display_name: "Cached" }]);
    const ctrl: any = {
      mode: "addr",
      cachedSuggestions: cache,
      suggestionsWrap: null,
      suggestionsThrottleTimer: null,
      selectedSuggestionIdx: -1,
      ctrl: {
        getBoundingClientRect: () => ({ left: 0, bottom: 50, width: 100 }),
      },
      inp: { value: "abc" },
    };
    fetchSuggestions(ctrl, "abc");
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(ctrl.suggestionsWrap).not.toBeNull();
  });

  it("is blocked by MeasureControl active mode", () => {
    globalThis.fetch = vi.fn();
    // Simulate MeasureControl being in active mode
    ensureModes(window.map).setMode("MeasureControl", "distance");
    const ctrl: any = {
      mode: "addr",
      cachedSuggestions: new Cache<string, object>(50),
      suggestionsWrap: null,
      suggestionsThrottleTimer: null,
      selectedSuggestionIdx: -1,
      ctrl: {
        getBoundingClientRect: () => ({ left: 0, bottom: 50, width: 100 }),
      },
      inp: { value: "Paris" },
    };
    fetchSuggestions(ctrl, "Paris");
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(ctrl.suggestionsWrap).toBeNull();
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
        suggestionsWrap: null,
        suggestionsThrottleTimer: null,
        selectedSuggestionIdx: -1,
        ctrl: {
          getBoundingClientRect: () => ({ left: 0, bottom: 50, width: 100 }),
        },
        inp: { value: "abc" },
      };
      fetchSuggestions(ctrl, "abc");
      // zh: reverse order (large → small), postal code filtered
      expect(ctrl.suggestionsWrap.textContent).toContain("France,Paris,Rue de Rivoli");
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
      suggestionsWrap: null,
      suggestionsThrottleTimer: null,
      selectedSuggestionIdx: -1,
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
    expect(ctrl.suggestionsWrap).not.toBeNull();
    // First suggestion is written into global geocode cache
    expect(window.foliplus.cacheSuggestion).toHaveBeenCalledWith(
      map,
      "abc",
      30.0,
      120.0,
      expect.any(String),
    );
  });
});

describe("attachSearchDelIcon", () => {
  // A real DOM wrap so toggleDelIcon can flip the inner ✕'s visible class.
  // makeMarkerWithEl: each L.marker() call returns a fresh marker sharing the
  // same wrap element, so ctrl.marker and the del icon are distinct objects.
  function makeMarkerWithEl() {
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
  }

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

    const delClick = delIcon.on.mock.calls.find(c => c[0] === "click")?.[1];
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
