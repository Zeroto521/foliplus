// test/js/control/LayerControl/ui/style/fill.original — the original-colors row.
import { findItem, initFixture, installLeafletGlobals } from "../fixture.js";
import {
  details,
  initWithAuthorScale,
  installChroma,
  makeFillableLayer,
  makePerFeatureLayer,
  modeSelect,
} from "./fill.fixture.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CLASS_COUNT } from "#core/value/index.js";
import { PANEL_CLASS } from "#ui/panelClassName.js";
import * as CONST from "#control/LayerControl/const.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";
import { getIntent, setIntent } from "#control/LayerControl/ui/intent.js";
import {
  MAX_STOPS,
  originalGradient,
} from "#control/LayerControl/ui/style/originalColor.js";
import { FACE, flushStyleDimApply } from "#control/LayerControl/ui/style/styleBag.js";

describe("fill row — original colors", () => {
  afterEach(() => {
    document.body.innerHTML = "";

    vi.clearAllMocks();

    vi.unstubAllGlobals();
  });

  const selector = (name: string): string => `.${name}`;

  const blockOf = (ui: LayerUI): HTMLElement => {
    const item = findItem(ui, "overlay1");

    ui.openStylePanel("overlay1");

    return item.querySelector(selector(CONST.CLASSES.STYLE_FILL_BLOCK)) as HTMLElement;
  };

  const boxOf = (row: HTMLElement, name: string): HTMLElement =>
    details(row).querySelector(selector(name)) as HTMLElement;

  const colorsBoxOf = (row: HTMLElement): HTMLElement =>
    boxOf(row, CONST.CLASSES.STYLE_FILL_ORIGINAL_COLORS);

  const stripOf = (row: HTMLElement): HTMLElement =>
    boxOf(row, CONST.CLASSES.STYLE_FILL_ORIGINAL_STRIP);

  /** Assert a gradient stop in canonical serialization form. jsdom 31's CSS
   *  engine re-serializes inline style.background, dropping trailing zeros in
   *  a percentage ("0.00%" -> "0%"), so the comparison is on the canonical
   *  (trailing-zero-stripped) form rather than the authored "0.00%" string. */
  const expectStop = (
    gradient: string,
    color: string,
    ...positions: string[]
  ): void => {
    // Minimal decimal representation: a percentage token's trailing zeros and
    // a bare "0.00" collapse to its shortest form ("0.00%" -> "0%",
    // "100.00%" -> "100%"), matching how jsdom 31 re-serializes inline CSS.
    const canonical = (s: string): string =>
      s.replace(/(\d+(?:\.\d+)?)%/g, (_, num: string) => {
        return `${String(parseFloat(num))}%`;
      });
    // jsdom 31 serializes a double-position stop ("color 0% 33.33%") as two
    // stops with the color repeated ("color 0%, color 33.33%"), so assert each
    // position's own "color pos" pair rather than one contiguous string.
    for (const position of positions) {
      expect(canonical(gradient)).toContain(canonical(`${color} ${position}`));
    }
  };

  const readoutOf = (row: HTMLElement, name: string): string =>
    (
      boxOf(row, name).querySelector(
        selector(CONST.CLASSES.STYLE_FILL_ORIGINAL_VALUE),
      ) as HTMLElement
    ).textContent as string;

  const labelsOf = (row: HTMLElement): (string | null)[] =>
    [...details(row).children].map(
      child => (child.querySelector(".foliplus-form-label") as HTMLElement).textContent,
    );

  /** Stops a gradient carries: every stop names two positions. */

  const countStops = (gradient: string): number =>
    (gradient.match(/%/g) ?? []).length / 2;

  it("opens on the author's colors and offers the mode as a choice", () => {
    const { ui, layer } = initWithAuthorScale();

    const row = blockOf(ui);

    const select = modeSelect(row);

    const option = select.querySelector(
      'option[value="original"]',
    ) as HTMLOptionElement | null;

    // The state a layer opens in is still the author's own paint...

    expect(select.value).toBe("original");

    // ...and it is now a state the user can come back to, so its option is a

    // real option, named like the mode it selects.

    expect(option).not.toBeNull();

    expect(option!.disabled).toBe(false);

    expect(option!.textContent).toBe("LayerControl.style_mode_original");

    // Opening writes no intent: the map keeps the author's own paint until the

    // user picks a mode.

    expect(getIntent(ui, "overlay1", "fillStyleMode")).toBeUndefined();

    for (const leaf of layer.leaves) expect(leaf.setStyle).not.toHaveBeenCalled();
  });

  it("puts every readout on the by-value mode's row grid", () => {
    const { ui } = initWithAuthorScale();

    const row = blockOf(ui);

    const children = [...details(row).children];

    // One FORM_ROW per readout group. The method and class count share one

    // row (the by-value classes row's shape), so four readouts become three

    // rows. The raw strip and caption divs are gone — they escaped the

    // label/control grid and are what overflowed the panel.

    expect(children.length).toBe(4);

    for (const child of children) {
      expect(child.classList.contains("foliplus-form-row")).toBe(true);

      expect(child.querySelector(".foliplus-form-label")).not.toBeNull();

      expect(child.querySelector(".foliplus-form-control")).not.toBeNull();
    }

    expect(labelsOf(row)).toEqual([
      "LayerControl.style_fill_field",

      "foliplus.classification_method",

      "LayerControl.style_fill_scheme",
      "LayerControl.style_fill_opacity",
    ]);

    // The strip lives inside a row's control cell, never directly in the

    // detail slot.

    const strip = stripOf(row);

    expect(strip.closest(".foliplus-form-row")).not.toBeNull();

    expect(strip.parentElement).toBe(colorsBoxOf(row));

    expect(colorsBoxOf(row).classList.contains(CONST.CLASSES.STYLE_FILL_READONLY)).toBe(
      true,
    );

    // The semantic class is supplied by the shared primitive (ui/panelField.ts) via

    // readOnlyBox; if fill.ts dropped either class, this real-panel DOM check

    // fails — the primitive-only test in ui/panelField.test.ts cannot see the

    // fill.ts delegation.

    expect(colorsBoxOf(row).classList.contains(PANEL_CLASS.READONLY)).toBe(true);
  });

  it("states the column, the colors and the count as readouts", () => {
    const { ui } = initWithAuthorScale({
      stops: ["#0d0887", "#6a00a8", "#b12a90"],

      scale: { kind: "stepped", column: "score", vmin: 10, vmax: 30, levels: 3 },
    });

    const row = blockOf(ui);

    expect(readoutOf(row, CONST.CLASSES.STYLE_FILL_ORIGINAL_COLUMN)).toBe("score");

    // A stepped scale has no recorded method here (the author passed a scheme

    // whose breaks the classification chose), so the method readout states a

    // dash rather than guessing; the count states the class count the author

    // actually drew.

    expect(readoutOf(row, CONST.CLASSES.STYLE_FILL_ORIGINAL_METHOD)).toBe("—");

    expect(readoutOf(row, CONST.CLASSES.STYLE_FILL_ORIGINAL_COUNT)).toBe("3");

    // The caption moved from a line of its own onto the colors box: the panel

    // is three rows tall (column, method + classes, scheme) and the sentence

    // is still reachable.

    expect(colorsBoxOf(row).title).toBe("LayerControl.style_fill_original_levels");

    expect(colorsBoxOf(row).getAttribute("aria-label")).toBe(
      "LayerControl.style_fill_original_levels",
    );

    // An accessible name only applies to a role that accepts one: the bar is

    // information (an image of the author's colors), not a control.

    expect(colorsBoxOf(row).getAttribute("role")).toBe("img");
  });

  it("renders read-only method and count boxes without asserting geometry", () => {
    const { ui } = initWithAuthorScale();

    const row = blockOf(ui);

    const method = boxOf(row, CONST.CLASSES.STYLE_FILL_ORIGINAL_METHOD);

    const count = boxOf(row, CONST.CLASSES.STYLE_FILL_ORIGINAL_COUNT);

    // The method and count share one row (the by-value classes row's shape):

    // they sit inside the same .foliplus-form-inline control cell. Geometry is

    // a stylesheet contract (fillStyles.test.ts) plus a browser probe

    // (fill_author_read.js rect equality); jsdom does not lay out, so this

    // test pins the frame, the shared-row shape and the aria state only.

    expect(method).not.toBeNull();

    expect(count).not.toBeNull();

    expect(method!.parentElement).toBe(count!.parentElement);

    expect(method!.parentElement!.classList.contains("foliplus-form-inline")).toBe(
      true,
    );

    expect(method!.closest(".foliplus-form-row")).toBe(
      count!.closest(".foliplus-form-row"),
    );

    // The two readouts stay distinguishable to assistive tech: the method box

    // is named by the method label, the count box by the class-count label (the

    // by-value classes row keeps the same split for its two selects).

    // The name only reaches assistive tech reliably through a standard namable

    // role: Chromium does put the aria-label on a bare div, but "text" is not

    // an ARIA role at all (a Safari/WebKit-ism), so a generic div is not a

    // dependable target across AT/browsers. role="group" (like the colors

    // box's role="img") makes the name stable.

    expect(method!.getAttribute("role")).toBe("group");

    expect(count!.getAttribute("role")).toBe("group");

    expect(method!.getAttribute("aria-label")).toBe("foliplus.classification_method");

    expect(count!.getAttribute("aria-label")).toBe("LayerControl.style_fill_classes");

    for (const box of [method!, count!]) {
      expect(box.classList.contains(CONST.CLASSES.STYLE_FILL_READONLY)).toBe(true);

      expect(box.classList.contains(PANEL_CLASS.READONLY)).toBe(true);

      expect(box.getAttribute("aria-disabled")).toBe("true");
    }
  });

  it("offers nothing interactive in the read-only detail", () => {
    const { ui } = initWithAuthorScale();

    const detail = details(blockOf(ui));

    expect(detail.querySelector("select")).toBeNull();

    expect(detail.querySelector("input")).toBeNull();

    expect(detail.querySelector('[role="combobox"]')).toBeNull();

    expect(detail.querySelector("[tabindex]")).toBeNull();

    const boxes = [
      ...detail.querySelectorAll(selector(CONST.CLASSES.STYLE_FILL_READONLY)),
    ];

    expect(boxes.length).toBe(5);

    for (const box of boxes) {
      expect(box.getAttribute("aria-disabled")).toBe("true");
    }
  });

  it("names the colors by what the author drew", () => {
    const stepped = initWithAuthorScale({
      scale: { kind: "stepped", column: "score", vmin: 10, vmax: 30, levels: 5 },
    });

    expect(colorsBoxOf(blockOf(stepped.ui)).title).toBe(
      "LayerControl.style_fill_original_levels",
    );

    // A stepped scale whose breaks are provably equally spaced carries

    // method: "equal" (Python's provable_equal_interval): the panel then

    // states Equal Interval instead of the honest dash.

    const equalStepped = initWithAuthorScale({
      scale: {
        kind: "stepped",

        column: "score",

        vmin: 10,

        vmax: 30,

        levels: 3,

        method: "equal",
      },
    });

    expect(
      readoutOf(blockOf(equalStepped.ui), CONST.CLASSES.STYLE_FILL_ORIGINAL_METHOD),
    ).toBe("foliplus.classification_equal");

    // A continuous scale has no count to state: the number row says so.

    const continuous = initWithAuthorScale();

    expect(
      readoutOf(blockOf(continuous.ui), CONST.CLASSES.STYLE_FILL_ORIGINAL_COUNT),
    ).toBe("—");

    // A continuous scale is the default explore mapping (an equally spaced

    // LinearColormap): the method readout states Equal Interval, the honest

    // classification that scale implies.

    expect(
      readoutOf(blockOf(continuous.ui), CONST.CLASSES.STYLE_FILL_ORIGINAL_METHOD),
    ).toBe("foliplus.classification_equal");

    expect(labelsOf(blockOf(continuous.ui))).toContain(
      "foliplus.classification_method",
    );

    expect(colorsBoxOf(blockOf(continuous.ui)).title).toBe(
      "LayerControl.style_fill_original_continuous",
    );

    const fallback = initWithAuthorScale({ scale: null, distinct: 64, capped: true });

    expect(colorsBoxOf(blockOf(fallback.ui)).title).toBe(
      "LayerControl.style_fill_original_colors",
    );

    expect(
      readoutOf(blockOf(fallback.ui), CONST.CLASSES.STYLE_FILL_ORIGINAL_COUNT),
    ).toBe("64+");

    // A categorical layer has no classification: the method row still renders

    // (the mode stays aligned with the by-value grid) but states no method, and

    // no field row either — the panel states the colors, their count and a

    // honest dash for the classification they did not draw.

    expect(
      readoutOf(blockOf(fallback.ui), CONST.CLASSES.STYLE_FILL_ORIGINAL_METHOD),
    ).toBe("—");

    expect(labelsOf(blockOf(fallback.ui))).toEqual([
      "foliplus.classification_method",

      "LayerControl.style_fill_scheme",
      "LayerControl.style_fill_opacity",
    ]);
  });

  it("keeps the author's scale order in the gradient", () => {
    const { ui } = initWithAuthorScale({
      stops: ["#0d0887", "#6a00a8", "#b12a90"],
    });

    const gradient = stripOf(blockOf(ui)).style.background;

    expect(gradient.startsWith("linear-gradient(90deg,")).toBe(true);

    // Author order, first color at 0% and last at 100%: the bar is the

    // author's ramp, not a re-sorted set.

    expectStop(gradient, "rgb(13, 8, 135)", "0%");

    expectStop(gradient, "rgb(177, 42, 144)", "100%");

    const first = gradient.indexOf("rgb(13, 8, 135)");

    const middle = gradient.indexOf("rgb(106, 0, 168)");

    const last = gradient.indexOf("rgb(177, 42, 144)");

    expect(first).toBeGreaterThan(-1);

    expect(middle).toBeGreaterThan(first);

    expect(last).toBeGreaterThan(middle);
  });

  it("draws a stepped scale as hard bands", () => {
    const { ui } = initWithAuthorScale({
      stops: ["#0d0887", "#6a00a8", "#b12a90"],

      scale: { kind: "stepped", column: "score", vmin: 10, vmax: 30, levels: 3 },
    });

    const gradient = stripOf(blockOf(ui)).style.background;

    // Each color owns an equal slice: a band edge repeats the color's position

    // instead of interpolating across it.

    expectStop(gradient, "rgb(13, 8, 135)", "0%", "33.33%");

    expectStop(gradient, "rgb(106, 0, 168)", "33.33%", "66.67%");

    expectStop(gradient, "rgb(177, 42, 144)", "66.67%", "100%");
  });

  it("ranks a categorical layer deterministically and samples it down", () => {
    const colors = [
      "#2ca25f",

      "#99d8c9",

      "#c51b8a",

      "#f768a1",

      "#41b6c4",

      "#253494",

      "lightgrey",

      "#ffffcc",

      "#a1dab4",

      "#fe9929",

      "#d95f0e",

      "#993404",

      "#5ab4ac",

      "#01665e",

      "#c7e9b4",

      "#7fcdbb",

      "#edf8b1",

      "#e34a33",

      "#b30000",

      "#045a8d",
    ];

    const first = initWithAuthorScale({
      stops: colors,

      scale: null,

      distinct: 20,

      capped: true,
    });

    const second = initWithAuthorScale({
      stops: colors,

      scale: null,

      distinct: 20,

      capped: true,
    });

    // The same color set paints the same bar on every render: the order is a

    // function of the colors, never of the feature order they were found in.

    expect(stripOf(blockOf(first.ui)).style.background).toBe(
      stripOf(blockOf(second.ui)).style.background,
    );

    // 64+ colors are sampled down instead of flooding the control column with

    // blocks, and the real count stays stated on the box.

    const gradient = originalGradient(colors, null);

    expect(gradient).toBe(originalGradient(colors, null));

    expect(countStops(gradient)).toBeGreaterThan(1);

    expect(countStops(gradient)).toBeLessThanOrEqual(MAX_STOPS);

    // A CSS keyword the author's missing_kwds declared stays verbatim.

    expect(originalGradient(["#000000", "lightgrey"], null)).toContain("lightgrey");
  });

  it("ranks every color notation it understands, and keeps the rest stable", () => {
    // Hex, alpha hex, rgb() with channels and with percentages all rank by

    // hue; a notation it cannot read (a CSS keyword, an hsl() function) still

    // produces one deterministic bar instead of dropping the color.

    const stops = [
      "rgb(255, 0, 0)",

      "rgba(0, 0, 255, 0.5)",

      "rgb(100% 0% 0%)",

      "#00ff00",

      "#0000ffcc",

      "hsl(240 100% 50%)",

      "#12",
    ];

    const first = originalGradient(stops, null);

    expect(first).toBe(originalGradient(stops, null));

    // Verbatim: every stop the author declared survives into the bar.

    for (const stop of ["rgb(255, 0, 0)", "rgb(100% 0% 0%)", "hsl(240 100% 50%)"]) {
      expect(first).toContain(stop);
    }

    // Nothing to draw and a single color cannot make a gradient: the bar is

    // empty and the one color, not a broken linear-gradient.

    expect(originalGradient([], null)).toBe("");

    expect(originalGradient(["#123456"], null)).toBe("#123456");
  });

  it("keeps a stable order for ties, grays and malformed stops", () => {
    // Same hue at two lightnesses, two notations of one color, a gray with no

    // hue at all, a malformed rgb() and the empty string: every one of them

    // either ranks on an axis or falls into the named bucket, so the bar is

    // still deterministic instead of depending on the author's feature order.

    const stops = [
      "#ff0000",

      "#800000",

      "rgb(255, 0, 0)",

      "#808080",

      "rgb(1 2)",

      "rgb(a b c)",

      "",

      "#ff0000",
    ];

    const bar = originalGradient(stops, null);

    expect(bar).toBe(originalGradient(stops, null));

    // The empty string and the repeat dropped out; every declared color stayed.

    expect(bar).not.toContain(";;");

    expect(bar).toContain("#ff0000");

    expect(bar).toContain("rgb(1 2)");
  });

  it("draws the colors without a field row when the scale named no column", () => {
    const { ui } = initWithAuthorScale({
      scale: { kind: "continuous", vmin: 10, vmax: 30 },
    });

    const row = blockOf(ui);

    // A scale the author could not be paired with still has the real colors,

    // so the bar renders; the panel must not invent a field name.

    expect(boxOf(row, CONST.CLASSES.STYLE_FILL_ORIGINAL_COLUMN)).toBeNull();

    expect(labelsOf(row)).toEqual([
      "foliplus.classification_method",

      "LayerControl.style_fill_scheme",
      "LayerControl.style_fill_opacity",
    ]);
  });

  it("seeds the by-value mode with the shared defaults", () => {
    installChroma(["#111111", "#222222", "#333333"]);

    const { ui } = initWithAuthorScale();

    const row = blockOf(ui);

    const select = modeSelect(row);

    select.value = "value";

    select.dispatchEvent(new Event("change", { bubbles: true }));

    flushStyleDimApply(FACE.FILL, "overlay1");

    // The seed is the user's own classification: the shared six classes on

    // jenks/Viridis over the column the author actually drew — never the

    // author's color count, so a 43-color palette cannot collapse to 9.

    expect(getIntent(ui, "overlay1", "fillValue")).toMatchObject({
      field: "score",

      method: "jenks",

      classes: CLASS_COUNT.DEFAULT,

      scheme: "Viridis",
    });

    // The original mode stays offered: it is a state the user can return to.

    expect(select.value).toBe("value");

    expect(select.querySelector('option[value="original"]')).not.toBeNull();

    // The ramp detail is the user's classification now.

    expect(
      details(row).querySelector(selector(CONST.CLASSES.STYLE_FILL_METHOD_SELECT)),
    ).not.toBeNull();
  });

  it("honours the author stepped class count when the panel can carry it", () => {
    installChroma(["#111111", "#222222", "#333333"]);

    const { ui } = initWithAuthorScale({
      scale: { kind: "stepped", column: "score", vmin: 10, vmax: 30, levels: 5 },
    });

    const select = modeSelect(blockOf(ui));

    select.value = "value";

    select.dispatchEvent(new Event("change", { bubbles: true }));

    expect(getIntent(ui, "overlay1", "fillValue")).toMatchObject({
      field: "score",

      classes: 5,
    });
  });

  it("falls back to the default class count past the panel vocabulary", () => {
    installChroma(["#111111", "#222222", "#333333"]);

    const { ui } = initWithAuthorScale({
      scale: { kind: "stepped", column: "score", vmin: 10, vmax: 30, levels: 12 },
    });

    const select = modeSelect(blockOf(ui));

    select.value = "value";

    select.dispatchEvent(new Event("change", { bubbles: true }));

    expect(getIntent(ui, "overlay1", "fillValue")).toMatchObject({
      classes: CLASS_COUNT.DEFAULT,
    });
  });

  it("seeds from the first numeric field when the scale names no column", () => {
    installChroma(["#111111", "#222222", "#333333"]);

    const { ui } = initWithAuthorScale({
      scale: { kind: "continuous", vmin: 10, vmax: 30 },
    });

    const select = modeSelect(blockOf(ui));

    select.value = "value";

    select.dispatchEvent(new Event("change", { bubbles: true }));

    expect(getIntent(ui, "overlay1", "fillValue")).toMatchObject({ field: "score" });
  });

  it("leaves the by-value mode out when the layer offers no value field", () => {
    const { ui, layer } = initWithAuthorScale();

    for (const leaf of layer.leaves as Array<{
      feature: { properties: Record<string, unknown> };
    }>) {
      // Clear every property, numeric and categorical alike: a layer with any

      // value field (a numeric column or a discrete string column) legitimately

      // offers the by-value mode, so the "no mode row" case is exactly an

      // empty feature bag.

      for (const key of Object.keys(leaf.feature.properties)) {
        delete leaf.feature.properties[key];
      }
    }

    ui.runtimeStore.setFields("overlay1", []);

    const select = modeSelect(blockOf(ui));

    expect(select.value).toBe("original");

    expect(select.querySelector('option[value="value"]')).toBeNull();

    expect(select.querySelector('option[value="original"]')).not.toBeNull();
  });

  it("keeps the original colors when only the opacity was overridden", () => {
    const { ui } = initWithAuthorScale();

    setIntent(ui, "overlay1", "fillOpacity", 0.4);

    // The author's per-feature colors are still what the layer paints; only a

    // fill mode intent takes the mode over.

    expect(modeSelect(blockOf(ui)).value).toBe("original");
  });

  it("shows the stored mode but keeps the original one offered", () => {
    const { ui } = initWithAuthorScale();

    setIntent(ui, "overlay1", "fillStyleMode", "solid");

    const row = blockOf(ui);

    const select = modeSelect(row);

    expect(select.value).toBe("solid");

    expect(select.querySelector('option[value="original"]')).not.toBeNull();

    expect(
      row.querySelector(selector(CONST.CLASSES.STYLE_FILL_COLOR_INPUT)),
    ).not.toBeNull();
  });

  it("switching from the original colors to solid seeds and paints one color", () => {
    const { ui, layer } = initWithAuthorScale();

    const row = blockOf(ui);

    const select = modeSelect(row);

    select.value = "solid";

    select.dispatchEvent(new Event("change", { bubbles: true }));

    flushStyleDimApply(FACE.FILL, "overlay1");

    // No colour intent is written: the base is derived at apply time, so a

    // reset never shows a colour the user never chose. The map still paints

    // one colour — the authored base, not the per-feature multi-colour face.

    expect(getIntent(ui, "overlay1", "fillColor")).toBeUndefined();

    for (const leaf of layer.leaves) {
      expect(leaf.setStyle).toHaveBeenLastCalledWith({
        fillColor: "#0d0887",

        fill: true,
      });
    }
  });

  it("switching back to the original colors releases the override", () => {
    const { ui, layer } = initWithAuthorScale();

    const row = blockOf(ui);

    const select = modeSelect(row);

    select.value = "solid";

    select.dispatchEvent(new Event("change", { bubbles: true }));

    flushStyleDimApply(FACE.FILL, "overlay1");

    select.value = "original";

    select.dispatchEvent(new Event("change", { bubbles: true }));

    flushStyleDimApply(FACE.FILL, "overlay1");

    // The mode is stored — the choice survives a reload — and the map paints

    // each leaf's own author color again, not the single one.

    expect(getIntent(ui, "overlay1", "fillStyleMode")).toBe("original");

    expect(layer.leaves[0].setStyle).toHaveBeenLastCalledWith({
      fillColor: "#0d0887",

      fillOpacity: 0.5,

      fill: true,
    });

    expect(layer.leaves[1].setStyle).toHaveBeenLastCalledWith({
      fillColor: "#6a00a8",

      fillOpacity: 0.5,

      fill: true,
    });

    // Back in the read-only detail: no classification control renders.

    expect(details(row).querySelector("select")).toBeNull();
  });

  it("steps down to the author's own stop count when the scale names no level", () => {
    // originalCaption + originalCount: a stepped scale without `levels`

    // (hand-built record) falls back to the author's stop count — the

    // honest number of bands the author actually drew.

    const { ui } = initWithAuthorScale({
      stops: ["#0d0887", "#6a00a8", "#b12a90", "#f0f921"],

      scale: { kind: "stepped", column: "score", vmin: 10, vmax: 30 },
    });

    const row = blockOf(ui);

    expect(colorsBoxOf(row).title).toBe("LayerControl.style_fill_original_levels");

    expect(readoutOf(row, CONST.CLASSES.STYLE_FILL_ORIGINAL_COUNT)).toBe("4");
  });

  it("states the fallback distinct count without a plus for an uncapped record", () => {
    // originalCaption + originalCount: no paired scale (categorical/legend=False)

    // and no distinct value recorded, capped falsy -> the count states 0 (nothing

    // the record proves) with no "+" suffix. The author still painted real stops

    // (the bar must render), only the count is a fallback.

    const { ui } = initWithAuthorScale({
      stops: ["#0d0887", "#6a00a8", "#b12a90"],

      scale: null,

      distinct: 0,

      capped: false,
    });

    const row = blockOf(ui);

    expect(colorsBoxOf(row).title).toBe("LayerControl.style_fill_original_colors");

    expect(readoutOf(row, CONST.CLASSES.STYLE_FILL_ORIGINAL_COUNT)).toBe("0");
  });

  it("draws the default swatch when the author recorded no stops", () => {
    // originalDetail.ts:118-119 — `author?.stops.length ? author.stops : [DEFAULT]`.
    // A per-feature author record with no stops at all must still paint the bar
    // with the documented default color, never an empty/invalid gradient. The
    // layer still has real leaves (the areal gate needs them); only the author's
    // recorded stop list is empty.
    installLeafletGlobals();
    const layer = makePerFeatureLayer(["#0d0887", "#6a00a8"]);
    const { ui } = initFixture({
      data: [
        {
          id: "overlay1",
          name: "Original",
          role: "overlay",
          layer,
          fillAuthor: { perFeature: true, distinct: 0, stops: [] },
        },
      ],
    });
    ui.runtimeStore.setFields("overlay1", [{ name: "score", numeric: true }]);
    const row = blockOf(ui);
    const strip = stripOf(row);
    // originalGradient([DEFAULT], undefined) -> the single color verbatim
    // (jsdom normalizes a cssText background:#cccccc to rgb(204, 204, 204)).
    expect(strip.style.background).toBe("rgb(204, 204, 204)");
  });

  it("reuses the solid row colour chrome for the monochrome original block", async () => {
    // The monochrome ORIGINAL colour block must use the SAME chrome as the
    // SOLID row (STYLE_FILL_COLOR_INPUT) so the two paint one box — flex:1,
    // ctrl-size tall, one border, one radius — and the colour fills the whole
    // block instead of a small square floating in an empty frame.
    installLeafletGlobals();
    const layer = makeFillableLayer();
    const { ui } = initFixture({
      data: [
        {
          id: "overlay1",
          name: "Original",
          role: "overlay",
          layer,
          fillAuthor: { perFeature: false, distinct: 1, stops: ["#aabbcc"] },
        },
      ],
    });
    const row = blockOf(ui);
    const colorBlock = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`,
    ) as HTMLElement | null;
    // The monochrome row MUST use the SOLID chrome class.
    expect(colorBlock).not.toBeNull();
    // ...and it must NOT use the cmap strip (the flex:1 strip belongs to the
    // per-feature multi-row form the monochrome row no longer paints).
    expect(row.querySelector(`.${CONST.CLASSES.STYLE_FILL_ORIGINAL_STRIP}`)).toBeNull();
    // The block is read-only (no colour picker interaction) and carries the
    // author's colour as its own background, filling the whole box.
    expect(colorBlock?.classList.contains(PANEL_CLASS.READONLY)).toBe(true);
    expect(colorBlock?.getAttribute("role")).toBe("img");
    expect(colorBlock?.style.background).toBe("rgb(170, 187, 204)");
    // The old fixed-size square class is gone entirely: the stylesheet no
    // longer defines it, so nothing can re-introduce the floating-square
    // layout.
    const { readFileSync } = await import("node:fs");
    const css = readFileSync("foliplus/css/control/LayerControl/style.css", "utf8");
    expect(css).not.toContain(".foliplus-style-fill-original-swatch");
  });
  it("reads the default constants when the per-feature record carries no author data", async () => {
    // originalCaption/originalCount/originalGradient all guard `author?.` — a

    // per-feature layer whose fillAuthor record vanished (a streamed data

    // replacement) must still render the bar with the documented defaults, not

    // throw on `author.stops.length`. The spy forces the perFeature arm so the

    // multi-row cmap form (buildOriginalDetail) runs with author === null.

    const fa = await import("#control/LayerControl/ui/style/fillAuthor.js");

    const spy = vi.spyOn(fa, "paintsPerFeatureFill").mockReturnValue(true);

    try {
      installLeafletGlobals();

      const layer = makePerFeatureLayer(["#0d0887", "#6a00a8"]);

      const { ui } = initFixture({
        data: [
          {
            id: "overlay1",

            name: "Original",

            role: "overlay",

            layer,

            // No fillAuthor key at all: the record is gone.
          },
        ],
      });

      ui.runtimeStore.setFields("overlay1", [{ name: "score", numeric: true }]);

      const row = blockOf(ui);

      // The mode reads original (perFeature arm) and the detail falls back to

      // the default swatch + the honest 0-count.

      expect(modeSelect(row).value).toBe("original");

      const strip = stripOf(row);

      expect(strip.style.background).toBe("rgb(204, 204, 204)");

      expect(readoutOf(row, CONST.CLASSES.STYLE_FILL_ORIGINAL_COUNT)).toBe("0");
    } finally {
      spy.mockRestore();
    }
  });

  it("states a zero count when a stepped record names no level and no stops", () => {
    // originalCaption + originalCount: `scale.levels ?? author?.stops.length

    // ?? 0` — a stepped scale whose record names neither levels nor stops

    // falls all the way to the documented 0 (nothing the record proves).

    installLeafletGlobals();

    const layer = makePerFeatureLayer(["#0d0887", "#6a00a8"]);

    const { ui } = initFixture({
      data: [
        {
          id: "overlay1",

          name: "Original",

          role: "overlay",

          layer,

          fillAuthor: {
            perFeature: true,

            distinct: 0,

            stops: [],

            scale: { kind: "stepped", column: "score", vmin: 10, vmax: 30 },
          },
        },
      ],
    });

    ui.runtimeStore.setFields("overlay1", [{ name: "score", numeric: true }]);

    const row = blockOf(ui);

    expect(colorsBoxOf(row).title).toBe("LayerControl.style_fill_original_levels");

    expect(readoutOf(row, CONST.CLASSES.STYLE_FILL_ORIGINAL_COUNT)).toBe("0");
  });
});
