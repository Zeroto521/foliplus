// Kill-test for the restore-author-layout footer button.
//
// The footer button (entry A4 of the folder-UI decisions) is the user-facing consumer of
// the folder-layout restore API. This test proves the button:
//   1. exists in the panel (below the layer rows, behind the section divider);
//   2. is disabled when the live layout already equals the author declaration
//      (seedFolderLayout(layers)) — nothing to restore;
//   3. is enabled once any folder operation diverges the layout from the seed;
//   4. restores the author layout on click (clears members/order, keeps the
//      name directory) and disables itself again.
import { attachedPanel, initFixture } from "../fixture.js";
import { beforeEach, describe, expect, it } from "vitest";
import { LAYOUT_DOC_KEY } from "#core/layer/index.js";
import * as CONST from "#control/LayerControl/const.js";

describe("restore-author-layout footer", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders the footer button below the rows, disabled when at the author layout", () => {
    // Author-declared folders: two overlay layers, one in "Roads".
    const { manager, ui } = initFixture({
      data: [
        { id: "a", name: "A", role: "overlay", folder: "Roads" },
        { id: "b", name: "B", role: "overlay" },
      ],
    });
    window.localStorage.removeItem(LAYOUT_DOC_KEY);

    const button = attachedPanel(ui).querySelector<HTMLButtonElement>(
      `.${CONST.CLASSES.RESTORE_AUTHOR_LAYOUT_BTN}`,
    );
    expect(button).not.toBeNull();
    // At the author seed: disabled.
    expect(button!.disabled).toBe(true);
    // The layout is the seed: member a → Roads, b → root.
    expect(manager.folderLayoutView.members.a).toEqual({
      role: "overlay",
      folder: "roads",
    });
    expect(manager.folderLayoutView.members.b).toBeUndefined();
  });

  it("enables the button after a user folder operation diverges the layout", () => {
    const { manager, ui } = initFixture({
      data: [
        { id: "a", name: "A", role: "overlay", folder: "Roads" },
        { id: "b", name: "B", role: "overlay" },
      ],
    });
    window.localStorage.removeItem(LAYOUT_DOC_KEY);

    const button = attachedPanel(ui).querySelector<HTMLButtonElement>(
      `.${CONST.CLASSES.RESTORE_AUTHOR_LAYOUT_BTN}`,
    );
    expect(button!.disabled).toBe(true);

    // Move b into a new folder → layout diverges from the author seed.
    manager.moveLayerToFolder("b", "overlay", "Parks");

    // The rebuild re-renders the footer; the button is now enabled.
    const after = attachedPanel(ui).querySelector<HTMLButtonElement>(
      `.${CONST.CLASSES.RESTORE_AUTHOR_LAYOUT_BTN}`,
    );
    expect(after!.disabled).toBe(false);
  });

  it("restores the author layout on click and disables itself", () => {
    const { manager, ui } = initFixture({
      data: [
        { id: "a", name: "A", role: "overlay", folder: "Roads" },
        { id: "b", name: "B", role: "overlay" },
      ],
    });
    window.localStorage.removeItem(LAYOUT_DOC_KEY);

    // Divergence: move b into a folder.
    manager.moveLayerToFolder("b", "overlay", "Parks");
    expect(manager.folderLayoutView.members.b).toEqual({
      role: "overlay",
      folder: "parks",
    });

    const button = attachedPanel(ui).querySelector<HTMLButtonElement>(
      `.${CONST.CLASSES.RESTORE_AUTHOR_LAYOUT_BTN}`,
    );
    expect(button!.disabled).toBe(false);
    button!.click();

    // The layout is back to the author seed. The core restore clears the
    // members map to {} (no user overrides); the effective assignment falls
    // back to the author declaration (folderOf reads layer.folder when the
    // layout has no member entry). So b's override is gone and a's effective
    // folder is the author's "Roads".
    const restored = manager.folderLayoutView;
    expect(restored.members.b).toBeUndefined();
    expect(restored.members.a).toBeUndefined();
    expect(manager.folderLayoutView.members).toEqual({});

    // The button disabled itself again (rebuild re-evaluated the predicate).
    const after = attachedPanel(ui).querySelector<HTMLButtonElement>(
      `.${CONST.CLASSES.RESTORE_AUTHOR_LAYOUT_BTN}`,
    );
    expect(after!.disabled).toBe(true);
  });

  it("no-ops when clicked at the author layout", () => {
    const { manager, ui } = initFixture({
      data: [
        { id: "a", name: "A", role: "overlay", folder: "Roads" },
        { id: "b", name: "B", role: "overlay" },
      ],
    });
    window.localStorage.removeItem(LAYOUT_DOC_KEY);

    const before = manager.folderLayoutView;
    const button = attachedPanel(ui).querySelector<HTMLButtonElement>(
      `.${CONST.CLASSES.RESTORE_AUTHOR_LAYOUT_BTN}`,
    );
    button!.click();

    // Nothing changed (still the author seed).
    expect(manager.folderLayoutView.members).toEqual(before.members);
    expect(manager.folderLayoutView.order).toEqual(before.order);
  });
});
