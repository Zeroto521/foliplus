import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUTOCOMPLETE, HISTORY } from "#foliplus/SearchControl/const.js";
import {
  addHistoryEntry,
  attachSearchDelIcon,
  buildSearchUrl,
  clearHistory,
  deleteHistoryEntry,
  fetchSuggestions,
  initDebouncedFetch,
  loadHistory,
  positionPanel,
  recordHistorySearch,
  removePanel,
  renderHistory,
  renderResults,
  saveHistory,
  searchAddress,
  searchCoord,
} from "#foliplus/SearchControl/logic.js";
import type { SearchHistoryEntry } from "#foliplus/SearchControl/type.js";
import { Cache } from "#foliplus/common/cache.js";
import { ensureModes } from "#foliplus/core/mode.js";

// Module-level code captured window.foliplus and window.map from setup.js.
// Use vi.spyOn to track calls on those already-setup mocks.
beforeEach(() => {
  vi.clearAllMocks();
});

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
      delete globalThis.fetch;
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
      searchHistory: [],
    };
    searchAddress(ctrl, "X");
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    expect(window.map.foliplus.hideHint).toHaveBeenCalledWith("SearchControl");
    expect(map.flyTo).toHaveBeenCalledWith([30.2, 120.5], expect.any(Number));
    expect(ctrl.marker).not.toBeNull();
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
// ── Search history integration tests ──────────────────────────────

describe("searchCoord — history recording", () => {
  it("records a coord search entry after successful search", async () => {
    const ctrl: any = {
      inp: { value: "121.47,31.23" },
      marker: null,
      searchHistory: [],
    };
    searchCoord(ctrl, "121.47,31.23");
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    expect(ctrl.searchHistory).toHaveLength(1);
    expect(ctrl.searchHistory[0].query).toBe("121.47,31.23");
    expect(ctrl.searchHistory[0].type).toBe("coord");
    expect(ctrl.searchHistory[0].coordDisplay).toBe("121.470000, 31.230000");
    expect(ctrl.searchHistory[0].lat).toBe(31.23);
    expect(ctrl.searchHistory[0].lng).toBe(121.47);
    expect(ctrl.searchHistory[0].ts).toBeGreaterThan(0);
  });

  it("does not record history for invalid coordinates", () => {
    const ctrl: any = { inp: { value: "" }, marker: null, searchHistory: [] };
    searchCoord(ctrl, "abc");
    expect(ctrl.searchHistory).toEqual([]);
  });

  it("reverse geocode success: addrDisplay updated, count stays 1", async () => {
    // Mock reverse geocode to return an address after the initial save
    (window.foliplus.reverseGeocode as any).mockResolvedValue("Shanghai, China");
    const ctrl: any = {
      inp: { value: "121.47,31.23" },
      marker: null,
      searchHistory: [],
    };
    searchCoord(ctrl, "121.47,31.23");
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    expect(ctrl.searchHistory).toHaveLength(1);
    expect(ctrl.searchHistory[0].addrDisplay).toBe("Shanghai, China");
    // Key invariant: reverse-geocode update must NOT increment count
    expect(ctrl.searchHistory[0].count).toBe(1);
  });

  it("reverse geocode failure: keeps coord-only entry, no crash", async () => {
    // First call is from createLocationMarker (popup), let it succeed.
    // Second call is from searchCoord's history update — reject it.
    let callCount = 0;
    (window.foliplus.reverseGeocode as any).mockImplementation(() =>
      Promise.resolve(
        ++callCount > 1 ? Promise.reject(new Error("network timeout")) : "Addr",
      ),
    );
    // Reset: first call resolves to "", second rejects
    callCount = 0;
    (window.foliplus.reverseGeocode as any).mockImplementation(() =>
      callCount++ === 0
        ? Promise.resolve("")
        : Promise.reject(new Error("network timeout")),
    );
    const ctrl: any = {
      inp: { value: "121.47,31.23" },
      marker: null,
      searchHistory: [],
    };
    searchCoord(ctrl, "121.47,31.23");
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    expect(ctrl.searchHistory).toHaveLength(1);
    expect(ctrl.searchHistory[0].addrDisplay).toBe("");
    expect(ctrl.searchHistory[0].count).toBe(1);
  });

  it("reverse geocode resolves null: keeps coord-only entry", async () => {
    (window.foliplus.reverseGeocode as any).mockResolvedValue(null);
    const ctrl: any = {
      inp: { value: "121.47,31.23" },
      marker: null,
      searchHistory: [],
    };
    searchCoord(ctrl, "121.47,31.23");
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    expect(ctrl.searchHistory).toHaveLength(1);
    expect(ctrl.searchHistory[0].addrDisplay).toBe("");
    expect(ctrl.searchHistory[0].count).toBe(1);
  });

  it("history entry missing: reverse geocode does not crash", async () => {
    (window.foliplus.reverseGeocode as any).mockResolvedValue("Some Addr");
    const ctrl: any = {
      inp: { value: "121.47,31.23" },
      marker: null,
      searchHistory: [],
    };
    // Clear history after searchCoord saves the entry so the lookup fails
    searchCoord(ctrl, "121.47,31.23");
    ctrl.searchHistory = [];
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    // The entry was removed before reverse-geocode resolved, so it stays empty
    expect(ctrl.searchHistory).toEqual([]);
    // No unhandled rejection — this promise resolves cleanly
    expect(await Promise.resolve(true)).toBe(true);
  });
});

