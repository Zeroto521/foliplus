// Guard: one row identity class. Every row the panel paints (layer / folder /
// group / role header) carries .foliplus-row, so a CSS rule that means "any
// row" can select on the identity instead of enumerating row kinds by hand.
// A new row kind that forgets the identity class fails here, the same way the
// role header's missing class let the menu's more-btn rule miss it.
import { initFixture } from "../control/LayerControl/ui/fixture.js";
import * as CONST from "#control/LayerControl/const.js";
import { describe, expect, it } from "vitest";

describe("row identity: every row kind carries .foliplus-row", () => {
  it("role header, folder row and layer row all carry the identity", () => {
    const { manager, ui } = initFixture({
      seed: { order: ["A", "rd1"] },
      seedLayout: {
        version: 2,
        folders: [{ key: "roads", name: "roads" }],
        order: { overlay: ["roads"] },
        members: { rd1: { role: "overlay", folder: "roads" } },
      },
      data: [
        { id: "A", name: "A", role: "overlay", folder: "", layer: { options: {} } },
      ],
    });
    manager.registerLayer({ id: "rd1", name: "Roads", role: "overlay" });

    const container = ui.uiContainer!;
    const roleRow = container.querySelector(".foliplus-layer-role");
    const folderRow = container.querySelector(".foliplus-layer-item-folder");
    const layerRow = container.querySelector('[data-layer-id="A"]');

    expect(roleRow).not.toBeNull();
    expect(folderRow).not.toBeNull();
    expect(layerRow).not.toBeNull();

    expect(roleRow!.classList.contains(CONST.CLASSES.ROW)).toBe(true);
    expect(folderRow!.classList.contains(CONST.CLASSES.ROW)).toBe(true);
    expect(layerRow!.classList.contains(CONST.CLASSES.ROW)).toBe(true);
  });
});
