// HeatmapControl ui.ts — DOM construction and control binding.
// Every UI function reads its config from the injected ctrl.config / ctrl.T
// (set by the fixture), never from the ambient window.CONFIG — these tests
// therefore prove both the behavior and the per-instance CONFIG injection.
import { afterEach, describe, expect, it, vi } from "vitest";
import { CLASS_COUNT, METHOD } from "#core/classify.js";
import { HINT_DURATION } from "#core/hint.js";
import * as CONST from "#foliplus/HeatmapControl/const.js";
import { HeatmapManager } from "#foliplus/HeatmapControl/manager.js";
import {
  bindControls,
  initScan,
  rebuildLayerDropdown,
  resetPanel,
  setupObserver,
} from "#foliplus/HeatmapControl/ui.js";
import { makeConfig, makeCtrl, makeManager } from "./fixture.js";

/** Bind a control against the real panel template and return the pieces. */
function setup(config: ComponentConfig = makeConfig()) {
  const m = makeManager();
  const ctrl = makeCtrl(m, config);
  const panel = document.createElement("div");
  bindControls(ctrl, panel);
  return { m, ctrl, panel };
}

const fire = (el: HTMLElement, type: string) =>
  el.dispatchEvent(new Event(type, { bubbles: true }));

afterEach(() => {
  delete globalThis.h3;
  delete globalThis.chroma;
  delete globalThis.ss;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("bindControls — lifecycle hooks", () => {
  it("installs every listener cleanup and callback onto the state", () => {
    const { ctrl } = setup();
    // schemeBarCleanup is registered here, unconditionally. The other three are
    // only wired when the dropdown is opened. Declaring all of them on the
    // control class in index.ts makes a missing assignment a compile error;
    // this covers the runtime half.
    expect(ctrl.schemeBarCleanup).toBeTypeOf("function");
    expect(ctrl.schemePickerCleanup).toBeTypeOf("function");
    expect(ctrl.toggleDropdown).toBeTypeOf("function");
    expect(ctrl.selectScheme).toBeTypeOf("function");
    // Two distinct cleanup closures — close (transient) vs destroy (permanent).
    expect(ctrl.schemeBarCleanup).not.toBe(ctrl.schemePickerCleanup);
  });
});

describe("bindControls — template render and initial values", () => {
  it("renders the panel template and wires the queried elements", () => {
    const { ctrl, panel } = setup();
    expect(panel.querySelector(`[${CONST.DATA_ATTR.LAYER}]`)).toBeTruthy();
    expect(ctrl.layerSelect).toBe(panel.querySelector(`[${CONST.DATA_ATTR.LAYER}]`));
    expect(ctrl.aggSelect).toBe(panel.querySelector(`[${CONST.DATA_ATTR.AGG}]`));
    expect(ctrl.schemeBar).toBe(panel.querySelector(CONST.SEL.SCHEME_BAR));
  });

  it("initialises controls from the manager state", () => {
    const { ctrl, m } = setup();
    expect(ctrl.methodSelect.value).toBe(m.method);
    expect(ctrl.aggSelect.value).toBe(m.agg);
    expect(ctrl.classSelect.value).toBe(String(m.numClasses));
    expect(ctrl.schemeSelectHidden.value).toBe(m.scheme);
  });

  it("keeps the aggregation before a source layer is selected", () => {
    // No source yet means the field list is empty for an unknown reason, not
    // because the layer lacks numbers. Rewriting the aggregation here would
    // discard a declared agg before its layer is scanned, and persisting the
    // empty selection would consume the hasScanned guard — the next reload
    // would then skip the Python declaration entirely.
    const config = makeConfig({ agg: "sum" });
    const m = makeManager({ agg: "sum" });
    const ctrl = makeCtrl(m, config);
    bindControls(ctrl, document.createElement("div"));

    expect(m.agg).toBe(CONST.AGG.SUM);
    expect(ctrl.aggSelect.value).toBe(CONST.AGG.SUM);
    expect(
      [...ctrl.aggSelect.options].filter(o => o.disabled).map(o => o.value),
    ).toEqual(["sum", "avg", "min", "max"]);
    expect(ctrl.aggSelect.title).toBe("Needs a numeric field to aggregate by value");
    expect(ctrl.fieldWrap.classList.contains(CONST.CLASSES.HIDDEN)).toBe(true);
    // Nothing is written: a first open with a declaration must stay record-free.
    expect(window.localStorage.getItem(CONST.STORAGE.KEY)).toBeNull();
  });

  it("keeps a declared aggregation through the first scan", () => {
    // The rebuild re-scans; pin the scan so the seeded layers stay put.
    vi.spyOn(HeatmapManager.prototype, "scanMapLayers").mockImplementation(() => {});
    const config = makeConfig({ layer: "Points 1", field: "score", agg: "sum" });
    const m = makeManager({ layer: "Points 1", field: "score", agg: "sum" });
    const ctrl = makeCtrl(m, config);
    bindControls(ctrl, document.createElement("div"));
    // bindControls' pre-scan pass must not downgrade the declared agg.
    expect(m.agg).toBe(CONST.AGG.SUM);

    m.pointLayers = [{ id: "p1", name: "Points 1", layer: null, count: 1 }];
    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => [
      { lat: 1, lng: 2, marker: { feature: { properties: { score: 5 } } } },
    ]);
    rebuildLayerDropdown(ctrl);

    expect(m.selectedLayerId).toBe("p1");
    expect(m.agg).toBe(CONST.AGG.SUM);
    // The declaration is a read-time default: shown and rendered, never
    // written into the user's field or the record.
    expect(m.field).toBe("");
    expect(m.effectiveField()).toBe("score");
    expect(ctrl.aggSelect.value).toBe(CONST.AGG.SUM);
    expect(ctrl.fieldSelect.value).toBe("score");
    expect(window.localStorage.getItem(CONST.STORAGE.KEY)).toBeNull();
  });

  it("labels the method + classes row by method, with two distinct names", () => {
    // One visible label, two native selects. The row reads by its primary
    // control (the method), matching LayerControl's fill ramp row; the class
    // count keeps its own accessible name so the pair is still announced
    // separately instead of the row label twice.
    const { ctrl } = setup(
      makeConfig({
        locale_tables: {
          en: {
            "HeatmapControl.classify_method": "Method",
            "HeatmapControl.class_count": "Classes",
          },
        },
      }),
    );
    const label = ctrl.methodSelect
      .closest(".foliplus-form-row")!
      .querySelector(".foliplus-form-label");

    expect(label?.textContent).toBe("Method");
    expect(ctrl.methodSelect.getAttribute("aria-label")).toBe("Method");
    expect(ctrl.classSelect.getAttribute("aria-label")).toBe("Classes");
    expect(ctrl.methodSelect.getAttribute("aria-label")).not.toBe(
      ctrl.classSelect.getAttribute("aria-label"),
    );
  });

  it("uses the shared zh vocabulary for the same row", () => {
    const { ctrl } = setup(
      makeConfig({
        locale_code: "zh",
        locale_tables: {
          zh: {
            "HeatmapControl.classify_method": "分类方法",
            "HeatmapControl.class_count": "分级数",
          },
        },
      }),
    );
    const label = ctrl.methodSelect
      .closest(".foliplus-form-row")!
      .querySelector(".foliplus-form-label");

    expect(label?.textContent).toBe("分类方法");
    expect(ctrl.methodSelect.getAttribute("aria-label")).toBe("分类方法");
    expect(ctrl.classSelect.getAttribute("aria-label")).toBe("分级数");
    expect(ctrl.methodSelect.getAttribute("aria-label")).not.toBe(
      ctrl.classSelect.getAttribute("aria-label"),
    );
  });

  it("clamps an out-of-range manager numClasses into the select options", () => {
    const m = makeManager();
    m.numClasses = 99;
    const ctrl = makeCtrl(m, makeConfig());
    const panel = document.createElement("div");
    bindControls(ctrl, panel);
    expect(ctrl.classSelect.value).toBe(String(CLASS_COUNT.MAX));
  });

  it("populates scheme options from config.schemes and renders the bar", () => {
    const { ctrl, m } = setup();
    const options = Array.from(ctrl.schemeSelectHidden.options).map(o => o.value);
    expect(options).toEqual(["Reds", "Blues", "Greens"]);
    expect(ctrl.schemeBar.title).toBe(m.scheme);
    expect(ctrl.schemeBarInner.childElementCount).toBeGreaterThan(0);
  });
});

describe("bindControls — change handlers", () => {
  it("agg change updates the manager, reveals the field selector and persists", () => {
    const { ctrl, m } = setup();
    // The row only exists while there is a field to pick.
    m.pointLayers = [{ id: "p1", name: "P1", layer: {}, count: 2 }];
    m.selectedLayerId = "p1";
    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => [
      { lat: 1, lng: 2, marker: { feature: { properties: { sales: 5 } } } },
    ]);
    const save = vi.spyOn(m, "saveConfig");
    const render = vi.spyOn(m, "renderHexagons");
    ctrl.aggSelect.value = CONST.AGG.SUM;
    fire(ctrl.aggSelect, "change");
    expect(m.agg).toBe(CONST.AGG.SUM);
    expect(render).toHaveBeenCalled();
    expect(save).toHaveBeenCalled();
    expect(ctrl.fieldWrap.classList.contains(CONST.CLASSES.HIDDEN)).toBe(false);

    ctrl.aggSelect.value = CONST.AGG.COUNT;
    fire(ctrl.aggSelect, "change");
    expect(ctrl.fieldWrap.classList.contains(CONST.CLASSES.HIDDEN)).toBe(true);
  });

  it("field change stores the resolved field and persists", () => {
    const { ctrl, m } = setup();
    m.pointLayers = [{ id: "p1", name: "P1", layer: {}, count: 2 }];
    m.selectedLayerId = "p1";
    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => [
      {
        lat: 1,
        lng: 2,
        marker: { feature: { properties: { sales: 5, price: 10 } } },
      },
    ]);
    ctrl.aggSelect.value = CONST.AGG.SUM;
    fire(ctrl.aggSelect, "change");
    // A fresh layer resolves the first numeric field for DISPLAY only: the
    // guess is not the user's pick, so the manager and the record stay empty.
    expect(m.field).toBe("");
    expect(m.effectiveField()).toBe("sales");
    expect(ctrl.fieldSelect.value).toBe("sales");

    const save = vi.spyOn(m, "saveConfig");
    const render = vi.spyOn(m, "renderHexagons");
    ctrl.fieldSelect.value = "price";
    fire(ctrl.fieldSelect, "change");
    expect(m.field).toBe("price");
    expect(render).toHaveBeenCalled();
    expect(save).toHaveBeenCalled();
  });

  it("method change updates the manager and persists", () => {
    const { ctrl, m } = setup();
    const save = vi.spyOn(m, "saveConfig");
    const render = vi.spyOn(m, "renderHexagons");
    ctrl.methodSelect.value = METHOD.QUANTILE;
    fire(ctrl.methodSelect, "change");
    expect(m.method).toBe(METHOD.QUANTILE);
    expect(render).toHaveBeenCalled();
    expect(save).toHaveBeenCalled();
  });

  it("ignores a method the select carries but the classifier does not know", () => {
    // The select only ever holds option values, so a hand-edited DOM is the
    // only way here - and writing it through would leave the manager in a
    // state computeBreaks refuses.
    const { ctrl, m } = setup();
    const save = vi.spyOn(m, "saveConfig");
    const render = vi.spyOn(m, "renderHexagons");
    const before = m.method;
    ctrl.methodSelect.value = "bogus";
    fire(ctrl.methodSelect, "change");
    expect(m.method).toBe(before);
    expect(render).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("class-count change clamps to the valid range and persists", () => {
    const { ctrl, m } = setup();
    const save = vi.spyOn(m, "saveConfig");
    ctrl.classSelect.value = "4";
    fire(ctrl.classSelect, "change");
    expect(m.numClasses).toBe(4);
    expect(save).toHaveBeenCalled();
  });

  it("class-count change refreshes the bars of an open dropdown", () => {
    const { ctrl } = setup();
    ctrl.schemeBar.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const bars = () =>
      Array.from(ctrl.schemeDropdown!.querySelectorAll(".foliplus-scheme-picker-bar"));
    expect(bars().length).toBe(3);
    ctrl.classSelect.value = "4";
    fire(ctrl.classSelect, "change");
    expect(bars().length).toBe(3);
    bars().forEach(bar => expect(bar.childElementCount).toBeGreaterThan(0));
  });

  it("hidden scheme select change applies the scheme and persists", () => {
    const { ctrl, m } = setup();
    const save = vi.spyOn(m, "saveConfig");
    const render = vi.spyOn(m, "renderHexagons");
    ctrl.schemeSelectHidden.value = "Blues";
    fire(ctrl.schemeSelectHidden, "change");
    expect(m.scheme).toBe("Blues");
    expect(ctrl.schemeBar.title).toBe("Blues");
    expect(render).toHaveBeenCalled();
    expect(save).toHaveBeenCalled();
  });

  it("field change emits LAYER_STYLE_CHANGE so the drawer refreshes", () => {
    const { ctrl, m } = setup();
    const emitSpy = vi.spyOn(m.events, "publish");
    ctrl.fieldSelect.value = "sales";
    fire(ctrl.fieldSelect, "change");
    expect(emitSpy).toHaveBeenCalledWith("foliplus:layer:style-change", {
      id: m.layerId,
    });
  });
});

describe("bindControls — clear (reset) button", () => {
  it("resets every control to config defaults and collapses the panel", () => {
    const config = makeConfig({
      color_scheme: "Blues",
      num_classes: 4,
      method: "equal",
    });
    const { ctrl, m, panel } = setup(config);
    m.selectedLayerId = "p1";
    m.agg = CONST.AGG.SUM;
    m.field = "x";
    m.scheme = "Greens";
    m.numClasses = 8;
    m.method = "quantile";

    const clearBtn = panel.querySelector(
      `[${CONST.DATA_ATTR.BTN_CLEAR}]`,
    ) as HTMLButtonElement;
    const clearSaved = vi.spyOn(m, "clearSavedConfig");
    clearBtn.click();

    expect(m.selectedLayerId).toBeNull();
    expect(m.agg).toBe(CONST.AGG.COUNT);
    expect(m.field).toBe("");
    expect(m.numClasses).toBe(config.num_classes);
    expect(m.method).toBe(config.method);
    expect(m.scheme).toBe(config.color_scheme);
    expect(clearSaved).toHaveBeenCalledTimes(1);

    expect(ctrl.extraBody.classList.contains(CONST.CLASSES.HIDDEN)).toBe(true);
    expect(ctrl.ctrl.classList.contains(CONST.CLASSES.COLLAPSED)).toBe(true);
    expect(ctrl.ctrl.classList.contains(CONST.CLASSES.EXPANDED)).toBe(false);

    expect(ctrl.aggSelect.value).toBe(CONST.AGG.COUNT);
    expect(ctrl.classSelect.value).toBe(String(config.num_classes));
    expect(ctrl.methodSelect.value).toBe(config.method);
    expect(ctrl.schemeSelectHidden.value).toBe(config.color_scheme);
  });

  it("clear drops the LayerControl-side record too, so a redraw starts clean", () => {
    // clearSavedConfig only removes the heatmap's own key. The intent row
    // (visibility / opacity) lives under LayerControl's key, so without the
    // second call a redraw inherited the tuning the user arranged before.
    const { ctrl, m, panel } = setup(makeConfig({}));
    const clearSaved = vi.spyOn(m, "clearSavedConfig");
    const clearLayerState = vi.spyOn(m, "clearLayerState");

    (
      panel.querySelector(`[${CONST.DATA_ATTR.BTN_CLEAR}]`) as HTMLButtonElement
    ).click();

    expect(clearSaved).toHaveBeenCalledTimes(1);
    expect(clearLayerState).toHaveBeenCalledTimes(1);
    expect(ctrl.ctrl.classList.contains(CONST.CLASSES.COLLAPSED)).toBe(true);
  });

  it("clear falls back to library defaults when config omits style fields", () => {
    // Python may emit a CONFIG that omits optional style fields entirely —
    // reset must fall back to the library defaults in that case.
    const { ctrl, m, panel } = setup(
      makeConfig({
        color_scheme: undefined,
        method: undefined,
        num_classes: undefined,
        field: undefined,
      }),
    );
    m.scheme = "Greens";
    m.numClasses = 8;
    m.method = "quantile";
    const clearBtn = panel.querySelector(
      `[${CONST.DATA_ATTR.BTN_CLEAR}]`,
    ) as HTMLButtonElement;
    clearBtn.click();

    expect(m.scheme).toBe("Reds");
    expect(m.numClasses).toBe(CLASS_COUNT.DEFAULT);
    expect(m.method).toBe(METHOD.JENKS);
    expect(m.field).toBe("");
    expect(ctrl.aggSelect.value).toBe(CONST.AGG.COUNT);
  });
});

describe("resetPanel — shared reset (Clear button + more-menu clear)", () => {
  it("resets state, canvas, and every dropdown back to the declared defaults", () => {
    const config = makeConfig({
      color_scheme: "Blues",
      num_classes: 4,
      method: "equal",
    });
    const { ctrl, m } = setup(config);
    m.selectedLayerId = "p1";
    m.agg = CONST.AGG.SUM;
    m.field = "price";
    m.scheme = "Greens";
    m.numClasses = 8;
    m.method = "quantile";
    m.cachedFeatures = [] as never;

    resetPanel(ctrl);

    expect(m.selectedLayerId).toBeNull();
    expect(m.agg).toBe(CONST.AGG.COUNT);
    expect(m.field).toBe("");
    expect(m.method).toBe(config.method);
    expect(m.scheme).toBe(config.color_scheme);
    expect(m.numClasses).toBe(config.num_classes);
    expect(m.cachedFeatures).toBeNull();

    expect(ctrl.layerSelect.value).toBe("");
    expect(ctrl.aggSelect.value).toBe(CONST.AGG.COUNT);
    expect(ctrl.classSelect.value).toBe(String(config.num_classes));
    expect(ctrl.methodSelect.value).toBe(config.method);
    expect(ctrl.schemeSelectHidden.value).toBe(config.color_scheme);
    // The field row goes back to no selection with no options to show — it is
    // hidden under the count aggregation anyway.
    expect(ctrl.fieldSelect.value).toBe("");
    expect(ctrl.fieldSelect.querySelectorAll("option").length).toBe(0);
    expect(ctrl.extraBody.classList.contains(CONST.CLASSES.HIDDEN)).toBe(true);
  });

  it("keeps the CONFIG aggregation through a reset with no numeric field", () => {
    // The reset restores the author's default. With no layer selected there is
    // nothing to prove the default unusable, so it is kept (and nothing is
    // written): only a SELECTED layer without numeric fields falls back to count.
    const { ctrl, m } = setup(makeConfig({ agg: "sum" }));

    resetPanel(ctrl);

    expect(m.agg).toBe(CONST.AGG.SUM);
    expect(ctrl.aggSelect.value).toBe(CONST.AGG.SUM);
    expect(
      [...ctrl.aggSelect.options].filter(o => o.disabled).map(o => o.value),
    ).toEqual(["sum", "avg", "min", "max"]);
    expect(ctrl.aggSelect.title).toBe("Needs a numeric field to aggregate by value");
    expect(window.localStorage.getItem(CONST.STORAGE.KEY)).toBeNull();
  });

  it("leaves the panel open and the persisted record alone", () => {
    // Only the Clear button's own handler collapses the panel and clears the
    // record — the more-menu clear keeps the panel open for the next pick.
    const removeItem = vi.spyOn(window.localStorage, "removeItem");
    const { ctrl } = setup();
    ctrl.ctrl.classList.add(CONST.CLASSES.EXPANDED);

    resetPanel(ctrl);

    expect(ctrl.ctrl.classList.contains(CONST.CLASSES.EXPANDED)).toBe(true);
    expect(ctrl.ctrl.classList.contains(CONST.CLASSES.COLLAPSED)).toBe(false);
    expect(removeItem).not.toHaveBeenCalled();
  });
});

describe("bindControls — scheme dropdown", () => {
  it("scheme bar click opens the dropdown with one item per config scheme", () => {
    const { ctrl } = setup();
    ctrl.schemeBar.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(ctrl.schemeDropdown).not.toBeNull();
    expect(ctrl.schemeDropdown!.children.length).toBe(3);
    expect(ctrl.schemeBar.classList.contains(CONST.CLASSES.SCHEME_BAR_OPEN)).toBe(true);
  });

  it("portals the dropdown to the document host", () => {
    // The style drawer's picker already ports its list: the shared placement
    // decision (flip above a trigger near the viewport bottom) lives there, and
    // the panel's scroll box would otherwise clip an inline list. Both
    // consumers must mount the same way or their flip behaviour splits again.
    const { ctrl } = setup();
    ctrl.schemeBar.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(
      ctrl.schemeDropdown!.classList.contains("foliplus-scheme-picker-portal"),
    ).toBe(true);
    expect(ctrl.schemeDropdown!.parentElement).toBe(document.body);
  });

  it("clicking the scheme bar again closes the dropdown", () => {
    const { ctrl } = setup();
    ctrl.schemeBar.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    ctrl.schemeBar.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(ctrl.schemeDropdown).toBeNull();
    expect(ctrl.schemeBar.classList.contains(CONST.CLASSES.SCHEME_BAR_OPEN)).toBe(
      false,
    );
  });

  it("selecting a dropdown item applies the config scheme and persists", () => {
    const { ctrl, m } = setup();
    const save = vi.spyOn(m, "saveConfig");
    const render = vi.spyOn(m, "renderHexagons");
    ctrl.schemeBar.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const items = ctrl.schemeDropdown!.querySelectorAll(".foliplus-scheme-picker-item");
    (items[1] as HTMLElement).click();
    expect(m.scheme).toBe("Blues");
    expect(ctrl.schemeSelectHidden.value).toBe("Blues");
    expect(ctrl.schemeDropdown).toBeNull();
    expect(render).toHaveBeenCalled();
    expect(save).toHaveBeenCalled();
  });

  it("outside click closes the open dropdown", () => {
    const { ctrl } = setup();
    ctrl.toggleSchemeDropdown();
    expect(ctrl.schemeDropdown).not.toBeNull();
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(ctrl.schemeDropdown).toBeNull();
    expect(ctrl.schemeBar.classList.contains(CONST.CLASSES.SCHEME_BAR_OPEN)).toBe(
      false,
    );
  });

  it("selectScheme by index applies the config scheme and persists", () => {
    const { ctrl, m } = setup();
    const save = vi.spyOn(m, "saveConfig");
    const render = vi.spyOn(m, "renderHexagons");
    ctrl.selectScheme?.(1);
    expect(m.scheme).toBe("Blues");
    expect(ctrl.schemeSelectHidden.value).toBe("Blues");
    expect(render).toHaveBeenCalled();
    expect(save).toHaveBeenCalled();
  });

  it("selectScheme with an out-of-range index is a no-op", () => {
    const { ctrl, m } = setup();
    const save = vi.spyOn(m, "saveConfig");
    ctrl.selectScheme?.(99);
    expect(m.scheme).toBe("Reds");
    expect(save).not.toHaveBeenCalled();
  });

  it("focuses the first item when the current scheme is not in config.schemes", () => {
    const { ctrl, m } = setup();
    // Manager state comes from window.CONFIG at construction, so move it off the
    // scheme list to force the fallback focus branch.
    m.scheme = "NoSuchScheme";
    ctrl.schemeBar.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(ctrl.schemeDropdown).not.toBeNull();
    const items = ctrl.schemeDropdown!.querySelectorAll(".foliplus-scheme-picker-item");
    expect(items.length).toBe(3);
  });

  it("tolerates a CONFIG without schemes (optional in the Python API)", () => {
    const { ctrl } = setup(makeConfig({ schemes: undefined }));
    expect(ctrl.schemeSelectHidden.options.length).toBe(0);
    ctrl.schemeBar.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(ctrl.schemeDropdown).not.toBeNull();
    expect(ctrl.schemeDropdown!.children.length).toBe(0);
  });

  it("closeSchemeDropdown delegate closes the open dropdown", () => {
    const { ctrl } = setup();
    ctrl.toggleSchemeDropdown();
    expect(ctrl.schemeDropdown).not.toBeNull();

    ctrl.closeSchemeDropdown(new MouseEvent("click"));

    expect(ctrl.schemeDropdown).toBeNull();
    expect(ctrl.schemeBar.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes the portalled dropdown when the panel collapses", async () => {
    const { ctrl } = setup();
    document.body.appendChild(ctrl.ctrl);
    setupObserver(ctrl);
    ctrl.ctrl.classList.add(CONST.CLASSES.EXPANDED);
    ctrl.schemeBar.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(ctrl.schemeDropdown).not.toBeNull();

    // The header and the close button collapse through this class change; the
    // portalled list is not inside the panel, so nothing else would remove it.
    ctrl.ctrl.classList.remove(CONST.CLASSES.EXPANDED);
    ctrl.ctrl.classList.add(CONST.CLASSES.COLLAPSED);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(ctrl.schemeDropdown).toBeNull();
    expect(document.querySelector(".foliplus-scheme-picker-portal")).toBeNull();
    expect(ctrl.schemeBar.getAttribute("aria-expanded")).toBe("false");
    ctrl.observer?.disconnect();
  });

  it("does not leak a document listener across open/collapse cycles", async () => {
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    const { ctrl } = setup();
    document.body.appendChild(ctrl.ctrl);
    setupObserver(ctrl);
    const baseline =
      add.mock.calls.filter(call => call[0] === "click").length -
      remove.mock.calls.filter(call => call[0] === "click").length;

    for (let i = 0; i < 3; i += 1) {
      ctrl.ctrl.classList.add(CONST.CLASSES.EXPANDED);
      ctrl.schemeBar.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(ctrl.schemeDropdown).not.toBeNull();
      ctrl.ctrl.classList.remove(CONST.CLASSES.EXPANDED);
      ctrl.ctrl.classList.add(CONST.CLASSES.COLLAPSED);
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(ctrl.schemeDropdown).toBeNull();
    }

    const live =
      add.mock.calls.filter(call => call[0] === "click").length -
      remove.mock.calls.filter(call => call[0] === "click").length;
    expect(live).toBe(baseline);
    ctrl.observer?.disconnect();
  });

  it("schemePickerCleanup destroys the picker and clears the control reference", () => {
    const { ctrl } = setup();
    ctrl.toggleSchemeDropdown();
    expect(ctrl.schemePicker).not.toBeNull();

    ctrl.schemePickerCleanup?.();

    expect(ctrl.schemePicker).toBeNull();
    expect(ctrl.schemeDropdown).toBeNull();
    // destroy(), not close(): the trigger no longer carries the combobox state.
    expect(ctrl.schemeBar.hasAttribute("aria-expanded")).toBe(false);
    expect(ctrl.schemeBar.hasAttribute("aria-controls")).toBe(false);
    // The compat delegates stay null-safe after the picker is gone.
    expect(() => ctrl.toggleDropdown?.()).not.toThrow();
  });
});

describe("layer dropdown change handler", () => {
  beforeEach(() => {
    vi.spyOn(HeatmapManager.prototype, "scanMapLayers").mockImplementation(function () {
      // no-op: keep the seeded pointLayers stable across rebuilds
    });
  });

  it("selecting a layer reveals the extra body, renders and persists", () => {
    const m = makeManager();
    m.pointLayers = [{ id: "p1", name: "P1", layer: {}, count: 2 }];
    const ctrl = makeCtrl(m, makeConfig());
    rebuildLayerDropdown(ctrl);

    const save = vi.spyOn(m, "saveConfig");
    const render = vi.spyOn(m, "renderHexagons");
    ctrl.layerSelect.value = "p1";
    fire(ctrl.layerSelect, "change");

    expect(m.selectedLayerId).toBe("p1");
    expect(ctrl.extraBody.classList.contains(CONST.CLASSES.HIDDEN)).toBe(false);
    expect(render).toHaveBeenCalled();
    expect(save).toHaveBeenCalled();
  });

  it("clearing the selection hides the extra body and clears the canvas", () => {
    const m = makeManager();
    m.pointLayers = [{ id: "p1", name: "P1", layer: {}, count: 2 }];
    m.selectedLayerId = "p1";
    const ctrl = makeCtrl(m, makeConfig());
    rebuildLayerDropdown(ctrl);

    const clear = vi.spyOn(m, "clearHeatmapCanvas");
    ctrl.layerSelect.value = "";
    fire(ctrl.layerSelect, "change");

    expect(m.selectedLayerId).toBeNull();
    expect(ctrl.extraBody.classList.contains(CONST.CLASSES.HIDDEN)).toBe(true);
    expect(clear).toHaveBeenCalled();
  });
});

describe("layer dropdown — source meta publish", () => {
  beforeEach(() => {
    vi.spyOn(HeatmapManager.prototype, "scanMapLayers").mockImplementation(function () {
      // no-op: keep the seeded pointLayers stable across rebuilds
    });
  });

  it("publishes source layer + field when a layer is selected", () => {
    const m = makeManager();
    m.pointLayers = [{ id: "p1", name: "Stores", layer: {}, count: 2 }];
    const ctrl = makeCtrl(m, makeConfig());
    const panel = document.createElement("div");
    bindControls(ctrl, panel);
    rebuildLayerDropdown(ctrl);

    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => [
      {
        lat: 1,
        lng: 2,
        marker: { feature: { properties: { sales: 5 } } },
      },
    ]);
    ctrl.aggSelect.value = CONST.AGG.SUM;
    fire(ctrl.aggSelect, "change");
    ctrl.layerSelect.value = "p1";
    fire(ctrl.layerSelect, "change");

    expect(m.agg).toBe(CONST.AGG.SUM);
    expect(m.sourceMeta["HeatmapControl.meta_source_layer"]).toBe("Stores");
    expect(m.sourceMeta["HeatmapControl.meta_agg_field"]).toBe("sales");
    // The attrs panel renders every meta entry as a row, so the record must
    // carry only these two: an internal source-layer id would leak as
    // "meta_source_layer_id" on the panel.
    expect(Object.keys(m.sourceMeta).sort()).toEqual([
      "HeatmapControl.meta_agg_field",
      "HeatmapControl.meta_source_layer",
    ]);
    expect(window.map.foliplus.LayerAPI.touchLayer).toHaveBeenCalledWith(m.layerId);
  });

  it("clears the published rows when the selection is cleared", () => {
    const m = makeManager();
    m.pointLayers = [{ id: "p1", name: "Stores", layer: {}, count: 1 }];
    m.selectedLayerId = "p1";
    m.sourceMeta["HeatmapControl.meta_source_layer"] = "Stores";
    m.sourceMeta["HeatmapControl.meta_agg_field"] = "sales";
    const ctrl = makeCtrl(m, makeConfig());
    rebuildLayerDropdown(ctrl);

    ctrl.layerSelect.value = "";
    fire(ctrl.layerSelect, "change");

    expect(m.sourceMeta["HeatmapControl.meta_source_layer"]).toBe("");
    expect(m.sourceMeta["HeatmapControl.meta_agg_field"]).toBe("");
  });

  it("resolves the field for display on a restored selection, without a record write", () => {
    const m = makeManager();
    // Restored from localStorage: layer already selected, field not yet set.
    m.pointLayers = [{ id: "p1", name: "Stores", layer: {}, count: 2 }];
    m.selectedLayerId = "p1";
    m.agg = "avg";
    m.field = "";
    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => [
      {
        lat: 1,
        lng: 2,
        marker: { feature: { properties: { dwell: 12 } } },
      },
    ]);

    const ctrl = makeCtrl(m, makeConfig());
    rebuildLayerDropdown(ctrl);

    // The guess feeds the row and the attrs panel, and stops there: it is not
    // the user's pick, so it must not become one in the record.
    expect(m.field).toBe("");
    expect(m.effectiveField()).toBe("dwell");
    expect(m.agg).toBe("avg");
    expect(window.localStorage.getItem(CONST.STORAGE.KEY)).toBeNull();
    expect(m.sourceMeta["HeatmapControl.meta_source_layer"]).toBe("Stores");
    expect(m.sourceMeta["HeatmapControl.meta_agg_field"]).toBe("dwell");
  });

  it("keeps a stale stored field and displays the fallback", () => {
    const m = makeManager();
    m.pointLayers = [{ id: "p1", name: "Stores", layer: {}, count: 1 }];
    m.selectedLayerId = "p1";
    m.agg = "sum";
    m.field = "old_field";
    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => [
      {
        lat: 1,
        lng: 2,
        marker: { feature: { properties: { sales: 5 } } },
      },
    ]);

    const ctrl = makeCtrl(m, makeConfig());
    rebuildLayerDropdown(ctrl);

    // The fallback is what the row and the map use right now; the stored pick
    // is the user's intent and survives, so it comes back with its column.
    expect(m.field).toBe("old_field");
    expect(m.effectiveField()).toBe("sales");
    expect(ctrl.fieldSelect.value).toBe("sales");
  });

  it("preserves a field that is still in the layer's fields", () => {
    const m = makeManager();
    m.pointLayers = [{ id: "p1", name: "Stores", layer: {}, count: 1 }];
    m.selectedLayerId = "p1";
    m.agg = "sum";
    m.field = "sales";
    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => [
      {
        lat: 1,
        lng: 2,
        marker: { feature: { properties: { sales: 5, price: 10 } } },
      },
    ]);

    const ctrl = makeCtrl(m, makeConfig());
    rebuildLayerDropdown(ctrl);

    expect(m.field).toBe("sales");
  });
});

