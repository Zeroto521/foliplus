// LayerControl ui/lifecycle.ts — the teardown contract: one ordered step list,
// every subscription released exactly once, and the container-less exit kept.
import { initFixture } from "./fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LayerController } from "#control/LayerControl/controller.js";
import type { LayerUI } from "#control/LayerControl/ui/index.js";
import { createTeardownScope } from "#control/LayerControl/ui/lifecycle.js";

describe("LayerUI teardown — the ordered scope", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("registers every step in the contract's execution order", () => {
    const names = createTeardownScope(ui).names();
    // The fixed prefix is the order the teardown contract states; the signal
    // block keeps the bind order, and the scheduler release comes last.
    const expected = [
      "clear-drag-state",
      "release-opacity-redraws",
      "unsubscribe-escape",
      "close-more-menu",
      "close-style-panel",
      "close-attrs-panel",
      "close-filter-panel",
      "finish-rename",
      "dismiss-focus",
      "off-change",
      "off-click",
      "off-focusin",
      "off-focusout",
      "off-dragstart",
      "off-dragover",
      "off-dragleave",
      "off-drop",
      "off-dragend",
      "off-dblclick",
      "off-more-click",
      "off-more-map-click",
      "off-zoomend",
      "clear-active-item",
      "destroy-list-cursor",
      "interaction-cleanup",
      "geometry-marquee-cleanup",
      "flush-persistence",
      "reset-handlers",
      "unsubscribe-count-change",
      "unsubscribe-control-attached",
      ...ui.unsubscribeLayerSignals.map(
        subscription => `unsubscribe-${subscription.name}`,
      ),
      "reset-signal-list",
      "release-style-apply-owner",
    ];

    expect(names).toEqual(expected);
  });

  it("subscribes to the documented layer signals, each as its own step", () => {
    // A dropped unsubscribe used to be invisible; pinning the subscription
    // list makes a missing one show up here as a gap instead of a leak.
    expect(ui.unsubscribeLayerSignals.map(subscription => subscription.name)).toEqual([
      "layer-item-added",
      "layer-item-updated",
      "layer-item-refreshed",
      "layer-capability-changed",
      "layer-filter-change",
      "layer-item-removed",
      "layer-role-count-changed",
      "layer-list-rebuild",
      "layer-no-basemap-changed",
      "layer-overlay-clear",
      "layer-overlay-clear",
      "layer-overlay-clear",
      "layer-overlay-clear",
      "layer-overlay-clear",
      "layer-overlay-clear",
    ]);
  });

  it("releases every subscription exactly once", () => {
    const released: Array<[string, ReturnType<typeof vi.fn>]> = [];
    ui.unsubscribeLayerSignals = ui.unsubscribeLayerSignals.map(subscription => {
      const off = vi.fn(subscription.off);
      released.push([subscription.name, off]);
      return { name: subscription.name, off };
    });
    const countOff = vi.fn(ui.unsubscribeCountChange as () => void);
    ui.unsubscribeCountChange = countOff;
    released.push(["count-change", countOff]);
    const attachedOff = vi.fn(ui.unsubscribeControlAttached as () => void);
    ui.unsubscribeControlAttached = attachedOff;
    released.push(["control-attached", attachedOff]);
    const escapeOff = vi.fn(ui.unsubscribeEscape as () => void);
    ui.unsubscribeEscape = escapeOff;
    released.push(["escape", escapeOff]);
    const flush = vi.spyOn(ui.c.persistence, "flushAll");

    ui.unbindEvents();

    for (const [name, off] of released) {
      expect(off, name).toHaveBeenCalledTimes(1);
    }
    expect(flush).toHaveBeenCalledTimes(1);
    expect(ui.unsubscribeLayerSignals).toEqual([]);
    expect(ui.unsubscribeCountChange).toBeNull();
    expect(ui.unsubscribeControlAttached).toBeNull();
  });

  it("a throwing step does not skip the ones behind it", () => {
    const lateOffs: Array<ReturnType<typeof vi.fn>> = [];
    ui.unsubscribeLayerSignals = ui.unsubscribeLayerSignals.map(subscription => {
      const off = vi.fn(subscription.off);
      lateOffs.push(off);
      return { name: subscription.name, off };
    });
    // flush-persistence sits before the subscription steps in the order: its
    // failure must be reported without shortening the teardown.
    vi.spyOn(ui.c.persistence, "flushAll").mockImplementation(() => {
      throw new Error("flush failed");
    });

    expect(() => ui.unbindEvents()).toThrow("flush failed");
    for (const off of lateOffs) expect(off).toHaveBeenCalledTimes(1);
  });

  it("without a container: only the pre-steps and the scheduler release run", () => {
    const signalOffs = ui.unsubscribeLayerSignals.map(subscription =>
      vi.fn(subscription.off),
    );
    ui.unsubscribeLayerSignals = ui.unsubscribeLayerSignals.map(
      (subscription, index) => ({
        name: subscription.name,
        off: signalOffs[index] as () => void,
      }),
    );
    const countOff = vi.fn(ui.unsubscribeCountChange as () => void);
    ui.unsubscribeCountChange = countOff;
    const flush = vi.spyOn(ui.c.persistence, "flushAll");
    ui.c.uiContainer = null as unknown as HTMLElement;

    const names = createTeardownScope(ui).names();
    expect(names).toEqual([
      "clear-drag-state",
      "release-opacity-redraws",
      "unsubscribe-escape",
      "release-style-apply-owner",
    ]);

    ui.unbindEvents();

    expect(flush).not.toHaveBeenCalled();
    expect(countOff).not.toHaveBeenCalled();
    for (const off of signalOffs) expect(off).not.toHaveBeenCalled();
  });
});
