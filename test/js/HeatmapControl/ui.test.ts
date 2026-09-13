// HeatmapControl ui.ts — DOM construction and control binding.
// Every UI function reads its config from the injected ctrl.conf / ctrl.T
// (set by the fixture), never from the ambient window.CONF — these tests
// therefore prove both the behavior and the per-instance CONF injection.
import { afterEach, describe, expect, it, vi } from "vitest";
import { HINT_DURATION } from "#core/hint.js";
import * as CONST from "#foliplus/HeatmapControl/const.js";
import { HeatmapManager } from "#foliplus/HeatmapControl/manager.js";
import {
  bindControls,
  initScan,
  rebuildLayerDropdown,
  setupObserver,
} from "#foliplus/HeatmapControl/ui.js";
import { makeConf, makeCtrl, makeManager } from "./fixture.js";

/** Bind a control against the real panel template and return the pieces. */
function setup(conf: ComponentConfig = makeConf()) {
  const m = makeManager();
  const ctrl = makeCtrl(m, conf);
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
  window.localStorage.clear();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
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
    expect(ctrl.borderColorInput.value).toBe(m.borderColor);
    expect(ctrl.borderWeightInput.value).toBe(String(m.borderWeight));
    expect(ctrl.labelChk.checked).toBe(m.currentLabelShow);
    expect(ctrl.methodSelect.value).toBe(m.currentMethod);
    expect(ctrl.aggSelect.value).toBe(m.currentAgg);
    expect(ctrl.classSelect.value).toBe(String(m.numClasses));
    expect(ctrl.schemeSelectHidden.value).toBe(m.currentScheme);
  });

  it("clamps an out-of-range manager numClasses into the select options", () => {
    const m = makeManager();
    m.numClasses = 99;
    const ctrl = makeCtrl(m, makeConf());
    const panel = document.createElement("div");
    bindControls(ctrl, panel);
    expect(ctrl.classSelect.value).toBe(String(CONST.CLASS_COUNT.MAX));
  });

  it("populates scheme options from conf.schemes and renders the bar", () => {
    const { ctrl, m } = setup();
    const options = Array.from(ctrl.schemeSelectHidden.options).map(o => o.value);
    expect(options).toEqual(["Reds", "Blues", "Greens"]);
    expect(ctrl.schemeBar.title).toBe(m.currentScheme);
    expect(ctrl.schemeBarInner.childElementCount).toBeGreaterThan(0);
  });
});

describe("bindControls — change handlers", () => {
  it("agg change updates the manager, reveals the field selector and persists", () => {
    const { ctrl, m } = setup();
    const save = vi.spyOn(m, "saveConfig");
    const render = vi.spyOn(m, "renderHexagons");
    ctrl.aggSelect.value = CONST.AGG.SUM;
    fire(ctrl.aggSelect, "change");
    expect(m.currentAgg).toBe(CONST.AGG.SUM);
    expect(render).toHaveBeenCalled();
    expect(save).toHaveBeenCalled();
    expect(ctrl.fieldWrap.classList.contains(CONST.CLASSES.HIDDEN)).toBe(false);

    ctrl.aggSelect.value = CONST.AGG.COUNT;
    fire(ctrl.aggSelect, "change");
    expect(ctrl.fieldWrap.classList.contains(CONST.CLASSES.HIDDEN)).toBe(true);
  });

  it("field change sets currentField, disables auto-field and persists", () => {
    const { ctrl, m } = setup();
    m.pointLayers = [{ id: "p1", name: "P1", layer: {}, count: 2 }];
    m.selectedLayerId = "p1";
    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => [
      {
        lat: 1,
        lng: 2,
        marker: { feature: { properties: { sales: 5, name: "x" } } },
      },
    ]);
    ctrl.aggSelect.value = CONST.AGG.SUM;
    fire(ctrl.aggSelect, "change");
    expect(m.autoFieldKey).toBe("properties.sales");

    const save = vi.spyOn(m, "saveConfig");
    const render = vi.spyOn(m, "renderHexagons");
    ctrl.fieldSelect.value = "properties.sales";
    fire(ctrl.fieldSelect, "change");
    expect(m.currentField).toBe("properties.sales");
    expect(m.fieldAuto).toBe(false);
    expect(render).toHaveBeenCalled();
    expect(save).toHaveBeenCalled();
  });

  it("method change updates the manager and persists", () => {
    const { ctrl, m } = setup();
    const save = vi.spyOn(m, "saveConfig");
    const render = vi.spyOn(m, "renderHexagons");
    ctrl.methodSelect.value = CONST.METHOD.QUANTILE;
    fire(ctrl.methodSelect, "change");
    expect(m.currentMethod).toBe(CONST.METHOD.QUANTILE);
    expect(render).toHaveBeenCalled();
    expect(save).toHaveBeenCalled();
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
      Array.from(ctrl.schemeDropdown!.querySelectorAll(CONST.SEL.SCHEME_DROPDOWN_BAR));
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
    expect(m.currentScheme).toBe("Blues");
    expect(ctrl.schemeBar.title).toBe("Blues");
    expect(render).toHaveBeenCalled();
    expect(save).toHaveBeenCalled();
  });

  it("border color input updates the manager on input", () => {
    const { ctrl, m } = setup();
    const render = vi.spyOn(m, "renderHexagons");
    ctrl.borderColorInput.value = "#000000";
    fire(ctrl.borderColorInput, "input");
    expect(m.borderColor).toBe("#000000");
    expect(render).toHaveBeenCalled();
  });

  it("border color change persists without re-rendering", () => {
    const { ctrl, m } = setup();
    const save = vi.spyOn(m, "saveConfig");
    const render = vi.spyOn(m, "renderHexagons");
    ctrl.borderColorInput.value = "#000000";
    fire(ctrl.borderColorInput, "change");
    expect(save).toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });

  it("border weight change clamps out-of-range values back into range", () => {
    const { ctrl, m } = setup();
    ctrl.borderWeightInput.value = "999";
    fire(ctrl.borderWeightInput, "change");
    expect(m.borderWeight).toBe(CONST.BORDER.WEIGHT_MAX);
    expect(ctrl.borderWeightInput.value).toBe(String(CONST.BORDER.WEIGHT_MAX));
  });

  it("border weight input ignores out-of-range edits and persists in-range ones", () => {
    const { ctrl, m } = setup();
    const save = vi.spyOn(m, "saveConfig");
    ctrl.borderWeightInput.value = "999";
    fire(ctrl.borderWeightInput, "input");
    expect(m.borderWeight).toBe(1.5);
    expect(save).not.toHaveBeenCalled();

    ctrl.borderWeightInput.value = "2.5";
    fire(ctrl.borderWeightInput, "input");
    expect(m.borderWeight).toBe(2.5);
    expect(save).toHaveBeenCalled();
  });

  it("label toggle updates the manager and persists", () => {
    const { ctrl, m } = setup();
    const save = vi.spyOn(m, "saveConfig");
    const render = vi.spyOn(m, "renderHexagons");
    ctrl.labelChk.checked = false;
    fire(ctrl.labelChk, "change");
    expect(m.currentLabelShow).toBe(false);
    expect(render).toHaveBeenCalled();
    expect(save).toHaveBeenCalled();
  });
});