describe("setupObserver", () => {
  const flush = () => new Promise(resolve => setTimeout(resolve, 0));

  it("rebuilds the layer dropdown once per expand", async () => {
    vi.spyOn(HeatmapManager.prototype, "scanMapLayers").mockImplementation(function () {
      // no-op: keep the seeded layer state stable across rebuilds
    });
    const m = makeManager();
    const ctrl = makeCtrl(m, makeConfig());
    document.body.appendChild(ctrl.ctrl);
    setupObserver(ctrl);

    ctrl.ctrl.classList.add(CONST.CLASSES.EXPANDED);
    await flush();
    expect(ctrl.expandHookDone).toBe(true);
    // The placeholder option is the only entry with no point layers.
    expect(ctrl.layerSelect.querySelectorAll("option").length).toBe(1);

    ctrl.ctrl.classList.remove(CONST.CLASSES.EXPANDED);
    ctrl.ctrl.classList.add(CONST.CLASSES.COLLAPSED);
    await flush();
    expect(ctrl.expandHookDone).toBe(false);

    ctrl.ctrl.classList.remove(CONST.CLASSES.COLLAPSED);
    ctrl.ctrl.classList.add(CONST.CLASSES.EXPANDED);
    await flush();
    expect(ctrl.expandHookDone).toBe(true);
    ctrl.observer?.disconnect();
  });
});

