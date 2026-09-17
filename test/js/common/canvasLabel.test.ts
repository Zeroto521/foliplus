// common/canvasLabel unit tests — the one canvas text recipe shared by the
// heatmap's hex values and LayerControl's annotation labels.
import { describe, expect, it, vi } from "vitest";
import {
  type CanvasLabelStyle,
  drawCanvasLabel,
  prepareCanvasLabel,
  resolveCanvasLabelStyle,
  withLabelPaint,
} from "#common/canvasLabel.js";

/** A container carrying the shared --label-* tokens (jsdom reads inline
 *  custom properties through getComputedStyle, the same way the real page
 *  inherits them from :root). */
const root = (vars: Record<string, string> = {}): HTMLElement => {
  const el = document.createElement("div");
  for (const [name, value] of Object.entries(vars)) {
    el.style.setProperty(name, value);
  }
  return el;
};

/** A recording 2D context — enough to observe what a draw writes. */
const ctx = () => ({
  font: "",
  textAlign: "",
  textBaseline: "",
  lineJoin: "",
  strokeStyle: "",
  lineWidth: 0,
  fillStyle: "",
  strokeText: vi.fn(),
  fillText: vi.fn(),
});

describe("resolveCanvasLabelStyle", () => {
  it("reads every token when the page defines it", () => {
    const style = resolveCanvasLabelStyle(
      root({
        "--label-font-family": "Georgia",
        "--label-font-size": "16",
        "--label-font-weight": "600",
        "--label-color": "#123456",
        "--label-halo-color": "rgba(1, 2, 3, 0.5)",
        "--label-halo-width": "5",
      }),
    );

    expect(style.font).toBe("600 16px Georgia");
    expect(style.color).toBe("#123456");
    expect(style.haloColor).toBe("rgba(1, 2, 3, 0.5)");
    expect(style.haloWidth).toBe(5);
  });

  it("falls back to the built-in defaults when no tokens are set", () => {
    const style = resolveCanvasLabelStyle(root());

    expect(style.font).toBe("bold 12px sans-serif");
    expect(style.color).toBe("#fff");
    expect(style.haloColor).toBe("rgba(0, 0, 0, 0.75)");
    expect(style.haloWidth).toBe(3);
  });

  it("falls back per-token when a numeric token is not numeric", () => {
    const style = resolveCanvasLabelStyle(
      root({ "--label-font-size": "abc", "--label-halo-width": "auto" }),
    );

    // A junk size must not parse to NaN and poison the font string.
    expect(style.font).toBe("bold 12px sans-serif");
    expect(style.haloWidth).toBe(3);
  });
});

describe("withLabelPaint", () => {
  it("overlays runtime color/size and rebuilds the font string", () => {
    const base = resolveCanvasLabelStyle(root());
    const painted = withLabelPaint(base, { color: "#ff0000", size: 18 });
    expect(painted.color).toBe("#ff0000");
    expect(painted.fontSize).toBe(18);
    expect(painted.font).toBe("bold 18px sans-serif");
    // Halo and family stay on the shared tokens.
    expect(painted.haloColor).toBe(base.haloColor);
    expect(painted.fontFamily).toBe(base.fontFamily);
  });

  it("leaves unspecified fields on the base style", () => {
    const base = resolveCanvasLabelStyle(root());
    const painted = withLabelPaint(base, { color: "#00ff00" });
    expect(painted.color).toBe("#00ff00");
    expect(painted.fontSize).toBe(base.fontSize);
    expect(painted.font).toBe(base.font);
  });
});

describe("prepareCanvasLabel", () => {
  it("applies the font and metrics to the context", () => {
    const c = ctx();
    const style: CanvasLabelStyle = {
      font: "bold 12px sans-serif",
      color: "#fff",
      haloColor: "rgba(0, 0, 0, 0.75)",
      haloWidth: 3,
    };

    prepareCanvasLabel(c as unknown as CanvasRenderingContext2D, style);

    expect(c.font).toBe("bold 12px sans-serif");
    expect(c.textAlign).toBe("center");
    expect(c.textBaseline).toBe("middle");
    expect(c.lineJoin).toBe("round");
  });
});

describe("drawCanvasLabel", () => {
  it("strokes the halo first, then fills the text", () => {
    const c = ctx();
    const style: CanvasLabelStyle = {
      font: "bold 12px sans-serif",
      color: "#fff",
      haloColor: "rgba(0, 0, 0, 0.75)",
      haloWidth: 3,
    };

    drawCanvasLabel(c as unknown as CanvasRenderingContext2D, "42", 10, 20, style);

    // The halo is the stroke pass, the text the fill pass — order matters:
    // filling first would let the halo paint over the glyphs.
    expect(c.strokeStyle).toBe("rgba(0, 0, 0, 0.75)");
    expect(c.lineWidth).toBe(3);
    expect(c.strokeText).toHaveBeenCalledWith("42", 10, 20);
    expect(c.fillStyle).toBe("#fff");
    expect(c.fillText).toHaveBeenCalledWith("42", 10, 20);
    expect(c.strokeText.mock.invocationCallOrder[0]).toBeLessThan(
      c.fillText.mock.invocationCallOrder[0]!,
    );
  });
});
