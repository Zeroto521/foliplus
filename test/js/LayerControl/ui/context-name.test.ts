import { describe, expect, it, vi } from "vitest";
import { applyNameProjection } from "#foliplus/LayerControl/ui/context.js";
import type { LayerInfo } from "#foliplus/core/layer/index.js";

describe("ui/context applyNameProjection", () => {
  it("writes the name onto layerInfo when it differs", () => {
    const layerInfo = { id: "a", name: "old" } as LayerInfo;
    applyNameProjection(layerInfo, null, "new");
    expect(layerInfo.name).toBe("new");
  });

  it("skips the write when the name already matches", () => {
    const layerInfo = { id: "a", name: "same" } as LayerInfo;
    applyNameProjection(layerInfo, null, "same");
    expect(layerInfo.name).toBe("same");
  });

  it("is a no-op when both layerInfo and item are missing", () => {
    expect(() => applyNameProjection(null, null, "x")).not.toThrow();
  });
});