describe("initScan — hints keyed by the injected config", () => {
  it("shows the localized no_layercontrol hint using ctrl.config, not window.CONFIG", async () => {
    const m = makeManager();
    // Ambient CONFIG differs from the injected ctrl.config — the hint must key on
    // the latter (the whole point of the config-carrying state object).
    window.CONFIG = { ...window.CONFIG, name: "SomeOtherControl" };
    const ctrl = makeCtrl(m, makeConfig());
    const showHint = vi.fn();
    (m.map as unknown as { foliplus: unknown }).foliplus = {
      LayerAPI: { isLayerControl: false },
      showHint,
    };

    vi.useFakeTimers();
    initScan(ctrl);
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();

    expect(showHint).toHaveBeenCalledWith(
      "HeatmapControl",
      expect.stringContaining("requires LayerControl"),
      HINT_DURATION.LONG,
    );
  });

  it("distinguishes a present-but-empty LayerControl via the no_layer hint", async () => {
    const m = makeManager();
    const ctrl = makeCtrl(m, makeConfig());
    const showHint = vi.fn();
    (m.map as unknown as { foliplus: unknown }).foliplus = {
      LayerAPI: { isLayerControl: true },
      showHint,
    };

    vi.useFakeTimers();
    initScan(ctrl);
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();

    expect(showHint).toHaveBeenCalledWith(
      "HeatmapControl",
      expect.stringContaining("No point layers found"),
      HINT_DURATION.LONG,
    );
  });
});