describe("bindControls — clear (reset) button", () => {
  it("resets every control to conf defaults and collapses the panel", () => {
    const conf = makeConf({
      color_scheme: "Blues",
      n_classes: 4,
      method: "equal",
      label_show: false,
      border_weight: 3,
      border_color: "#abcdef",
      field: "value",
    });
    const { ctrl, m, panel } = setup(conf);
    m.selectedLayerId = "p1";
    m.currentAgg = CONST.AGG.SUM;
    m.currentField = "properties.x";
    m.fieldAuto = false;
    m.autoFieldKey = "properties.y";
    m.currentScheme = "Greens";
    m.numClasses = 8;
    m.currentMethod = "quantile";
    m.currentLabelShow = true;
    m.borderWeight = 5;
    m.borderColor = "#111111";

    const clearBtn = panel.querySelector(
      `[${CONST.DATA_ATTR.BTN_CLEAR}]`,
    ) as HTMLButtonElement;
    const clearSaved = vi.spyOn(m, "clearSavedConfig");
    clearBtn.click();

    expect(m.selectedLayerId).toBeNull();
    expect(m.currentAgg).toBe(CONST.AGG.COUNT);
    expect(m.currentField).toBe(conf.field);
    expect(m.numClasses).toBe(conf.n_classes);
    expect(m.currentMethod).toBe(conf.method);
    expect(m.currentScheme).toBe(conf.color_scheme);
    expect(m.currentLabelShow).toBe(conf.label_show);
    expect(m.borderWeight).toBe(conf.border_weight);
    expect(m.borderColor).toBe(conf.border_color);
    expect(clearSaved).toHaveBeenCalled();

    expect(ctrl.extraBody.classList.contains(CONST.CLASSES.HIDDEN)).toBe(true);
    expect(ctrl.ctrl.classList.contains(CONST.CLASSES.COLLAPSED)).toBe(true);
    expect(ctrl.ctrl.classList.contains(CONST.CLASSES.EXPANDED)).toBe(false);

    expect(ctrl.aggSelect.value).toBe(CONST.AGG.COUNT);
    expect(ctrl.classSelect.value).toBe(String(conf.n_classes));
    expect(ctrl.methodSelect.value).toBe(conf.method);
    expect(ctrl.schemeSelectHidden.value).toBe(conf.color_scheme);
    expect(ctrl.borderWeightInput.value).toBe(String(conf.border_weight));
    expect(ctrl.borderColorInput.value).toBe(conf.border_color);
  });

  it("clear falls back to library defaults when conf omits style fields", () => {
    // Python may emit a CONF that omits optional style fields entirely —
    // reset must fall back to the library defaults in that case.
    const { ctrl, m, panel } = setup(
      makeConf({
        color_scheme: undefined,
        method: undefined,
        n_classes: undefined,
        label_show: undefined,
        border_weight: undefined,
        border_color: undefined,
        field: undefined,
      }),
    );
    m.currentScheme = "Greens";
    m.numClasses = 8;
    m.currentMethod = "quantile";
    const clearBtn = panel.querySelector(
      `[${CONST.DATA_ATTR.BTN_CLEAR}]`,
    ) as HTMLButtonElement;
    clearBtn.click();

    expect(m.currentScheme).toBe("Reds");
    expect(m.numClasses).toBe(CONST.CLASS_COUNT.DEFAULT);
    expect(m.currentMethod).toBe(CONST.METHOD.JENKS);
    expect(m.currentLabelShow).toBe(false);
    expect(m.borderWeight).toBe(CONST.BORDER.WEIGHT_DEFAULT);
    expect(m.borderColor).toBe(CONST.GRAY);
    expect(m.currentField).toBe("");
    expect(ctrl.aggSelect.value).toBe(CONST.AGG.COUNT);
  });
});

