// Unit tests for HeatmapControl/render — the pure canvas draw helpers.
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/HeatmapControl/const.js";
import {
  drawHexLabel,
  drawHexagon,
  resolveLabelStyle,
} from "#foliplus/HeatmapControl/render.js";
import type { HexFeature } from "#foliplus/HeatmapControl/type.js";
import { getLayerAlpha, setLayerAlpha } from "#common/canvasAlpha.js";

const makeCtx = () => {
  const canvas = document.createElement("canvas");
  return {
    canvas,
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
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    measureText: vi.fn(() => ({ width: 10 })),
  };
};

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

  it("stacks declared fill/border opacity with layerAlpha (R11 multiply)", () => {
    // fill_opacity=0.7, border_opacity=0.9 from beforeEach; layerAlpha=0.5
    // → fill draws at 0.35, border at 0.45, then globalAlpha restores to 1.
    const ctx = makeCtx();
    setLayerAlpha(ctx.canvas, 0.5);
    const alphasDuring: number[] = [];
    ctx.fill = vi.fn(() => {
      alphasDuring.push(ctx.globalAlpha);
    });
    ctx.stroke = vi.fn(() => {
      alphasDuring.push(ctx.globalAlpha);
    });
    drawHexagon(
      ctx as unknown as CanvasRenderingContext2D,
      makeFeat(),
      makeMap() as unknown as L.Map,
      2,
      "#000000",
    );
    expect(alphasDuring).toHaveLength(2);
    expect(alphasDuring[0]).toBeCloseTo(0.35);
    expect(alphasDuring[1]).toBeCloseTo(0.45);
    expect(ctx.globalAlpha).toBe(1);
    // The layer alpha stays on the canvas for the next shape.
    expect(getLayerAlpha(ctx.canvas)).toBeCloseTo(0.5);
  });

  it("keeps declared fill_opacity semantics when layerAlpha is 1", () => {
    const ctx = makeCtx();
    const alphasDuring: number[] = [];
    ctx.fill = vi.fn(() => {
      alphasDuring.push(ctx.globalAlpha);
    });
    drawHexagon(
      ctx as unknown as CanvasRenderingContext2D,
      makeFeat(),
      makeMap() as unknown as L.Map,
      0,
      "#000000",
    );
    // fill_opacity=0.7 unchanged — the existing declaration contract.
    expect(alphasDuring[0]).toBeCloseTo(0.7);
    expect(ctx.globalAlpha).toBe(1);
  });

  it("falls back to 1 when CONF.fill_opacity is absent (branch cover)", () => {
    Object.assign(window.CONF, { fill_opacity: undefined, border_opacity: 0 });
    const ctx = makeCtx();
    const alphasDuring: number[] = [];
    ctx.fill = vi.fn(() => {
      alphasDuring.push(ctx.globalAlpha);
    });
    drawHexagon(
      ctx as unknown as CanvasRenderingContext2D,
      makeFeat(),
      makeMap() as unknown as L.Map,
      0,
      "#000000",
    );
    expect(alphasDuring[0]).toBe(1);
    expect(ctx.globalAlpha).toBe(1);
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