describe("bindControls — saved-config restore", () => {
  it("applies a persisted config on first bind", () => {
    // Seed a saved record so the first bindControls run rehydrates state.
    // A restored source also defers the field/aggregation resolution to
    // initScan — the layer's fields are not known during bind.
    window.localStorage.setItem(
      CONST.STORAGE.KEY,
      JSON.stringify({
        layerId: "p1",
        scheme: "Blues",
        numClasses: 4,
        agg: "sum",
      }),
    );
    const m = makeManager();
    const ctrl = makeCtrl(m, makeConfig());
    const panel = document.createElement("div");
    bindControls(ctrl, panel);
    expect(m.scheme).toBe("Blues");
    expect(m.numClasses).toBe(4);
    expect(m.agg).toBe(CONST.AGG.SUM);
  });
});

describe("bindControls — class count clamping", () => {
  it("class-count change falls back to DEFAULT when the value is not a number", () => {
    const { ctrl, m } = setup();
    ctrl.classSelect.value = "not-a-number";
    fire(ctrl.classSelect, "change");
    expect(m.numClasses).toBe(CLASS_COUNT.DEFAULT);
  });

  it("class-count change falls back to DEFAULT for zero", () => {
    const { ctrl, m } = setup();
    ctrl.classSelect.value = "0";
    fire(ctrl.classSelect, "change");
    expect(m.numClasses).toBe(CLASS_COUNT.DEFAULT);
  });
});

