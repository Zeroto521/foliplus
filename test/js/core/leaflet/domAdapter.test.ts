import { describe, expect, it } from "vitest";
import { cancelMapPaneTranslate } from "#core/leaflet/domAdapter.js";

describe("cancelMapPaneTranslate", () => {
  it("offsets the canvas by the negated mapPane position", () => {
    const canvas = document.createElement("canvas");
    (window.L as unknown as { DomUtil: unknown }).DomUtil = {
      getPosition: () => ({ x: 12, y: -5 }),
    };
    const map = {
      getPanes: () => ({ mapPane: document.createElement("div") }),
    } as unknown as L.Map;

    cancelMapPaneTranslate(canvas, map);

    expect(canvas.style.left).toBe("-12px");
    expect(canvas.style.top).toBe("5px");
  });

  it("tolerates a map without a mapPane", () => {
    const canvas = document.createElement("canvas");
    const map = { getPanes: () => ({}) } as unknown as L.Map;

    expect(() => cancelMapPaneTranslate(canvas, map)).not.toThrow();
    expect(canvas.style.left).toBe("");
  });
});
