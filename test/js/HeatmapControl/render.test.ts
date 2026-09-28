// Unit tests for HeatmapControl/render — the pure canvas draw helpers.
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/HeatmapControl/const.js";
import {
  drawHexLabel,
  drawHexagon,
  resolveLabelStyle,
} from "#foliplus/HeatmapControl/render.js";
import type { HexFeature } from "#foliplus/HeatmapControl/type.js";

const makeCtx = () => ({
  font: "",
  textAlign: "",
  textBaseline: "",
  lineJoin: "",
  strokeStyle: "",
  lineWidth: 0,
  fillStyle: "",
  globalAlpha: 1,
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  closePath: vi.fn(),
  fill: vi.fn(),
  stroke: vi.fn(),
  strokeText: vi.fn(),
  fillText: vi.fn(),
});

const makeMap = () => ({
  latLngToContainerPoint: vi.fn(() => ({ x: 100, y: 200 })),
});

/** A hexagon ring in GeoJSON [lng, lat] order. */
const makeFeat = (overrides: Partial<HexFeature> = {}): HexFeature => ({
  type: "Feature",
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [119.3, 26.08],
        [119.31, 26.09],
        [119.3, 26.08],
      ],
    ],
  },
  properties: { centroid: [26.08, 119.3], value: 42, fillColor: "#ff0000" },
  ...overrides,
});

describe("drawHexagon", () => {
  beforeEach(() => {
    Object.assign(window.CONF, {
      fill_opacity: 0.7,
      border_opacity: 0.9,
    });
  });

  it("fills the polygon and strokes the border", () => {
    const ctx = makeCtx();
    drawHexagon(
      ctx as unknown as CanvasRenderingContext2D,
      makeFeat(),
      makeMap() as unknown as L.Map,
      2,
      "#000000",
    );
    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.moveTo).toHaveBeenCalledWith(100, 200);
    expect(ctx.lineTo).toHaveBeenCalledWith(100, 200);
    expect(ctx.closePath).toHaveBeenCalled();
    expect(ctx.fillStyle).toBe("#ff0000");
    expect(ctx.fill).toHaveBeenCalled();
    // Fill opacity comes from CONF, then resets after the draw.
    expect(ctx.strokeStyle).toBe("#000000");
    expect(ctx.lineWidth).toBe(2);
    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.globalAlpha).toBe(1);
  });

  it("skips the stroke when borderWeight is 0", () => {
    const ctx = makeCtx();
    drawHexagon(
      ctx as unknown as CanvasRenderingContext2D,
      makeFeat(),
      makeMap() as unknown as L.Map,
      0,
      "#000000",
    );
    expect(ctx.fill).toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();
  });

  it("skips the stroke when CONF.border_opacity is absent or 0", () => {
    Object.assign(window.CONF, { border_opacity: 0 });
    const ctx = makeCtx();
    drawHexagon(
      ctx as unknown as CanvasRenderingContext2D,
      makeFeat(),
      makeMap() as unknown as L.Map,
      2,
      "#000000",
    );
    expect(ctx.fill).toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();
  });

  it("falls back to GRAY fill when the feature has no fillColor", () => {
    const ctx = makeCtx();
    drawHexagon(
      ctx as unknown as CanvasRenderingContext2D,
      makeFeat({ properties: { centroid: null, value: 42 } }),
      makeMap() as unknown as L.Map,
      0,
      "#000000",
    );
    expect(ctx.fillStyle).toBe(CONST.GRAY);
  });
});

describe("resolveLabelStyle", () => {
  it("overlays runtime size/color on the shared token defaults", () => {
    const ctrl = document.createElement("div");
    const style = resolveLabelStyle(ctrl, 14, "#123456");
    expect(style.fontSize).toBe(14);
    expect(style.font).toContain("14px");
    expect(style.color).toBe("#123456");
    // Token defaults still apply for the pieces the runtime does not override.
    expect(style.haloColor).toBe("rgba(0, 0, 0, 0.75)");
  });
});

describe("drawHexLabel", () => {
  beforeEach(() => {
    Object.assign(window.CONF, { locale_code: "en" });
  });

  it("strokes the halo then fills the value at the centroid", () => {
    const ctx = makeCtx();
    const style = resolveLabelStyle(document.createElement("div"), 14, "#123456");
    drawHexLabel(
      ctx as unknown as CanvasRenderingContext2D,
      makeFeat(),
      style,
      makeMap() as unknown as L.Map,
      "auto",
    );
    expect(ctx.strokeText).toHaveBeenCalledWith("42", 100, 200);
    expect(ctx.fillText).toHaveBeenCalledWith("42", 100, 200);
  });

  it("skips a feature without a centroid", () => {
    const ctx = makeCtx();
    const style = resolveLabelStyle(document.createElement("div"), 14, "#123456");
    drawHexLabel(
      ctx as unknown as CanvasRenderingContext2D,
      makeFeat({ properties: { centroid: null, value: 7 } }),
      style,
      makeMap() as unknown as L.Map,
      "auto",
    );
    expect(ctx.strokeText).not.toHaveBeenCalled();
    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  it("formats a missing value as 0", () => {
    const ctx = makeCtx();
    const style = resolveLabelStyle(document.createElement("div"), 14, "#123456");
    drawHexLabel(
      ctx as unknown as CanvasRenderingContext2D,
      makeFeat({ properties: { centroid: [26.08, 119.3] } }),
      style,
      makeMap() as unknown as L.Map,
      "auto",
    );
    expect(ctx.strokeText).toHaveBeenCalledWith("0", 100, 200);
  });
});