describe("selectScheme — CONFIG.schemes edge cases", () => {
  it("selectScheme with an out-of-range index when schemes is missing is a no-op", () => {
    const { ctrl, m } = setup(makeConfig({ schemes: undefined }));
    const save = vi.spyOn(m, "saveConfig");
    ctrl.selectScheme?.(0);
    expect(m.scheme).toBe("Reds");
    expect(save).not.toHaveBeenCalled();
  });
});

// A scheme restored from storage (persistence accepts any string — it is a
// chroma palette name) or a CONFIG.color_scheme outside CONFIG.schemes used to
// reach createSchemePicker's RangeError and abort the whole control build.
// The panel clamps to the first offered scheme instead.
describe("scheme validation — restored scheme no longer offered", () => {
  it("clamps a manager scheme that config.schemes does not offer", () => {
    const m = makeManager();
    m.scheme = "Viridis"; // storage written under an older `schemes` kwarg
    const ctrl = makeCtrl(m, makeConfig({ schemes: ["Reds", "Blues"] }));
    const panel = document.createElement("div");
    expect(() => bindControls(ctrl, panel)).not.toThrow();
    expect(m.scheme).toBe("Reds");
    expect(ctrl.schemeSelectHidden.value).toBe("Reds");
    expect(ctrl.schemeBar.title).toBe("Reds");
    expect(ctrl.schemePicker).not.toBeNull();
  });

  it("resetPanel clamps config.color_scheme that is not in config.schemes", () => {
    const { ctrl, m } = setup(
      makeConfig({ color_scheme: "Viridis", schemes: ["Reds", "Blues"] }),
    );
    expect(() => resetPanel(ctrl)).not.toThrow();
    expect(m.scheme).toBe("Reds");
    expect(ctrl.schemeSelectHidden.value).toBe("Reds");
    expect(ctrl.schemeBar.title).toBe("Reds");
  });

  it("clamps when config.schemes is empty (any value is allowed)", () => {
    const { ctrl, m } = setup(makeConfig({ schemes: [] }));
    expect(ctrl.schemePicker).not.toBeNull();
    expect(m.scheme).toBe("Reds");
  });
});