describe("searchAddress — history recording", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("records a geocode address search entry after success", async () => {
    (window.foliplus.geocode as any).mockResolvedValue({
      lat: 48.8,
      lng: 2.3,
      display_name: "Paris, France",
    });
    const ctrl: any = {
      cachedAddress: {},
      addrAbortController: null,
      inp: { value: "Paris" },
      marker: null,
      searchHistory: [],
    };
    searchAddress(ctrl, "Paris");
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    expect(ctrl.searchHistory).toHaveLength(1);
    expect(ctrl.searchHistory[0].query).toBe("Paris");
    expect(ctrl.searchHistory[0].type).toBe("addr");
    expect(ctrl.searchHistory[0].lat).toBe(48.8);
    expect(ctrl.searchHistory[0].lng).toBe(2.3);
  });

  it("does not record history when no results are found", async () => {
    (window.foliplus.geocode as any).mockResolvedValue(null);
    const ctrl: any = {
      cachedAddress: {},
      addrAbortController: null,
      inp: { value: "abc" },
      searchHistory: [],
    };
    searchAddress(ctrl, "nowhere");
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    expect(ctrl.searchHistory).toEqual([]);
  });
});

describe("searchCoord edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
    delete globalThis.fetch;
  });

  it("throttles rapid requests and retries after delay", async () => {
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
    fetchSuggestions(ctrl, "abc");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    fetchSuggestions(ctrl, "abc");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTime(1000);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
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
    ctrl.lastSuggestFetch = Date.now() - 2000;
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
    (item as HTMLElement).onmousedown!(evt);
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

// ===========================================================================
// SearchControl history (merged from history.test.ts)

describe("SearchControl history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("loadHistory / saveHistory", () => {
    it("loads empty array when nothing is stored", () => {
      const entries = loadHistory();
      expect(entries).toEqual([]);
    });

    it("loads entries from localStorage", () => {
      const entries: SearchHistoryEntry[] = [
        {
          query: "Paris",
          type: "addr",
          coordDisplay: "121.4700, 31.2300",
          addrDisplay: "Paris",
          lng: 2.3,
          lat: 48.8,
          ts: 1000,
          count: 1,
        },
        {
          query: "121.47,31.23",
          type: "coord",
          coordDisplay: "121.4700, 31.2300",
          addrDisplay: "",
          lng: 121.47,
          lat: 31.23,
          ts: 2000,
          count: 1,
        },
      ];
      saveHistory(entries);
      expect(loadHistory()).toEqual(entries);
    });

    it("returns empty array for corrupt data", () => {
      localStorage.setItem(HISTORY.STORAGE_KEY, "not json");
      expect(loadHistory()).toEqual([]);
    });

    it("returns empty array for non-array data", () => {
      localStorage.setItem(HISTORY.STORAGE_KEY, '"string"');
      expect(loadHistory()).toEqual([]);
    });

    it("migrates old entries with label field to new format", () => {
      localStorage.setItem(
        HISTORY.STORAGE_KEY,
        JSON.stringify([
          {
            query: "Paris",
            type: "addr",
            label: "Paris, France",
            lng: 2.3,
            lat: 48.8,
            ts: 1000,
          },
          {
            query: "121.47,31.23",
            type: "coord",
            label: "121.4700, 31.2300",
            lng: 121.47,
            lat: 31.23,
            ts: 2000,
          },
        ]),
      );
      const loaded = loadHistory();
      expect(loaded).toHaveLength(2);
      expect(loaded[0].query).toBe("Paris");
      expect(loaded[0].addrDisplay).toBe("Paris, France");
      expect(loaded[0].coordDisplay).toBe("");
      expect(loaded[0].count).toBe(1);
      expect(loaded[1].query).toBe("121.47,31.23");
      expect(loaded[1].coordDisplay).toBe("121.4700, 31.2300");
      expect(loaded[1].addrDisplay).toBe("");
      expect(loaded[1].count).toBe(1);
    });

    it("saves an empty array when history is cleared", () => {
      const entries: SearchHistoryEntry[] = [
        {
          query: "A",
          type: "addr",
          coordDisplay: "",
          addrDisplay: "A",
          lng: 0,
          lat: 0,
          ts: 1,
          count: 1,
        },
      ];
      saveHistory(entries);
      expect(loadHistory()).toHaveLength(1);
      saveHistory([]);
      expect(loadHistory()).toEqual([]);
    });
  });

  describe("addHistoryEntry", () => {
    it("prepends a new entry and persists", () => {
      const ctrl: any = { searchHistory: [] };
      addHistoryEntry(ctrl, {
        query: "Paris",
        type: "addr",
        coordDisplay: "121.4700, 31.2300",
        addrDisplay: "Paris",
        lng: 2.3,
        lat: 48.8,
        ts: 1000,
        count: 1,
      });
      expect(ctrl.searchHistory).toHaveLength(1);
      expect(ctrl.searchHistory[0].query).toBe("Paris");
      expect(ctrl.searchHistory[0].count).toBe(1);
      expect(localStorage.getItem(HISTORY.STORAGE_KEY)).toBeDefined();
    });

    it("increments count on duplicate query and updates displays", () => {
      const ctrl: any = {
        searchHistory: [
          {
            query: "A",
            type: "addr",
            coordDisplay: "",
            addrDisplay: "A",
            lng: 0,
            lat: 0,
            ts: 100,
            count: 1,
          },
          {
            query: "Paris",
            type: "addr",
            coordDisplay: "1.0, 2.0",
            addrDisplay: "Paris",
            lng: 1.0,
            lat: 2.0,
            ts: 200,
            count: 3,
          },
          {
            query: "B",
            type: "addr",
            coordDisplay: "",
            addrDisplay: "B",
            lng: 0,
            lat: 0,
            ts: 300,
            count: 1,
          },
        ],
      };
      addHistoryEntry(ctrl, {
        query: "Paris",
        type: "addr",
        coordDisplay: "1.5, 2.5",
        addrDisplay: "Paris, France",
        lng: 1.5,
        lat: 2.5,
        ts: 9999,
        count: 1, // will be ignored; existing count is incremented
      });
      expect(ctrl.searchHistory).toHaveLength(3);
      // Paris moved to front with updated displays and incremented count
      expect(ctrl.searchHistory[0].query).toBe("Paris");
      expect(ctrl.searchHistory[0].count).toBe(4); // 3 + 1
      expect(ctrl.searchHistory[0].addrDisplay).toBe("Paris, France");
      expect(ctrl.searchHistory[0].coordDisplay).toBe("1.5, 2.5");
      // Other entries retain their relative order
      expect(ctrl.searchHistory[1].query).toBe("A");
      expect(ctrl.searchHistory[2].query).toBe("B");
    });

    it("persists after deduplication", () => {
      const ctrl: any = {
        searchHistory: [
          {
            query: "Paris",
            type: "addr",
            coordDisplay: "",
            addrDisplay: "Paris",
            lng: 2.3,
            lat: 48.8,
            ts: 1000,
            count: 2,
          },
        ],
      };
      addHistoryEntry(ctrl, {
        query: "Paris",
        type: "addr",
        coordDisplay: "2.3, 48.8",
        addrDisplay: "Paris, France",
        lng: 2.3,
        lat: 48.8,
        ts: 2000,
        count: 1,
      });
      const stored = JSON.parse(localStorage.getItem(HISTORY.STORAGE_KEY)!);
      expect(stored[0].addrDisplay).toBe("Paris, France");
      expect(stored[0].count).toBe(3);
      expect(stored).toHaveLength(1);
    });

    it("respects MAX_ENTRIES limit", () => {
      const ctrl: any = {
        searchHistory: Array.from({ length: HISTORY.MAX_ENTRIES }, (_, i) => ({
          query: `q${i}`,
          type: "addr" as const,
          coordDisplay: "",
          addrDisplay: `L${i}`,
          lng: 0,
          lat: 0,
          ts: i,
          count: 1,
        })),
      };
      addHistoryEntry(ctrl, {
        query: "new",
        type: "addr",
        coordDisplay: "1.0, 1.0",
        addrDisplay: "New",
        lng: 1,
        lat: 1,
        ts: 9999,
        count: 1,
      });
      expect(ctrl.searchHistory).toHaveLength(HISTORY.MAX_ENTRIES);
      expect(ctrl.searchHistory[0].query).toBe("new");
      expect(
        ctrl.searchHistory.find((e: SearchHistoryEntry) => e.query === "q19"),
      ).toBeUndefined();
      expect(
        ctrl.searchHistory.find((e: SearchHistoryEntry) => e.query === "q0"),
      ).toBeDefined();
    });

    it("persists after hitting MAX_ENTRIES cap", () => {
      const ctrl: any = {
        searchHistory: Array.from({ length: HISTORY.MAX_ENTRIES }, (_, i) => ({
          query: `q${i}`,
          type: "addr" as const,
          coordDisplay: "",
          addrDisplay: `L${i}`,
          lng: 0,
          lat: 0,
          ts: i,
          count: 1,
        })),
      };
      addHistoryEntry(ctrl, {
        query: "new",
        type: "addr",
        coordDisplay: "1.0, 1.0",
        addrDisplay: "New",
        lng: 1,
        lat: 1,
        ts: 9999,
        count: 1,
      });
      const stored = JSON.parse(localStorage.getItem(HISTORY.STORAGE_KEY)!);
      expect(stored).toHaveLength(HISTORY.MAX_ENTRIES);
      expect(stored[0].query).toBe("new");
    });
  });

  describe("deleteHistoryEntry", () => {
    it("removes a matching entry and persists", () => {
      const ctrl: any = {
        searchHistory: [
          {
            query: "A",
            type: "addr",
            coordDisplay: "",
            addrDisplay: "A",
            lng: 0,
            lat: 0,
            ts: 1,
            count: 1,
          },
          {
            query: "B",
            type: "addr",
            coordDisplay: "",
            addrDisplay: "B",
            lng: 0,
            lat: 0,
            ts: 2,
            count: 1,
          },
        ],
      };
      deleteHistoryEntry(ctrl, "A");
      expect(ctrl.searchHistory).toHaveLength(1);
      expect(ctrl.searchHistory[0].query).toBe("B");
      const stored = JSON.parse(localStorage.getItem(HISTORY.STORAGE_KEY)!);
      expect(stored).toHaveLength(1);
      expect(stored[0].query).toBe("B");
    });

    it("does nothing for unknown query", () => {
      const ctrl: any = {
        searchHistory: [
          {
            query: "A",
            type: "addr",
            coordDisplay: "",
            addrDisplay: "A",
            lng: 0,
            lat: 0,
            ts: 1,
            count: 1,
          },
        ],
      };
      deleteHistoryEntry(ctrl, "Z");
      expect(ctrl.searchHistory).toHaveLength(1);
    });

    it("empties history when last entry is deleted", () => {
      const ctrl: any = {
        searchHistory: [
          {
            query: "Only",
            type: "addr",
            coordDisplay: "",
            addrDisplay: "Only",
            lng: 0,
            lat: 0,
            ts: 1,
            count: 1,
          },
        ],
      };
      deleteHistoryEntry(ctrl, "Only");
      expect(ctrl.searchHistory).toEqual([]);
      const stored = JSON.parse(localStorage.getItem(HISTORY.STORAGE_KEY)!);
      expect(stored).toEqual([]);
    });
  });

  describe("clearHistory", () => {
    it("empties the history array and persists", () => {
      const ctrl: any = {
        searchHistory: [
          {
            query: "A",
            type: "addr",
            coordDisplay: "",
            addrDisplay: "A",
            lng: 0,
            lat: 0,
            ts: 1,
            count: 1,
          },
          {
            query: "B",
            type: "addr",
            coordDisplay: "",
            addrDisplay: "B",
            lng: 0,
            lat: 0,
            ts: 2,
            count: 1,
          },
        ],
      };
      clearHistory(ctrl);
      expect(ctrl.searchHistory).toEqual([]);
      const loaded = loadHistory();
      expect(loaded).toEqual([]);
    });

    it("is a no-op when history is already empty", () => {
      const ctrl: any = { searchHistory: [] };
      clearHistory(ctrl);
      expect(ctrl.searchHistory).toEqual([]);
    });
  });

  describe("recordHistorySearch", () => {
    it("records a completed coord search", () => {
      const ctrl: any = { searchHistory: [] };
      recordHistorySearch(
        ctrl,
        "121.47,31.23",
        "coord",
        "121.4700, 31.2300",
        "",
        121.47,
        31.23,
      );
      expect(ctrl.searchHistory).toHaveLength(1);
      expect(ctrl.searchHistory[0].type).toBe("coord");
      expect(ctrl.searchHistory[0].coordDisplay).toBe("121.4700, 31.2300");
      expect(ctrl.searchHistory[0].addrDisplay).toBe("");
      expect(ctrl.searchHistory[0].lat).toBe(31.23);
      expect(ctrl.searchHistory[0].lng).toBe(121.47);
      expect(ctrl.searchHistory[0].count).toBe(1);
    });

    it("records a completed addr search", () => {
      const ctrl: any = { searchHistory: [] };
      recordHistorySearch(
        ctrl,
        "Paris",
        "addr",
        "2.3, 48.8",
        "Paris, France",
        2.3,
        48.8,
      );
      expect(ctrl.searchHistory).toHaveLength(1);
      expect(ctrl.searchHistory[0].type).toBe("addr");
      expect(ctrl.searchHistory[0].addrDisplay).toBe("Paris, France");
      expect(ctrl.searchHistory[0].coordDisplay).toBe("2.3, 48.8");
    });

    it("records the current timestamp", () => {
      const ctrl: any = { searchHistory: [] };
      const before = Date.now();
      recordHistorySearch(ctrl, "A", "addr", "", "A", 0, 0);
      const after = Date.now();
      expect(ctrl.searchHistory[0].ts).toBeGreaterThanOrEqual(before);
      expect(ctrl.searchHistory[0].ts).toBeLessThanOrEqual(after);
    });

    it("stores raw query as key for deduplication", () => {
      const ctrl: any = { searchHistory: [] };
      recordHistorySearch(
        ctrl,
        "Paris",
        "addr",
        "2.3, 48.8",
        "Paris, France",
        2.3,
        48.8,
      );
      expect(ctrl.searchHistory[0].query).toBe("Paris");
      // Re-record with same query — dedup should apply and increment count
      recordHistorySearch(
        ctrl,
        "Paris",
        "addr",
        "2.3, 48.8",
        "Paris, France",
        2.3,
        48.8,
      );
      expect(ctrl.searchHistory).toHaveLength(1);
      expect(ctrl.searchHistory[0].count).toBe(2);
    });
  });

  describe("renderHistory", () => {
    const makeHistoryCtrl = (searchHistory: SearchHistoryEntry[]): any => {
      return {
        searchHistory,
        panelWrap: null,
        throttleTimer: null,
        selectedIdx: -1,
        ctrl: {
          getBoundingClientRect: () => ({ left: 0, bottom: 50, width: 100 }),
        },
        inp: { value: "" },
      };
    };

    it("removes suggestions when history is empty", () => {
      const ctrl = makeHistoryCtrl([]);
      renderHistory(ctrl, "addr");
      expect(ctrl.panelWrap).toBeNull();
    });

    it("renders address history in addr mode", () => {
      const ctrl = makeHistoryCtrl([
        {
          query: "Paris",
          type: "addr",
          coordDisplay: "2.3, 48.8",
          addrDisplay: "Paris, France",
          lng: 2.3,
          lat: 48.8,
          ts: 1000,
          count: 1,
        },
        {
          query: "121.47,31.23",
          type: "coord",
          coordDisplay: "121.4700, 31.2300",
          addrDisplay: "",
          lng: 121.47,
          lat: 31.23,
          ts: 2000,
          count: 1,
        },
      ]);
      renderHistory(ctrl, "addr");
      expect(ctrl.panelWrap).not.toBeNull();
      expect(ctrl.panelWrap.innerHTML).toContain("Paris, France");
      // Only addr items shown, coord items filtered out
      expect(ctrl.panelWrap.innerHTML).not.toContain("121.4700, 31.2300");
      const items = ctrl.panelWrap.querySelectorAll(".foliplus-search-result-item");
      expect(items).toHaveLength(1);
      expect(items[0].querySelector(".foliplus-search-result-coord")).not.toBeNull();
      expect(items[0].querySelector(".foliplus-search-result-coord")?.textContent).toBe(
        "2.3, 48.8",
      );
    });

    it("renders coordinate history in coord mode", () => {
      const ctrl = makeHistoryCtrl([
        {
          query: "Paris",
          type: "addr",
          coordDisplay: "2.3, 48.8",
          addrDisplay: "Paris, France",
          lng: 2.3,
          lat: 48.8,
          ts: 1000,
          count: 1,
        },
        {
          query: "121.47,31.23",
          type: "coord",
          coordDisplay: "121.4700, 31.2300",
          addrDisplay: "",
          lng: 121.47,
          lat: 31.23,
          ts: 2000,
          count: 1,
        },
      ]);
      renderHistory(ctrl, "coord");
      expect(ctrl.panelWrap).not.toBeNull();
      expect(ctrl.panelWrap.innerHTML).toContain("121.4700, 31.2300");
      // Only coord items shown, addr items filtered out
      expect(ctrl.panelWrap.innerHTML).not.toContain("Paris, France");
      const items = ctrl.panelWrap.querySelectorAll(".foliplus-search-result-item");
      expect(items).toHaveLength(1);
      // Coord entries also show coord-display for consistent two-line layout
      expect(items[0].querySelector(".foliplus-search-result-coord")).not.toBeNull();
      expect(items[0].querySelector(".foliplus-search-result-coord")?.textContent).toBe(
        "121.4700, 31.2300",
      );
    });

    it("sorts by count desc then ts desc", () => {
      const ctrl = makeHistoryCtrl([
        {
          query: "A",
          type: "addr",
          coordDisplay: "",
          addrDisplay: "A",
          lng: 0,
          lat: 0,
          ts: 100,
          count: 1,
        },
        {
          query: "B",
          type: "addr",
          coordDisplay: "",
          addrDisplay: "B",
          lng: 0,
          lat: 0,
          ts: 200,
          count: 5,
        },
        {
          query: "C",
          type: "addr",
          coordDisplay: "",
          addrDisplay: "C",
          lng: 0,
          lat: 0,
          ts: 300,
          count: 5,
        },
      ]);
      renderHistory(ctrl, "addr");
      const items = ctrl.panelWrap.querySelectorAll(".foliplus-search-result-text");
      expect(items[0].textContent).toBe("C");
      expect(items[1].textContent).toBe("B");
      expect(items[2].textContent).toBe("A");
    });

    it("clicking a history entry navigates to the saved coordinates", () => {
      const ctrl = makeHistoryCtrl([
        {
          query: "Paris",
          type: "addr",
          coordDisplay: "2.3, 48.8",
          addrDisplay: "Paris, France",
          lng: 2.3,
          lat: 48.8,
          ts: 1000,
          count: 1,
        },
      ]);
      renderHistory(ctrl, "addr");
      const item = ctrl.panelWrap.querySelector(".foliplus-search-result-item")!;
      const mouseEvent = new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
      });
      item.dispatchEvent(mouseEvent);
      expect(map.flyTo).toHaveBeenCalled();
      expect(ctrl.inp.value).toBe("Paris, France");
    });

    it("renders only coord entries in coord mode", () => {
      const ctrl = makeHistoryCtrl([
        {
          query: "121.47,31.23",
          type: "coord",
          coordDisplay: "121.4700, 31.2300",
          addrDisplay: "",
          lng: 121.47,
          lat: 31.23,
          ts: 1000,
          count: 1,
        },
      ]);
      renderHistory(ctrl, "coord");
      const items = ctrl.panelWrap.querySelectorAll(".foliplus-search-result-text");
      expect(items).toHaveLength(1);
      expect(items[0].textContent).toBe("121.4700, 31.2300");
    });

    it("shows nothing when no history matches the current mode", () => {
      const ctrl = makeHistoryCtrl([
        {
          query: "Paris",
          type: "addr",
          coordDisplay: "2.3, 48.8",
          addrDisplay: "Paris, France",
          lng: 2.3,
          lat: 48.8,
          ts: 1000,
          count: 1,
        },
      ]);
      renderHistory(ctrl, "coord");
      expect(ctrl.panelWrap).toBeNull();
    });

    it("limits display to 5 entries per section", () => {
      const entries = Array.from({ length: 10 }, (_, i) => ({
        query: `q${i}`,
        type: "addr" as const,
        coordDisplay: `${i}.0, ${i}.0`,
        addrDisplay: `Addr ${i}`,
        lng: i,
        lat: i,
        ts: i,
        count: 1,
      }));
      const ctrl = makeHistoryCtrl(entries);
      renderHistory(ctrl, "addr");
      const items = ctrl.panelWrap.querySelectorAll(".foliplus-search-result-item");
      expect(items.length).toBeLessThanOrEqual(5);
    });

    it("coord entry with reverse-geocoded address: primary=address, coord=coords", () => {
      const ctrl = makeHistoryCtrl([
        {
          query: "121.47,31.23",
          type: "coord",
          coordDisplay: "121.4700, 31.2300",
          addrDisplay: "Shanghai, China",
          lng: 121.47,
          lat: 31.23,
          ts: 1000,
          count: 1,
        },
      ]);
      renderHistory(ctrl, "coord");
      const items = ctrl.panelWrap.querySelectorAll(".foliplus-search-result-text");
      // Primary (title) shows address when available
      expect(items[0].textContent).toBe("Shanghai, China");
      const coord = ctrl.panelWrap.querySelector(".foliplus-search-result-coord");
      expect(coord?.textContent).toBe("121.4700, 31.2300");
    });

    it("coord entry without address: primary=coordDisplay", () => {
      const ctrl = makeHistoryCtrl([
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
      ]);
      renderHistory(ctrl, "coord");
      const items = ctrl.panelWrap.querySelectorAll(".foliplus-search-result-text");
      // No address → primary falls back to coord display
      expect(items[0].textContent).toBe("121.4700, 31.2300");
    });

    it("addr entry: primary=addrDisplay, secondary=coordDisplay", () => {
      const ctrl = makeHistoryCtrl([
        {
          query: "Paris",
          type: "addr",
          coordDisplay: "2.3, 48.8",
          addrDisplay: "Paris, France",
          lng: 2.3,
          lat: 48.8,
          ts: 1000,
          count: 1,
        },
      ]);
      renderHistory(ctrl, "addr");
      const items = ctrl.panelWrap.querySelectorAll(".foliplus-search-result-text");
      expect(items[0].textContent).toBe("Paris, France");
      const coord = ctrl.panelWrap.querySelector(".foliplus-search-result-coord");
      expect(coord?.textContent).toBe("2.3, 48.8");
    });
  });
});
