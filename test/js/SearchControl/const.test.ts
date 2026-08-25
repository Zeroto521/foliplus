import { describe, expect, it } from "vitest";
import * as CONST from "#foliplus/SearchControl/const.js";

describe("MODE", () => {
  it("defines search modes", () => {
    expect(CONST.MODE.COORD).toBe("coord");
    expect(CONST.MODE.ADDR).toBe("addr");
  });
});

describe("ZOOM", () => {
  it("defines zoom levels", () => {
    expect(CONST.ZOOM.MAX).toBe(16);
    expect(CONST.ZOOM.MIN).toBe(12);
    expect(CONST.ZOOM.BASE).toBe(18);
  });
});

describe("AUTOCOMPLETE", () => {
  it("defines autocomplete settings", () => {
    expect(CONST.AUTOCOMPLETE.DEBOUNCE_MS).toBe(300);
    expect(CONST.AUTOCOMPLETE.MIN_CHARS).toBe(3);
    expect(CONST.AUTOCOMPLETE.MAX_ITEMS).toBe(5);
  });
});

describe("PARAM", () => {
  it("defines URL params", () => {
    expect(CONST.PARAM.Q).toBe("q");
    expect(CONST.PARAM.LAT).toBe("lat");
    expect(CONST.PARAM.LNG).toBe("lng");
  });
});

describe("SOURCE", () => {
  it("defines result source types", () => {
    expect(CONST.SOURCE.SUGGESTION).toBe("suggestion");
    expect(CONST.SOURCE.HISTORY).toBe("history");
  });
});

describe("HISTORY", () => {
  it("defines history config", () => {
    expect(CONST.HISTORY.MAX_ENTRIES).toBe(20);
    expect(CONST.HISTORY.MAX_DISPLAY).toBe(5);
    expect(CONST.HISTORY.STORAGE_KEY).toBe("foliplus.search_history");
  });
});

describe("CLASSES", () => {
  it("defines CSS class constants", () => {
    expect(CONST.CLASSES.MAP_SEARCH).toBe("foliplus-search");
    expect(CONST.CLASSES.RESULT_PANEL).toBe("foliplus-search-result-panel");
    expect(CONST.CLASSES.ACTIVE).toBe("active");
  });
});