// The picker factory carries no locale table; the panel's translator must name
// the trigger. Regression for the hardcoded English "Color scheme" label.
describe("scheme trigger accessible name", () => {
  it("uses the panel translator for aria-label", () => {
    const { ctrl } = setup();
    expect(ctrl.schemeBar.getAttribute("aria-label")).toBe(ctrl.T("scheme"));
  });

  it("resolves the localized label from the locale tables", () => {
    const config = makeConfig({
      locale_code: "zh",
      locale_tables: { zh: { "HeatmapControl.scheme": "色带" } },
    });
    const { ctrl } = setup(config);
    expect(ctrl.T("scheme")).toBe("色带");
    expect(ctrl.schemeBar.getAttribute("aria-label")).toBe("色带");
  });
});

// closeSchemeDropdown — covered by schemePicker.test.ts (outside-click tests)

// toggleSchemeDropdown — covered by schemePicker.test.ts (trigger click tests)

describe("buildLayerListItems — null extraBody tolerance", () => {
  beforeEach(() => {
    vi.spyOn(HeatmapManager.prototype, "scanMapLayers").mockImplementation(function () {
      // no-op: keep the seeded pointLayers stable across rebuilds
    });
  });
  it("auto-select path tolerates a null extraBody", () => {
    const m = makeManager();
    m.pointLayers = [{ id: "p1", name: "P1", layer: {}, count: 1 }];
    m.hasScanned = false;
    m.selectedLayerId = null;
    const ctrl = makeCtrl(m, makeConfig());
    ctrl.extraBody = null as any;
    expect(() => rebuildLayerDropdown(ctrl)).not.toThrow();
    expect(m.selectedLayerId).toBe("p1");
  });

  it("layer-select change tolerates a null extraBody", () => {
    const m = makeManager();
    m.pointLayers = [{ id: "p1", name: "P1", layer: {}, count: 1 }];
    const ctrl = makeCtrl(m, makeConfig());
    rebuildLayerDropdown(ctrl);
    ctrl.extraBody = null as any;
    ctrl.layerSelect.value = "p1";
    fire(ctrl.layerSelect, "change");
    expect(m.selectedLayerId).toBe("p1");
  });

  it("buildLayerListItems tail tolerates a null extraBody", () => {
    const m = makeManager();
    m.pointLayers = [{ id: "p1", name: "P1", layer: {}, count: 1 }];
    const ctrl = makeCtrl(m, makeConfig());
    ctrl.extraBody = null as any;
    rebuildLayerDropdown(ctrl);
    expect(ctrl.layerSelect.value).toBe("p1");
  });
});

