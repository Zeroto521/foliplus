import { initFixture, polygonLayer } from "./ui/fixture.js";
import { beforeEach, describe, expect, it } from "vitest";
import { ROLE } from "#core/layer/index.js";
import * as CONST from "#control/LayerControl/const.js";
import { LayerController } from "#control/LayerControl/controller.js";
import type { LayerUI } from "#control/LayerControl/ui/index.js";

// Kill-units for the two folder-order invariants that hold only by comment
// today (design .foliplus/design/folder-order-systemic-audit.md section 4).
//
// Both drive the REAL delete path (controller.deleteLayer / deleteFolder)
// rather than the pure folderOrder functions, so what they pin is the ORDER
// of the write steps in a delete, not the shape of its result. The
// pure-function half of these invariants is already covered by
// test/js/core/layer/folderOrder.test.ts, which drives sectionOrder and
// freezeSectionOrder directly.
type FolderOrder = { version: 1; sections: Partial<Record<string, string[]>> };

/** The section order persisted to storage, or undefined when nothing was. */
const storedOverlayOrder = (): string[] | undefined => {
  const record = JSON.parse(window.localStorage.getItem(CONST.STORAGE.KEY) ?? "{}") as {
    folderOrder?: FolderOrder;
  };
  return record.folderOrder?.sections.overlay;
};

/** The section's live layers in registry order. The controller also owns a
 *  base-role color map, so the role filter matters more than the ids here. */
const overlayIds = (manager: LayerController): string[] =>
  manager.layers.filter(l => l.role === ROLE.OVERLAY).map(l => l.id);

/** The overlay rows the attached panel renders, in DOM order. */
const rowIds = (ui: LayerUI): string[] =>
  Array.from(ui.uiContainer!.querySelectorAll<HTMLElement>(CONST.SEL.LAYER_ITEM)).map(
    el => el.dataset.layerId ?? "",
  );

/** Three one-member folders A/B/C, in that order. */
const abcData = () =>
  [
    { id: "a1", name: "A", role: "overlay", folder: "A", layer: polygonLayer() },
    { id: "b1", name: "B", role: "overlay", folder: "B", layer: polygonLayer() },
    { id: "c1", name: "C", role: "overlay", folder: "C", layer: polygonLayer() },
  ] as const;

describe("folder order invariants (delete path)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.CONFIG = { ...window.CONFIG, name: "LayerControl", locale_code: "en" };
  });

  // Invariant 7 — the freeze runs BEFORE the last member leaves.
  it("freezes the section order from the pre-removal snapshot", () => {
    // A/B/C are three one-member folders. Deleting B's only member must
    // materialise the section's block order from the PRE-removal registry
    // snapshot, when B's block is still part of it.
    const { manager } = initFixture({ data: abcData() });

    expect(manager.deleteLayer("b1")).toBe(true);

    // B's key lands in the MIDDLE, in block order. This is the discriminator:
    // a freeze taken AFTER retireEntry would snapshot a registry without B and
    // answer ["a", "c", "b"] — freezeSectionOrder appends the empty key it
    // never saw — so the emptied folder's position would depend on when the
    // delete's steps run rather than on where the folder sat.
    expect(manager.folderOrder.sections.overlay).toEqual(["a", "b", "c"]);
    // The freeze is owed to the user, not just to memory: it leaves in the
    // same flush as the removal.
    expect(storedOverlayOrder()).toEqual(["a", "b", "c"]);

    // And it survives a reload. A fresh controller boots off the persisted
    // record with only A and C in the CONF; it must read the SAME frozen list
    // rather than re-derive A/C from their surviving anchors, which would drop
    // B's position and let a later new folder land between A and C — exactly
    // where the user's deleted folder used to sit.
    const reloaded = new LayerController(manager.map, [
      { id: "a1", name: "A", role: "overlay", folder: "A" },
      { id: "c1", name: "C", role: "overlay", folder: "C" },
    ]);
    expect(reloaded.folderOrder.sections.overlay).toEqual(["a", "b", "c"]);
    // The reloaded registry keeps A's and C's blocks in the frozen list order
    // (B's key has no live member, so it contributes no block).
    expect(overlayIds(reloaded)).toEqual(["a1", "c1"]);
  });

  // Invariant 6 — deleting a folder does not resort the surviving blocks.
  it("deleting a middle folder keeps the stored order of the rest", () => {
    // The stored order lists C first, A last, and carries the stale "empty"
    // key of a folder that lost its member earlier. That stale key is what
    // separates "filter one name out of the list" from "re-derive the
    // surviving blocks": an implementation that re-derives the list from the
    // live blocks answers ["c", "a"] — it drops a key nobody asked it to
    // drop and invents a new tail — and must go RED.
    const { manager, ui } = initFixture({
      seed: {
        folderOrder: { version: 1, sections: { overlay: ["c", "empty", "a"] } },
      },
      data: abcData(),
    });
    // Construction honours the stored order: C's block first, A's second, B
    // unlisted so it falls to the block tail.
    expect(overlayIds(manager)).toEqual(["c1", "a1", "b1"]);

    expect(manager.deleteFolder("overlay", "B")).toBe(true);

    // The list the delete leaves behind is the stored list with nothing else
    // touched: C stays first, the stale "empty" key of a folder that lost its
    // member earlier survives, and A keeps the slot the user gave it. That is
    // the whole point of the name filter — deleteFolderFromOrder must not
    // re-derive the surviving blocks from their anchors, which would answer
    // ["c", "a"] (or ["c", "b", "a"] if it also resorted the promoted
    // member) and silently reorder a folder arrangement the user made by hand.
    expect(manager.folderOrder.sections.overlay).toEqual(["c", "empty", "a"]);
    expect(storedOverlayOrder()).toEqual(["c", "empty", "a"]);
    // B's member is PROMOTED to root, never retired: the layer survives the
    // folder, so it renders after the folder blocks as a root row.
    const b1 = manager.layerRegistry.get("b1")!;
    expect(b1.folder).toBeNull();
    expect(overlayIds(manager)).toEqual(["c1", "a1", "b1"]);
    // The panel agrees with the registry: no resort, no re-derivation.
    expect(rowIds(ui).filter(id => ["a1", "b1", "c1"].includes(id))).toEqual([
      "c1",
      "a1",
      "b1",
    ]);
  });
});
