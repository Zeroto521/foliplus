// test/js/control/LayerControl/ui/style/list.sync — incremental reorder.
import { attachedPanel, initFixture } from "../fixture.js";
import {
  benchData,
  childKeys,
  cursorLedger,
  refusesHiddenFocus,
  registryKeys,
  rowOf,
} from "./list.fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS } from "#core/event/index.js";
import { type LayerInfo, ROLE, orderKeyOf } from "#core/layer/index.js";
import * as CONST from "#control/LayerControl/const.js";
import { type LayerController } from "#control/LayerControl/controller.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";
import {
  getNavigableItems,
  rebuildList,
  reconcileCursorByIdentity,
  syncRowOrder,
  toggleFold,
} from "#control/LayerControl/ui/listPanel/index.js";

// Suite-level timeout: every case here builds a panel fixture, and jsdom
// attach sweeps stretch past the default 5s when the whole suite's workers
// compete for the machine.
// The order doc's root-layer sequence (parent null) in rank order, read
// from the order's own key; the record no longer carries an order field.
const orderDocRoots = (map: any): string[] => {
  const raw = window.localStorage.getItem(orderKeyOf(map));
  if (!raw) return [];
  const doc = JSON.parse(raw) as { nodes?: Record<string, any> };
  return Object.entries(doc.nodes ?? {})
    .filter(([, n]) => n.parent === null && n.kind === "layer")
    .sort((a, b) => (a[1].rank as string).localeCompare(b[1].rank as string))
    .map(([k]) => k.replace(/^layer:/, ""));
};
describe("ui/list syncRowOrder — incremental reorder", { timeout: 30_000 }, () => {
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

    // Bottom overlay cannot sink into the base role; top overlay cannot
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
    expect(items.findIndex(el => el.tabIndex === 0)).toBe(items.indexOf(row));
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

    // The flag never came down mid-move: no record shows a removal. The
    // current value is read off the target — MutationRecord.newValue is not
    // in the DOM typings the test typecheck builds against.
    expect(
      records.filter(
        record =>
          record.attributeName === "data-ready" &&
          record.oldValue === "true" &&
          (record.target as Element).getAttribute("data-ready") === null,
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
    const { manager, ui, map } = initFixture({ data: benchData(5, 2) });
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
    expect(orderDocRoots(map)).toEqual(manager.layers.map(l => l.id));
    expect(orderDocRoots(map)).toEqual(registryBefore);
  });

  it("brings an overlay to the panel head without rebuilding the rows", () => {
    const { manager, ui } = initFixture({ data: benchData(4, 2) });
    const childrenBefore = new Set(Array.from(attachedPanel(ui).children));
    const insertBefore = vi.spyOn(attachedPanel(ui), "insertBefore");

    manager.bringLayerToFront("overlay_3");

    // Longest overlay move: the row lands right under the overlay anchor.
    expect(insertBefore).toHaveBeenCalledTimes(1);
    expect(new Set(Array.from(attachedPanel(ui).children))).toEqual(childrenBefore);
    expect(childKeys(ui)[0]).toBe("role:overlay");
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
    const overlays = () => manager.layers.filter(l => l.role === ROLE.OVERLAY);
    const bases = () => manager.layers.filter(l => l.role === ROLE.BASE);

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

  it("tolerates a missing panel, anchor-less rows, stray children and no layers", () => {
    // The reconcile's defensive branches, driven through a bare mock: a
    // torn-down panel no-ops; rows order without their toggle-all anchors; a
    // child that is neither a row nor an anchor is ignored — including a
    // toggle-all shell that lost its data-role; a registry entry without a
    // row is skipped, and the write-path drift that produced any of this is
    // named, not silently absorbed; an empty registry writes nothing.
    // A torn-down control must no-op.
    const bare = {
      uiContainer: null,
      c: { layers: [] },
      listPanel: { activeIdx: null },
    } as unknown as LayerUI;
    expect(() => syncRowOrder(bare)).not.toThrow();

    const rowEl = (id: string) => {
      const el = document.createElement("div");
      el.setAttribute(CONST.DATA.LAYER_ID, id);
      return el;
    };
    // Deliberately detached: the cursor reconcile must skip a disconnected
    // root.
    const container = document.createElement("div");
    const stray = document.createElement("div");
    // Carries the toggle-all class but no data-role: an anchor that cannot
    // be keyed, ignored like any other non-row child.
    const headlessAnchor = document.createElement("div");
    headlessAnchor.classList.add(CONST.CLASSES.TOGGLE_ALL);
    // Two anchors for a group no layer references — the duplicate is named,
    // and neither becomes a target.
    const anchorEl = () => {
      const el = document.createElement("div");
      el.classList.add(CONST.CLASSES.TOGGLE_ALL);
      el.setAttribute("data-role", "phantom");
      return el;
    };
    container.append(
      stray,
      rowEl("B"),
      rowEl("A"),
      rowEl("base1"),
      headlessAnchor,
      // A second row for the same id and a row the registry never heard of:
      // both are write-path bugs the diagnostics exist to name. The earlier
      // duplicate is dropped, the later node kept.
      rowEl("A"),
      rowEl("orphan"),
      anchorEl(),
      anchorEl(),
    );
    const registry = { layers: [] as LayerInfo[] };
    const warn = vi.fn();
    const ui = {
      uiContainer: container,
      c: registry,
      listPanel: { activeIdx: null },
      log: { warn },
    } as unknown as LayerUI;
    registry.layers = [
      { id: "A", role: ROLE.OVERLAY } as LayerInfo,
      { id: "B", role: ROLE.OVERLAY } as LayerInfo,
      { id: "ghost", role: ROLE.OVERLAY } as LayerInfo,
      { id: "base1", role: ROLE.BASE } as LayerInfo,
    ];

    syncRowOrder(ui);

    // Rows follow the registry with no anchors to carry (both anchor-missing
    // diagnostics fire); the ghost has no row to place; the earlier duplicate
    // row and anchor are gone; the orphan and stray children trail the targets.
    expect(
      Array.from(container.children).map(
        el => el.getAttribute(CONST.DATA.LAYER_ID) ?? "stray",
      ),
    ).toEqual(["A", "B", "base1", "stray", "stray", "orphan", "stray"]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('duplicate row for layer "A"'),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('duplicate toggle-all anchor for "phantom"'),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        `panel/registry drift — rows without entries [orphan], entries without rows [ghost]`,
      ),
    );

    registry.layers = [];
    expect(() => syncRowOrder(ui)).not.toThrow();
    expect(container.children.length).toBe(7);
  });

  it("syncRowOrder keeps a role anchor when the registry has no rows for it", () => {
    // L332 fallback loop branch: a role whose toggle-all anchor exists in the
    // DOM but no layer row of that role is in the registry. The first loop
    // never marks the role seen (no row), so the fallback pushes the anchor
    // (anchor truthy) rather than dropping the empty role header.
    const container = document.createElement("div");
    const overlayAnchor = document.createElement("div");
    overlayAnchor.classList.add(CONST.CLASSES.TOGGLE_ALL);
    overlayAnchor.setAttribute("data-role", ROLE.OVERLAY);
    const baseAnchor = document.createElement("div");
    baseAnchor.classList.add(CONST.CLASSES.TOGGLE_ALL);
    baseAnchor.setAttribute("data-role", ROLE.BASE);
    container.append(overlayAnchor, baseAnchor);
    // Registry has ONLY a base row — the overlay anchor has no rows, so it is
    // an empty-role header the reconcile must preserve (the clean button
    // still hangs off it).
    const row = document.createElement("div");
    row.setAttribute(CONST.DATA.LAYER_ID, "base1");
    container.appendChild(row);
    const registry = { layers: [{ id: "base1", role: ROLE.BASE } as LayerInfo] };
    const ui = {
      uiContainer: container,
      c: registry,
      listPanel: { activeIdx: null },
      log: { warn: vi.fn() },
    } as unknown as LayerUI;
    syncRowOrder(ui);
    // Both anchors survive (overlay via the fallback push, base via its row);
    // the row is present.
    const roles = Array.from(container.children)
      .filter(el => el.classList.contains(CONST.CLASSES.TOGGLE_ALL))
      .map(el => (el as HTMLElement).dataset.role);
    expect(roles.sort()).toEqual([ROLE.OVERLAY, ROLE.BASE].sort());
    expect(container.querySelector(`[${CONST.DATA.LAYER_ID}="base1"]`)).not.toBeNull();
  });
  it("repairs a duplicate row instead of only warning about it", () => {
    const { manager, ui } = initFixture({ data: benchData(3, 1) });
    const container = attachedPanel(ui);
    const original = rowOf(ui, "overlay_1");
    // A second node for the same id, appended by a racing write path: the
    // later mount is the one the next reconcile keeps.
    const duplicate = original.cloneNode(true) as HTMLElement;
    container.appendChild(duplicate);

    syncRowOrder(ui);

    // Children only: the count cell inside a row carries the same id.
    const rows = Array.from(container.children).filter(
      el => el.getAttribute(CONST.DATA.LAYER_ID) === "overlay_1",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toBe(duplicate);
    // The survivor sits in the registry's slot, not at the tail.
    expect(childKeys(ui)).toEqual(registryKeys(manager));
  });

  it("moves the cursor and DOM focus onto the surviving duplicate row", () => {
    const { ui } = initFixture({ data: benchData(3, 1) });
    const container = attachedPanel(ui);
    const original = rowOf(ui, "overlay_1");
    const duplicate = original.cloneNode(true) as HTMLElement;
    container.appendChild(duplicate);
    // The earlier node is the active, focused one: repairing the duplicate
    // must not silently drop the user's cursor or focus onto <body>.
    original.classList.add(CONST.CLASSES.FOCUSED);
    ui.listPanel.activeIdx = getNavigableItems(ui).indexOf(original);
    original.focus();

    syncRowOrder(ui);

    expect(original.isConnected).toBe(false);
    expect(duplicate.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);
    expect(ui.listPanel.activeIdx).toBe(getNavigableItems(ui).indexOf(duplicate));
    expect(document.activeElement).toBe(duplicate);
  });

  it("returns focus to the same descendant of the surviving row", () => {
    const { ui } = initFixture({ data: benchData(3, 1) });
    const original = rowOf(ui, "overlay_1");
    const duplicate = original.cloneNode(true) as HTMLElement;
    attachedPanel(ui).appendChild(duplicate);
    // Focus is on the row's checkbox, not the row, and the ledger has not
    // caught up (activeIdx null): the repair must treat focus as the cursor,
    // land on the survivor's checkbox (same path) and sync the ledger.
    const box = original.querySelector("input")!;
    box.focus();

    syncRowOrder(ui);

    expect(document.activeElement).toBe(duplicate.querySelector("input"));
    expect(document.activeElement).not.toBe(duplicate);
    expect(duplicate.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);
    expect(ui.listPanel.activeIdx).toBe(getNavigableItems(ui).indexOf(duplicate));
  });

  it("repairs a duplicate toggle-all anchor instead of only warning", () => {
    const { manager, ui } = initFixture({ data: benchData(3, 1) });
    const container = attachedPanel(ui);
    const anchorOf = () =>
      Array.from(container.children).find(
        el =>
          el.classList.contains(CONST.CLASSES.TOGGLE_ALL) &&
          el.getAttribute("data-role") === ROLE.OVERLAY,
      ) as HTMLElement;
    const original = anchorOf();
    expect(original).toBeDefined();
    const duplicate = original.cloneNode(true) as HTMLElement;
    duplicate.classList.add(CONST.CLASSES.FOCUSED);
    container.appendChild(duplicate);

    syncRowOrder(ui);

    const anchors = Array.from(container.children).filter(
      el =>
        el.classList.contains(CONST.CLASSES.TOGGLE_ALL) &&
        el.getAttribute("data-role") === ROLE.OVERLAY,
    );
    expect(anchors).toHaveLength(1);
    expect(anchors[0]).toBe(duplicate);
    expect(childKeys(ui)).toEqual(registryKeys(manager));
  });

  it("keeps the cursor on its row when a duplicate ahead of it is removed", () => {
    const { ui } = initFixture({ data: benchData(3, 1) });
    const container = attachedPanel(ui);
    const duplicate = rowOf(ui, "overlay_1").cloneNode(true) as HTMLElement;
    container.appendChild(duplicate);
    // The cursor sits on a later row: removing the earlier duplicate shifts
    // its position, and a stale activeIdx would re-home onto the neighbor.
    const active = rowOf(ui, "overlay_2");
    ui.listPanel.activeIdx = getNavigableItems(ui).indexOf(active);
    active.classList.add(CONST.CLASSES.FOCUSED);

    syncRowOrder(ui);

    expect(ui.listPanel.activeIdx).toBe(getNavigableItems(ui).indexOf(active));
    expect(active.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);
  });

  it("moves a class-only active duplicate without stealing focus", () => {
    const { ui } = initFixture({ data: benchData(3, 1) });
    const container = attachedPanel(ui);
    const original = rowOf(ui, "overlay_1");
    const duplicate = original.cloneNode(true) as HTMLElement;
    container.appendChild(duplicate);
    // The marker says active, the ledger index is stale (it resolves to no
    // row), and DOM focus is elsewhere: the repair must still move the cursor
    // onto the survivor without focusing it.
    original.classList.add(CONST.CLASSES.FOCUSED);
    ui.listPanel.activeIdx = 999;
    (document.activeElement as HTMLElement | null)?.blur?.();

    syncRowOrder(ui);

    expect(duplicate.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);
    expect(document.activeElement).not.toBe(duplicate);
  });

  it("moves focus onto the surviving duplicate anchor", () => {
    const { ui } = initFixture({ data: benchData(3, 1) });
    const container = attachedPanel(ui);
    const anchorOf = () =>
      Array.from(container.children).find(
        el =>
          el.classList.contains(CONST.CLASSES.TOGGLE_ALL) &&
          el.getAttribute("data-role") === ROLE.OVERLAY,
      ) as HTMLElement;
    const original = anchorOf();
    const duplicate = original.cloneNode(true) as HTMLElement;
    container.appendChild(duplicate);
    const control = original.querySelector<HTMLElement>("button, input, [tabindex]")!;
    control.focus();
    expect(document.activeElement).toBe(control);

    syncRowOrder(ui);

    expect(anchorOf()).toBe(duplicate);
    // The fold button, not the anchor row: the exact descendant travels.
    expect(document.activeElement).toBe(duplicate.querySelector("button"));
    expect(document.activeElement).not.toBe(duplicate);
  });

  it("moves the cursor onto the surviving anchor when the anchor was active", () => {
    const { ui } = initFixture({ data: benchData(3, 1) });
    const container = attachedPanel(ui);
    const anchorOf = () =>
      Array.from(container.children).find(
        el =>
          el.classList.contains(CONST.CLASSES.TOGGLE_ALL) &&
          el.getAttribute("data-role") === ROLE.OVERLAY,
      ) as HTMLElement;
    const original = anchorOf();
    const duplicate = original.cloneNode(true) as HTMLElement;
    container.appendChild(duplicate);
    original.classList.add(CONST.CLASSES.FOCUSED);
    ui.listPanel.activeIdx = getNavigableItems(ui).indexOf(original);
    (original.querySelector("button") as HTMLElement).focus();

    syncRowOrder(ui);

    expect(anchorOf()).toBe(duplicate);
    expect(duplicate.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);
    expect(ui.listPanel.activeIdx).toBe(getNavigableItems(ui).indexOf(duplicate));
    expect(document.activeElement).toBe(duplicate.querySelector("button"));
  });

  it("keeps the cursor index when a duplicate anchor ahead of it is removed", () => {
    const { ui } = initFixture({ data: benchData(3, 1) });
    const container = attachedPanel(ui);
    const anchorOf = () =>
      Array.from(container.children).find(
        el =>
          el.classList.contains(CONST.CLASSES.TOGGLE_ALL) &&
          el.getAttribute("data-role") === ROLE.OVERLAY,
      ) as HTMLElement;
    const duplicate = anchorOf().cloneNode(true) as HTMLElement;
    container.appendChild(duplicate);
    // The cursor is on a row after the anchor: removing the anchor shifts its
    // index, and the reconcile would re-home onto the neighbor without the
    // shared helper's activeIdx adjustment.
    const active = rowOf(ui, "overlay_2");
    ui.listPanel.activeIdx = getNavigableItems(ui).indexOf(active);
    active.classList.add(CONST.CLASSES.FOCUSED);

    syncRowOrder(ui);

    expect(ui.listPanel.activeIdx).toBe(getNavigableItems(ui).indexOf(active));
    expect(active.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);
  });

  it("keeps focus inside the panel when the surviving anchor was stripped", () => {
    // Name note: this exercises the *survivor* rung of the restore chain, not
    // the nearest-neighbour rung — a row/anchor is focusable by construction
    // (tabindex is re-seeded by the roving cursor). The folded-survivor test
    // below is what reaches the walk; the container last resort stays a
    // browser-only defense and is exempt from coverage in list.ts. The
    // assertion that matters here is unchanged: the keyboard user never lands
    // on <body> after the duplicate is dropped.
    const { ui } = initFixture({ data: benchData(3, 1) });
    const container = attachedPanel(ui);
    const anchorOf = () =>
      Array.from(container.children).find(
        el =>
          el.classList.contains(CONST.CLASSES.TOGGLE_ALL) &&
          el.getAttribute("data-role") === ROLE.OVERLAY,
      ) as HTMLElement;
    const original = anchorOf();
    const duplicate = original.cloneNode(true) as HTMLElement;
    // The surviving anchor carries no controls, so the exact path cannot
    // resolve and the control fallback finds nothing; the survivor itself is
    // the rung that takes focus in a jsdom run.
    duplicate.replaceChildren();
    duplicate.removeAttribute("tabindex");
    container.appendChild(duplicate);
    (original.querySelector("button") as HTMLElement).focus();

    expect(() => syncRowOrder(ui)).not.toThrow();
    expect(anchorOf()).toBe(duplicate);
    expect(document.activeElement).not.toBe(document.body);
    expect(container.contains(document.activeElement as Node)).toBe(true);
  });

  it("falls back to the surviving row itself when its controls were stripped", () => {
    const { ui } = initFixture({ data: benchData(3, 1) });
    const container = attachedPanel(ui);
    const original = rowOf(ui, "overlay_1");
    const duplicate = original.cloneNode(true) as HTMLElement;
    // The clone lost every in-row control (checkbox / ⋮), so the exact path
    // has no target; the row itself is focusable (tabindex=0) and must take
    // the focus rather than leaving it on the removed original.
    duplicate.replaceChildren();
    container.appendChild(duplicate);
    (original.querySelector("input") as HTMLElement).focus();

    syncRowOrder(ui);

    expect(document.activeElement).toBe(duplicate);
    expect(container.contains(duplicate)).toBe(true);
    expect(ui.listPanel.activeIdx).toBe(getNavigableItems(ui).indexOf(duplicate));
  });

  it.skipIf(!refusesHiddenFocus)(
    "walks to a visible neighbour when the surviving duplicate is folded",
    () => {
      // The browser-only rung: a folded group renders `display: none`, and
      // browsers refuse focus on a `display: none` subtree. jsdom applies no
      // stylesheet, so pin the folded state inline to reproduce that refusal —
      // exact path, caller fallback and the survivor itself all fail to take
      // focus, and the walk must land on a visible row rather than leave the
      // keyboard user on <body>.
      const { ui } = initFixture({ data: benchData(3, 1) });
      const container = attachedPanel(ui);
      const original = rowOf(ui, "overlay_1");
      const duplicate = original.cloneNode(true) as HTMLElement;
      duplicate.style.display = "none";
      container.appendChild(duplicate);
      (original.querySelector("input") as HTMLElement).focus();

      syncRowOrder(ui);

      expect(duplicate.isConnected).toBe(true);
      expect(document.activeElement).not.toBe(duplicate);
      expect(document.activeElement).not.toBe(document.body);
      expect(container.contains(document.activeElement as Node)).toBe(true);
      // Focus is the cursor: the row that took the focus owns the ledger, so a
      // later arrow key continues from the visible neighbour instead of from the
      // folded survivor (which cannot hold focus at all).
      const items = getNavigableItems(ui);
      const focusedIdx = items.indexOf(document.activeElement as HTMLElement);
      expect(focusedIdx).toBeGreaterThanOrEqual(0);
      expect(ui.listPanel.activeIdx).toBe(focusedIdx);
      expect(items[focusedIdx]).not.toBe(duplicate);
    },
  );

  it("reorderLayer refuses unknown ids, self-drops and cross-group pairs", () => {
    // The drag commit entry's own guards — the drop path pre-checks for the
    // hint, but the entry must hold on its own.
    const { manager, ui } = initFixture({ data: benchData(3, 2) });
    const changes: string[] = [];
    ui.events.on(EVENTS.LAYER_CHANGE, payload => changes.push(payload.id));
    const before = manager.layers.map(l => l.id);

    expect(manager.reorderLayer("nope", "overlay_0")).toBe(false);
    expect(manager.reorderLayer("overlay_0", "nope")).toBe(false);
    expect(manager.reorderLayer("overlay_1", "overlay_1")).toBe(false);
    expect(manager.reorderLayer("overlay_0", "base_0")).toBe(false);

    expect(changes).toEqual([]);
    expect(manager.layers.map(l => l.id)).toEqual(before);
  });

  it("reconcileCursorByIdentity clears the cursor when its row left the panel", () => {
    const { ui } = initFixture({ data: benchData(3, 1) });
    const row = rowOf(ui, "overlay_1");
    row.focus();
    ui.listPanel.activeIdx = getNavigableItems(ui).indexOf(row);

    // A row removed mid-flow (a subscriber retired it inside the signal)
    // leaves the cursor nothing to re-home onto — the kind-tagged identity
    // resolves against nothing, so the ledger clears.
    row.remove();
    reconcileCursorByIdentity(ui, { kind: "layer", id: "overlay_1" });

    expect(ui.listPanel.activeIdx).toBeNull();
  });

  it("every reorder entrance publishes the same event pair and settles the same way", () => {
    // The four entrances — moveLayerUp, moveLayerDown, bringLayerToFront and
    // the drag drop's reorderLayer — all commit through one funnel, so an
    // outside observer cannot tell which one moved the layer: one
    // panel-order signal after the registry move, one CHANGE for the moved
    // layer, DOM and persisted order agreeing with the registry.
    const cases = [
      {
        via: "moveLayerUp",
        act: (m: LayerController) => m.moveLayerUp("L2"),
        moved: "L2",
        order: ["L0", "L2", "L1", "L3"],
      },
      {
        via: "moveLayerDown",
        act: (m: LayerController) => m.moveLayerDown("L0"),
        moved: "L0",
        order: ["L1", "L0", "L2", "L3"],
      },
      {
        via: "bringLayerToFront",
        act: (m: LayerController) => m.bringLayerToFront("L2"),
        moved: "L2",
        order: ["L2", "L0", "L1", "L3"],
      },
      {
        via: "reorderLayer (drag)",
        act: (m: LayerController) => m.reorderLayer("L3", "L0"),
        moved: "L3",
        order: ["L3", "L0", "L1", "L2"],
      },
    ];

    for (const { via, act, moved, order } of cases) {
      window.localStorage.clear();
      const { manager, ui, map } = initFixture({
        data: Array.from({ length: 4 }, (_, i) => ({
          id: `L${i}`,
          name: `L${i}`,
          role: "overlay" as const,
        })),
      });
      const rebuilds: string[] = [];
      const changes: string[] = [];
      // The color basemap joins the registry at attach as a base-group tail;
      // the arrangement under test is the overlay block.
      const overlayOrder = (m: LayerController) =>
        m.layers.filter(l => l.role === ROLE.OVERLAY).map(l => l.id);
      ui.events.on(EVENTS.LAYER_LIST_REBUILD, () =>
        rebuilds.push(overlayOrder(manager).join(",")),
      );
      ui.events.on(EVENTS.LAYER_CHANGE, payload => changes.push(payload.id));

      act(manager);

      // The signal fires once, already carrying the finished arrangement;
      // the move announces through the same CHANGE every entrance uses.
      expect(rebuilds, via).toEqual([order.join(",")]);
      expect(changes, via).toEqual([moved]);
      expect(overlayOrder(manager), via).toEqual(order);
      const domOrder = Array.from(
        attachedPanel(ui).querySelectorAll(
          `${CONST.SEL.LAYER_ITEM}[data-layer-type="${ROLE.OVERLAY}"]`,
        ),
      ).map(el => el.getAttribute(CONST.DATA.LAYER_ID));
      expect(domOrder, via).toEqual(order);
      (
        manager as unknown as { persistence: { flushAll(): void } }
      ).persistence.flushAll();
      // The persisted snapshot is the full registry, color basemap included.
      expect(orderDocRoots(map), via).toEqual(manager.layers.map(l => l.id));
    }
  });

  it("a reorder never steals focus from the control the user is operating", () => {
    // The incremental move carries DOM focus with the node; the reconcile
    // re-homes only cursor metadata. A focused ⋮ button (or checkbox, or
    // panel control) keeps focus whether its own row moved or another one
    // did — the rebuild path had to re-aim focus because it destroyed the
    // nodes; this path must not.
    const { manager, ui } = initFixture({ data: benchData(4, 2) });
    const moreBtn = rowOf(ui, "overlay_2").querySelector(
      `.${CONST.CLASSES.MORE_BTN}`,
    ) as HTMLElement;
    moreBtn.focus();

    manager.moveLayerUp("overlay_3");
    expect(document.activeElement).toBe(moreBtn);

    // Moving the focus host's own row travels with it.
    manager.moveLayerUp("overlay_2");
    expect(document.activeElement).toBe(moreBtn);
    expect(moreBtn.closest(CONST.SEL.LAYER_ITEM)).toBe(rowOf(ui, "overlay_2"));

    // One roving tab stop survives the moves.
    const stops = getNavigableItems(ui).filter(el => el.tabIndex === 0);
    expect(stops.length).toBe(1);
  });

  it("keeps checkbox focus while its hosting row moves", () => {
    const { manager, ui } = initFixture({ data: benchData(4, 2) });
    const box = rowOf(ui, "overlay_1").querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    box.focus();

    manager.moveLayerUp("overlay_1");

    expect(document.activeElement).toBe(box);
    expect(box.closest(CONST.SEL.LAYER_ITEM)).toBe(rowOf(ui, "overlay_1"));
  });

  it.each([
    { named: "overlay", role: "overlay" as const },
    { named: "base", role: "base" as const },
  ])(
    "keeps the cursor on a layer named $named when its row moves",
    ({ named, role }) => {
      // A layer may legally be called "overlay" or "base" — the same
      // strings the group headers key on. The cursor identity is
      // kind-tagged, so every ledger (DOM focus, activeIdx, the one roving
      // tab stop) re-homes onto the layer row, not the same-named header.
      const { manager, ui } = initFixture({
        data: [
          { id: named, name: named, role },
          {
            id: role === "base" ? "tile" : "x",
            name: "other",
            role,
          },
        ],
      });
      const row = rowOf(ui, named);
      row.focus();
      ui.listPanel.activeIdx = getNavigableItems(ui).indexOf(row);

      expect(manager.moveLayerDown(named)).toBe(true);

      const items = getNavigableItems(ui);
      expect(items[ui.listPanel.activeIdx ?? -1]).toBe(row);
      expect(items.findIndex(el => el.tabIndex === 0)).toBe(items.indexOf(row));
      expect(document.activeElement).toBe(row);
      const header = attachedPanel(ui).querySelector(
        `.${CONST.CLASSES.TOGGLE_ALL}[data-role="${role}"]`,
      );
      expect(items.indexOf(row)).not.toBe(items.indexOf(header as HTMLElement));
    },
  );

  it("re-homes a header cursor back onto the header", () => {
    const { manager, ui } = initFixture({ data: benchData(3, 0) });
    const header = attachedPanel(ui).querySelector(
      `.${CONST.CLASSES.TOGGLE_ALL}[data-role="${ROLE.OVERLAY}"]`,
    ) as HTMLElement;
    header.focus();
    ui.listPanel.activeIdx = getNavigableItems(ui).indexOf(header);

    manager.moveLayerUp("overlay_2");

    const items = getNavigableItems(ui);
    expect(items[ui.listPanel.activeIdx ?? -1]).toBe(header);
    expect(items.findIndex(el => el.tabIndex === 0)).toBe(items.indexOf(header));
  });

  it("a folded cursor row falls back to its group header, same name or not", () => {
    const { ui } = initFixture({
      data: [
        { id: "overlay", name: "overlay", role: "overlay" as const },
        { id: "x", name: "x", role: "overlay" as const },
      ],
    });
    const row = rowOf(ui, "overlay");
    row.focus();
    ui.listPanel.activeIdx = getNavigableItems(ui).indexOf(row);

    // The fold rebuild captures the cursor by identity before the rows go,
    // then finds its row hidden — the fallback is the row's own group
    // header, not a same-named one swapped in by string luck.
    toggleFold(ui, ROLE.OVERLAY);

    const items = getNavigableItems(ui);
    const header = attachedPanel(ui).querySelector(
      `.${CONST.CLASSES.TOGGLE_ALL}[data-role="${ROLE.OVERLAY}"]`,
    ) as HTMLElement;
    expect(items[ui.listPanel.activeIdx ?? -1]).toBe(header);
  });

  it("a late registration ahead of the active row keeps every ledger on it", () => {
    // The persisted order slots H before A, so the newcomer lands ahead of
    // the focused row: a positional ledger would hand the cursor, the
    // marker and the tab stop to H while DOM focus stayed on A.
    const { manager, ui } = initFixture({
      seed: { order: ["H", "A", "B"] },
      data: [
        { id: "A", name: "A", role: "overlay" as const },
        { id: "B", name: "B", role: "overlay" as const },
      ],
    });
    const row = rowOf(ui, "A");
    row.focus();
    ui.listPanel.activeIdx = getNavigableItems(ui).indexOf(row);
    row.classList.add(CONST.CLASSES.FOCUSED);

    manager.registerLayer({ id: "H", name: "H", role: "overlay" });

    // The color basemap joins the registry at attach as the base-group tail.
    expect(manager.layers.map(l => l.id)).toEqual([
      "H",
      "A",
      "B",
      CONST.SOLID_BASEMAP_ID,
    ]);
    const ledger = cursorLedger(ui);
    expect(ledger.active).toBe("A");
    expect(ledger.marked).toBe("A");
    expect(ledger.tabStops).toEqual(["A"]);
    expect(ledger.domFocus).toBe("A");
  });

  it("a late registration behind the active row changes nothing", () => {
    const { manager, ui } = initFixture({
      data: [
        { id: "A", name: "A", role: "overlay" as const },
        { id: "B", name: "B", role: "overlay" as const },
      ],
    });
    const row = rowOf(ui, "A");
    row.focus();
    ui.listPanel.activeIdx = getNavigableItems(ui).indexOf(row);

    // A base registration lands in the trailing base role, below every
    // overlay row — the active row keeps its index and its ledgers.
    manager.registerLayer({ id: "tile", name: "tile", role: "base" });

    const ledger = cursorLedger(ui);
    expect(ledger.active).toBe("A");
    expect(ledger.marked).toBe("A");
    expect(ledger.tabStops).toEqual(["A"]);
    expect(ledger.domFocus).toBe("A");
  });

  it("removing a row above the active row keeps every ledger on it", () => {
    const { manager, ui } = initFixture({
      data: [
        { id: "A", name: "A", role: "overlay" as const },
        { id: "B", name: "B", role: "overlay" as const },
        { id: "C", name: "C", role: "overlay" as const },
      ],
    });
    const row = rowOf(ui, "B");
    row.focus();
    ui.listPanel.activeIdx = getNavigableItems(ui).indexOf(row);

    // A sat above B; the removal shifts B into its index, so a positional
    // ledger would hand every state to C. Identity keeps them on B.
    manager.unregisterLayer("A");

    const ledger = cursorLedger(ui);
    expect(ledger.active).toBe("B");
    expect(ledger.marked).toBe("B");
    expect(ledger.tabStops).toEqual(["B"]);
    expect(ledger.domFocus).toBe("B");
  });

  it("removing the active row clears the cursor and keeps one tab stop", () => {
    const { manager, ui } = initFixture({
      data: [
        { id: "A", name: "A", role: "overlay" as const },
        { id: "B", name: "B", role: "overlay" as const },
      ],
    });
    const row = rowOf(ui, "A");
    row.focus();
    ui.listPanel.activeIdx = getNavigableItems(ui).indexOf(row);

    manager.unregisterLayer("A");

    // The focused row is gone; the cursor clears and the roving contract
    // holds — exactly one visible stop, the first row, so Tab can re-enter
    // the list.
    expect(ui.listPanel.activeIdx).toBeNull();
    const ledger = cursorLedger(ui);
    expect(ledger.marked).toBeNull();
    expect(ledger.tabStops).toEqual(["role:overlay"]);
    expect(document.activeElement).toBe(document.body);
  });

  it("renders a base header for an empty base role via the fallback loop", () => {
    // L445 BASE side: after the user deletes every base layer, the base
    // role has no live row but keeps a stale folder key (freezeEmptyFolder).
    // rolesWithHeader(BASE) is then true with no base layer, so the fallback
    // loop must render the base header with base_map_label — not the overlay
    // label, which would be a user-visible mislabel.
    const { manager, ui } = initFixture({
      data: [{ id: "O1", name: "O1", role: "overlay" }],
    });
    // Remove the always-registered solid basemap so the base role is empty.
    manager.unregisterLayer(CONST.SOLID_BASEMAP_ID);
    manager.createFolder("base", "Ghost");
    manager.ui?.rebuildAfterLayoutChange?.();
    const baseHeader = attachedPanel(ui).querySelector(
      `.${CONST.CLASSES.TOGGLE_ALL}[data-role="${ROLE.BASE}"]`,
    ) as HTMLElement | null;
    expect(baseHeader).not.toBeNull();
    // The ternary passes base_map_label; syncNoBasemap may then show
    // no_base_map_label when zero basemaps are visible — either is correct
    // for a base header, the overlay label never is.
    expect(
      baseHeader!.textContent.includes(ui.T("base_map_label")) ||
        baseHeader!.textContent.includes(ui.T("no_base_map_label")),
    ).toBe(true);
    expect(baseHeader!.textContent).not.toContain(ui.T("data_layer_label"));
  });
});
