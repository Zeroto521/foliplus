import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addHistoryEntry,
  clearHistory,
  deleteHistoryEntry,
  loadHistory,
  recordHistorySearch,
  renderHistory,
  saveHistory,
} from "#foliplus/SearchControl/logic.js";
import { HISTORY } from "#foliplus/SearchControl/const.js";
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
      { query: "Paris", type: "addr", label: "Paris", lat: 48.8, lng: 2.3, ts: 1000 },
      { query: "121.47,31.23", type: "coord", label: "121.4700, 31.2300", lat: 31.23, lng: 121.47, ts: 2000 },
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
});

describe("addHistoryEntry", () => {
  it("prepends a new entry and persists", () => {
    const ctrl: any = { searchHistory: [] };
    addHistoryEntry(ctrl, {
      query: "Paris", type: "addr", label: "Paris", lat: 48.8, lng: 2.3, ts: 1000,
    });
    expect(ctrl.searchHistory).toHaveLength(1);
    expect(ctrl.searchHistory[0].query).toBe("Paris");
    expect(localStorage.getItem(HISTORY.STORAGE_KEY)).toBeDefined();
  });

  it("deduplicates by query", () => {
    const ctrl: any = {
      searchHistory: [
        { query: "Paris", type: "addr", label: "Paris", lat: 48.8, lng: 2.3, ts: 1000 },
      ],
    };
    addHistoryEntry(ctrl, {
      query: "Paris", type: "addr", label: "Paris, France", lat: 48.8, lng: 2.3, ts: 2000,
    });
    expect(ctrl.searchHistory).toHaveLength(1);
    expect(ctrl.searchHistory[0].label).toBe("Paris, France");
  });

  it("respects MAX_ENTRIES limit", () => {
    const ctrl: any = {
      searchHistory: Array.from({ length: HISTORY.MAX_ENTRIES }, (_, i) => ({
        query: `q${i}`, type: "addr", label: `L${i}`, lat: 0, lng: 0, ts: i,
      })),
    };
    addHistoryEntry(ctrl, {
      query: "new", type: "addr", label: "New", lat: 1, lng: 1, ts: 9999,
    });
    expect(ctrl.searchHistory).toHaveLength(HISTORY.MAX_ENTRIES);
    expect(ctrl.searchHistory[0].query).toBe("new");
    // q0..q18 stay, q19 is evicted (new entry prepended, oldest tail entry dropped)
    expect(ctrl.searchHistory.find((e: SearchHistoryEntry) => e.query === "q19")).toBeUndefined();
    expect(ctrl.searchHistory.find((e: SearchHistoryEntry) => e.query === "q0")).toBeDefined();
  });
});

describe("deleteHistoryEntry", () => {
  it("removes a matching entry and persists", () => {
    const ctrl: any = {
      searchHistory: [
        { query: "A", type: "addr", label: "A", lat: 0, lng: 0, ts: 1 },
        { query: "B", type: "addr", label: "B", lat: 0, lng: 0, ts: 2 },
      ],
    };
    deleteHistoryEntry(ctrl, "A");
    expect(ctrl.searchHistory).toHaveLength(1);
    expect(ctrl.searchHistory[0].query).toBe("B");
  });

  it("does nothing for unknown query", () => {
    const ctrl: any = {
      searchHistory: [
        { query: "A", type: "addr", label: "A", lat: 0, lng: 0, ts: 1 },
      ],
    };
    deleteHistoryEntry(ctrl, "Z");
    expect(ctrl.searchHistory).toHaveLength(1);
  });
});

describe("clearHistory", () => {
  it("empties the history array and persists", () => {
    const ctrl: any = {
      searchHistory: [
        { query: "A", type: "addr", label: "A", lat: 0, lng: 0, ts: 1 },
        { query: "B", type: "addr", label: "B", lat: 0, lng: 0, ts: 2 },
      ],
    };
    clearHistory(ctrl);
    expect(ctrl.searchHistory).toEqual([]);
    const loaded = loadHistory();
    expect(loaded).toEqual([]);
  });
});

describe("recordHistorySearch", () => {
  it("records a completed coord search", () => {
    const ctrl: any = { searchHistory: [] };
    recordHistorySearch(ctrl, "121.47,31.23", "coord", "121.4700, 31.2300", 31.23, 121.47);
    expect(ctrl.searchHistory).toHaveLength(1);
    expect(ctrl.searchHistory[0].type).toBe("coord");
    expect(ctrl.searchHistory[0].lat).toBe(31.23);
    expect(ctrl.searchHistory[0].lng).toBe(121.47);
  });

  it("records a completed addr search", () => {
    const ctrl: any = { searchHistory: [] };
    recordHistorySearch(ctrl, "Paris", "addr", "Paris, France", 48.8, 2.3);
    expect(ctrl.searchHistory).toHaveLength(1);
    expect(ctrl.searchHistory[0].type).toBe("addr");
    expect(ctrl.searchHistory[0].label).toBe("Paris, France");
  });
});

describe("renderHistory", () => {
  it("removes suggestions when history is empty", () => {
    const ctrl: any = {
      searchHistory: [],
      suggestionsWrap: null,
      suggestionsThrottleTimer: null,
      selectedSuggestionIdx: -1,
    };
    renderHistory(ctrl);
    expect(ctrl.suggestionsWrap).toBeNull();
  });

  it("renders a history panel with group header and entries", () => {
    const ctrl: any = {
      searchHistory: [
        { query: "Paris", type: "addr", label: "Paris, France", lat: 48.8, lng: 2.3, ts: 1000 },
        { query: "121.47,31.23", type: "coord", label: "121.4700, 31.2300", lat: 31.23, lng: 121.47, ts: 2000 },
      ],
      suggestionsWrap: null,
      suggestionsThrottleTimer: null,
      selectedSuggestionIdx: -1,
      ctrl: {
        getBoundingClientRect: () => ({ left: 0, bottom: 50, width: 100 }),
      },
      inp: { value: "" },
    };
    renderHistory(ctrl);
    expect(ctrl.suggestionsWrap).not.toBeNull();
    expect(ctrl.suggestionsWrap.innerHTML).toContain("Paris, France");
    expect(ctrl.suggestionsWrap.innerHTML).toContain("121.4700, 31.2300");
    // Group header present
    expect(ctrl.suggestionsWrap.querySelector(".foliplus-search-history-group-header")).not.toBeNull();
    // Clear all button present
    expect(ctrl.suggestionsWrap.querySelector(".foliplus-search-history-group-clear")).not.toBeNull();
    // History items present — they reuse suggestion-item classes with a history modifier
    const items = ctrl.suggestionsWrap.querySelectorAll(
      ".foliplus-search-suggestion-item.foliplus-search-history-item",
    );
    expect(items).toHaveLength(2);
    // Each history item has the same layout as a suggestion item (icon + text)
    expect(items[0].querySelector(".foliplus-search-suggestion-icon")).not.toBeNull();
    expect(items[0].querySelector(".foliplus-search-suggestion-text")?.textContent).toBe("Paris, France");
    // Delete button present for each history item
    expect(items[0].querySelector(".foliplus-search-history-item-del")).not.toBeNull();
  });
});
