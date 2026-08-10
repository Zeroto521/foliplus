import {
  buildSearchUrl,
  fetchSuggestions,
  initDebouncedFetch,
  positionSuggestions,
  removeSuggestions,
  searchAddress,
  searchCoord,
} from "#foliplus/SearchControl/SearchControl.logic.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Module-level code captured window.foliplus and window.map from setup.js.
// Use vi.spyOn to track calls on those already-setup mocks.
beforeEach(() => {
  vi.clearAllMocks();
});

describe("removeSuggestions", () => {
  it("removes suggestionsWrap and resets state", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const ctrl = {
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
    const ctrl = {
      suggestionsWrap: null,
      suggestionsThrottleTimer: null,
      selectedSuggestionIdx: -1,
    };
    expect(() => removeSuggestions(ctrl)).not.toThrow();
  });
});

describe("initDebouncedFetch", () => {
  it("creates a debounced function on ctrl.debouncedFetch", () => {
    const ctrl = { inp: { value: "test" }, debouncedFetch: null };
    initDebouncedFetch(ctrl);
    expect(ctrl.debouncedFetch).toBeDefined();
    expect(typeof ctrl.debouncedFetch).toBe("function");
    expect(ctrl.debouncedFetch.cancel).toBeDefined();
  });
});

describe("buildSearchUrl", () => {
  it("includes query, limit, and center coordinates", () => {
    const ctrl = {};
    const url = buildSearchUrl(ctrl, "test query", 5);
    expect(url).toContain("q=test+query");
    expect(url).toContain("limit=5");
    expect(url).toContain("lon=119.3");
    expect(url).toContain("lat=26.08");
    expect(url).toContain("nominatim.openstreetmap.org");
  });
});

describe("searchCoord", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows hint and clears input for invalid coordinates", () => {
    const ctrl = { inp: { value: "" }, marker: null };
    searchCoord(ctrl, "abc");
    expect(foliplus.showHint).toHaveBeenCalledWith(
      "SearchControl",
      "SearchControl.coord_error",
      4000,
    );
    expect(ctrl.inp.value).toBe("");
  });

  it("shows hint for out-of-range values", () => {
    const ctrl = { inp: { value: "" }, marker: null };
    searchCoord(ctrl, "200,100");
    expect(foliplus.showHint).toHaveBeenCalled();
    expect(ctrl.inp.value).toBe("");
  });

  it("flies to valid coordinates", () => {
    const ctrl = {
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

  it("shows hint and clears input when no results", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve([]) }),
    );
    const ctrl = {
      cachedAddress: {},
      addrAbortController: null,
      inp: { value: "abc" },
    };
    searchAddress(ctrl, "nowhere");
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    expect(foliplus.showHint).toHaveBeenLastCalledWith(
      "SearchControl",
      "SearchControl.addr_not_found",
      4000,
    );
    expect(ctrl.inp.value).toBe("");
  });

  it("flies to and marks the first result", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        json: () =>
          Promise.resolve([{ lat: "30.2", lon: "120.5", display_name: "X, Y" }]),
      }),
    );
    const ctrl = {
      cachedAddress: {},
      addrAbortController: null,
      inp: { value: "X" },
      marker: null,
    };
    searchAddress(ctrl, "X");
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    expect(foliplus.hideHint).toHaveBeenCalledWith("SearchControl");
    expect(map.flyTo).toHaveBeenCalled();
    expect(ctrl.cachedAddress["X"]).toBeDefined();
    expect(ctrl.marker).not.toBeNull();
  });

  it("serves cached results without fetching", () => {
    globalThis.fetch = vi.fn();
    const ctrl = {
      cachedAddress: {
        X: { item: { lat: "30", lon: "120" }, displayName: "X" },
      },
      addrAbortController: null,
      inp: { value: "X" },
      marker: null,
    };
    searchAddress(ctrl, "X");
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(map.flyTo).toHaveBeenCalled();
  });
});

describe("positionSuggestions", () => {
  it("places wrap below the control", () => {
    const ctrl = {
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
    const ctrl = {
      mode: "coord",
      suggestionsWrap: null,
      suggestionsThrottleTimer: null,
      selectedSuggestionIdx: -1,
    };
    fetchSuggestions(ctrl, "abc");
    expect(ctrl.suggestionsWrap).toBeNull();
  });

  it("ignores queries below min chars", () => {
    const ctrl = {
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
    const ctrl = {
      mode: "addr",
      cachedSuggestions: { abc: [{ display_name: "A" }] },
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

  it("fetches and renders results", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve([{ display_name: "A, Place" }]) }),
    );
    const ctrl = {
      mode: "addr",
      cachedSuggestions: {},
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
    expect(ctrl.cachedSuggestions["abc"]).toHaveLength(1);
    expect(ctrl.suggestionsWrap).not.toBeNull();
  });
});
