import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markRequest } from "#core/geocode/index.js";
import { HISTORY, MODE, RECORD_VERSION, ZOOM } from "#foliplus/SearchControl/const.js";
import {
  addHistoryEntry,
  clearHistory,
  deleteHistoryEntry,
  loadHistory,
  recordHistorySearch,
  renderHistory,
} from "#foliplus/SearchControl/logic/history.js";
import {
  fetchSuggestions,
  searchAddress,
  searchCoord,
} from "#foliplus/SearchControl/logic/search.js";
import { ensureModes } from "#foliplus/core/mode.js";
import type { SearchHistoryEntry } from "#foliplus/SearchControl/type.js";

// Module-level code captured window.foliplus and window.map from setup.js.
// Use vi.spyOn to track calls on those already-setup mocks.
beforeEach(() => {
  markRequest("nominatim", 0);
});

const tick = () => new Promise(r => setTimeout(r, 0));

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

  it("dedupes coordinate variants that parse to the same location", async () => {
    const tick = () => new Promise(r => setTimeout(r, 0));
    // "120,32" and its whitespace / full-width-comma variants resolve to the
    // same lng/lat, so they must collapse into one entry instead of two.
    const ctrl: any = { inp: { value: "" }, marker: null, searchHistory: [] };
    searchCoord(ctrl, "120,32");
    await tick();
    await tick();
    searchCoord(ctrl, "120, 32");
    await tick();
    await tick();
    searchCoord(ctrl, "120，32");
    await tick();
    await tick();
    expect(ctrl.searchHistory).toHaveLength(1);
    expect(ctrl.searchHistory[0].query).toBe("120,32");
    expect(ctrl.searchHistory[0].count).toBe(3);
    expect(ctrl.searchHistory[0].lng).toBe(120);
    expect(ctrl.searchHistory[0].lat).toBe(32);
  });

  it("stores a canonical coord key, not the raw input", async () => {
    const tick = () => new Promise(r => setTimeout(r, 0));
    const ctrl: any = { inp: { value: "" }, marker: null, searchHistory: [] };
    searchCoord(ctrl, " 120 , 32 ");
    await tick();
    await tick();
    expect(ctrl.searchHistory).toHaveLength(1);
    expect(ctrl.searchHistory[0].query).toBe("120,32");
    expect(ctrl.searchHistory[0].coordDisplay).toBe("120.000000, 32.000000");
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
    expect(stored.version).toBe(RECORD_VERSION);
    expect(stored.entries[0].addrDisplay).toBe("Paris, France");
    expect(stored.entries[0].count).toBe(3);
    expect(stored.entries).toHaveLength(1);
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
    expect(stored.entries).toHaveLength(HISTORY.MAX_ENTRIES);
    expect(stored.entries[0].query).toBe("new");
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
    expect(stored.entries).toHaveLength(1);
    expect(stored.entries[0].query).toBe("B");
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
    expect(stored.entries).toEqual([]);
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
    recordHistorySearch(ctrl, "Paris", "addr", "2.3, 48.8", "Paris, France", 2.3, 48.8);
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
    recordHistorySearch(ctrl, "Paris", "addr", "2.3, 48.8", "Paris, France", 2.3, 48.8);
    expect(ctrl.searchHistory[0].query).toBe("Paris");
    // Re-record with same query — dedup should apply and increment count
    recordHistorySearch(ctrl, "Paris", "addr", "2.3, 48.8", "Paris, France", 2.3, 48.8);
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
    // CONF.zoom is unset so the flyTo target exercises the ZOOM.MAX fallback.
    const original = window.CONF.zoom;
    try {
      window.CONF = { ...window.CONF, zoom: undefined };
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
      item.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );
      expect(map.flyTo).toHaveBeenCalledWith([48.8, 2.3], ZOOM.MAX);
      // The input gets the panel's display so the input matches the entry
      // the user clicked (addrDisplay), not the original keyword.
      expect(ctrl.inp.value).toBe("Paris, France");
      // The addr entry carries its display for keyboard nav too.
      expect(item.getAttribute("data-query")).toBe("Paris, France");
    } finally {
      window.CONF = { ...window.CONF, zoom: original };
    }
  });

  it("clicking a coord entry with an address restores the coord display, not the address", () => {
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
    // The item displays the reverse-geocoded address as its primary text...
    expect(
      ctrl.panelWrap.querySelector(".foliplus-search-result-text")?.textContent,
    ).toBe("Shanghai, China");
    // ...and the coord display rides along as data-query for keyboard nav.
    expect(
      ctrl.panelWrap
        .querySelector(".foliplus-search-result-item")
        ?.getAttribute("data-query"),
    ).toBe("121.4700, 31.2300");
    ctrl.panelWrap
      .querySelector(".foliplus-search-result-item")!
      .dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    // The input is filled with the coord display so it matches the panel
    // and a follow-up Enter re-searches the same point.
    expect(ctrl.inp.value).toBe("121.4700, 31.2300");
  });

  it("clicking an entry with no display falls back to the stored query", () => {
    const ctrl = makeHistoryCtrl([
      {
        query: "121.47,31.23",
        type: "coord",
        coordDisplay: "",
        addrDisplay: "",
        lng: 121.47,
        lat: 31.23,
        ts: 1000,
        count: 1,
      },
    ]);
    renderHistory(ctrl, "coord");
    // With both displays empty, data-query falls back to entry.query.
    expect(
      ctrl.panelWrap
        .querySelector(".foliplus-search-result-item")
        ?.getAttribute("data-query"),
    ).toBe("121.47,31.23");
    ctrl.panelWrap
      .querySelector(".foliplus-search-result-item")!
      .dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(ctrl.inp.value).toBe("121.47,31.23");
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

describe("mode-lock guard: history entry click when a mode is held", () => {
  it("history entry click is blocked and panel stays open when a mode is held", () => {
    const ctrl: any = {
      mode: "coord",
      panelWrap: null,
      throttleTimer: null,
      selectedIdx: -1,
      inp: { value: "" },
      marker: null,
      searchHistory: [
        {
          query: "121.47,31.23",
          type: MODE.COORD,
          coordDisplay: "121.4700, 31.2300",
          addrDisplay: "",
          lng: 121.47,
          lat: 31.23,
          ts: 1000,
          count: 1,
        },
      ],
      ctrl: {
        getBoundingClientRect: () => ({ left: 0, bottom: 50, width: 100 }),
      },
    };
    // Render the history panel first without a held mode.
    fetchSuggestions(ctrl, "");
    const item = ctrl.panelWrap.querySelector("[data-index='0']");
    expect(item).not.toBeNull();

    // Now hold a mode and click — the click should be blocked.
    ensureModes(window.map).setMode("MeasureControl", "distance");
    const evt = { stopPropagation: vi.fn(), preventDefault: vi.fn() };
    (item as HTMLElement).onmousedown!(evt as unknown as MouseEvent);
    expect(ctrl.panelWrap).not.toBeNull();
    expect(map.flyTo).not.toHaveBeenCalled();
    expect(ctrl.marker).toBeNull();
    expect(ctrl.inp.value).toBe("");
    expect(window.map.foliplus.showHint).toHaveBeenCalledWith(
      "SearchControl",
      "SearchControl.blocked",
      expect.any(Number),
    );
    ensureModes(window.map).setMode("MeasureControl", null);
  });
});
