// test/js/control/LayerControl/ui/style/border.scheduler — the drag-coalescing scheduler and content-change replay.
import { initFixture } from "../fixture.js";
import { BASE_LAYER, commitBorderNow, makeLeaf } from "./border.fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS, ensureEvents } from "#core/event/index.js";
import { type LayerController } from "#control/LayerControl/controller.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";
import {
  getIntent,
  seedIntentMap,
  setIntent,
} from "#control/LayerControl/ui/intent.js";
import {
  BORDER_DIMENSION,
  bindBorderRow,
  bindBorderRowShell,
  buildBorderRow,
  buildBorderRowShell,
  commitBorderColor,
  commitBorderWeight,
  resetLayerBorder,
} from "#control/LayerControl/ui/style/border.js";
import { closeStylePanel } from "#control/LayerControl/ui/style/index.js";
import {
  FACE,
  flushStyleDimApply,
  hasStyleDimApply,
} from "#control/LayerControl/ui/style/styleBag.js";

describe("border apply scheduler (drag coalesce)", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
    ui.listPanel.foldedRoles = {};
    seedIntentMap(ui, "visible", {});
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("coalesces same-frame commits into one walk", () => {
    const leaf = makeLeaf();
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    const frames: Array<() => void> = [];
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});

    commitBorderColor(ui, "vec1", "#111111");
    commitBorderColor(ui, "vec1", "#222222");
    commitBorderWeight(ui, "vec1", 5);
    expect(leaf.setStyle).not.toHaveBeenCalled();

    for (const cb of frames.splice(0)) cb();
    expect(leaf.setStyle).toHaveBeenCalledTimes(1);
    expect(leaf.setStyle).toHaveBeenCalledWith({
      color: "#222222",
      weight: 5,
      stroke: true,
    });
  });

  it("BORDER_DIMENSION.value reports the stored choice over the authored one", () => {
    const leaf = makeLeaf("#aabbcc", 3);
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    expect(BORDER_DIMENSION.value!(ui, "vec1")).toEqual({
      color: "#aabbcc",
      weight: 3,
      mode: "solid",
      ramp: undefined,
    });
    commitBorderNow(ui, "vec1", "color", "#445566");
    commitBorderNow(ui, "vec1", "weight", 7);
    expect(BORDER_DIMENSION.value!(ui, "vec1")).toEqual({
      color: "#445566",
      weight: 7,
      mode: "solid",
      ramp: undefined,
    });
  });

  it("shell builds color-only / weight-only rows and default selectors", () => {
    // The delegated drawer owns its own write path and does not pass
    // onFlush: the shell must not install a flush chain there. Also pins
    // the two shape branches (one input) and the default-selector fallback.
    const colorOnly = buildBorderRowShell({
      rowClass: "x",
      label: "Border",
      color: "#010203",
      weight: 2,
      hasColorInput: true,
      hasWeightInput: false,
      colorAria: "c",
      weightAria: "w",
    });
    expect(colorOnly.querySelector("input[type=color]")).toBeTruthy();
    expect(colorOnly.querySelector("input[type=number]")).toBeNull();

    const weightOnly = buildBorderRowShell({
      rowClass: "x",
      label: "Border",
      color: "#010203",
      weight: 2,
      hasColorInput: false,
      hasWeightInput: true,
      colorAria: "c",
      weightAria: "w",
    });
    expect(weightOnly.querySelector("input[type=color]")).toBeNull();
    expect(weightOnly.querySelector("input[type=number]")).toBeTruthy();

    // default selectors (no className) still resolve the two inputs
    bindBorderRowShell(colorOnly, {
      onChangeColor: vi.fn(),
    });
    bindBorderRowShell(weightOnly, {
      onChangeWeight: vi.fn(),
    });
  });

  it("shell without onFlush keeps the binders untouched (delegated drawer)", () => {
    // The delegated drawer owns its own write path and does not pass
    // onFlush: the shell must not install a flush chain there.
    const row = buildBorderRowShell({
      rowClass: "x",
      label: "Border",
      color: "#010203",
      weight: 2,
      hasColorInput: true,
      hasWeightInput: true,
      className: "c-in",
      weightClassName: "w-in",
      colorAria: "c",
      weightAria: "w",
    });
    const color = row.querySelector("input.c-in") as HTMLInputElement;
    const weight = row.querySelector("input.w-in") as HTMLInputElement;
    const colorChange = vi.fn();
    const weightChange = vi.fn();
    bindBorderRowShell(row, {
      className: "c-in",
      weightClassName: "w-in",
      onChangeColor: colorChange,
      onChangeWeight: weightChange,
    });
    const priorColorChange = color.onchange;
    const priorWeightChange = weight.onchange;
    color.dispatchEvent(new Event("change"));
    weight.dispatchEvent(new Event("change"));
    // no flush chain installed — the raw binder's handlers stay as-is
    expect(priorColorChange).toBe(color.onchange);
    expect(priorWeightChange).toBe(weight.onchange);
  });

  it("shell weight blur flushes the deferred walk", () => {
    const leaf = makeLeaf();
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    const frames: Array<() => void> = [];
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});

    const row = buildBorderRow(ui, "vec1");
    bindBorderRow(ui, "vec1", row);
    const weight = row.querySelector(
      ".foliplus-style-border-weight-input",
    ) as HTMLInputElement;
    weight.value = "8";
    weight.dispatchEvent(new Event("input", { bubbles: true }));
    expect(leaf.setStyle).not.toHaveBeenCalled();
    weight.dispatchEvent(new Event("blur", { bubbles: true }));

    expect(leaf.setStyle).toHaveBeenCalledWith({ weight: 8, stroke: true });
  });

  it("closing the style panel flushes a pending border walk", () => {
    // Panel close is a commit boundary for BOTH faces: a dragged border
    // left on a trailing frame must not vanish when the panel disappears.
    const leaf = makeLeaf();
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    const frames: Array<() => void> = [];
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});

    // minimal panel chrome so closeStylePanel finds stylePanelLayerId
    ui.overlayPanel.stylePanelLayerId = "vec1";
    commitBorderColor(ui, "vec1", "#333333");
    expect(leaf.setStyle).not.toHaveBeenCalled();

    closeStylePanel(ui, false);

    expect(leaf.setStyle).toHaveBeenCalledWith({
      color: "#333333",
      stroke: true,
    });
  });

  it("shell weight change runs the live binder commit and then flushes", () => {
    // bindLiveNumber owns onchange (clamp + commit); the flush is chained
    // AFTER it, so one change event both commits the value and lands the
    // deferred walk. (Unlike color, a prior onchange is replaced by the
    // binder itself — the chain protects that binder, not an outsider.)
    const leaf = makeLeaf();
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    const frames: Array<() => void> = [];
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});

    const row = buildBorderRow(ui, "vec1");
    bindBorderRow(ui, "vec1", row);
    const weight = row.querySelector(
      ".foliplus-style-border-weight-input",
    ) as HTMLInputElement;
    weight.value = "4";
    weight.dispatchEvent(new Event("input", { bubbles: true }));
    expect(leaf.setStyle).not.toHaveBeenCalled();
    weight.dispatchEvent(new Event("change", { bubbles: true }));

    expect(getIntent(ui, "vec1", "borderWeight")).toBe(4);
    expect(leaf.setStyle).toHaveBeenCalledWith({ weight: 4, stroke: true });
  });

  it("flush delivers the terminal value and is idempotent", () => {
    const leaf = makeLeaf();
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    const frames: Array<() => void> = [];
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});

    commitBorderColor(ui, "vec1", "#333333");
    flushStyleDimApply(FACE.STROKE, "vec1");
    expect(leaf.setStyle).toHaveBeenCalledWith({
      color: "#333333",
      stroke: true,
    });
    expect(leaf.setStyle).toHaveBeenCalledTimes(1);
    // The first flush executed the box, and execution reclaims the entry —
    // the second flush finds nothing, and the Map holds no parked closure.
    flushStyleDimApply(FACE.STROKE, "vec1");
    expect(leaf.setStyle).toHaveBeenCalledTimes(1);
    expect(hasStyleDimApply(FACE.STROKE, "vec1")).toBe(false);
  });

  it("reset cancels a pending walk so it cannot paint over the restore", () => {
    const leaf = makeLeaf("#aabbcc", 3);
    leaf.setStyle = vi.fn((style: Record<string, unknown>) =>
      Object.assign(leaf.options, style),
    );
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    const frames: Array<() => void> = [];
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});

    commitBorderColor(ui, "vec1", "#ff0000");
    leaf.setStyle.mockClear();
    resetLayerBorder(ui, "vec1");
    expect(leaf.options.color).toBe("#aabbcc");
    for (const cb of frames.splice(0)) cb();
    // the cancelled drag walk must not repaint the user's color
    expect(leaf.options.color).toBe("#aabbcc");
  });

  it("unregister drops the scheduler entry — no Map residue for dead ids", () => {
    const leaf = makeLeaf();
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    const frames: Array<() => void> = [];
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});

    commitBorderColor(ui, "vec1", "#333333");
    expect(hasStyleDimApply(FACE.STROKE, "vec1")).toBe(true);

    manager.unregisterLayer("vec1");
    expect(hasStyleDimApply(FACE.STROKE, "vec1")).toBe(false);
    for (const cb of frames.splice(0)) cb();
    expect(leaf.setStyle).not.toHaveBeenCalled();
  });

  it("bind chain: change runs the prior handler and flushes", () => {
    const leaf = makeLeaf();
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    // Editable colour: the border row is read-only in ORIGINAL mode (the
    // author's own stroke); a stored "solid" mode is what makes it a picker.
    setIntent(ui, "vec1", "borderStyleMode", "solid");
    const frames: Array<() => void> = [];
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});

    const row = buildBorderRow(ui, "vec1");
    bindBorderRow(ui, "vec1", row);
    const color = row.querySelector(
      ".foliplus-style-border-color-input",
    ) as HTMLInputElement;
    const prior = vi.fn();
    const chained = color.onchange;
    color.onchange = ev => {
      prior(ev);
      chained?.call(color, ev);
    };
    color.value = "#445544";
    color.dispatchEvent(new Event("input", { bubbles: true }));
    color.dispatchEvent(new Event("change", { bubbles: true }));

    expect(prior).toHaveBeenCalledTimes(1);
    expect(leaf.setStyle).toHaveBeenCalledWith({
      color: "#445544",
      stroke: true,
    });
  });
});

