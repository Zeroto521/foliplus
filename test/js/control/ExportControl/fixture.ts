// control/ExportControl — shared doubles for the ExportControl test files.
//
// Every ExportControl module test builds the same two things: the minimal map
// the ExportManager constructor needs (crop-box geometry plus the zoom handlers
// it disables while exporting) and a manager whose UI delegations are stubbed so
// a test can drive cropState/savedBounds without a real crop-box DOM. Keeping
// them here means a constructor requirement only has to be satisfied once.
import { vi } from "vitest";
import { ExportManager } from "#control/ExportControl/manager.js";

/** Minimal map mock satisfying the ExportManager constructor contract.
 *  showHint/hideHint on foliplus mirror setup.ts's window.map mock — the manager
 *  reaches them through the public map.foliplus API rather than ensureHint(). */
const makeMapMock = () => {
  const container = document.createElement("div");
  return {
    getContainer: () => container,
    getBounds: () => ({
      getSouth: () => -90,
      getNorth: () => 90,
      getEast: () => 180,
      getWest: () => -180,
    }),
    latLngToContainerPoint: vi.fn(({ lat, lng }: { lat: number; lng: number }) => ({
      x: lng,
      y: lat,
    })),
    dragging: { disable: vi.fn(), enable: vi.fn() },
    scrollWheelZoom: { disable: vi.fn(), enable: vi.fn() },
    doubleClickZoom: { disable: vi.fn(), enable: vi.fn() },
    boxZoom: { disable: vi.fn(), enable: vi.fn() },
    keyboard: { disable: vi.fn(), enable: vi.fn() },
    touchZoom: { disable: vi.fn(), enable: vi.fn() },
    foliplus: { hint: { set: vi.fn(), clear: vi.fn(), registerIcon: vi.fn() } },
    on: vi.fn(),
    off: vi.fn(),
    eachLayer: vi.fn(),
  };
};

/** Build an ExportManager with every UI delegation stubbed, on the fixture map
 *  (or on a caller-supplied scheduler for the session-timing tests). */
const makeManager = (
  scheduler?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>,
) => {
  window.CONFIG = { ...window.CONFIG, name: "ExportControl", timeout: 7500 };
  const manager = scheduler
    ? new ExportManager(makeMapMock(), scheduler)
    : new ExportManager(makeMapMock());
  manager.showCropBox = vi.fn();
  manager.lockCropBox = vi.fn();
  manager.unlockCropBox = vi.fn();
  manager.removeCropBox = vi.fn();
  manager.updateBoxStyle = vi.fn();
  manager.showHintWithInfo = vi.fn();
  manager.showGlobalHint = vi.fn();
  return manager;
};

export { makeManager, makeMapMock };
