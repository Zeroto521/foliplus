// Unit tests for originalColor — the read-only "Original colors" bar.
//
// The bar's shape is one pure function of the stops and the (optional) scale:
// a paired scale keeps the author's shipped order (a stepped scale keeps its
// bands), a legend=False categorical layer sorts hue → lightness, and a
// legend=False continuous fallback variant (`{"kind": "continuous",
// "ordered": false}`) sorts lightness → hue, because its stops are discovery
// order, not domain order — a sequential ramp is lightness-monotonic.
import { describe, expect, it } from "vitest";
import {
  MAX_STOPS,
  originalGradient,
} from "#control/LayerControl/ui/style/originalColor.js";

/** The viridis extremes, deliberately handed in a bad order. Lightness rises
 *  dark purple (#440154, ~0.17) → teal (#21918c, ~0.35) → yellow (#fde725,
 *  ~0.57), so the discovery-order variant must rank them in exactly that order. */
const BAD_ORDER = ["#fde725", "#440154", "#21918c"];

describe("originalGradient", () => {
  it("returns an empty string when there are no stops", () => {
    expect(originalGradient([])).toBe("");
  });

  it("paints the single color when there is only one stop", () => {
    expect(originalGradient(["#ff0000"])).toBe("#ff0000");
  });

  it("keeps a paired continuous scale in shipped order", () => {
    const gradient = originalGradient(["#ff0000", "#00ff00", "#0000ff"], {
      kind: "continuous",
    });
    expect(gradient).toBe(
      "linear-gradient(90deg, #ff0000 0.00%, #00ff00 50.00%, #0000ff 100.00%)",
    );
  });

  it("keeps a paired stepped scale as hard bands", () => {
    const gradient = originalGradient(["#ff0000", "#00ff00", "#0000ff"], {
      kind: "stepped",
    });
    expect(gradient).toContain("#ff0000 0.00% 33.33%");
    expect(gradient).toContain("#00ff00 33.33% 66.67%");
    expect(gradient).toContain("#0000ff 66.67% 100.00%");
  });

  it("ranks a discovery-order continuous variant lightness → hue", () => {
    const gradient = originalGradient(BAD_ORDER, {
      kind: "continuous",
      ordered: false,
    });
    expect(gradient).toBe(
      "linear-gradient(90deg, #440154 0.00%, #21918c 50.00%, #fde725 100.00%)",
    );
  });

  it("is independent of input order for a discovery-order continuous variant", () => {
    const first = originalGradient(BAD_ORDER, { kind: "continuous", ordered: false });
    const second = originalGradient([...BAD_ORDER].reverse(), {
      kind: "continuous",
      ordered: false,
    });
    const third = originalGradient(["#21918c", "#fde725", "#440154"], {
      kind: "continuous",
      ordered: false,
    });
    expect(first).toBe(second);
    expect(first).toBe(third);
  });

  it("keeps shipped order when a scale is explicitly ordered", () => {
    const gradient = originalGradient(BAD_ORDER, {
      kind: "continuous",
      ordered: true,
    });
    expect(gradient).toBe(
      "linear-gradient(90deg, #fde725 0.00%, #440154 50.00%, #21918c 100.00%)",
    );
  });

  it("trusts shipped order by default (an absent ordered flag is the paired variant)", () => {
    const gradient = originalGradient(BAD_ORDER, { kind: "continuous" });
    expect(gradient).toContain("#fde725 0.00%");
    expect(gradient).toContain("#21918c 100.00%");
  });

  it("ranks a no-scale categorical layer hue → lightness", () => {
    // Hue order is yellow (~54°) → teal (~177°) → purple (~288°), which is
    // NOT the lightness order (purple → teal → yellow), so this pins the
    // categorical variant's own sort rather than the discovery variant's.
    const gradient = originalGradient(BAD_ORDER, null);
    expect(gradient).toBe(
      "linear-gradient(90deg, #fde725 0.00%, #21918c 50.00%, #440154 100.00%)",
    );
  });

  it("caps a long discovery-order variant at MAX_STOPS", () => {
    const stops = Array.from({ length: 30 }, (_, index) => {
      const channel = Math.round((index / 29) * 255)
        .toString(16)
        .padStart(2, "0");
      return `#${channel}${channel}${channel}`;
    });
    const gradient = originalGradient(stops, { kind: "continuous", ordered: false });
    const colors = gradient.match(/#[0-9a-f]{6}/g) ?? [];
    expect(colors.length).toBeLessThanOrEqual(MAX_STOPS);
  });
});
