import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  hasSetStyleLeaf,
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

describe("hasSetStyleLeaf", () => {
  it("returns false for a null node", () => {
    // The upstream walk guards nulls, but the helper itself must refuse a
    // null it is handed directly: calling into a null would otherwise throw
    // on the property read.
    expect(hasSetStyleLeaf(null)).toBe(false);
  });

  it("returns false for a node with neither a setter nor children", () => {
    // A bare options bag — the shape a Marker or a Group child without a
    // style axis takes — is refused by both axes.
    expect(hasSetStyleLeaf({ options: {} })).toBe(false);
  });

  it("returns true for a leaf that owns setStyle", () => {
    expect(hasSetStyleLeaf({ setStyle: () => {} })).toBe(true);
  });

  it("descends through a group to find a leaf", () => {
    const leaf: any = { setStyle: () => {} };
    const group: any = {
      options: {},
      eachLayer: (fn: (child: unknown) => void) => fn(leaf),
    };
    expect(hasSetStyleLeaf(group)).toBe(true);
  });

  it("descends through nested groups to find a leaf", () => {
    const leaf: any = { setStyle: () => {} };
    const inner: any = {
      options: {},
      eachLayer: (fn: (child: unknown) => void) => fn(leaf),
    };
    const outer: any = {
      options: {},
      eachLayer: (fn: (child: unknown) => void) => fn(inner),
    };
    expect(hasSetStyleLeaf(outer)).toBe(true);
  });

  it("returns false for an empty group", () => {
    const empty: any = {
      options: {},
      eachLayer: () => {},
    };
    expect(hasSetStyleLeaf(empty)).toBe(false);
  });

  it("returns false for an empty GeoJSON — own setStyle is not a carrier with no features", () => {
    // L.GeoJSON owns setStyle (which fans a style out to its features), so
    // a setter-only check stops there. The walk descends through eachLayer
    // anyway, so an empty GeoJSON returns false: the setStyle of its own
    // is not a real carrier when there is no feature behind it.
    const emptyGeo: any = {
      options: {},
      setStyle: () => {},
      eachLayer: () => {},
    };
    expect(hasSetStyleLeaf(emptyGeo)).toBe(false);
  });

  it("short-circuits at the first found leaf and skips recursing into the remaining children", () => {
    // eachLayer still dispatches every child, but the closure's
    // `if (!found)` guard means only the first leaf's setStyle is
    // actually checked: the walk's answer is already known and the rest
    // of the group is not walked.
    let setStyleChecks = 0;
    const leaf = {
      get setStyle() {
        setStyleChecks++;
        return () => {};
      },
    };
    const eachLayer = (fn: (child: unknown) => void) => {
      fn(leaf);
      fn(leaf);
    };
    const group: any = { options: {}, eachLayer };
    expect(hasSetStyleLeaf(group)).toBe(true);
    expect(setStyleChecks).toBe(1);
  });

  it("walks every child when none of them is a leaf", () => {
    const calls: number[] = [];
    const eachLayer = (fn: (child: unknown) => void) => {
      fn({ options: {} });
      calls.push(1);
      fn({ options: {} });
      calls.push(2);
    };
    const group: any = { options: {}, eachLayer };
    expect(hasSetStyleLeaf(group)).toBe(false);
    expect(calls).toEqual([1, 2]);
  });
});
