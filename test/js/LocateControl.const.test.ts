import * as CONST from "#foliplus/LocateControl/LocateControl.const.js";
import { describe, expect, it } from "vitest";

describe("CLASSES", () => {
  it("defines CSS class constants", () => {
    expect(CONST.CLASSES.BTN).toBe("foliplus-locate-btn");
  });
});

describe("GEO", () => {
  it("defines geolocation options", () => {
    expect(CONST.GEO.TIMEOUT_MS).toBe(10000);
    expect(CONST.GEO.MAX_AGE_MS).toBe(60000);
  });
});
