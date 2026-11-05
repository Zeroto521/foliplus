import { beforeEach, describe, expect, it, vi } from "vitest";
import { initFixture, polygonLayer } from "./ui/fixture.js";

/**
 * task-75 deleteFolder / cleanEmptyFolders wiring tests (RED scaffold).
 *
 * These tests pin the v4 semantics of the two controller methods that are
 * NOT IMPLEMENTED yet (deleteFolder / cleanEmptyFolders). They are expected
 * to fail at runtime (TypeError: not a function) until the implementation
 * lands — the lead's scaffold instruction: write the tests now, run once to
 * confirm they are red at the expected place (not a syntax/import error).
 */

describe("task-75 deleteFolder wiring", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.CONFIG = { ...window.CONFIG, name: "LayerControl", locale_code: "en" };
  });

  it("[V4-1] non-empty folder delete: member folder=null + layer kept + order key removed + one schedule", () => {
    const { manager } = initFixture({
      seed: { folderOrder: { version: 1, sections: { overlay: ["roads"] } } },
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "Roads",
          layer: polygonLayer(),
        },
      ],
    });
    const schedule = vi.spyOn(manager.persistence, "schedule");

    const ok = manager.deleteFolder("overlay", "Roads");

    expect(ok).toBe(true);
    expect(manager.layerRegistry.get("rd1")).toBeDefined();
    expect(manager.layerRegistry.get("rd1")!.folder).toBeNull();
    expect(manager.folderOrder.sections.overlay ?? []).not.toContain("roads");
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it("[V4-1] empty folder delete: only key removed", () => {
    const { manager } = initFixture({
      seed: { folderOrder: { version: 1, sections: { overlay: ["roads"] } } },
      data: [],
    });
    const schedule = vi.spyOn(manager.persistence, "schedule");

    const ok = manager.deleteFolder("overlay", "roads");

    expect(ok).toBe(true);
    expect(manager.folderOrder.sections.overlay ?? []).not.toContain("roads");
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it("[V4-1][V4-P2#3] non-existent folder: false + no schedule", () => {
    const { manager } = initFixture({
      seed: { folderOrder: { version: 1, sections: { overlay: ["roads"] } } },
      data: [],
    });
    const schedule = vi.spyOn(manager.persistence, "schedule");

    const ok = manager.deleteFolder("overlay", "never-existed");

    expect(ok).toBe(false);
    expect(schedule).not.toHaveBeenCalled();
  });

  it("[V4-P2#1] cross-section isolation: delete base foo keeps overlay foo", () => {
    const { manager } = initFixture({
      seed: {
        folderOrder: { version: 1, sections: { overlay: ["foo"], base: ["foo"] } },
      },
      data: [
        {
          id: "b1",
          name: "Base Foo",
          role: "base",
          folder: "foo",
          layer: polygonLayer(),
        },
      ],
    });

    const ok = manager.deleteFolder("base", "foo");

    expect(ok).toBe(true);
    expect(manager.folderOrder.sections.base ?? []).not.toContain("foo");
    expect(manager.folderOrder.sections.overlay ?? []).toContain("foo");
  });

  it("[V4-P2#2] not resurrected by a *different* folder's freeze after delete", () => {
    // P2#2 regression: after deleteFolder("Roads"), a *different* folder (Water)
    // losing its last member must NOT write the just-deleted "roads" name back.
    // This deliberately uses a different folder to trigger freeze, distinguishing
    // from #911's same-name keep-alive semantics (which DOES preserve the key).
    const { manager } = initFixture({
      seed: { folderOrder: { version: 1, sections: { overlay: ["roads", "water"] } } },
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "Roads",
          layer: polygonLayer(),
        },
        {
          id: "wt1",
          name: "Water",
          role: "overlay",
          folder: "Water",
          layer: polygonLayer(),
        },
      ],
    });
    manager.deleteFolder("overlay", "Roads");
    expect(manager.folderOrder.sections.overlay ?? []).not.toContain("roads");

    // Water loses its last member -> freezeSectionOrder runs.
    manager.map.hasLayer.mockReturnValue(true);
    manager.deleteLayer("wt1");
    manager.map.hasLayer.mockReturnValue(false);

    expect(manager.folderOrder.sections.overlay ?? []).not.toContain("roads");
    expect(manager.folderOrder.sections.overlay ?? []).toContain("water");
  });

  it("[V4-2] cleanEmptyFolders: one schedule + one flushAll + returns count", () => {
    const { manager } = initFixture({
      seed: {
        folderOrder: {
          version: 1,
          sections: { overlay: ["empty1", "empty2", "full"] },
        },
      },
      data: [
        {
          id: "rd1",
          name: "Full",
          role: "overlay",
          folder: "full",
          layer: polygonLayer(),
        },
      ],
    });
    const schedule = vi.spyOn(manager.persistence, "schedule");
    const flushAll = vi.spyOn(manager.persistence, "flushAll");

    const count = manager.cleanEmptyFolders("overlay");

    expect(count).toBe(2);
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(flushAll).toHaveBeenCalledTimes(1);
    expect(manager.folderOrder.sections.overlay ?? []).toEqual(["full"]);
  });

  it("[V4-mutex] deleteFolder never goes through freezeEmptyFolder", () => {
    const { manager } = initFixture({
      seed: { folderOrder: { version: 1, sections: { overlay: ["roads"] } } },
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "Roads",
          layer: polygonLayer(),
        },
      ],
    });
    const schedule = vi.spyOn(manager.persistence, "schedule");
    const ok = manager.deleteFolder("overlay", "Roads");
    expect(ok).toBe(true);
    expect(manager.layerRegistry.get("rd1")!.folder).toBeNull();
    // If the implementation wrongly went through freezeEmptyFolder first, the
    // key would be written back then deleted (folder still null here) — but the
    // schedule count would be 2, or "roads" would survive. Pin both.
    expect(manager.folderOrder.sections.overlay ?? []).not.toContain("roads");
    expect(schedule).toHaveBeenCalledTimes(1);
  });
});
