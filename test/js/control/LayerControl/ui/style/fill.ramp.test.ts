// test/js/control/LayerControl/ui/style/fill.ramp — ramp detail, persistence and field-change replay.
import { findItem } from "../fixture.js";
import {
  details,
  flushFill,
  initWithFillLayer,
  initWithPerFeatureLayer,
  initWithValues,
  installChroma,
  type makeLayer,
  modeSelect,
  openPanel,
} from "./fill.fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLASS_COUNT } from "#core/value/index.js";
import * as CONST from "#control/LayerControl/const.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";
import { clearIntent, getIntent, setIntent } from "#control/LayerControl/ui/intent.js";
import {
  FILL_DIMENSION,
  bindFillRow,
  buildFillRow,
  replayFillState,
  resetLayerFill,
} from "#control/LayerControl/ui/style/fill.js";
import { closeStylePanel } from "#control/LayerControl/ui/style/index.js";

describe("fill ramp detail — field / method / classes / scheme", () => {
  let ui: LayerUI;

  beforeEach(() => {
    installChroma(["#111111", "#222222", "#333333"]);

    ({ ui } = initWithValues());

    setIntent(ui, "overlay1", "fillStyleMode", "value");

    setIntent(ui, "overlay1", "fillValue", {
      field: "count",

      method: "jenks",

      classes: 3,

      scheme: "Blues",
    } as never);
  });

  afterEach(() => {
    document.body.innerHTML = "";

    vi.clearAllMocks();

    vi.unstubAllGlobals();
  });

  it("field selection writes the ramp field", () => {
    // Two numeric fields so a real choice exists (the field list is native).

    ui.runtimeStore.setFields("overlay1", [
      { name: "count", numeric: true },

      { name: "score", numeric: true },
    ]);

    const block = openPanel(ui);

    const select = details(block).querySelector(
      `.${CONST.CLASSES.STYLE_FILL_FIELD_SELECT}`,
    ) as HTMLSelectElement;

    expect(select.value).toBe("count");

    select.value = "score";

    select.dispatchEvent(new Event("change", { bubbles: true }));

    expect(getIntent(ui, "overlay1", "fillValue")).toMatchObject({ field: "score" });
  });

  it("shows the first field when the stored field is no longer offered", () => {
    // Options come from the current data; a stored field that disappeared

    // cannot stay selected, or the select would render blank.

    ui.runtimeStore.setFields("overlay1", [{ name: "score", numeric: true }]);

    setIntent(ui, "overlay1", "fillValue", {
      field: "count",

      method: "jenks",

      classes: 3,

      scheme: "Blues",
    } as never);

    const block = buildFillRow(ui, "overlay1");

    const field = details(block).querySelector(
      `.${CONST.CLASSES.STYLE_FILL_FIELD_SELECT}`,
    ) as HTMLSelectElement;

    expect(Array.from(field.options).map(o => o.value)).toEqual(["score"]);

    expect(field.value).toBe("score");
  });

  it("method selection writes the ramp method", () => {
    const block = openPanel(ui);

    const method = details(block).querySelector(
      `.${CONST.CLASSES.STYLE_FILL_METHOD_SELECT}`,
    ) as HTMLSelectElement;

    method.value = "equal";

    method.dispatchEvent(new Event("change", { bubbles: true }));

    expect(getIntent(ui, "overlay1", "fillValue")).toMatchObject({ method: "equal" });
  });

  it("class count select writes the chosen count and offers the shared range", () => {
    const block = openPanel(ui);

    const classes = details(block).querySelector(
      `.${CONST.CLASSES.STYLE_FILL_CLASSES_SELECT}`,
    ) as HTMLSelectElement;

    // Same vocabulary as the heatmap: a select over the 2..9 range, never a

    // free number input.

    expect(Array.from(classes.options).map(o => o.value)).toEqual(
      Array.from({ length: CLASS_COUNT.MAX - CLASS_COUNT.MIN + 1 }, (_, i) =>
        String(CLASS_COUNT.MIN + i),
      ),
    );

    classes.value = "5";

    classes.dispatchEvent(new Event("change", { bubbles: true }));

    expect(getIntent(ui, "overlay1", "fillValue")).toMatchObject({ classes: 5 });
  });

  it("shared scheme picker selection writes the scheme (strip only, no name)", () => {
    const block = openPanel(ui);

    const trigger = details(block).querySelector(
      `.${CONST.CLASSES.STYLE_FILL_SCHEME_TRIGGER}`,
    ) as HTMLElement;

    // The trigger shows the color strip only; the scheme name lives on the

    // tooltip (picker contract), matching the heatmap trigger.

    expect(trigger.textContent?.trim()).toBe("");

    expect(trigger.title).toBe("Blues");

    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const item = document.querySelector(
      '.foliplus-scheme-picker-item[data-scheme-name="Reds"]',
    ) as HTMLElement;

    expect(item).not.toBeNull();

    item.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(getIntent(ui, "overlay1", "fillValue")).toMatchObject({ scheme: "Reds" });

    expect(trigger.title).toBe("Reds");
  });

  it("outside click closes the open picker through the overlay registry", () => {
    const block = openPanel(ui);

    const trigger = details(block).querySelector(
      `.${CONST.CLASSES.STYLE_FILL_SCHEME_TRIGGER}`,
    ) as HTMLElement;

    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(document.querySelector(".foliplus-scheme-picker-dropdown")).not.toBeNull();

    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(document.querySelector(".foliplus-scheme-picker-dropdown")).toBeNull();
  });

  it("Escape closes the picker first, then the style panel (one layer per press)", () => {
    const block = openPanel(ui);

    const trigger = details(block).querySelector(
      `.${CONST.CLASSES.STYLE_FILL_SCHEME_TRIGGER}`,
    ) as HTMLElement;

    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(document.querySelector(".foliplus-scheme-picker-dropdown")).not.toBeNull();

    const escape = (): KeyboardEvent => {
      const event = new KeyboardEvent("keydown", {
        key: "Escape",

        bubbles: true,

        cancelable: true,
      });

      document.body.dispatchEvent(event);

      return event;
    };

    // Topmost is the picker (ESC_PRIORITY 850), even though focus is on body.

    escape();

    expect(document.querySelector(".foliplus-scheme-picker-dropdown")).toBeNull();

    expect(ui.overlayPanel.stylePanelLayerId).toBe("overlay1");

    escape();

    expect(ui.overlayPanel.stylePanelLayerId).toBeNull();
  });

  it("closing the panel destroys the open picker's dropdown", () => {
    const block = openPanel(ui);

    const trigger = details(block).querySelector(
      `.${CONST.CLASSES.STYLE_FILL_SCHEME_TRIGGER}`,
    ) as HTMLElement;

    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(document.querySelector(".foliplus-scheme-picker-dropdown")).not.toBeNull();

    closeStylePanel(ui, false);

    expect(document.querySelector(".foliplus-scheme-picker-dropdown")).toBeNull();
  });
});

