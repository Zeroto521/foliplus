// LayerControl reorder path — the incremental row relocation the
// LAYER_LIST_REBUILD signal and the drag drop share. Pins the contract that
// made it incremental: one node moves per reorder (no rebuild, no repaint,
// no projection), the panel never leaves its settled state, and the full
// rebuild the fold path still takes is order-equivalent to it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS } from "#core/event/index.js";
import { GROUP } from "#core/layer/index.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import { type LayerController } from "#foliplus/LayerControl/controller.js";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import {
  getNavigableItems,
  rebuildList,
} from "#foliplus/LayerControl/ui/listPanel/index.js";
import { attachedPanel, initFixture } from "../fixture.js";

/** Layer rows for n overlays + m base maps, mirroring the bench shape. */
const benchData = (overlays: number, bases: number) => [
  ...Array.from({ length: overlays }, (_, i) => ({
    id: `overlay_${i}`,
    name: `Overlay ${i}`,
    group: "overlay" as const,
  })),
  ...Array.from({ length: bases }, (_, i) => ({
    id: `base_${i}`,
    name: `Base ${i}`,
    group: "base" as const,
  })),
];

/** Child sequence signature: layer rows by id, anchors by group. */
const childKeys = (ui: LayerUI) =>
  Array.from(attachedPanel(ui).children).map(
    el =>
      el.getAttribute(CONST.DATA.LAYER_ID) ?? `group:${el.getAttribute("data-group")}`,
  );

/** The panel sequence renderInitialList would emit for this registry: each
 *  group's anchor before its first row, rows in registry order. */
const registryKeys = (manager: LayerController): string[] => {
  const keys: string[] = [];
  let seenOverlay = false;
  let seenBase = false;
  for (const layerInfo of manager.layers) {
    if (layerInfo.group !== GROUP.BASE && !seenOverlay) {
      seenOverlay = true;
      keys.push(`group:${GROUP.OVERLAY}`);
    }
    if (layerInfo.group === GROUP.BASE && !seenBase) {
      seenBase = true;
      keys.push(`group:${GROUP.BASE}`);
    }
    keys.push(layerInfo.id);
  }
  return keys;
};

