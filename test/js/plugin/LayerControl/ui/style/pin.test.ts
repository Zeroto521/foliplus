import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FILL_OPT_IN,
  hasFillLeaf,
  hasSetStyleLeaf,
  isArealStyleLeaf,
} from "#core/layer/capability.js";
import {
  isStyleSetter,
  pinStyleOnHighlight,
  pinnedGetterCount,
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

  it("registers one mouseout handler per leaf; distinct keys stack and merge", () => {
    const { leaf, fire } = makeLeaf();
    const fillGetter = () => ({ fillColor: "#123456" });
    const borderGetter = () => ({ color: "#ffffff" });
    pinStyleOnHighlight(leaf, "fill", fillGetter);
    pinStyleOnHighlight(leaf, "border", borderGetter);

    // One handler regardless of how many dimensions stack.
    expect(leaf.on).toHaveBeenCalledTimes(1);
    fire();
    expect(leaf.setStyle).toHaveBeenLastCalledWith({
      fillColor: "#123456",
      color: "#ffffff",
    });
  });

  it("replaces the getter registered under the same key instead of stacking", () => {
    // Every apply pass builds a fresh closure, so identity dedupe never
    // matches — the key is the stable identity: re-registering "fill" swaps
    // the getter in place and the registry stays at one entry per key.
    const { leaf, fire } = makeLeaf();
    pinStyleOnHighlight(leaf, "fill", () => ({ fillColor: "#111111" }));
    pinStyleOnHighlight(leaf, "fill", () => ({ fillColor: "#222222" }));
    pinStyleOnHighlight(leaf, "fill", () => ({ fillColor: "#333333" }));

    expect(leaf.on).toHaveBeenCalledTimes(1);
    expect(pinnedGetterCount(leaf)).toBe(1);
    fire();
    expect(leaf.setStyle).toHaveBeenLastCalledWith({ fillColor: "#333333" });
  });

  it("reapplies the user's style on mouseout", () => {
    const { leaf, fire } = makeLeaf();
    pinStyleOnHighlight(leaf, "fill", () => ({
      fillColor: "#123456",
      fillOpacity: 0.4,
    }));

    fire();

    expect(leaf.setStyle).toHaveBeenCalledWith({
      fillColor: "#123456",
      fillOpacity: 0.4,
    });
    expect(leaf.options.fillColor).toBe("#123456");
  });

  it("skips the write when getStyle returns null (Reset keeps the author's value)", () => {
    const { leaf, fire } = makeLeaf();
    pinStyleOnHighlight(leaf, "fill", () => null);

    fire();

    expect(leaf.setStyle).not.toHaveBeenCalled();
  });

  it("reads the style live on every fire, not once at pin time", () => {
    const { leaf, fire } = makeLeaf();
    let current: Record<string, unknown> | null = { fillColor: "#111111" };
    pinStyleOnHighlight(leaf, "fill", () => current);

    fire();
    current = { fillColor: "#222222" };
    fire();

    expect(leaf.setStyle).toHaveBeenLastCalledWith({ fillColor: "#222222" });
  });

  it("no-ops for a leaf without an event channel", () => {
    const leaf = { setStyle: vi.fn() };
    expect(() =>
      pinStyleOnHighlight(leaf, "fill", () => ({ fillColor: "#123456" })),
    ).not.toThrow();
    expect(leaf.setStyle).not.toHaveBeenCalled();
  });

  it("pinnedGetterCount reports 0 for a leaf that was never pinned", () => {
    const { leaf } = makeLeaf();
    expect(pinnedGetterCount(leaf)).toBe(0);
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

describe("hasFillLeaf", () => {
  const { Polygon, Circle } = window.L;

  it("returns false for a null node", () => {
    expect(hasFillLeaf(null)).toBe(false);
  });

  it("the predicate itself rejects null and primitive nodes", () => {
    // hasFillLeaf short-circuits a null root before the walk starts, so the
    // guard is only reachable through the predicate - its defence for a
    // child an adapter reports as null.
    expect(isArealStyleLeaf(null)).toBe(false);
    expect(isArealStyleLeaf(undefined)).toBe(false);
    expect(isArealStyleLeaf("Polygon")).toBe(false);
  });

  it("returns false for a node with neither a setter nor children", () => {
    expect(hasFillLeaf({ options: {} })).toBe(false);
  });

  it("returns false for a leaf with setStyle that is not a Polygon or Circle", () => {
    expect(hasFillLeaf({ setStyle: () => {} })).toBe(false);
  });

  it("returns false for an empty group", () => {
    expect(hasFillLeaf({ options: {}, eachLayer: () => {} })).toBe(false);
  });

  it("returns true for a Polygon leaf with setStyle", () => {
    const leaf: any = Object.assign(new Polygon(), { setStyle: vi.fn() });
    expect(hasFillLeaf(leaf)).toBe(true);
  });

  it("returns true for a Circle leaf with setStyle", () => {
    const leaf: any = Object.assign(new Circle(), { setStyle: vi.fn() });
    expect(hasFillLeaf(leaf)).toBe(true);
  });

  it("returns true for a bare CircleMarker leaf with setStyle", () => {
    // Leaflet 1.x: Circle extends CircleMarker (not the reverse), so
    // `instanceof L.Circle` does NOT catch a bare CircleMarker. The probe
    // must admit CircleMarker itself — quickstart Facility Points are
    // exactly that face.
    const { CircleMarker } = window.L;
    const leaf: any = Object.assign(new (CircleMarker as any)([0, 0], {}), {
      setStyle: vi.fn(),
    });
    expect(hasFillLeaf(leaf)).toBe(true);
  });

  it("returns true when a CircleMarker is nested in a group", () => {
    const { CircleMarker } = window.L;
    const leaf: any = Object.assign(new (CircleMarker as any)([0, 0], {}), {
      setStyle: vi.fn(),
    });
    const group: any = {
      options: {},
      eachLayer: (fn: (child: unknown) => void) => fn(leaf),
    };
    expect(hasFillLeaf(group)).toBe(true);
  });

  it("returns true when a Polygon is nested in a group", () => {
    const leaf: any = Object.assign(new Polygon(), { setStyle: vi.fn() });
    const group: any = {
      options: {},
      eachLayer: (fn: (child: unknown) => void) => fn(leaf),
    };
    expect(hasFillLeaf(group)).toBe(true);
  });

  it("returns false when a Polyline is nested in a group", () => {
    const { Polyline } = window.L;
    const leaf = new Polyline();
    const group: any = {
      options: {},
      eachLayer: (fn: (child: unknown) => void) => fn(leaf),
    };
    expect(hasFillLeaf(group)).toBe(false);
  });

  it("returns true for a Polygon even when L.Circle is undefined", () => {
    const saved = window.L.Circle;
    delete (window.L as any).Circle;
    try {
      const leaf: any = Object.assign(new Polygon(), { setStyle: vi.fn() });
      expect(hasFillLeaf(leaf)).toBe(true);
    } finally {
      (window.L as any).Circle = saved;
    }
  });

  it("returns false for a non-Polygon leaf when L.Circle is undefined", () => {
    const saved = window.L.Circle;
    delete (window.L as any).Circle;
    try {
      expect(hasFillLeaf({ setStyle: () => {} })).toBe(false);
    } finally {
      (window.L as any).Circle = saved;
    }
  });

  it("rejects a MultiPolyline duck - nested coords are not evidence of an area", () => {
    // The shape that motivated the declaration-based probe: a MultiPolyline's
    // getLatLngs() returns rings exactly like a Polygon's, so nesting cannot
    // separate the two. Admitting it would put a line value in the ramp's
    // breaks and hand a line a fill it cannot render.
    const multi: any = {
      setStyle: vi.fn(),
      getLatLngs: () => [
        [
          { lat: 0, lng: 0 },
          { lat: 1, lng: 1 },
        ],
        [
          { lat: 2, lng: 2 },
          { lat: 3, lng: 3 },
        ],
      ],
    };
    expect(hasFillLeaf(multi)).toBe(false);
  });

  it("admits a MultiPolygon by declaration and rejects a MultiLineString", () => {
    expect(
      hasFillLeaf({
        setStyle: vi.fn(),
        feature: { geometry: { type: "MultiPolygon" } },
      }),
    ).toBe(true);
    expect(
      hasFillLeaf({
        setStyle: vi.fn(),
        feature: { geometry: { type: "MultiLineString" } },
        getLatLngs: () => [
          [
            { lat: 0, lng: 0 },
            { lat: 1, lng: 1 },
          ],
        ],
      }),
    ).toBe(false);
  });

  it("admits a Polygon with holes - the extra ring changes nothing", () => {
    expect(
      hasFillLeaf({
        setStyle: vi.fn(),
        feature: {
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [1, 0],
                [0, 1],
                [0, 0],
              ],
              [
                [0.3, 0.3],
                [0.7, 0.3],
                [0.3, 0.7],
                [0.3, 0.3],
              ],
            ],
          },
        },
      }),
    ).toBe(true);
  });

  it("accepts an explicit opt-in from a cross-realm or third-party path", () => {
    const vendorLeaf: any = { setStyle: vi.fn() };
    vendorLeaf[FILL_OPT_IN] = true;
    expect(hasFillLeaf(vendorLeaf)).toBe(true);
    // The same shape without the declaration is not fillable, whatever
    // coordinates it advertises.
    expect(hasFillLeaf({ setStyle: vi.fn(), getLatLngs: () => [] })).toBe(false);
  });

  it("finds an opted-in leaf nested in a group", () => {
    const vendorLeaf: any = { setStyle: vi.fn() };
    vendorLeaf[FILL_OPT_IN] = true;
    const group: any = {
      options: {},
      eachLayer: (fn: (child: unknown) => void) => fn(vendorLeaf),
    };
    expect(hasFillLeaf(group)).toBe(true);
  });

  it("reads the declaration from toGeoJSON when there is no feature envelope", () => {
    expect(
      hasFillLeaf({
        setStyle: vi.fn(),
        toGeoJSON: () => ({ type: "Feature", geometry: { type: "Polygon" } }),
      }),
    ).toBe(true);
    expect(
      hasFillLeaf({
        setStyle: vi.fn(),
        toGeoJSON: () => ({ type: "Feature", geometry: { type: "MultiLineString" } }),
      }),
    ).toBe(false);
  });

  it("treats a throwing toGeoJSON and an empty envelope as no declaration", () => {
    expect(
      hasFillLeaf({
        setStyle: vi.fn(),
        toGeoJSON: () => {
          throw new Error("no geometry");
        },
      }),
    ).toBe(false);
    expect(hasFillLeaf({ setStyle: vi.fn(), feature: {} })).toBe(false);
    expect(hasFillLeaf({ setStyle: vi.fn(), feature: { properties: { a: 1 } } })).toBe(
      false,
    );
  });
});