describe("fill ramp persistence and reset", () => {
  let ui: LayerUI;

  let layer: ReturnType<typeof makeLayer>;

  beforeEach(() => {
    installChroma(["#111111", "#222222", "#333333"]);

    ({ ui, layer } = initWithValues());
  });

  afterEach(() => {
    document.body.innerHTML = "";

    vi.clearAllMocks();

    vi.unstubAllGlobals();
  });

  it("reopening the panel shows the stored mode and replays the ramp", () => {
    setIntent(ui, "overlay1", "fillStyleMode", "value");

    setIntent(ui, "overlay1", "fillValue", {
      field: "count",

      // Equal interval: no simple-statistics dependency in jsdom.

      method: "equal",

      classes: 3,

      scheme: "Reds",
    } as never);

    replayFillState(ui, "overlay1");

    flushFill();

    expect(layer.leaves[0].setStyle).toHaveBeenCalledWith(
      expect.objectContaining({ fillColor: "#111111" }),
    );

    const block = openPanel(ui);

    expect(modeSelect(block).value).toBe("value");

    expect(
      (
        details(block).querySelector(
          `.${CONST.CLASSES.STYLE_FILL_FIELD_SELECT}`,
        ) as HTMLSelectElement
      ).value,
    ).toBe("count");
  });

  it("reset clears both modes' intents and the panel opens solid", () => {
    setIntent(ui, "overlay1", "fillStyleMode", "value");

    setIntent(ui, "overlay1", "fillValue", {
      field: "count",

      method: "jenks",

      classes: 3,

      scheme: "Blues",
    } as never);

    setIntent(ui, "overlay1", "fillColor", "#ff0000");

    setIntent(ui, "overlay1", "fillOpacity", 0.4);

    resetLayerFill(ui, "overlay1");

    expect(getIntent(ui, "overlay1", "fillStyleMode")).toBeUndefined();

    expect(getIntent(ui, "overlay1", "fillValue")).toBeUndefined();

    expect(getIntent(ui, "overlay1", "fillColor")).toBeUndefined();

    expect(getIntent(ui, "overlay1", "fillOpacity")).toBeUndefined();

    const block = openPanel(ui);

    expect(modeSelect(block).value).toBe("original");

    expect(FILL_DIMENSION.value!(ui, "overlay1")?.mode).toBe("original");
  });

  it("clearIntent on the ramp keeps the solid mode untouched", () => {
    setIntent(ui, "overlay1", "fillStyleMode", "solid");

    setIntent(ui, "overlay1", "fillColor", "#123456");

    setIntent(ui, "overlay1", "fillValue", {
      field: "count",

      method: "jenks",

      classes: 3,

      scheme: "Blues",
    } as never);

    clearIntent(ui, "overlay1", "fillValue");

    expect(getIntent(ui, "overlay1", "fillValue")).toBeUndefined();

    expect(getIntent(ui, "overlay1", "fillColor")).toBe("#123456");

    const block = openPanel(ui);

    expect(modeSelect(block).value).toBe("solid");
  });
});