describe("content-change replay", () => {
  let manager: LayerController;
  let ui: LayerUI;

  // The group closes over the array, so a leaf pushed after the fixture was
  // built is still walked — that late leaf is the replay's whole subject.
  const groupWith = (children: any[]): any => ({
    options: {},
    eachLayer: vi.fn((fn: (child: unknown) => void) => {
      for (const child of children) fn(child);
    }),
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("replays the stored border to a leaf that lands after the user chose one", () => {
    const early = makeLeaf("#00ff00", 1);
    const late = makeLeaf("#445566", 4);
    const children = [early];
    ({ manager, ui } = initFixture({
      data: [
        { id: "grp1", name: "G", role: "overlay", layer: groupWith(children) },
        BASE_LAYER,
      ],
    }));
    commitBorderColor(ui, "grp1", "#ff0000");
    flushStyleDimApply(FACE.STROKE, "grp1");
    expect(early.setStyle).toHaveBeenCalledWith(
      expect.objectContaining({ color: "#ff0000", stroke: true }),
    );

    // A leaf lands while the user already has a border chosen.
    children.push(late);
    ensureEvents(ui.c.map).emit(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: "grp1" });
    flushStyleDimApply(FACE.STROKE, "grp1");

    expect(late.setStyle).toHaveBeenCalledWith(
      expect.objectContaining({ color: "#ff0000", stroke: true }),
    );
    // Each leaf restores its own authored stroke, including the late one —
    // the replay captured its base on its first write, not the replayed value.
    resetLayerBorder(ui, "grp1");
    expect(early.setStyle).toHaveBeenLastCalledWith(
      expect.objectContaining({ color: "#00ff00", weight: 1, stroke: true }),
    );
    expect(late.setStyle).toHaveBeenLastCalledWith(
      expect.objectContaining({ color: "#445566", weight: 4, stroke: true }),
    );
  });

  it("coalesces a bulk add of leaves into one walk", () => {
    const early = makeLeaf("#00ff00", 1);
    const children = [early];
    ({ manager, ui } = initFixture({
      data: [
        { id: "grp1", name: "G", role: "overlay", layer: groupWith(children) },
        BASE_LAYER,
      ],
    }));
    commitBorderColor(ui, "grp1", "#ff0000");
    flushStyleDimApply(FACE.STROKE, "grp1");
    expect(early.setStyle).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 5; i++) {
      children.push(makeLeaf("#101010", 2));
      ensureEvents(ui.c.map).emit(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: "grp1" });
    }
    // Five content changes, one pending frame: no new leaf walked yet.
    expect(children.slice(1).some(l => l.setStyle.mock.calls.length > 0)).toBe(false);

    flushStyleDimApply(FACE.STROKE, "grp1");
    // Each new leaf was written exactly once, by that single walk.
    expect(children.slice(1).every(l => l.setStyle.mock.calls.length === 1)).toBe(true);
  });

  it("does nothing when the user never chose a border", () => {
    const leaf = makeLeaf("#112233", 3);
    ({ manager, ui } = initFixture({
      data: [{ id: "o1", name: "O", role: "overlay", layer: leaf }, BASE_LAYER],
    }));
    ensureEvents(ui.c.map).emit(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: "o1" });
    flushStyleDimApply(FACE.STROKE, "o1");
    expect(leaf.setStyle).not.toHaveBeenCalled();
    // No base was captured for an untouched leaf, so a reset cannot invent a
    // style for it either.
    resetLayerBorder(ui, "o1");
    expect(leaf.setStyle).not.toHaveBeenCalled();
  });
});
