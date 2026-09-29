import { describe, expect, it } from "vitest";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import {
  clearIntent,
  dropIntent,
  getIntent,
  hasIntentValue,
  seedIntentMap,
  setIntent,
} from "#foliplus/LayerControl/ui/intent.js";

const ui = (): LayerUI => ({ intents: {} }) as unknown as LayerUI;

describe("LayerIntent helpers", () => {
  it("setIntent writes one dimension and getIntent reads it back", () => {
    const u = ui();
    setIntent(u, "a", "visible", false);
    setIntent(u, "a", "opacity", 0.5);
    setIntent(u, "a", "zoomRange", [3, 12]);
    setIntent(u, "a", "name", "Renamed");
    expect(getIntent(u, "a", "visible")).toBe(false);
    expect(getIntent(u, "a", "opacity")).toBe(0.5);
    expect(getIntent(u, "a", "zoomRange")).toEqual([3, 12]);
    expect(getIntent(u, "a", "name")).toBe("Renamed");
  });

  it("setIntent bootstraps ui.intents when the shell omitted it", () => {
    const u = {} as unknown as LayerUI;
    setIntent(u, "a", "fillColor", "#ff0000");
    expect(getIntent(u, "a", "fillColor")).toBe("#ff0000");
  });

  it("clearIntent drops one dimension and collapses an empty record", () => {
    const u = ui();
    setIntent(u, "a", "fillColor", "#123456");
    setIntent(u, "a", "fillOpacity", 0.25);
    clearIntent(u, "a", "fillColor");
    expect(getIntent(u, "a", "fillColor")).toBeUndefined();
    expect(getIntent(u, "a", "fillOpacity")).toBe(0.25);
    clearIntent(u, "a", "fillOpacity");
    expect(u.intents.a).toBeUndefined();
  });

  it("clearIntent is a no-op when the id has no record", () => {
    const u = ui();
    clearIntent(u, "ghost", "opacity");
    expect(u.intents).toEqual({});
  });

  it("dropIntent clears style dims but keeps name and annotation", () => {
    const u = ui();
    setIntent(u, "a", "visible", false);
    setIntent(u, "a", "opacity", 0.3);
    setIntent(u, "a", "name", "Keep");
    setIntent(u, "a", "annotation", {
      show: true,
      field: "name",
      format: "auto",
      color: "#000",
      fontSize: 12,
    });
    dropIntent(u, "a");
    expect(getIntent(u, "a", "visible")).toBeUndefined();
    expect(getIntent(u, "a", "opacity")).toBeUndefined();
    expect(getIntent(u, "a", "name")).toBe("Keep");
    expect(getIntent(u, "a", "annotation")).toBeDefined();
  });

  it("dropIntent removes the record when only style dims were present", () => {
    const u = ui();
    setIntent(u, "a", "opacity", 1);
    dropIntent(u, "a");
    expect(u.intents.a).toBeUndefined();
  });

  it("hasIntentValue distinguishes typed presence from absence", () => {
    const u = ui();
    setIntent(u, "a", "visible", true);
    setIntent(u, "a", "fillColor", "#abcdef");
    setIntent(u, "a", "borderWeight", 0);
    setIntent(u, "a", "zoomRange", [0, 18]);
    setIntent(u, "a", "name", "N");
    setIntent(u, "a", "annotation", {
      show: false,
      field: "count",
      format: "auto",
      color: "#111",
      fontSize: 11,
    });
    expect(hasIntentValue(u, "a", "visible")).toBe(true);
    expect(hasIntentValue(u, "a", "fillColor")).toBe(true);
    expect(hasIntentValue(u, "a", "borderWeight")).toBe(true); // 0 is a live value
    expect(hasIntentValue(u, "a", "zoomRange")).toBe(true);
    expect(hasIntentValue(u, "a", "name")).toBe(true);
    expect(hasIntentValue(u, "a", "annotation")).toBe(true);
    expect(hasIntentValue(u, "a", "opacity")).toBe(false);
    expect(hasIntentValue(u, "b", "visible")).toBe(false);
    expect(hasIntentValue(u, "a", "fillOpacity")).toBe(false);
    expect(hasIntentValue(u, "a", "borderColor")).toBe(false);
    expect(hasIntentValue(u, "a", "borderWeight")).toBe(true);
  });

  it("dropIntent is a no-op when the id has no record", () => {
    const u = ui();
    dropIntent(u, "ghost");
    expect(u.intents).toEqual({});
  });

  it("seedIntentMap fills a whole dimension from a record", () => {
    const u = ui();
    seedIntentMap(u, "visible", { a: false, b: true });
    expect(getIntent(u, "a", "visible")).toBe(false);
    expect(getIntent(u, "b", "visible")).toBe(true);
  });
});
