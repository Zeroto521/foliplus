import { beforeEach, describe, expect, it, vi } from "vitest";
import { bindOpenOverlay } from "#foliplus/MeasureControl/ui/helper.js";
import * as UI from "#foliplus/MeasureControl/ui/index.js";
import { installStubs } from "./fixture.js";

beforeEach(() => {
  installStubs();
});

describe("resortLayers", () => {
  const makeLayers = () => ({
    addLayer: vi.fn(l => l),
    removeLayer: vi.fn(),
  });

  const makeLayer = (id: string) => ({ _id: id, on: vi.fn() }) as L.Layer;

  it("removes then re-adds all layers in each collection", () => {
    const layers = makeLayers();
    const a = makeLayer("a");
    const b = makeLayer("b");

    UI.resortLayers(layers, [a, b]);

    expect(layers.removeLayer).toHaveBeenCalledTimes(2);
    expect(layers.addLayer).toHaveBeenCalledTimes(2);
  });

  it("processes collections in order", () => {
    const layers = makeLayers();
    const first = makeLayer("first");
    const second = makeLayer("second");

    UI.resortLayers(layers, [first], [second]);

    const callOrder = [
      ...layers.removeLayer.mock.calls.map(c => c[0]._id),
      ...layers.addLayer.mock.calls.map(c => c[0]._id),
    ];
    expect(callOrder).toEqual(["first", "second", "first", "second"]);
  });

  it("handles multiple collections of multiple layers", () => {
    const layers = makeLayers();
    const a = makeLayer("a");
    const b = makeLayer("b");
    const c = makeLayer("c");

    UI.resortLayers(layers, [a, b], [c]);

    expect(layers.removeLayer).toHaveBeenCalledTimes(3);
    expect(layers.addLayer).toHaveBeenCalledTimes(3);
  });
});

describe("bindOpenOverlay", () => {
  it("fires openOverlay on non-delete-icon clicks", () => {
    const layer = { on: vi.fn() } as any;
    const openOverlay = vi.fn();

    bindOpenOverlay(layer, openOverlay);

    const handler = layer.on.mock.calls.find((c: any[]) => c[0] === "click")?.[1];
    handler({ originalEvent: { target: null } });

    expect(openOverlay).toHaveBeenCalledTimes(1);
  });

  it("ignores clicks on the delete-icon (attachDelClick owns those)", () => {
    const layer = { on: vi.fn() } as any;
    const openOverlay = vi.fn();

    bindOpenOverlay(layer, openOverlay);

    const handler = layer.on.mock.calls.find((c: any[]) => c[0] === "click")?.[1];
    handler({
      originalEvent: {
        target: { closest: () => ({}) },
      },
    });

    expect(openOverlay).not.toHaveBeenCalled();
  });
});
