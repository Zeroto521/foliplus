import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LayerInfo } from "#core/layer/type.js";
import { resetMapSettings, restoreDefaults } from "#foliplus/StyleKitControl/logic.js";

/** Minimal registered layer — every field a real registry entry carries, with
 *  only the style-delegation pair left overridable. */
const layer = (
  styleSetters: Record<string, (value: unknown) => void> | null = null,
  styleDefaults: (() => Record<string, unknown>) | null = null,
): LayerInfo =>
  ({
    id: "layer-1",
    name: "Layer",
    layer: null,
    visible: true,
    isBase: false,
    paneName: null,
    paneSpecs: [],
    iconSvg: null,
    type: null,
    styleSetters,
    styleDefaults,
  }) as LayerInfo;

describe("restoreDefaults", () => {
  it("returns a changed value to its Python default", () => {
    let value = "#123456";
    const setter = (v: unknown) => {
      value = v as string;
    };
    const layers = Object.freeze([
      layer({ labelColor: setter }, () => ({ labelColor: "#0000ff" })),
    ]);

    expect(value).toBe("#123456");
    expect(restoreDefaults(layers)).toBe(1);
    expect(value).toBe("#0000ff");
  });

  it("calls every delegated dimension with its own default", () => {
    const labelColor = vi.fn();
    const labelSize = vi.fn();
    const layers = Object.freeze([
      layer({ labelColor, labelSize }, () => ({
        labelColor: "#ff0000",
        labelSize: 12,
      })),
    ]);

    expect(restoreDefaults(layers)).toBe(1);
    expect(labelColor).toHaveBeenCalledWith("#ff0000");
    expect(labelSize).toHaveBeenCalledWith(12);
  });

  it("leaves a dimension alone the defaults carry no value for", () => {
    const labelColor = vi.fn();
    const labelSize = vi.fn();
    const layers = Object.freeze([
      layer({ labelColor, labelSize }, () => ({ labelColor: "#ff0000" })),
    ]);

    expect(restoreDefaults(layers)).toBe(1);
    expect(labelColor).toHaveBeenCalledWith("#ff0000");
    expect(labelSize).not.toHaveBeenCalled();
  });

  it("skips a layer that delegates no dimensions", () => {
    const layers = Object.freeze([layer(null, null), layer()]);
    expect(restoreDefaults(layers)).toBe(0);
  });

  it("counts only the layers that had a dimension written back", () => {
    const set = vi.fn();
    const skipped = vi.fn();
    const layers = Object.freeze([
      layer({ colour: set }, () => ({ colour: 1 })),
      layer({ unrelated: skipped }),
      layer(),
    ]);

    expect(restoreDefaults(layers)).toBe(1);
    expect(set).toHaveBeenCalledWith(1);
    expect(skipped).not.toHaveBeenCalled();
  });

  it("pulls the defaults fresh rather than snapshotting them", () => {
    const defaults = { current: "#ff0000" };
    const setters = { colour: vi.fn() };
    const layers = Object.freeze([
      layer({ colour: setters.colour }, () => ({ colour: defaults.current })),
    ]);

    restoreDefaults(layers);
    defaults.current = "#00ff00";
    restoreDefaults(layers);

    expect(setters.colour.mock.calls.map(c => c[0])).toEqual(["#ff0000", "#00ff00"]);
  });
});

describe("resetMapSettings", () => {
  it("clears every foliplus record this map container owns", () => {
    for (const key of [
      "foliplus_layer_state_test-map",
      "foliplus_measure_test-map",
      "foliplus_heatmap_test-map",
      "foliplus_search_test-map",
      "foliplus_export_rect_test-map",
    ]) {
      window.localStorage.setItem(key, "{}");
    }

    expect(resetMapSettings()).toBe(5);
    expect(window.localStorage.length).toBe(0);
  });

  it("leaves another map container's records alone", () => {
    window.localStorage.setItem("foliplus_layer_state_test-map", "{}");
    window.localStorage.setItem("foliplus_layer_state_other-map", "{}");
    window.localStorage.setItem("foliplus_heatmap_other-map", "{}");

    expect(resetMapSettings()).toBe(1);
    expect(window.localStorage.getItem("foliplus_layer_state_other-map")).toBe("{}");
    expect(window.localStorage.getItem("foliplus_heatmap_other-map")).toBe("{}");
    expect(window.localStorage.length).toBe(2);
  });

  it("leaves non-foliplus keys and an empty record name alone", () => {
    window.localStorage.setItem("foliplus_layer_state_test-map", "{}");
    window.localStorage.setItem("unrelated.app_setting", "1");
    window.localStorage.setItem("foliplus_", "{}");

    expect(resetMapSettings()).toBe(1);
    expect(window.localStorage.getItem("unrelated.app_setting")).toBe("1");
    expect(window.localStorage.getItem("foliplus_")).toBe("{}");
    expect(window.localStorage.length).toBe(2);
  });

  it("returns zero when this map owns no record", () => {
    window.localStorage.setItem("unrelated.key", "1");
    expect(resetMapSettings()).toBe(0);
    expect(window.localStorage.length).toBe(1);
  });

  it("deletes every match, never skipping the one behind a deletion", () => {
    for (const key of [
      "foliplus_a_test-map",
      "unrelated.middle",
      "foliplus_b_test-map",
      "unrelated.tail",
      "foliplus_c_test-map",
    ]) {
      window.localStorage.setItem(key, "x");
    }

    expect(resetMapSettings()).toBe(3);
    expect(window.localStorage.getItem("unrelated.middle")).toBe("x");
    expect(window.localStorage.getItem("unrelated.tail")).toBe("x");
    expect(window.localStorage.length).toBe(2);
  });
});