describe("rebuildLayerDropdown — null layerSelect", () => {
  it("no-ops when layerSelect is null", () => {
    const m = makeManager();
    const ctrl = makeCtrl(m, makeConfig());
    ctrl.layerSelect = null as any;
    expect(() => rebuildLayerDropdown(ctrl)).not.toThrow();
  });
});

describe("updateFieldSelector — concrete field resolution", () => {
  const seed = (fields: Record<string, string | number>) => {
    const { ctrl, m } = setup();
    m.pointLayers = [{ id: "p1", name: "P1", layer: {}, count: 1 }];
    m.selectedLayerId = "p1";
    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => [
      { lat: 1, lng: 2, marker: { feature: { properties: { ...fields } } } },
    ]);
    ctrl.aggSelect.value = CONST.AGG.SUM;
    fire(ctrl.aggSelect, "change");
    return { ctrl, m };
  };

  it("lists only real fields — no disabled empty option remains", () => {
    const { ctrl } = seed({ sales: 5, price: 10 });
    const options = Array.from(ctrl.fieldSelect.options);
    expect(options.map(o => o.value)).toEqual(["sales", "price"]);
    expect(options.some(o => o.disabled)).toBe(false);
    expect(ctrl.fieldSelect.querySelector("option[value='']")).toBeNull();
  });

  it("shows the first numeric field on a fresh layer without storing it", () => {
    const { ctrl, m } = seed({ sales: 5, price: 10 });
    expect(m.field).toBe("");
    expect(m.effectiveField()).toBe("sales");
    expect(ctrl.fieldSelect.value).toBe("sales");
  });

  it("keeps an explicit choice selected across rebuilds", () => {
    const { ctrl, m } = seed({ sales: 5, price: 10 });
    ctrl.fieldSelect.value = "price";
    fire(ctrl.fieldSelect, "change");
    expect(m.field).toBe("price");
    // A later rebuild (layer re-selection) must not snap back to the first field.
    fire(ctrl.aggSelect, "change");
    expect(ctrl.fieldSelect.value).toBe("price");
    expect(m.field).toBe("price");
  });

  it("does not persist the resolved field (the guess is not a record)", () => {
    const { m } = seed({ sales: 5, price: 10 });
    expect(m.effectiveField()).toBe("sales");
    // The agg change that ran the scan did write a record (it persists the
    // aggregation), but the field key is the empty sentinel: nothing guessed
    // its way in, and the loaded record carries no field at all.
    const stored = JSON.parse(window.localStorage.getItem(CONST.STORAGE.KEY)!);
    expect(stored.field).toBe("");
    expect(m.loadSavedConfig()?.field).toBeUndefined();
  });

  it("follows the data while the user has not picked a field", () => {
    const { ctrl, m } = seed({ sales: 5 });
    expect(ctrl.fieldSelect.value).toBe("sales");

    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => [
      { lat: 1, lng: 2, marker: { feature: { properties: { cost: 3, sales: 5 } } } },
    ]);
    fire(ctrl.aggSelect, "change");

    // Nothing was stored, so the display tracks the new first field.
    expect(m.field).toBe("");
    expect(ctrl.fieldSelect.value).toBe("cost");
  });

  it("hides the field row when the source has no numeric field", () => {
    const { ctrl, m } = seed({ name: "x", label: "y" });
    expect(m.field).toBe("");
    expect(ctrl.fieldSelect.options.length).toBe(0);
    expect(ctrl.fieldWrap.classList.contains(CONST.CLASSES.HIDDEN)).toBe(true);
  });

  it("falls back to count when no numeric field exists", () => {
    const { ctrl, m } = seed({ name: "x" });
    expect(
      [...ctrl.aggSelect.options].filter(o => o.disabled).map(o => o.value),
    ).toEqual(["sum", "avg", "min", "max"]);
    // One value for display, render and persistence.
    expect(m.agg).toBe(CONST.AGG.COUNT);
    expect(ctrl.aggSelect.value).toBe(CONST.AGG.COUNT);
    expect(ctrl.aggSelect.title).toBe("Needs a numeric field to aggregate by value");
    expect(ctrl.fieldWrap.classList.contains(CONST.CLASSES.HIDDEN)).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(CONST.STORAGE.KEY)!).agg).toBe(
      "count",
    );
  });

  it("hides the field row when no source layer is selected", () => {
    const { ctrl, m } = setup();
    expect(m.selectedLayerId).toBeNull();
    ctrl.aggSelect.value = CONST.AGG.SUM;
    fire(ctrl.aggSelect, "change");
    // No source yet is not the same as "the source has no numeric field":
    // the aggregation is kept (a declared agg must survive until its layer is
    // scanned) and nothing is persisted — the options simply disable.
    expect(m.agg).toBe(CONST.AGG.SUM);
    expect(ctrl.aggSelect.value).toBe(CONST.AGG.SUM);
    expect(
      [...ctrl.aggSelect.options].filter(o => o.disabled).map(o => o.value),
    ).toEqual(["sum", "avg", "min", "max"]);
    expect(ctrl.fieldWrap.classList.contains(CONST.CLASSES.HIDDEN)).toBe(true);
  });

  it("does not clear a stored field when the scan is momentarily empty", () => {
    const { ctrl, m } = seed({ sales: 5 });
    // The user picks explicitly, so this name is a real stored choice.
    ctrl.fieldSelect.value = "sales";
    fire(ctrl.fieldSelect, "change");
    expect(m.field).toBe("sales");

    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => []);
    fire(ctrl.aggSelect, "change");

    // The empty scan cannot prove the column is gone, so the pick survives.
    expect(m.field).toBe("sales");
    expect(m.agg).toBe(CONST.AGG.COUNT);
    expect(m.sourceMeta["HeatmapControl.meta_agg_field"]).toBe("");
  });

  it("keeps a valid field projection while count hides the row", () => {
    const { ctrl } = seed({ sales: 5, price: 10 });
    ctrl.aggSelect.value = CONST.AGG.COUNT;
    fire(ctrl.aggSelect, "change");

    expect(ctrl.fieldWrap.classList.contains(CONST.CLASSES.HIDDEN)).toBe(true);
    expect(ctrl.fieldSelect.value).toBe("sales");
  });

  it("stays on count when the source supplies a numeric field again", () => {
    const { ctrl, m } = seed({ name: "x" });
    expect(ctrl.fieldWrap.classList.contains(CONST.CLASSES.HIDDEN)).toBe(true);
    expect(m.agg).toBe(CONST.AGG.COUNT);
    expect(ctrl.aggSelect.value).toBe(CONST.AGG.COUNT);

    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => [
      { lat: 1, lng: 2, marker: { feature: { properties: { sales: 5 } } } },
    ]);
    fire(ctrl.aggSelect, "change");

    // The options become available again, but the value stays count until the
    // user picks a value aggregation.
    expect(m.agg).toBe(CONST.AGG.COUNT);
    expect(ctrl.aggSelect.value).toBe(CONST.AGG.COUNT);
    expect([...ctrl.aggSelect.options].some(o => o.disabled)).toBe(false);
    expect(ctrl.aggSelect.title).toBe("");
    expect(ctrl.fieldWrap.classList.contains(CONST.CLASSES.HIDDEN)).toBe(true);
    expect(ctrl.fieldSelect.value).toBe("sales");
  });
});

