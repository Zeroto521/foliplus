// test/js/core/layer/paintObservation — the paint observation composition.
//
// Four facts decide what one observation reports: the factors that produced the
// verdict, the verdict itself (`paintProjection`, never a second AND), the drawn
// paint (`readLayerPaint`, never a second colour read), and the style snapshot's
// provenance (never a second source derivation). `resolvePaintOpacity` is the one
// opacity rule the panel and the attribution both call.
import { describe, expect, it, vi } from "vitest";
import {
  type LayerStyleSnapshot,
  type VisibilityFactors,
  observePaint,
  resolvePaintOpacity,
} from "#core/layer/index.js";

/** A Marker stand-in for the paint read (`instanceof L.Marker`). */
class Marker {
  options: Record<string, unknown>;

  constructor(options: Record<string, unknown> = {}) {
    this.options = options;
  }

  setIcon = () => this;
}

const markerOf = (iconOptions: Record<string, unknown>) =>
  new Marker({ icon: { options: iconOptions } });

/** An areal leaf: a `setStyle` carrier with a radius geometry. */
const arealOf = (options: Record<string, unknown>) => ({
  options,
  setStyle: () => undefined,
  getRadius: () => 5,
});

/** A group stand-in: `walkLeaf` descends anything with `eachLayer`. */
const groupOf = (...children: unknown[]) => ({
  eachLayer: (fn: (child: unknown) => void) => {
    for (const child of children) fn(child);
  },
});

const factorsOf = (over: Partial<VisibilityFactors> = {}): VisibilityFactors => ({
  declared: true,
  container: true,
  zoom: true,
  opacity: true,
  filter: true,
  ancestor: true,
  ...over,
});

const snapshotOf = (provenance: Record<string, string>): LayerStyleSnapshot =>
  ({ id: "layer", provenance }) as unknown as LayerStyleSnapshot;

describe("observePaint", () => {
  it("composes the verdict through paintProjection", () => {
    const layer = groupOf(arealOf({}));
    expect(observePaint({ factors: factorsOf(), layer, style: null }).paints).toBe(
      true,
    );
    expect(
      observePaint({ factors: factorsOf({ opacity: false }), layer, style: null })
        .paints,
    ).toBe(false);
    expect(
      observePaint({ factors: factorsOf({ zoom: false }), layer, style: null }).paints,
    ).toBe(false);
  });

  it("invents no verdict when the caller could not gather the factors", () => {
    const obs = observePaint({
      factors: null,
      layer: groupOf(arealOf({ fillColor: "#FF0000" })),
      style: null,
    });
    expect(obs.factors).toBeNull();
    expect(obs.paints).toBe(false);
    // The drawn paint is still read: values do not depend on the verdict.
    expect(obs.paint.color).toBe("#ff0000");
  });

  it("reads the drawn paint once, through readLayerPaint", () => {
    const obs = observePaint({
      factors: factorsOf(),
      layer: groupOf(
        arealOf({ fillColor: "#123456", color: "#ABCDEF", fillOpacity: 0.5 }),
      ),
      style: null,
    });
    expect(obs.paint.kind).toBe("areal");
    expect(obs.paint.color).toBe("#123456");
    expect(obs.paint.border).toBe("#abcdef");
    expect(obs.paint.opacity).toBe(0.5);
  });

  it("reports each channel source from the style snapshot", () => {
    const style = snapshotOf({
      fill: "user",
      border: "author",
      icon: "none",
      opacity: "declaration",
    });
    const obs = observePaint({
      factors: factorsOf(),
      layer: groupOf(arealOf({})),
      style,
    });
    expect(obs.style).toBe(style);
    expect(obs.source).toEqual({
      fill: "user",
      border: "author",
      icon: "none",
      opacity: "declaration",
    });
  });

  it("reports every channel none when no snapshot was read", () => {
    const obs = observePaint({
      factors: factorsOf(),
      layer: markerOf({}),
      style: null,
    });
    expect(obs.source).toEqual({
      fill: "none",
      border: "none",
      icon: "none",
      opacity: "none",
    });
  });
});

describe("resolvePaintOpacity", () => {
  it("lets a live focus paint at full strength", () => {
    const declared = vi.fn(() => 0.2);
    expect(
      resolvePaintOpacity({
        focused: true,
        intent: 0.4,
        declared,
        authorDefault: 0.6,
      }),
    ).toBe(1);
    expect(declared).not.toHaveBeenCalled();
  });

  it("prefers the user intent over every author input", () => {
    const declared = vi.fn(() => 0.2);
    expect(
      resolvePaintOpacity({
        focused: false,
        intent: 0.7,
        declared,
        authorDefault: 0.6,
      }),
    ).toBe(0.7);
    // The declaration parse is paid for only when the user has no value.
    expect(declared).not.toHaveBeenCalled();
  });

  it("parses the declaration before falling back to the registry default", () => {
    const declared = vi.fn(() => 0.2);
    expect(
      resolvePaintOpacity({
        focused: false,
        intent: undefined,
        declared,
        authorDefault: 0.6,
      }),
    ).toBe(0.2);
    expect(declared).toHaveBeenCalledTimes(1);
    expect(
      resolvePaintOpacity({
        focused: false,
        intent: undefined,
        declared: () => undefined,
        authorDefault: 0.6,
      }),
    ).toBe(0.6);
    expect(
      resolvePaintOpacity({
        focused: false,
        intent: undefined,
        declared: () => undefined,
        authorDefault: undefined,
      }),
    ).toBe(1);
  });
});
