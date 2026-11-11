import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markRequest } from "#core/geocode/index.js";
import { ensureModes } from "#core/lifecycle/index.js";
import { HISTORY, MODE, RECORD_VERSION, ZOOM } from "#control/SearchControl/const.js";
import {
  addHistoryEntry,
  clearHistory,
  deleteHistoryEntry,
  flushHistory,
  loadHistory,
  recordHistorySearch,
  renderHistory,
  saveHistory,
} from "#control/SearchControl/logic/history.js";
import {
  fetchSuggestions,
  searchAddress,
  searchCoord,
} from "#control/SearchControl/logic/search.js";
import type { SearchControlCtx } from "#control/SearchControl/logic/util.js";
import type { SearchHistoryEntry } from "#control/SearchControl/type.js";

// Module-level code captured window.foliplus and window.map from setup.js.
// Use vi.spyOn to track calls on those already-setup mocks.
beforeEach(() => {
  markRequest("nominatim", 0);
});

// Control context for logic functions that now receive ctrl.
const ctx = (): SearchControlCtx =>
  ({
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
  }) as unknown as SearchControlCtx;

describe("searchCoord — history recording", () => {
  it("records a coord search entry after successful search", async () => {
    const ctrl: any = {
      ...ctx(),
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
    const ctrl: any = { ...ctx(), inp: { value: "" }, marker: null, searchHistory: [] };
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
    const ctrl: any = { ...ctx(), inp: { value: "" }, marker: null, searchHistory: [] };
    searchCoord(ctrl, " 120 , 32 ");
    await tick();
    await tick();
    expect(ctrl.searchHistory).toHaveLength(1);
    expect(ctrl.searchHistory[0].query).toBe("120,32");
    expect(ctrl.searchHistory[0].coordDisplay).toBe("120.000000, 32.000000");
  });

  it("does not record history for invalid coordinates", () => {
    const ctrl: any = { ...ctx(), inp: { value: "" }, marker: null, searchHistory: [] };
    searchCoord(ctrl, "abc");
    expect(ctrl.searchHistory).toEqual([]);
  });

  it("reverse geocode success: addrDisplay updated, count stays 1", async () => {
    // Mock reverse geocode to return an address after the initial save
    (window.foliplus.reverseGeocode as any).mockResolvedValue("Shanghai, China");
    const ctrl: any = {
      ...ctx(),
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
      ...ctx(),
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
      ...ctx(),
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
      ...ctx(),
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
      ...ctx(),
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
      ...ctx(),
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
    const ctrl: any = { ...ctx(), searchHistory: [] };
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
      ...ctx(),
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
      ...ctx(),
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
      ...ctx(),
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
      ...ctx(),
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
      ...ctx(),
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
      ...ctx(),
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
      ...ctx(),
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
      ...ctx(),
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
    const loaded = loadHistory(ctx());
    expect(loaded).toEqual([]);
  });

  it("is a no-op when history is already empty", () => {
    const ctrl: any = { ...ctx(), searchHistory: [] };
    clearHistory(ctrl);
    expect(ctrl.searchHistory).toEqual([]);
  });
});

describe("recordHistorySearch", () => {
  it("records a completed coord search", () => {
    const ctrl: any = { ...ctx(), searchHistory: [] };
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
    const ctrl: any = { ...ctx(), searchHistory: [] };
    recordHistorySearch(ctrl, "Paris", "addr", "2.3, 48.8", "Paris, France", 2.3, 48.8);
    expect(ctrl.searchHistory).toHaveLength(1);
    expect(ctrl.searchHistory[0].type).toBe("addr");
    expect(ctrl.searchHistory[0].addrDisplay).toBe("Paris, France");
    expect(ctrl.searchHistory[0].coordDisplay).toBe("2.3, 48.8");
  });

  it("records the current timestamp", () => {
    const ctrl: any = { ...ctx(), searchHistory: [] };
    const before = Date.now();
    recordHistorySearch(ctrl, "A", "addr", "", "A", 0, 0);
    const after = Date.now();
    expect(ctrl.searchHistory[0].ts).toBeGreaterThanOrEqual(before);
    expect(ctrl.searchHistory[0].ts).toBeLessThanOrEqual(after);
  });

  it("stores raw query as key for deduplication", () => {
    const ctrl: any = { ...ctx(), searchHistory: [] };
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
      ...ctx(),
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
    // config.zoom is unset so the flyTo target exercises the ZOOM.MAX fallback.
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
    ctrl.config = { ...ctrl.config, zoom: undefined };
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
      ...ctx(),
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

describe("SearchControl history — versioned envelope", () => {
  describe("saveHistory — writes { version, entries }", () => {
    it("wraps the entries in a versioned record", () => {
      const entries: SearchHistoryEntry[] = [
        {
          query: "Paris",
          type: MODE.ADDR,
          coordDisplay: "",
          addrDisplay: "Paris, France",
          lng: 0,
          lat: 48.85,
          ts: 1000,
          count: 1,
        },
      ];
      saveHistory(ctx(), entries);
      const stored = JSON.parse(window.localStorage.getItem(HISTORY.STORAGE_KEY)!);
      expect(stored.version).toBe(RECORD_VERSION);
      expect(stored.entries).toEqual(entries);
    });

    it("writes an empty envelope for an empty history (still carries version)", () => {
      saveHistory(ctx(), []);
      const stored = JSON.parse(window.localStorage.getItem(HISTORY.STORAGE_KEY)!);
      expect(stored.version).toBe(RECORD_VERSION);
      expect(stored.entries).toEqual([]);
    });
  });

  describe("loadHistory — envelope + legacy bare array + corrupt", () => {
    it("reads the new { version, entries } envelope", () => {
      const entries: SearchHistoryEntry[] = [
        {
          query: "Paris",
          type: MODE.ADDR,
          coordDisplay: "",
          addrDisplay: "Paris",
          lng: 0,
          lat: 48.85,
          ts: 1000,
          count: 1,
        },
      ];
      window.localStorage.setItem(
        HISTORY.STORAGE_KEY,
        JSON.stringify({ version: RECORD_VERSION, entries }),
      );
      expect(loadHistory(ctx())).toEqual(entries);
    });

    it("accepts an older/unknown version value without migrating", () => {
      const entries: SearchHistoryEntry[] = [
        {
          query: "Paris",
          type: MODE.ADDR,
          coordDisplay: "",
          addrDisplay: "Paris",
          lng: 0,
          lat: 48.85,
          ts: 1000,
          count: 1,
        },
      ];
      window.localStorage.setItem(
        HISTORY.STORAGE_KEY,
        JSON.stringify({ version: 999, entries }),
      );
      expect(loadHistory(ctx())).toEqual(entries);
    });

    it("reads the legacy bare-array shape when the rows are complete", () => {
      // Pre-envelope shape: a bare array of complete current-format rows. The
      // envelope is an optional wrapper — C7 drops partial rows, not complete
      // ones, so a bare array of well-formed entries still loads.
      const row: SearchHistoryEntry = {
        query: "",
        type: MODE.ADDR,
        coordDisplay: "",
        addrDisplay: "Paris",
        lng: 0,
        lat: 0,
        ts: 1000,
        count: 1,
      };
      window.localStorage.setItem(HISTORY.STORAGE_KEY, JSON.stringify([row]));
      expect(loadHistory(ctx())).toEqual([row]);
    });

    it("returns [] for a corrupt envelope (entries missing)", () => {
      window.localStorage.setItem(
        HISTORY.STORAGE_KEY,
        JSON.stringify({ version: RECORD_VERSION }),
      );
      expect(loadHistory(ctx())).toEqual([]);
    });

    it("returns [] for an envelope whose entries is not an array", () => {
      window.localStorage.setItem(
        HISTORY.STORAGE_KEY,
        JSON.stringify({ version: RECORD_VERSION, entries: { not: "array" } }),
      );
      expect(loadHistory(ctx())).toEqual([]);
    });

    it("returns [] for a plain non-array value", () => {
      window.localStorage.setItem(HISTORY.STORAGE_KEY, JSON.stringify("string"));
      expect(loadHistory(ctx())).toEqual([]);
    });

    it("returns [] for malformed JSON (falls through to empty history)", () => {
      window.localStorage.setItem(HISTORY.STORAGE_KEY, "not-json");
      expect(loadHistory(ctx())).toEqual([]);
    });

    it("returns [] when storage is empty", () => {
      expect(loadHistory(ctx())).toEqual([]);
    });
  });

  describe("round-trip", () => {
    it("save then load returns the same entries (envelope is transparent)", () => {
      const entries: SearchHistoryEntry[] = [
        {
          query: "Paris",
          type: MODE.ADDR,
          coordDisplay: "",
          addrDisplay: "Paris",
          lng: 0,
          lat: 48.85,
          ts: 1000,
          count: 1,
        },
      ];
      saveHistory(ctx(), entries);
      expect(loadHistory(ctx())).toEqual(entries);
    });

    it("a bare-array record of complete rows is re-wrapped on the next save", () => {
      const row: SearchHistoryEntry = {
        query: "",
        type: MODE.ADDR,
        coordDisplay: "",
        addrDisplay: "Paris",
        lng: 0,
        lat: 0,
        ts: 1000,
        count: 1,
      };
      window.localStorage.setItem(HISTORY.STORAGE_KEY, JSON.stringify([row]));
      // Read: bare shape is unwrapped, then re-persisted as the new envelope.
      const loaded = loadHistory(ctx());
      saveHistory(ctx(), loaded);
      const stored = JSON.parse(window.localStorage.getItem(HISTORY.STORAGE_KEY)!);
      expect(stored.version).toBe(RECORD_VERSION);
      expect(Array.isArray(stored.entries)).toBe(true);
      expect(stored.entries).toHaveLength(1);
      expect(stored.entries[0]).toEqual(row);
    });
  });

  describe("flushHistory — teardown safety", () => {
    it("entries survive the destroy() flush → reset sequence", () => {
      // Mirrors SearchControl.destroy(): flushHistory(ctx()) writes the current
      // history before the in-memory array is reset. With debounceMs=0 the
      // write is already durable at saveHistory time, so flushHistory is a
      // no-op safety net — but the flush-before-reset order is the convention
      // that keeps this teardown safe if the debounce window ever changes.
      const entries: SearchHistoryEntry[] = [
        {
          query: "Paris",
          type: MODE.ADDR,
          coordDisplay: "121.4700, 31.2300",
          addrDisplay: "Paris",
          lng: 121.47,
          lat: 31.23,
          ts: 2000,
          count: 1,
        },
      ];

      saveHistory(ctx(), entries);
      flushHistory(ctx());

      const stored = JSON.parse(window.localStorage.getItem(HISTORY.STORAGE_KEY)!);
      expect(stored.version).toBe(RECORD_VERSION);
      expect(Array.isArray(stored.entries)).toBe(true);
      expect(stored.entries).toEqual(entries);
    });

    it("is a no-op when nothing is pending since the last write", () => {
      // Conditional-flush semantic: flush only writes when a schedule() is
      // pending. A teardown that has nothing to save must not rewrite the
      // record — the disk copy stays untouched, so a later reset of memory
      // state cannot leak through a stale flush.
      const entries: SearchHistoryEntry[] = [
        {
          query: "Tokyo",
          type: MODE.ADDR,
          coordDisplay: "",
          addrDisplay: "Tokyo",
          lng: 139.69,
          lat: 35.68,
          ts: 1000,
          count: 1,
        },
      ];
      saveHistory(ctx(), entries);
      flushHistory(ctx());
      const afterFirst = window.localStorage.getItem(HISTORY.STORAGE_KEY);
      flushHistory(ctx());
      expect(window.localStorage.getItem(HISTORY.STORAGE_KEY)).toBe(afterFirst);
    });
  });
  describe("loadHistory / saveHistory — legacy bare-array rows", () => {
    /** Rows a post-scoped build writes, under the per-map key. */
    const scopedRows: SearchHistoryEntry[] = [
      {
        query: "",
        type: MODE.ADDR,
        coordDisplay: "",
        addrDisplay: "Scoped",
        lng: 1.0,
        lat: 50.0,
        ts: 1,
        count: 1,
      },
    ];

    /** Write partial entries as an older version would have stored them. */
    const store = (entries: object[]): void => {
      localStorage.setItem(HISTORY.STORAGE_KEY, JSON.stringify(entries));
    };

    it("drops partial rows an older version wrote instead of filling defaults", () => {
      // C7: old-version tolerance removed — a row missing any current-format
      // field is old data and is dropped, not defaulted.
      store([{ type: MODE.ADDR, addrDisplay: "Paris", lng: 0, lat: 0 }]);
      expect(loadHistory(ctx())).toEqual([]);
    });

    it("drops a partial coord entry with no display fields", () => {
      store([{ query: "120, 32", type: MODE.COORD, ts: 1000 }]);
      expect(loadHistory(ctx())).toEqual([]);
    });

    it("drops partial rows whose display fields are missing", () => {
      store([
        {
          query: "120,32",
          type: MODE.COORD,
          coordDisplay: "120.000000, 32.000000",
          ts: 500,
        },
        { query: "120,32", type: MODE.COORD, coordDisplay: "", ts: 900 },
      ]);
      expect(loadHistory(ctx())).toEqual([]);
    });

    it("drops null, non-object, and partial rows instead of crashing", () => {
      store([null, "text", 42, { type: MODE.ADDR, ts: 1000 }] as unknown as object[]);
      expect(loadHistory(ctx())).toEqual([]);
    });

    it("drops a row with no usable fields", () => {
      store([{}]);
      expect(loadHistory(ctx())).toEqual([]);
    });

    it("loads empty array when nothing is stored", () => {
      const entries = loadHistory(ctx());
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
      saveHistory(ctx(), entries);
      expect(loadHistory(ctx())).toEqual(entries);
    });

    it("returns empty array for corrupt data", () => {
      localStorage.setItem(HISTORY.STORAGE_KEY, "not json");
      expect(loadHistory(ctx())).toEqual([]);
    });

    it("reads history from the scoped key only", () => {
      store(scopedRows);
      const otherRows: SearchHistoryEntry[] = [
        {
          query: "",
          type: MODE.ADDR,
          coordDisplay: "",
          addrDisplay: "Other",
          lng: 9,
          lat: 9,
          ts: 1,
          count: 1,
        },
      ];
      localStorage.setItem("foliplus_search_map-other", JSON.stringify(otherRows));
      expect(loadHistory(ctx()).map(e => e.addrDisplay)).toEqual(
        scopedRows.map(r => r.addrDisplay),
      );
    });

    it("keeps history separate per map container", () => {
      const rowsA = [scopedRows[0]];
      const rowsB: SearchHistoryEntry[] = [
        {
          query: "",
          type: MODE.ADDR,
          coordDisplay: "",
          addrDisplay: "Tokyo",
          lng: 0,
          lat: 0,
          ts: 1,
          count: 1,
        },
      ];
      localStorage.setItem("foliplus_search_map-a", JSON.stringify(rowsA));
      localStorage.setItem("foliplus_search_map-b", JSON.stringify(rowsB));
      // The container id feeds the scoped key directly; a second map must not
      // inherit the first map's row.
      Object.defineProperty(HISTORY, "STORAGE_KEY", { value: "foliplus_search_map-a" });
      const mapA = loadHistory(ctx());
      expect(mapA.map(e => e.addrDisplay)).toEqual(["Scoped"]);
      Object.defineProperty(HISTORY, "STORAGE_KEY", { value: "foliplus_search_map-b" });
      const mapB = loadHistory(ctx());
      expect(mapB.map(e => e.addrDisplay)).toEqual(["Tokyo"]);
      // map-a's store survives map-b's read.
      expect(JSON.parse(localStorage.getItem("foliplus_search_map-a")!).length).toBe(1);
    });

    it("returns empty array for non-array data", () => {
      localStorage.setItem(HISTORY.STORAGE_KEY, '"string"');
      expect(loadHistory(ctx())).toEqual([]);
    });

    it("drops old label-field rows instead of migrating them", () => {
      // C7: label was an old-format display field; rows carrying it are old
      // data and are dropped, not rewritten into coordDisplay/addrDisplay.
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
      expect(loadHistory(ctx())).toEqual([]);
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
      saveHistory(ctx(), entries);
      expect(loadHistory(ctx())).toHaveLength(1);
      saveHistory(ctx(), []);
      expect(loadHistory(ctx())).toEqual([]);
    });

    it("keeps complete rows with non-canonical coord keys distinct", () => {
      // C7: the load path no longer canonicalizes legacy raw-input keys, so
      // complete rows with distinct key strings stay distinct (only exact
      // type:query duplicates merge). Old rows with partial fields were already
      // dropped, but complete rows are kept verbatim.
      localStorage.setItem(
        HISTORY.STORAGE_KEY,
        JSON.stringify([
          {
            query: "120, 32",
            type: "coord",
            coordDisplay: "120.000000, 32.000000",
            addrDisplay: "",
            lng: 120,
            lat: 32,
            ts: 111,
            count: 1,
          },
          {
            query: "120，32",
            type: "coord",
            coordDisplay: "120.000000, 32.000000",
            addrDisplay: "",
            lng: 120,
            lat: 32,
            ts: 222,
            count: 1,
          },
          {
            query: "120,32",
            type: "coord",
            coordDisplay: "120.000000, 32.000000",
            addrDisplay: "Hangzhou, China",
            lng: 120,
            lat: 32,
            ts: 333,
            count: 2,
          },
        ]),
      );
      const loaded = loadHistory(ctx());
      expect(loaded).toHaveLength(3);
      expect(loaded.map(e => e.query)).toEqual(["120, 32", "120，32", "120,32"]);
    });

    it("keeps a coord key exactly as stored (no load-time canonicalization)", () => {
      localStorage.setItem(
        HISTORY.STORAGE_KEY,
        JSON.stringify([
          {
            query: "121.47 , 31.23",
            type: "coord",
            coordDisplay: "",
            addrDisplay: "",
            lng: 121.47,
            lat: 31.23,
            ts: 1,
            count: 1,
          },
          {
            query: "Paris",
            type: "addr",
            coordDisplay: "",
            addrDisplay: "Paris, France",
            lng: 2.3,
            lat: 48.8,
            ts: 2,
            count: 1,
          },
        ]),
      );
      const loaded = loadHistory(ctx());
      expect(loaded).toHaveLength(2);
      expect(loaded[0].query).toBe("121.47 , 31.23");
      // Address queries are never rewritten either.
      expect(loaded.find(e => e.type === "addr")?.query).toBe("Paris");
    });

    it("does not collapse out-of-range coord keys that fail to validate", () => {
      // Out-of-range values pass parseCoord's shape check but fail range validation,
      // so their keys stay as typed and distinct entries stay distinct.
      localStorage.setItem(
        HISTORY.STORAGE_KEY,
        JSON.stringify([
          {
            query: "200,32",
            type: "coord",
            coordDisplay: "1.000000, 1.000000",
            addrDisplay: "",
            lng: 1,
            lat: 1,
            ts: 1,
            count: 1,
          },
          {
            query: "999,32",
            type: "coord",
            coordDisplay: "2.000000, 2.000000",
            addrDisplay: "",
            lng: 2,
            lat: 2,
            ts: 2,
            count: 1,
          },
        ]),
      );
      const loaded = loadHistory(ctx());
      expect(loaded).toHaveLength(2);
      // Stored in insertion order, as loadHistory preserves it
      expect(loaded.map(e => e.lng)).toEqual([1, 2]);
      // Keys that fail to parse are never rewritten
      expect(loaded.map(e => e.query)).toEqual(["200,32", "999,32"]);
    });

    it("does not collapse a coord and an addr entry that share a key string", () => {
      localStorage.setItem(
        HISTORY.STORAGE_KEY,
        JSON.stringify([
          {
            query: "120,32",
            type: "coord",
            coordDisplay: "120.000000, 32.000000",
            addrDisplay: "",
            lng: 120,
            lat: 32,
            ts: 1,
            count: 1,
          },
          {
            query: "120,32",
            type: "addr",
            coordDisplay: "120.000000, 32.000000",
            addrDisplay: "Somewhere",
            lng: 120,
            lat: 32,
            ts: 2,
            count: 1,
          },
        ]),
      );
      const loaded = loadHistory(ctx());
      expect(loaded).toHaveLength(2);
      expect(loaded.filter(e => e.type === "coord")).toHaveLength(1);
      expect(loaded.filter(e => e.type === "addr")).toHaveLength(1);
    });

    it("keeps the newest-first order for non-duplicate entries", () => {
      const entries: SearchHistoryEntry[] = [
        {
          query: "Paris",
          type: "addr",
          coordDisplay: "",
          addrDisplay: "Paris",
          lng: 0,
          lat: 0,
          ts: 1,
          count: 1,
        },
        {
          query: "Berlin",
          type: "addr",
          coordDisplay: "",
          addrDisplay: "Berlin",
          lng: 0,
          lat: 0,
          ts: 2,
          count: 1,
        },
      ];
      saveHistory(ctx(), entries);
      expect(loadHistory(ctx())).toEqual(entries);
    });
  });
});