describe("updateFieldSelector — null field controls", () => {
  it("agg change tolerates a null fieldWrap", () => {
    const { ctrl, m } = setup();
    ctrl.fieldWrap = null as any;
    ctrl.aggSelect.value = CONST.AGG.SUM;
    fire(ctrl.aggSelect, "change");
    expect(m.agg).toBe(CONST.AGG.SUM);
  });

  it("agg change tolerates a null fieldSelect", () => {
    const { ctrl, m } = setup();
    ctrl.fieldSelect = null as any;
    ctrl.aggSelect.value = CONST.AGG.SUM;
    fire(ctrl.aggSelect, "change");
    expect(m.agg).toBe(CONST.AGG.SUM);
  });
});

// refreshSchemeDropdownItems — covered by schemePicker.test.ts (setNumClasses tests)

describe("declared starting layer/field (Python layer=/field=)", () => {
  beforeEach(() => {
    vi.spyOn(HeatmapManager.prototype, "scanMapLayers").mockImplementation(function () {
      // no-op: keep the seeded pointLayers stable across rebuilds
    });
  });

  it("selects the Python-declared point layer on the first rebuild", () => {
    const m = makeManager({ layer: "Points 2" });
    m.pointLayers = [
      { id: "p1", name: "Points 1", layer: null, count: 1 },
      { id: "p2", name: "Points 2", layer: null, count: 1 },
    ];
    const ctrl = makeCtrl(m, makeConfig({ layer: "Points 2" }));
    rebuildLayerDropdown(ctrl);

    expect(m.selectedLayerId).toBe("p2");
    expect(ctrl.layerSelect.value).toBe("p2");
    expect(ctrl.extraBody.classList.contains(CONST.CLASSES.HIDDEN)).toBe(false);
  });

  it("keeps the single-layer auto-select when the declared name misses", () => {
    const m = makeManager({ layer: "Nope" });
    m.pointLayers = [{ id: "p1", name: "Only", layer: null, count: 1 }];
    const ctrl = makeCtrl(m, makeConfig({ layer: "Nope" }));
    rebuildLayerDropdown(ctrl);

    expect(m.selectedLayerId).toBe("p1");
  });

  it("shows the declared aggregation field on the first rebuild", () => {
    const m = makeManager({ layer: "Points 1", field: "score", agg: "sum" });
    m.pointLayers = [{ id: "p1", name: "Points 1", layer: null, count: 1 }];
    const ctrl = makeCtrl(
      m,
      makeConfig({ layer: "Points 1", field: "score", agg: "sum" }),
    );
    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => [
      { lat: 1, lng: 2, marker: { feature: { properties: { score: 5 } } } },
    ]);
    rebuildLayerDropdown(ctrl);

    // A declaration is a read-time default, not a pick: it is what the row
    // and the render use, and the manager's stored field stays empty.
    expect(m.field).toBe("");
    expect(m.effectiveField()).toBe("score");
    expect(ctrl.fieldSelect.value).toBe("score");
  });

  it("follows the declaration again when the data offers its column back", () => {
    // The declaration is re-read on every scan, so a data change that hides
    // its column falls back, and the column coming back restores it — the
    // behaviour a persisted declaration could not have (it would have been
    // consumed by the record's hasScanned guard).
    const m = makeManager({ layer: "Points 1", field: "score", agg: "sum" });
    m.pointLayers = [{ id: "p1", name: "Points 1", layer: null, count: 1 }];
    const ctrl = makeCtrl(
      m,
      makeConfig({ layer: "Points 1", field: "score", agg: "sum" }),
    );
    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => [
      { lat: 1, lng: 2, marker: { feature: { properties: { cost: 1 } } } },
    ]);
    rebuildLayerDropdown(ctrl);
    // No column named score: the first numeric field is the fallback.
    expect(ctrl.fieldSelect.value).toBe("cost");

    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => [
      { lat: 1, lng: 2, marker: { feature: { properties: { cost: 1, score: 5 } } } },
    ]);
    // A fresh scan (this fixture has no bound agg handler): the rebuild is the
    // path that re-reads the fields.
    rebuildLayerDropdown(ctrl);

    // The declared column is back, so the declaration is in force again.
    expect(ctrl.fieldSelect.value).toBe("score");
    expect(m.effectiveField()).toBe("score");
    // Still not a record: the resolution never wrote itself into the manager.
    expect(m.field).toBe("");
  });
});
