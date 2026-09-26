import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isStyleSetter,
  pinStyleOnHighlight,
} from "#foliplus/LayerControl/ui/style/pin.js";

const makeLeaf = () => {
  let handler: (() => void) | null = null;
  return {
    leaf: {
      options: {} as Record<string, unknown>,
      setStyle: vi.fn(function (
        this: { options: Record<string, unknown> },
        s: Record<string, unknown>,
      ) {
        Object.assign(this.options, s);
      }),
      on: vi.fn((_type: string, fn: () => void) => {
        handler = fn;
      }),
    },
    fire: () => handler?.(),
  };
};

describe("pinStyleOnHighlight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("registers one mouseout handler per leaf; distinct getters stack and merge", () => {
    const { leaf, fire } = makeLeaf();
    const fillGetter = () => ({ fillColor: "#123456" });
    const borderGetter = () => ({ color: "#ffffff" });
    pinStyleOnHighlight(leaf, fillGetter);
    pinStyleOnHighlight(leaf, borderGetter);

    // One handler regardless of how many dimensions stack.
    expect(leaf.on).toHaveBeenCalledTimes(1);
    fire();
    expect(leaf.setStyle).toHaveBeenLastCalledWith({
      fillColor: "#123456",
      color: "#ffffff",
    });
  });

  it("idempotent for the same getter object", () => {
    const { leaf } = makeLeaf();
    const g = () => ({ fillColor: "#123456" });
    pinStyleOnHighlight(leaf, g);
    pinStyleOnHighlight(leaf, g);
    expect(leaf.on).toHaveBeenCalledTimes(1);
  });

  it("reapplies the user's style on mouseout", () => {
    const { leaf, fire } = makeLeaf();
    pinStyleOnHighlight(leaf, () => ({ fillColor: "#123456", fillOpacity: 0.4 }));

    fire();

    expect(leaf.setStyle).toHaveBeenCalledWith({
      fillColor: "#123456",
      fillOpacity: 0.4,
    });
    expect(leaf.options.fillColor).toBe("#123456");
  });

  it("skips the write when getStyle returns null (Reset keeps the author's value)", () => {
    const { leaf, fire } = makeLeaf();
    pinStyleOnHighlight(leaf, () => null);

    fire();

    expect(leaf.setStyle).not.toHaveBeenCalled();
  });

  it("reads the style live on every fire, not once at pin time", () => {
    const { leaf, fire } = makeLeaf();
    let current: Record<string, unknown> | null = { fillColor: "#111111" };
    pinStyleOnHighlight(leaf, () => current);

    fire();
    current = { fillColor: "#222222" };
    fire();

    expect(leaf.setStyle).toHaveBeenLastCalledWith({ fillColor: "#222222" });
  });

  it("no-ops for a leaf without an event channel", () => {
    const leaf = { setStyle: vi.fn() };
    expect(() =>
      pinStyleOnHighlight(leaf, () => ({ fillColor: "#123456" })),
    ).not.toThrow();
    expect(leaf.setStyle).not.toHaveBeenCalled();
  });

  it("isStyleSetter narrows on the presence of setStyle", () => {
    expect(isStyleSetter({ setStyle: vi.fn() })).toBe(true);
    expect(isStyleSetter({})).toBe(false);
    expect(isStyleSetter(null)).toBe(false);
  });
});