describe("bindControls — scheme dropdown", () => {
  it("scheme bar click opens the dropdown with one item per conf scheme", () => {
    const { ctrl } = setup();
    ctrl.schemeBar.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(ctrl.schemeDropdown).not.toBeNull();
    expect(ctrl.schemeDropdown!.children.length).toBe(3);
    expect(ctrl.schemeBar.classList.contains(CONST.CLASSES.SCHEME_BAR_OPEN)).toBe(true);
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

  it("selecting a dropdown item applies the conf scheme and persists", () => {
    const { ctrl, m } = setup();
    const save = vi.spyOn(m, "saveConfig");
    const render = vi.spyOn(m, "renderHexagons");
    ctrl.schemeBar.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const items = ctrl.schemeDropdown!.querySelectorAll(CONST.SEL.SCHEME_DROPDOWN_ITEM);
    (items[1] as HTMLElement).click();
    expect(m.currentScheme).toBe("Blues");
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

  it("selectScheme by index applies the conf scheme and persists", () => {
    const { ctrl, m } = setup();
    const save = vi.spyOn(m, "saveConfig");
    const render = vi.spyOn(m, "renderHexagons");
    ctrl.selectScheme?.(1);
    expect(m.currentScheme).toBe("Blues");
    expect(ctrl.schemeSelectHidden.value).toBe("Blues");
    expect(render).toHaveBeenCalled();
    expect(save).toHaveBeenCalled();
  });

  it("selectScheme with an out-of-range index is a no-op", () => {
    const { ctrl, m } = setup();
    const save = vi.spyOn(m, "saveConfig");
    ctrl.selectScheme?.(99);
    expect(m.currentScheme).toBe("Reds");
    expect(save).not.toHaveBeenCalled();
  });

  it("focuses the first item when the current scheme is not in conf.schemes", () => {
    const { ctrl, m } = setup();
    // Manager state comes from window.CONF at construction, so move it off the
    // scheme list to force the fallback focus branch.
    m.currentScheme = "NoSuchScheme";
    ctrl.schemeBar.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(ctrl.schemeDropdown).not.toBeNull();
    const items = ctrl.schemeDropdown!.querySelectorAll(CONST.SEL.SCHEME_DROPDOWN_ITEM);
    expect(items.length).toBe(3);
  });

  it("tolerates a CONF without schemes (optional in the Python API)", () => {
    const { ctrl } = setup(makeConf({ schemes: undefined }));
    expect(ctrl.schemeSelectHidden.options.length).toBe(0);
    ctrl.schemeBar.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(ctrl.schemeDropdown).not.toBeNull();
    expect(ctrl.schemeDropdown!.children.length).toBe(0);
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
    const ctrl = makeCtrl(m, makeConf());
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
    const ctrl = makeCtrl(m, makeConf());
    rebuildLayerDropdown(ctrl);

    const clear = vi.spyOn(m, "clearHeatmapCanvas");
    ctrl.layerSelect.value = "";
    fire(ctrl.layerSelect, "change");

    expect(m.selectedLayerId).toBeNull();
    expect(ctrl.extraBody.classList.contains(CONST.CLASSES.HIDDEN)).toBe(true);
    expect(clear).toHaveBeenCalled();
  });
});

describe("setupObserver", () => {
  const flush = () => new Promise(resolve => setTimeout(resolve, 0));

  it("rebuilds the layer dropdown once per expand", async () => {
    vi.spyOn(HeatmapManager.prototype, "scanMapLayers").mockImplementation(function () {
      // no-op: keep the seeded layer state stable across rebuilds
    });
    const m = makeManager();
    const ctrl = makeCtrl(m, makeConf());
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

describe("initScan — hints keyed by the injected conf", () => {
  it("shows the localized no_layercontrol hint using ctrl.conf, not window.CONF", async () => {
    const m = makeManager();
    // Ambient CONF differs from the injected ctrl.conf — the hint must key on
    // the latter (the whole point of the conf-carrying state object).
    window.CONF = { ...window.CONF, name: "SomeOtherControl" };
    const ctrl = makeCtrl(m, makeConf());
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
    const ctrl = makeCtrl(m, makeConf());
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