describe("ui/listPanel reorder — incremental row relocation", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("moves exactly one DOM node for a single-step reorder", () => {
    const { manager, ui } = initFixture({ data: benchData(8, 2) });
    const container = attachedPanel(ui);
    const insertBefore = vi.spyOn(container, "insertBefore");
    const childrenBefore = new Set(Array.from(container.children));

    expect(manager.moveLayerUp("overlay_4")).toBe(true);

    // One row relocated, everything else untouched: no node was created or
    // destroyed (rebuild would replace the whole child set).
    expect(insertBefore).toHaveBeenCalledTimes(1);
    expect(new Set(Array.from(container.children))).toEqual(childrenBefore);
    // overlay_4 swapped with its predecessor overlay_3 only.
    expect(childKeys(ui).slice(3, 6)).toEqual(["overlay_2", "overlay_4", "overlay_3"]);
    expect(childKeys(ui)).toEqual(registryKeys(manager));
  });

  it("relocates rows without rebuilding or re-projecting them", () => {
    const { manager, ui } = initFixture({ data: benchData(4, 2) });
    const row = attachedPanel(ui).querySelector(
      `[${CONST.DATA.LAYER_ID}="overlay_2"]`,
    ) as HTMLElement;
    const countCol = row.querySelector(CONST.SEL.COUNT_COL) as HTMLElement;
    countCol.textContent = "stale";
    const applyUserState = vi.spyOn(ui, "applyUserState");

    expect(manager.moveLayerUp("overlay_2")).toBe(true);

    // The same element survives with its content: no renderInitialList pass,
    // no projection sweep, no count repaint.
    expect(
      attachedPanel(ui).querySelector(`[${CONST.DATA.LAYER_ID}="overlay_2"]`),
    ).toBe(row);
    expect((row.querySelector(CONST.SEL.COUNT_COL) as HTMLElement).textContent).toBe(
      "stale",
    );
    expect(applyUserState).not.toHaveBeenCalled();
  });

  it("writes nothing when the panel already matches the registry", () => {
    const { ui } = initFixture({ data: benchData(5, 2) });
    const insertBefore = vi.spyOn(attachedPanel(ui), "insertBefore");

    // The signal is the only entry that runs the reconcile directly; an
    // in-order panel must cost zero DOM writes, twice over.
    ui.events.emit(EVENTS.LAYER_LIST_REBUILD);
    ui.events.emit(EVENTS.LAYER_LIST_REBUILD);

    expect(insertBefore).not.toHaveBeenCalled();
  });

  it("keeps group boundaries: a blocked move writes nothing and stays quiet", () => {
    const { manager, ui } = initFixture({ data: benchData(3, 2) });
    const insertBefore = vi.spyOn(attachedPanel(ui), "insertBefore");
    const rebuilds: number[] = [];
    ui.events.on(EVENTS.LAYER_LIST_REBUILD, () => rebuilds.push(1));
    const before = childKeys(ui);

    // Bottom overlay cannot sink into the base section; top overlay cannot
    // rise past the panel head; unknown ids are refused outright.
    expect(manager.moveLayerDown("overlay_2")).toBe(false);
    expect(manager.moveLayerUp("overlay_0")).toBe(false);
    expect(manager.moveLayerUp("nope")).toBe(false);

    expect(insertBefore).not.toHaveBeenCalled();
    expect(rebuilds).toHaveLength(0);
    expect(childKeys(ui)).toEqual(before);
  });

  it("keeps the keyboard cursor on the row that moved", () => {
    const { manager, ui } = initFixture({ data: benchData(4, 2) });
    const row = attachedPanel(ui).querySelector(
      `[${CONST.DATA.LAYER_ID}="overlay_2"]`,
    ) as HTMLElement;
    // Establish the cursor the way the panel does: DOM focus on the row and
    // the active index pointing at it.
    row.focus();
    ui.listPanel.activeIdx = getNavigableItems(ui).indexOf(row);
    row.classList.add(CONST.CLASSES.FOCUSED);

    expect(manager.moveLayerUp("overlay_2")).toBe(true);

    const items = getNavigableItems(ui);
    expect(items[ui.listPanel.activeIdx ?? -1]).toBe(row);
    expect(row.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);
    expect(document.activeElement).toBe(row);
    // The roving tab stop travels with the cursor row.
    expect(items.findIndex(el => el.tabIndex === 0)).toBe(
      items.indexOf(row as HTMLElement),
    );
  });

  it("never takes the panel out of its data-ready state", async () => {
    const { manager, ui } = initFixture({ data: benchData(4, 2) });
    const container = attachedPanel(ui);
    expect(container.getAttribute("data-ready")).toBe("true");

    const records: MutationRecord[] = [];
    const observer = new MutationObserver(rs => records.push(...rs));
    observer.observe(container, {
      attributes: true,
      attributeFilter: ["data-ready"],
      attributeOldValue: true,
    });

    manager.moveLayerUp("overlay_3");
    manager.moveLayerDown("overlay_3");
    await new Promise(resolve => setTimeout(resolve, 0));

    // The flag never came down mid-move: no record shows a removal.
    expect(
      records.filter(
        record =>
          record.attributeName === "data-ready" &&
          record.oldValue === "true" &&
          record.newValue === null,
      ),
    ).toEqual([]);
    expect(container.getAttribute("data-ready")).toBe("true");
    observer.disconnect();
  });

  it("survives a subscriber that unregisters the moved layer mid-CHANGE", () => {
    const { manager, ui } = initFixture({ data: benchData(3, 2) });
    const changes: string[] = [];
    ui.events.on(EVENTS.LAYER_CHANGE, payload => {
      changes.push(payload.id);
      if (payload.id === "overlay_1") manager.unregisterLayer("overlay_1");
    });

    expect(() => manager.moveLayerUp("overlay_1")).not.toThrow();

    // The move's own CHANGE, then the retirement's — and no third: the
    // second unregister inside that fan-out found nothing left to retire.
    expect(changes).toEqual(["overlay_1", "overlay_1"]);
    expect(
      attachedPanel(ui).querySelector(`[${CONST.DATA.LAYER_ID}="overlay_1"]`),
    ).toBeNull();
    expect(childKeys(ui)).toEqual(registryKeys(manager));
  });

  it("survives a subscriber that re-registers the same id mid-CHANGE", () => {
    const { manager, ui } = initFixture({ data: benchData(3, 2) });
    let replaced = false;
    ui.events.on(EVENTS.LAYER_CHANGE, payload => {
      if (payload.id === "overlay_1" && !replaced) {
        replaced = true;
        manager.unregisterLayer("overlay_1");
        manager.registerLayer({ id: "overlay_1", name: "Overlay 1 again" });
      }
    });

    expect(() => manager.moveLayerUp("overlay_1")).not.toThrow();

    // The replacement owns the row: present, and the panel order still
    // tracks the registry.
    expect(
      attachedPanel(ui).querySelector(`[${CONST.DATA.LAYER_ID}="overlay_1"]`),
    ).not.toBeNull();
    expect(childKeys(ui)).toEqual(registryKeys(manager));
  });

  it("an up-then-down round restores the order and the persisted record", () => {
    const { manager, ui } = initFixture({ data: benchData(5, 2) });
    const orderBefore = childKeys(ui);
    const registryBefore = manager.layers.map(l => l.id);

    manager.moveLayerUp("overlay_3");
    manager.moveLayerDown("overlay_3");

    expect(childKeys(ui)).toEqual(orderBefore);
    // saveOrder snapshots on every user reorder — flush the debounced write
    // and compare the record with the live registry.
    (
      manager as unknown as { persistence: { flushAll(): void } }
    ).persistence.flushAll();
    const record = JSON.parse(
      window.localStorage.getItem(CONST.STORAGE.KEY) ?? "{}",
    ) as { order?: string[] };
    expect(record.order).toEqual(manager.layers.map(l => l.id));
    expect(record.order).toEqual(registryBefore);
  });

  it("brings an overlay to the panel head without rebuilding the rows", () => {
    const { manager, ui } = initFixture({ data: benchData(4, 2) });
    const childrenBefore = new Set(Array.from(attachedPanel(ui).children));
    const insertBefore = vi.spyOn(attachedPanel(ui), "insertBefore");

    manager.bringLayerToFront("overlay_3");

    // Longest overlay move: the row lands right under the overlay anchor.
    expect(insertBefore).toHaveBeenCalledTimes(1);
    expect(new Set(Array.from(attachedPanel(ui).children))).toEqual(childrenBefore);
    expect(childKeys(ui)[0]).toBe("group:overlay");
    expect(childKeys(ui)[1]).toBe("overlay_3");
  });

  it("agrees with the full rebuild on every shuffled order it produced", () => {
    // Deterministic shuffle: 40 seeded single-step moves over 10 overlays +
    // 2 bases, checking DOM == registry after each move, then one full
    // rebuild (the fold path's) must land on exactly the same arrangement.
    // The 41 assertion rounds stretch past the default 5s test budget when
    // the whole suite's workers compete for the machine.
    const { manager, ui } = initFixture({ data: benchData(10, 2) });
    let seed = 0x2f6e2b1;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x1_0000_0000;
    };
    const overlays = () => manager.layers.filter(l => l.group === GROUP.OVERLAY);
    const bases = () => manager.layers.filter(l => l.group === GROUP.BASE);

    for (let step = 0; step < 40; step++) {
      const pool = rand() < 0.7 ? overlays() : bases();
      const pick = pool[Math.floor(rand() * pool.length)];
      expect(childKeys(ui)).toEqual(registryKeys(manager));
      if (rand() < 0.5) manager.moveLayerUp(pick.id);
      else manager.moveLayerDown(pick.id);
    }
    expect(childKeys(ui)).toEqual(registryKeys(manager));

    const incremental = childKeys(ui);
    const elements = new Set(Array.from(attachedPanel(ui).children));
    rebuildList(ui);
    expect(childKeys(ui)).toEqual(incremental);
    // The rebuild re-created the rows; the incremental pass had preserved
    // them — both hold the same arrangement either way.
    expect(new Set(Array.from(attachedPanel(ui).children))).not.toEqual(elements);
  }, 60_000);

  it("keeps a 200-layer reorder round in the millisecond range", () => {
    // Loose gate, not a stopwatch: the rebuild path cost ~4.4s for this
    // round in the same environment, while the incremental path measures
    // ~45ms standalone — and roughly 4× that when the whole suite's workers
    // compete for the machine, which is why the gate sits at 300ms. If a
    // regression reintroduces a per-move full rebuild, this still trips an
    // order of magnitude below the old cost. The timeout covers the
    // fixture's own attach sweep (the content-path scan, not the reorder),
    // which costs seconds at n=200 and more under a loaded CI.
    const { manager } = initFixture({ data: benchData(198, 2) });
    const target = "overlay_99";

    const start = performance.now();
    manager.moveLayerUp(target);
    manager.moveLayerDown(target);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(300);
  }, 120_000);
});
