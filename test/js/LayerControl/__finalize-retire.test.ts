import { describe, expect, it, vi } from "vitest";
import { initFixture } from "./ui/fixture.js";

describe("retireEntry finalization", () => {
  it("unloads the annotation even when the row step throws", () => {
    document.body.innerHTML = "";
    window.localStorage.clear();
    const { manager, ui } = initFixture({
      data: [
        { id: "overlay1", name: "Polygons", group: "overlay" },
        { id: "base1", name: "OSM", group: "base" },
      ],
    });
    const unload = vi.spyOn(manager.annotation, "unloadLayer");
    const container = (ui as unknown as { uiContainer: HTMLElement }).uiContainer;
    const original = container.querySelector.bind(container);
    let armed = true;
    container.querySelector = ((sel: string) => {
      if (armed && String(sel).includes("data-layer-id")) {
        armed = false;
        throw new Error("panel read failed");
      }
      return original(sel);
    }) as typeof container.querySelector;

    expect(() => manager.unregisterLayer("overlay1")).toThrow("panel read failed");
    expect(unload.mock.calls.some(c => c[0] === "overlay1")).toBe(true);
    expect(manager.layerRegistry.has("overlay1")).toBe(false);
  });
});
