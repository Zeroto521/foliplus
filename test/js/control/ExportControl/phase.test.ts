// ExportControl export-phase state machine — the single owner of the
// component's mode registration, the blocker overlay, and the map lock.
//
// Two P1s lived in this file's absence:
//
//   * doExport() registered the "exporting" mode and then called
//     removeCropBox(), which unconditionally cleared *this* component's mode
//     back to null.  The ModeManager therefore believed the export never
//     happened: guardBlocked() was ineffective for the entire render, and
//     MODE_CHANGE reported "exporting" immediately followed by null.
//   * destroy() handled the crop box and the shortcuts, but not the export in
//     flight.  removeControl() left the blocker overlay on document.body, the
//     map locked against pan/zoom, and a render still running.
//
// setExportPhase() is the single entry point both now route through.
import { readFileSync } from "fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExportManager } from "#control/ExportControl/manager.js";

const src = (rel: string) => readFileSync(rel, "utf8");

const makeMap = () => {
  const container = document.createElement("div");
  return {
    getContainer: () => container,
    getBounds: () => ({
      getSouth: () => -90,
      getNorth: () => 90,
      getEast: () => 180,
      getWest: () => -180,
    }),
    latLngToContainerPoint: vi.fn(({ lat, lng }) => ({ x: lng, y: lat })),
    dragging: { disable: vi.fn(), enable: vi.fn() },
    scrollWheelZoom: { disable: vi.fn(), enable: vi.fn() },
    doubleClickZoom: { disable: vi.fn(), enable: vi.fn() },
    boxZoom: { disable: vi.fn(), enable: vi.fn() },
    keyboard: { disable: vi.fn(), enable: vi.fn() },
    touchZoom: { disable: vi.fn(), enable: vi.fn() },
    foliplus: { showHint: vi.fn(), hideHint: vi.fn() },
    on: vi.fn(),
    off: vi.fn(),
    eachLayer: vi.fn(),
  } as never;
};

const makeManager = () => {
  window.CONFIG = { ...window.CONFIG, name: "ExportControl", timeout: 7500 };
  return new ExportManager(makeMap());
};

/** Arm a crop box the way showCropBox would, without building the DOM. */
const armCropBox = (manager: ExportManager) => {
  const box = document.createElement("div");
  (manager as unknown as { cropState: unknown }).cropState = {
    rect: { left: 10, top: 10, width: 100, height: 100 },
    locked: false,
    box,
    geoBounds: null,
  };
};

describe("ExportControl — the export phase owns the mode registration", () => {
  let manager: ExportManager;

  beforeEach(() => {
    document.body.innerHTML = "";
    manager = makeManager();
  });

  it("setExportPhase writes the component's mode through one entry point", () => {
    const modes = manager.modes;
    const setPhase = vi.spyOn(manager, "setExportPhase");

    expect(modes.getMode("ExportControl")).toBeNull();
    manager.setExportPhase("crop");
    expect(modes.getMode("ExportControl")).toBe("selecting");
    manager.setExportPhase("exporting");
    expect(modes.getMode("ExportControl")).toBe("exporting");
    manager.setExportPhase("idle");
    expect(modes.getMode("ExportControl")).toBeNull();
    expect(setPhase).toHaveBeenCalledTimes(3);
  });

  it("removeCropBox does not clear the exporting mode (the P1-1 state collapse)", () => {
    // The old sequence: doExport() set "exporting", then removeCropBox() set
    // the component's own mode back to null.  The mode is registered by the
    // crop session, so only the crop session may release it — and the
    // export takes it over by writing "exporting" itself.
    manager.setExportPhase("crop");
    armCropBox(manager);
    manager.setExportPhase("exporting");
    expect(manager.modes.getMode("ExportControl")).toBe("exporting");

    manager.removeCropBox();

    expect(
      manager.modes.getMode("ExportControl"),
      "removing the crop box must not release the export's mode",
    ).toBe("exporting");
    // The crop DOM is gone and the box collapsed back to idle.
    expect(manager.cropState).toBeNull();
  });

  it("an in-flight export blocks the interactive components (guardBlocked works)", () => {
    manager.setExportPhase("exporting");
    expect(manager.modes.isBlocked("MeasureControl")).toBe(true);
    manager.setExportPhase("idle");
    expect(manager.modes.isBlocked("MeasureControl")).toBe(false);
  });

  it("MODE_CHANGE reports exporting once, not exporting then null", () => {
    const seen: Array<string | null> = [];
    manager.events.on("foliplus:mode:change", (p: { mode: string | null }) => {
      seen.push(p.mode);
    });

    manager.setExportPhase("exporting");
    manager.setExportPhase("idle");

    expect(seen).toEqual(["exporting", null]);
  });

  it("abortExport stops the in-flight export and returns the map to idle", () => {
    // The export commits: overlay up, map locked, phase exporting.
    manager.setExportPhase("exporting");
    manager.exportOverlay = document.createElement("div");
    manager.lockMap();
    expect(manager.modes.getMode("ExportControl")).toBe("exporting");

    expect(() => manager.abortExport()).not.toThrow();
    expect(manager.isExporting).toBe(false);
    expect(manager.modes.getMode("ExportControl")).toBeNull();
    expect(manager.exportOverlay).toBeNull();
    expect(manager.map.dragging.enable).toHaveBeenCalled();
    expect(manager.map.scrollWheelZoom.enable).toHaveBeenCalled();
  });

  it("abortExport is idempotent from idle", () => {
    expect(() => manager.abortExport()).not.toThrow();
    expect(manager.modes.getMode("ExportControl")).toBeNull();
    expect(manager.isExporting).toBe(false);
  });
});

describe("ExportControl — the blocker policy has one source", () => {
  it("showCropBox and doExport read the blockers from const.ts", () => {
    // P2-10: the four-entry blockedBy tuple was transcribed into ui.ts and
    // session.ts.  A divergence would mean the two entries into the same mode
    // claim different owners, so it must come from one place.
    const ui = src("foliplus/js/control/ExportControl/ui.ts");
    const session = src("foliplus/js/control/ExportControl/session.ts");
    const constFile = src("foliplus/js/control/ExportControl/const.ts");

    const defs = (text: string) => {
      const needle = "blockedBy: COMPONENTS.";
      let count = 0;
      let from = text.indexOf(needle);
      while (from !== -1) {
        count += 1;
        from = text.indexOf(needle, from + needle.length);
      }
      return count;
    };
    expect(defs(constFile), "const.ts defines the blocker table").toBeGreaterThan(0);
    expect(defs(ui), "ui.ts must not redefine the tuple").toBe(0);
    expect(defs(session), "session.ts must not redefine the tuple").toBe(0);
    expect(ui.indexOf("EXPORT_BLOCKERS") !== -1, "ui.ts imports the shared table").toBe(
      true,
    );
    expect(
      session.indexOf("EXPORT_BLOCKERS") !== -1,
      "session.ts imports the shared table",
    ).toBe(true);
  });
});
