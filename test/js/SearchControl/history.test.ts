import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HISTORY } from "#foliplus/SearchControl/const.js";
import {
  addHistoryEntry,
  clearHistory,
  deleteHistoryEntry,
  loadHistory,
  recordHistorySearch,
  renderHistory,
  saveHistory,
} from "#foliplus/SearchControl/logic.js";
import type { SearchHistoryEntry } from "#foliplus/SearchControl/type.js";

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
          lat: 48.8,
          lng: 2.3,
          ts: 1000,
        },
        {
          query: "121.47,31.23",
          type: "coord",
          label: "121.4700, 31.2300",
          lat: 31.23,
          lng: 121.47,
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
        lat: 0,
        lng: 0,
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
          lat: 0,
          lng: 0,
          ts: 100,
          count: 1,
        },
        {
          query: "Paris",
          type: "addr",
          coordDisplay: "1.0, 2.0",
          addrDisplay: "Paris",
          lat: 2.0,
          lng: 1.0,
          ts: 200,
          count: 3,
        },
        {
          query: "B",
          type: "addr",
          coordDisplay: "",
          addrDisplay: "B",
          lat: 0,
          lng: 0,
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
          lat: 48.8,
          lng: 2.3,
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
        lat: 0,
        lng: 0,
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
        lat: 0,
        lng: 0,
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
          lat: 0,
          lng: 0,
          ts: 1,
          count: 1,
        },
        {
          query: "B",
          type: "addr",
          coordDisplay: "",
          addrDisplay: "B",
          lat: 0,
          lng: 0,
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
          lat: 0,
          lng: 0,
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
          lat: 0,
          lng: 0,
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
          lat: 0,
          lng: 0,
          ts: 1,
          count: 1,
        },
        {
          query: "B",
          type: "addr",
          coordDisplay: "",
          addrDisplay: "B",
          lat: 0,
          lng: 0,
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
  function makeHistoryCtrl(searchHistory: SearchHistoryEntry[]): any {
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
  }

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
        lat: 48.8,
        lng: 2.3,
        ts: 1000,
        count: 1,
      },
      {
        query: "121.47,31.23",
        type: "coord",
        coordDisplay: "121.4700, 31.2300",
        addrDisplay: "",
        lat: 31.23,
        lng: 121.47,
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
        lat: 48.8,
        lng: 2.3,
        ts: 1000,
        count: 1,
      },
      {
        query: "121.47,31.23",
        type: "coord",
        coordDisplay: "121.4700, 31.2300",
        addrDisplay: "",
        lat: 31.23,
        lng: 121.47,
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
        lat: 0,
        lng: 0,
        ts: 100,
        count: 1,
      },
      {
        query: "B",
        type: "addr",
        coordDisplay: "",
        addrDisplay: "B",
        lat: 0,
        lng: 0,
        ts: 200,
        count: 5,
      },
      {
        query: "C",
        type: "addr",
        coordDisplay: "",
        addrDisplay: "C",
        lat: 0,
        lng: 0,
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
        lat: 48.8,
        lng: 2.3,
        ts: 1000,
        count: 1,
      },
    ]);
    renderHistory(ctrl, "addr");
    const item = ctrl.panelWrap.querySelector(".foliplus-search-result-item")!;
    const mouseEvent = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
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
        lat: 31.23,
        lng: 121.47,
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
        lat: 48.8,
        lng: 2.3,
        ts: 1000,
        count: 1,
      },
    ]);
    renderHistory(ctrl, "coord");
    expect(ctrl.panelWrap).toBeNull();
  });

  it("limits display to 5 entries per section", () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({
      query: `q${i}`, type: "addr" as const,
      coordDisplay: `${i}.0, ${i}.0`, addrDisplay: `Addr ${i}`,
      lat: i, lng: i, ts: i, count: 1,
    }));
    const ctrl = makeHistoryCtrl(entries);
    renderHistory(ctrl, "addr");
    const items = ctrl.panelWrap.querySelectorAll(".foliplus-search-result-item");
    expect(items.length).toBeLessThanOrEqual(5);
  });
});
