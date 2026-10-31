// Content-change label replay — the label face of the frame coalescer.
//
// The renderer itself is spied out here: the UI fixture's map has no
// projection, so a real rebuild cannot run. What these tests pin is the
// scheduling contract — when a rebuild is queued, when it is dropped, when
// it is flushed, and when the config gate keeps it from ever running. The
// real walk and its cost live in the annotation suite and the perf test.
import { afterEach, describe, expect, it, vi } from "vitest";
import { EVENTS, ensureEvents } from "#core/event/index.js";
import type { LayerController } from "#foliplus/LayerControl/controller.js";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import { closeStylePanel } from "#foliplus/LayerControl/ui/style/index.js";
import {
  FACE,
  flushStyleDimApply,
  hasStyleDimApply,
} from "#foliplus/LayerControl/ui/style/styleBag.js";
import { initFixture } from "../fixture.js";

// The base layer every fixture carries — the hub's BASE early-return must
// not be what keeps a replay from running.
const BASE_LAYER = {
  id: "base1",
  name: "OSM",
  role: "base",
  layer: { options: {}, setZIndex: vi.fn() } as never,
  paneName: "tilePane",
};

describe("content-change label replay", () => {
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

  const labelLeaf = (name: string): any => ({
    options: {},
    feature: { properties: { name } },
    getLatLng: () => ({ lat: 40, lng: -74 }),
  });

  const labelledFixture = () => {
    const children = [labelLeaf("a")];
    ({ manager, ui } = initFixture({
      data: [
        { id: "grp1", name: "G", role: "overlay", layer: groupWith(children) },
        BASE_LAYER,
      ],
    }));
    return children;
  };

  const turnLabelsOn = () => {
    ui.c.annotation.setConfig("grp1", {
      ...ui.c.annotation.defaultConfig(),
      show: true,
      field: "name",
    });
  };

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("coalesces a streamed burst into one label rebuild", () => {
    const children = labelledFixture();
    turnLabelsOn();
    const renderLabels = vi.spyOn(ui.c.annotation, "renderLabels").mockReturnValue([]);

    for (let i = 0; i < 5; i++) {
      children.push(labelLeaf(`f${i}`));
      ensureEvents(ui.c.map).emit(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: "grp1" });
    }
    // Five content changes, one pending frame: no rebuild yet.
    expect(renderLabels).not.toHaveBeenCalled();

    flushStyleDimApply(FACE.LABEL, "grp1");
    expect(renderLabels).toHaveBeenCalledTimes(1);
    expect(renderLabels).toHaveBeenLastCalledWith("grp1");
  });

  it("does not rebuild when labels are off", () => {
    labelledFixture();
    // No config: getConfig answers the default, show=false.
    const renderLabels = vi.spyOn(ui.c.annotation, "renderLabels").mockReturnValue([]);

    ensureEvents(ui.c.map).emit(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: "grp1" });
    flushStyleDimApply(FACE.LABEL, "grp1");
    expect(renderLabels).not.toHaveBeenCalled();
  });

  it("an unregister drops the pending label task", () => {
    labelledFixture();
    turnLabelsOn();
    const renderLabels = vi.spyOn(ui.c.annotation, "renderLabels").mockReturnValue([]);

    ensureEvents(ui.c.map).emit(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: "grp1" });
    expect(hasStyleDimApply(FACE.LABEL, "grp1")).toBe(true);

    manager.unregisterLayer("grp1");
    expect(hasStyleDimApply(FACE.LABEL, "grp1")).toBe(false);
    flushStyleDimApply(FACE.LABEL, "grp1");
    expect(renderLabels).not.toHaveBeenCalled();
  });

  it("closing the style panel flushes a pending label rebuild", () => {
    labelledFixture();
    turnLabelsOn();
    const renderLabels = vi.spyOn(ui.c.annotation, "renderLabels").mockReturnValue([]);
    // Minimal panel chrome so closeStylePanel finds stylePanelLayerId.
    ui.overlayPanel.stylePanelLayerId = "grp1";

    ensureEvents(ui.c.map).emit(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: "grp1" });
    expect(renderLabels).not.toHaveBeenCalled();

    closeStylePanel(ui, false);
    expect(renderLabels).toHaveBeenCalledTimes(1);
  });
});