describe("capability probe - hostile third-party leaves", () => {
  // A third-party or cross-realm Path can be a class whose property
  // getters throw. Each read must be its own boundary: a hostile leaf
  // answers nothing, and the probe keeps looking at the next signal.
  const throwingLeaf = (keys: string[]) =>
    new Proxy({ setStyle: vi.fn() } as Record<PropertyKey, unknown>, {
      get(target, key) {
        if (keys.includes(String(key))) throw new Error("getter boom");
        return target[key];
      },
    });

  it("a throwing setStyle getter is no evidence of either capability", () => {
    expect(isArealStyleLeaf(throwingLeaf(["setStyle"]))).toBe(false);
    expect(hasSetStyleLeaf(throwingLeaf(["setStyle"]))).toBe(false);
  });

  it.each([
    ["getRadius", "getter boom"],
    ["feature", "getter boom"],
    ["toGeoJSON", "getter boom"],
    [FILL_OPT_IN, "getter boom"],
  ])("a throwing %s getter is treated as undeclared, not fatal", key => {
    expect(() => isArealStyleLeaf(throwingLeaf([key]))).not.toThrow();
    expect(isArealStyleLeaf(throwingLeaf([key]))).toBe(false);
  });

  it("falls through to the next signal when one getter throws", () => {
    // The feature envelope is hostile but the toGeoJSON declaration is not:
    // the probe must skip the broken read and keep looking, not give up.
    const leaf = new Proxy(
      {
        setStyle: vi.fn(),
        toGeoJSON: () => ({ type: "Feature", geometry: { type: "Polygon" } }),
      } as Record<PropertyKey, unknown>,
      {
        get(target, key) {
          if (key === "feature") throw new Error("getter boom");
          return target[key];
        },
      },
    );
    expect(isArealStyleLeaf(leaf)).toBe(true);
  });

  it("a Proxy whose every get throws is not fillable and does not throw", () => {
    const hostile = new Proxy(
      {},
      {
        get: () => {
          throw new Error("boom");
        },
      },
    );
    expect(() => isArealStyleLeaf(hostile)).not.toThrow();
    expect(isArealStyleLeaf(hostile)).toBe(false);
    expect(() => hasSetStyleLeaf(hostile)).not.toThrow();
    expect(hasSetStyleLeaf(hostile)).toBe(false);
  });

  it("a throwing feature.geometry getter is not a declaration", () => {
    // The envelope's owner reading cleanly is not enough: a real feature
    // object can carry its own throwing getter one level down.
    const feature = Object.defineProperty({}, "geometry", {
      get() {
        throw new Error("geometry boom");
      },
    });
    const leaf = { setStyle: vi.fn(), feature };
    expect(() => isArealStyleLeaf(leaf)).not.toThrow();
    expect(isArealStyleLeaf(leaf)).toBe(false);
  });

  it("a throwing feature.geometry.type getter is not a declaration", () => {
    const geometry = Object.defineProperty({}, "type", {
      get() {
        throw new Error("type boom");
      },
    });
    const leaf = { setStyle: vi.fn(), feature: { geometry } };
    expect(() => isArealStyleLeaf(leaf)).not.toThrow();
    expect(isArealStyleLeaf(leaf)).toBe(false);
  });

  it("falls through to toGeoJSON when only the feature envelope is hostile", () => {
    // Skip the broken branch and keep looking: one unreadable source must
    // not hide a declaration the other still carries.
    const leaf = {
      setStyle: vi.fn(),
      feature: Object.defineProperty({}, "geometry", {
        get() {
          throw new Error("geometry boom");
        },
      }),
      toGeoJSON: () => ({ type: "Feature", geometry: { type: "Polygon" } }),
    };
    expect(isArealStyleLeaf(leaf)).toBe(true);
  });

  it("a toGeoJSON envelope with a throwing type getter is not a declaration", () => {
    // The toGeoJSON source funnels through the same parser as feature, so
    // the shallow-read hole cannot reopen on one of them only.
    const leaf = {
      setStyle: vi.fn(),
      toGeoJSON: () => ({
        geometry: Object.defineProperty({}, "type", {
          get() {
            throw new Error("type boom");
          },
        }),
      }),
    };
    expect(() => isArealStyleLeaf(leaf)).not.toThrow();
    expect(isArealStyleLeaf(leaf)).toBe(false);
  });

  it("a hostile leaf does not abort the walk of its container", () => {
    // The point of per-read isolation: one hostile child must not strand the
    // healthy siblings in the same group.
    const healthy: any = { setStyle: vi.fn() };
    healthy[FILL_OPT_IN] = true;
    const group: any = {
      options: {},
      eachLayer: (fn: (child: unknown) => void) => {
        fn(throwingLeaf(["getRadius", "feature", "toGeoJSON", FILL_OPT_IN]));
        fn(healthy);
      },
    };
    expect(hasFillLeaf(group)).toBe(true);
    expect(hasSetStyleLeaf(group)).toBe(true);
  });
});
