import { describe, expect, it, vi } from "vitest";
import { initFixture } from "./ui/fixture.js";

describe("dismissFocus finalization", () => {
  it("removes focus visuals even when a pane restore throws", () => {
    window.localStorage.clear();
    const { ui } = initFixture();
    const warn = vi.spyOn(ui.log, "warn");
    const removeLayer = vi.spyOn(ui.c.map, "removeLayer");

    ui.focusController.focusedPaneRestores = [
      () => undefined,
      () => {
        throw new Error("pane gone");
      },
    ];
    const rect = {} as L.Layer;
    const mask = {} as L.Polygon;
    const renderer = {} as L.SVG;
    ui.focusController.focusRect = rect;
    ui.focusController.focusMask = mask;
    ui.focusController.focusRenderer = renderer;

    expect(() => ui.cancelFocus()).not.toThrow();

    expect(removeLayer).toHaveBeenCalledWith(rect);
    expect(removeLayer).toHaveBeenCalledWith(mask);
    expect(removeLayer).toHaveBeenCalledWith(renderer);
    expect(ui.focusController.focusRect).toBeNull();
    expect(ui.focusController.focusMask).toBeNull();
    expect(ui.focusController.focusRenderer).toBeNull();
    expect(ui.focusController.focusedPaneRestores).toEqual([]);
    expect(
      warn.mock.calls.some(call => String(call[0]).includes("pane-restore:1")),
    ).toBe(true);
  });
});
