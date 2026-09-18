import { describe, expect, it } from "vitest";
import * as CONST from "#foliplus/LayerControl/const.js";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import { displayName } from "#foliplus/LayerControl/ui/list.js";

const makeUi = () =>
  ({
    renamedNames: {},
    m: { layerRegistry: { get: () => undefined } },
    T: (k: string) => k,
  }) as unknown as LayerUI;

describe("ui/list displayName", () => {
  it("resolves a registered/renamed id through the registry name", () => {
    const ui = {
      renamedNames: { a: "Renamed" },
      m: { layerRegistry: { get: () => ({ name: "Original" }) } },
      T: (k: string) => k,
    } as unknown as LayerUI;
    expect(displayName(ui, "a")).toBe("Renamed");
    expect(displayName(ui, "b")).toBe("Original");
  });

  it("labels the color basemap and falls back to empty for unknown ids", () => {
    const ui = makeUi();
    expect(displayName(ui, CONST.COLOR.MAP_ID)).toContain("color_map_label");
    expect(displayName(ui, "ghost")).toBe("");
  });
});
