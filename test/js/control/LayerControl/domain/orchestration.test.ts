// test/js/control/LayerControl/domain/orchestration — attribution follows the paint
// observation, not a local zoom probe.
//
// The regression this pins: a base dragged to opacity 0 paints nothing, so its
// attribution string must leave the table with it. Before the paint observation
// `desiredAttribution` read only `paintsAtZoom`, so the hatch said no basemap
// while the attribution control still named the invisible base.
import { createLayerControllerFixture } from "../controller.fixture.js";
import { describe, expect, it } from "vitest";

interface OpacityStore {
  setRaw: (id: string, key: never, value: unknown) => void;
}

const setOpacity = (manager: { intentStore: OpacityStore }, opacity: number) => {
  manager.intentStore.setRaw("base1", "opacity" as never, opacity);
};

describe("desiredAttribution", () => {
  it("names the topmost base that is painting", () => {
    const { manager, map } = createLayerControllerFixture();
    map.hasLayer.mockReturnValue(true);
    expect(manager.desiredAttribution()).toBe("© OpenStreetMap");
  });

  it("drops the attribution when the base is at opacity 0", () => {
    const { manager, map } = createLayerControllerFixture();
    map.hasLayer.mockReturnValue(true);
    setOpacity(manager, 0);
    expect(manager.desiredAttribution()).toBe("");
  });

  it("keeps the attribution while the base still paints", () => {
    const { manager, map } = createLayerControllerFixture();
    map.hasLayer.mockReturnValue(true);
    setOpacity(manager, 0.5);
    expect(manager.desiredAttribution()).toBe("© OpenStreetMap");
  });

  it("drops the attribution when the base is off the map", () => {
    const { manager, map } = createLayerControllerFixture();
    map.hasLayer.mockReturnValue(false);
    expect(manager.desiredAttribution()).toBe("");
  });
});