describe("fill mode switch after the layer's fields changed", () => {
  it("writes nothing when the numeric field disappeared under the open panel", () => {
    // The data can lose its numeric property while the style panel is open (a

    // streamed replacement, a filter). Switching to by-value then has no field

    // to classify, so the write is rejected instead of persisting a ramp with

    // an empty field.

    const fixture = initWithFillLayer();

    fixture.ui.openStylePanel("overlay1");

    const item = findItem(fixture.ui, "overlay1");

    const select = item.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_MODE_SELECT}`,
    ) as HTMLSelectElement;

    expect(select).not.toBeNull();

    fixture.ui.runtimeStore.setFields("overlay1", []);

    select.value = "value";

    select.dispatchEvent(new Event("change"));

    expect(getIntent(fixture.ui, "overlay1", "fillStyleMode")).toBeUndefined();

    expect(getIntent(fixture.ui, "overlay1", "fillValue")).toBeUndefined();
  });
  // Patch-coverage evidence (codecov fill.ts patch 93.22% -> target >=95%):
  // The two remaining uncovered patch branches are unreachable by design, not
  // missing coverage:
  //   - fill.ts:159 applyValueFillToLayer `if (value === undefined) return;` — the
  //     value hook is only invoked when dim.hasValue(ui, layerId) is true
  //     (paintDimension applyPaintToLayer: mode===VALUE && dim.hasValue), and
  //     hasValue is effectiveFillValue(...) !== undefined, so `value` is always
  //     defined when applyValueFillToLayer runs. The guard is a defensive
  //     invariant, not a reachable branch.
  //   - fill.ts:498 fillModeRowHint `if (original) original.title = note;` — the
  //     mode row always starts with [ORIGINAL, SOLID] (FILL_ADAPTER.modes), so
  //     option[value="original"] is always present when the hint runs. The
  //     null arm is a defensive invariant, not a reachable branch.
  // The test below covers the third patch gap (L574/L573: stored VALUE mode on
  // a layer whose fields are gone degrades to the solid binder).
  it("binds the solid detail when a stored VALUE mode loses its numeric field", () => {
    // A stored by-value choice can outlive the data: the layer's numeric
    // field disappears (a streamed replacement, a filter) while the panel
    // stays open. The mode select no longer offers VALUE (modes() omits it),
    // but the stored mode still resolves the display to VALUE - the detail
    // builder and binder must degrade to the SOLID controls rather than
    // render a value ramp with an empty field or throw.
    // A layer whose features carry no property bag (a streamed replacement
    // with no fields): the VALUE mode cannot classify anything, so the row
    // degrades to the SOLID controls instead of a value ramp.
    const { ui } = initWithPerFeatureLayer({ withProperties: false });
    ui.runtimeStore.setFields("feature1", []);
    setIntent(ui, "feature1", "fillStyleMode", "value");

    const row = buildFillRow(ui, "feature1");
    document.body.append(row);
    // The detail slot renders the solid controls (the VALUE builder's
    // no-field fallback): a colour swatch, no value-field/method/class selects.
    expect(
      row.querySelector(`.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`),
    ).not.toBeNull();
    expect(row.querySelector(`.${CONST.CLASSES.STYLE_FILL_FIELD_SELECT}`)).toBeNull();

    // Binding follows the same fallback: the solid binder attaches the swatch
    // and commits to the fill dimension instead of touching a missing ramp.
    expect(() => bindFillRow(ui, "feature1", row)).not.toThrow();
    const color = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`,
    ) as HTMLInputElement;
    color.value = "#123456";
    color.dispatchEvent(new Event("input", { bubbles: true }));
    expect(getIntent(ui, "feature1", "fillColor")).toBe("#123456");
  });
});

describe("content-change replay", () => {
  it("repaints every leaf from the stored fill", () => {
    // The frame the content-change scheduler runs owns the repaint: without it

    // a streamed addData keeps the new features at the author's color.

    const fixture = initWithFillLayer();

    setIntent(fixture.ui, "overlay1", "fillColor", "#123456");

    setIntent(fixture.ui, "overlay1", "fillOpacity", 0.4);

    const policy = FILL_DIMENSION.contentChange as {
      run: (ui: LayerUI, layerId: string) => void;
    };

    policy.run(fixture.ui, "overlay1");

    for (const leaf of fixture.fillLayer.leaves) {
      expect(leaf.setStyle).toHaveBeenCalledWith({
        fillColor: "#123456",

        fillOpacity: 0.4,

        fill: true,
      });
    }
  });
});
