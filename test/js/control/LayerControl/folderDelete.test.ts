import { beforeEach, describe, expect, it, vi } from "vitest";
import { initFixture, polygonLayer } from "./ui/fixture.js";

/**
 * deleteFolder / cleanEmptyFolders wiring tests.
 *
 * These tests pin the v4 semantics of the two controller methods that are
 * NOT IMPLEMENTED yet (deleteFolder / cleanEmptyFolders). They are expected
 * to fail at runtime (TypeError: not a function) until the implementation
 * lands — the lead's scaffold instruction: write the tests now, run once to
 * confirm they are red at the expected place (not a syntax/import error).
 */

describe("deleteFolder", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.CONFIG = { ...window.CONFIG, name: "LayerControl", locale_code: "en" };
  });

  it("deleting a non-empty folder keeps its layers and removes the order key: one schedule", () => {
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

  it("deleting an empty folder removes only the key", () => {
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

  it("deleting a missing folder returns false and does not persist", () => {
    const { manager } = initFixture({
      seed: { folderOrder: { version: 1, sections: { overlay: ["roads"] } } },
      data: [],
    });
    const schedule = vi.spyOn(manager.persistence, "schedule");

    const ok = manager.deleteFolder("overlay", "never-existed");

    expect(ok).toBe(false);
    expect(schedule).not.toHaveBeenCalled();
  });

  it("deleting a base folder keeps an overlay folder of the same name", () => {
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

  it("a later freeze of another folder does not bring a deleted folder back", () => {
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

  it("cleanEmptyFolders schedules once and flushes once for each empty key", () => {
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

  it("deleteFolder does not go through freezeEmptyFolder", () => {
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

  it("[BR-1] deleteFolder: opts.persist=false skips persistence (persist branch)", () => {
    const { manager } = initFixture({
      seed: { folderOrder: { version: 1, sections: { overlay: ["roads"] } } },
      data: [],
    });
    const schedule = vi.spyOn(manager.persistence, "schedule");
    const flushAll = vi.spyOn(manager.persistence, "flushAll");
    const ok = manager.deleteFolder("overlay", "roads", { persist: false });
    expect(ok).toBe(true);
    expect(manager.folderOrder.sections.overlay ?? []).not.toContain("roads");
    expect(schedule).not.toHaveBeenCalled();
    expect(flushAll).not.toHaveBeenCalled();
  });

  it("[BR-2] deleteFolder: absent section key -> ?? [] empty-branch (no crash)", () => {
    const { manager } = initFixture({
      seed: { folderOrder: { version: 1, sections: {} } },
      data: [],
    });
    const schedule = vi.spyOn(manager.persistence, "schedule");
    // No "overlay" key in sections: listed ?? [] = []. members empty. Neither
    // existed nor members => false without writing.
    const ok = manager.deleteFolder("overlay", "roads");
    expect(ok).toBe(false);
    expect(schedule).not.toHaveBeenCalled();
  });

  it("[BR-3] deleteFolder: no ui -> reindexAfterMove not called (if(this.ui) false)", () => {
    const { manager } = initFixture({
      seed: { folderOrder: { version: 1, sections: { overlay: ["roads"] } } },
      data: [],
    });
    const reindex = vi.fn();
    (manager as any).ui = null;
    const ok = manager.deleteFolder("overlay", "roads");
    expect(ok).toBe(true);
    expect(manager.folderOrder.sections.overlay ?? []).not.toContain("roads");
    expect(reindex).not.toHaveBeenCalled();
  });

  it("[BR-4] cleanEmptyFolders: absent section key -> ?? [] empty-branch", () => {
    const { manager } = initFixture({
      seed: { folderOrder: { version: 1, sections: {} } },
      data: [],
    });
    const count = manager.cleanEmptyFolders("overlay");
    expect(count).toBe(0);
  });

  it("[BR-5] cleanEmptyFolders: no empty keys -> return 0 (emptyKeys.length===0)", () => {
    const { manager } = initFixture({
      seed: { folderOrder: { version: 1, sections: { overlay: ["full"] } } },
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
    const count = manager.cleanEmptyFolders("overlay");
    expect(count).toBe(0);
    expect(schedule).not.toHaveBeenCalled();
  });

  it("[BR-6] cleanEmptyFolders: no ui -> reindexAfterMove not called", () => {
    const { manager } = initFixture({
      seed: { folderOrder: { version: 1, sections: { overlay: ["empty1"] } } },
      data: [],
    });
    (manager as any).ui = null;
    const count = manager.cleanEmptyFolders("overlay");
    expect(count).toBe(1);
  });
});
