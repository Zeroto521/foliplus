import { describe, expect, it, vi } from "vitest";
import { LayerRegistry } from "#core/layer/index.js";
import type { LayerInfo, RegisterLayerOpts } from "#core/layer/index.js";

// Compile-time contract for the layer type model.
//
// `RegisterLayerOpts` and `LayerInfo` used to close with
// `[key: string]: unknown`, which made both open records. That masked two
// distinct classes of caller error, and neither was recoverable at runtime
// because `createLayerInfo` copies fields one by one:
//
//   1. A misspelled key (`iconSVG`) — ignored, so the layer registered and
//      its type icon rendered empty.
//   2. A wrong value type (`visible: "yes"`) — an index signature accepts any
//      value at any declared key, so this compiled too. It is the worse of the
//      two: no exception is thrown, the layer just behaves unexpectedly.
//
// Each `@ts-expect-error` below fails the build if it stops resolving to an
// error (TS2578), which is what proves the closure is load-bearing. A plain
// assertion on `undefined` would go green again the moment an escape is
// restored, so it cannot stand in for these directives.
//
// The runtime assertions in this file exist to document how bad the type hole
// is — `createLayerInfo` performs no validation, so at runtime both escapes
// produce a plausible-looking result. The compile-time barrier is the only
// thing standing between a caller and those values.
describe("RegisterLayerOpts", () => {
  const make = () => new LayerRegistry([], null);

  it("rejects a misspelled key", () => {
    // @ts-expect-error iconSVG is a typo of iconSvg and must not compile
    const bad = make().createLayerInfo({ id: "l1", iconSVG: "<svg></svg>" });

    // @ts-expect-error an unknown key is not a valid option
    const alsoBad = make().createLayerInfo({ id: "l1", isVisible: true });

    // `createLayerInfo` only reads the keys it names, so the payload the caller
    // got wrong is simply absent from the result.
    expect(bad.iconSvg).toBeNull();
    expect(alsoBad.iconSvg).toBeNull();
  });

  it("rejects a declared key with the wrong value type", () => {
    // The whole point of typing opts rather than accepting unknown: a truthy
    // garbage value must not be admissible where a boolean is expected.
    // @ts-expect-error visible is boolean | undefined
    const bad = make().createLayerInfo({ id: "l1", visible: "yes" });

    // @ts-expect-error subPanes is string[]
    const notArray = make().createLayerInfo({ id: "l1", subPanes: "pane" });

    // @ts-expect-error isBase is boolean
    const notBool = make().createLayerInfo({ id: "l1", isBase: "true" });

    // createLayerInfo runs `opts.x ?? existing ?? default` with no type check,
    // so garbage at a declared key lands in the registry verbatim. This is
    // what callers are protected from by the type alone.
    expect(bad.visible).toBe("yes");
    expect(notArray.subPanes).toBe("pane");
    expect(notBool.isBase).toBe("true");
  });

  it("accepts every declared field at its declared type", () => {
    const layer = { options: {} } as unknown as L.Layer;
    const onToggle = vi.fn();
    const featureCountProvider = () => 3;
    const getBounds = () => null;

    // A well-formed payload must compile untouched — closing the record must
    // not force callers to cast or drop fields. parseSVG round-trips this as
    // an SVG node and back, so assert on content rather than an exact echo.
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">' +
      '<rect x="0" y="0" width="16" height="16"/></svg>';

    const opts: RegisterLayerOpts = {
      id: "l1",
      name: "L1",
      layer,
      isBase: false,
      paneName: "myPane",
      subPanes: ["a", "b"],
      iconSvg: svg,
      visible: false,
      canvas: null,
      onToggle,
      onZIndex: () => {},
      featureCountProvider,
      getBounds,
      source: "data.csv",
      updatedAt: 123,
      meta: { count: 4, unit: "rows" },
    };

    const info = make().createLayerInfo(opts);

    expect(info).toMatchObject({
      id: "l1",
      name: "L1",
      isBase: false,
      paneName: "myPane",
      subPanes: ["a", "b"],
      visible: false,
      source: "data.csv",
      updatedAt: 123,
      meta: { count: 4, unit: "rows" },
    });
    expect(info.layer).toBe(layer);
    expect(info.onToggle).toBe(onToggle);
    expect(info.featureCountProvider).toBe(featureCountProvider);
    expect(info.getBounds).toBe(getBounds);
    expect(info.iconSvg).toContain("<rect");
  });
});

// Read side: `LayerInfo` is the read-only registry snapshot. If it were open,
// a component could read a field the registry never sets and receive
// `undefined` without a diagnostic.
describe("LayerInfo", () => {
  it("exposes only fields the registry populates", () => {
    const li = new LayerRegistry([{ id: "l1", name: "L1" }], null).at(0);

    // @ts-expect-error unknown properties are not part of LayerInfo
    const unknown = li.anythingGoes;

    expect(Object.keys(li)).toEqual(
      expect.arrayContaining(["id", "name", "iconSvg", "subPanes"]),
    );
    expect(unknown === undefined).toBe(true);
  });

  it("cannot be widened with an unknown key", () => {
    const li = new LayerRegistry([{ id: "l1", name: "L1" }], null).at(0);

    const widened: LayerInfo = {
      ...li,
      // @ts-expect-error an untyped hole in LayerInfo would let this through
      anythingGoes: "survives",
    };

    // Excess-property checking only applies to object literals, so the extra
    // key is a compile error here but survives at runtime. The assertion
    // documents that the model gained nothing: the spread is the whole
    // surface, and the rogue key is the sole deviation.
    expect(Object.keys(widened)).toEqual([...Object.keys(li), "anythingGoes"]);
  });
});
