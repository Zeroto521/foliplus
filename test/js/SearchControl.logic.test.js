import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSearchUrl,
  initDebouncedFetch,
  removeSuggestions,
  searchCoord,
} from "../../foliplus/js/SearchControl/SearchControl.logic.js";

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
    const ctrl = { inp: { value: "" }, _: (s) => s, marker: null };
    searchCoord(ctrl, "abc");
    expect(foliplus.showHint).toHaveBeenCalledWith(
      "SearchControl",
      "SearchControl.coord_error",
      4000,
    );
    expect(ctrl.inp.value).toBe("");
  });

  it("shows hint for out-of-range values", () => {
    const ctrl = { inp: { value: "" }, _: (s) => s, marker: null };
    searchCoord(ctrl, "200,100");
    expect(foliplus.showHint).toHaveBeenCalled();
    expect(ctrl.inp.value).toBe("");
  });

  it("flies to valid coordinates", () => {
    const ctrl = {
      inp: { value: "121.47,31.23" },
      _: (s) => s,
      marker: null,
    };
    searchCoord(ctrl, "121.47,31.23");
    expect(map.flyTo).toHaveBeenCalledWith([31.23, 121.47], 16);
  });
});
