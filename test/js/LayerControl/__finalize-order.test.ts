import { describe, expect, it, vi } from "vitest";
import { initFixture } from "./ui/fixture.js";

describe("enforceOrder isolation", () => {
  it("prices the rest of the stack and reports the layer that failed", () => {
    window.localStorage.clear();
    const { manager } = initFixture({
      data: [
        { id: "a", name: "A", group: "overlay" },
        { id: "bad", name: "Bad", group: "overlay" },
        { id: "c", name: "C", group: "overlay" },
      ],
    });
    const bad = manager.surfaceFor(manager.layerRegistry.get("bad")!);
    const c = manager.surfaceFor(manager.layerRegistry.get("c")!);
    vi.spyOn(bad, "setZ").mockImplementation(() => {
      throw new Error("no z");
    });
    const cSetZ = vi.spyOn(c, "setZ");

    const failed = manager.domain.enforceOrder();

    expect(failed).toEqual(["bad"]);
    expect(cSetZ).toHaveBeenCalled();
  });
});
