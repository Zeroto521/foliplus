import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  BORDER_WEIGHT,
  LABEL_SIZE,
  bindLiveColor,
  bindLiveNumber,
  clampBorderWeight,
  clampLabelSize,
  colorInput,
  formRow,
  inlineControls,
  normalizeHexColor,
  numberInput,
  selectInput,
} from "#common/form.js";

describe("LABEL_SIZE / clampLabelSize", () => {
  it("exposes one shared bound set and clamps into it", () => {
    expect(LABEL_SIZE.SIZE_MIN).toBe(6);
    expect(LABEL_SIZE.SIZE_MAX).toBe(32);
    expect(LABEL_SIZE.SIZE_STEP).toBe(1);
    expect(LABEL_SIZE.SIZE_DEFAULT).toBe(11);
    expect(clampLabelSize(99)).toBe(32);
    expect(clampLabelSize(1)).toBe(6);
    expect(clampLabelSize(14)).toBe(14);
  });
});

describe("normalizeHexColor", () => {
  it("expands #rgb to #rrggbb and leaves other values alone", () => {
    expect(normalizeHexColor("#fff")).toBe("#ffffff");
    expect(normalizeHexColor("#AbC")).toBe("#aabbcc");
    expect(normalizeHexColor("#ff0000")).toBe("#ff0000");
    expect(normalizeHexColor("red")).toBe("red");
  });
});

describe("colorInput / numberInput / inlineControls", () => {
  it("builds color and number inputs on the shared chrome", () => {
    const color = colorInput({ value: "#fff", ariaLabel: "c" }) as HTMLInputElement;
    expect(color.type).toBe("color");
    expect(color.className).toContain("foliplus-form-color-input");
    expect(color.value).toBe("#ffffff");
    expect(color.getAttribute("aria-label")).toBe("c");

    const bare = colorInput({}) as HTMLInputElement;
    expect(bare.className).toBe("foliplus-form-color-input");
    expect(bare.value).toBe("#ffffff");

    const num = numberInput({
      value: LABEL_SIZE.SIZE_DEFAULT,
      min: LABEL_SIZE.SIZE_MIN,
      max: LABEL_SIZE.SIZE_MAX,
      className: "extra",
      ariaLabel: "n",
    }) as HTMLInputElement;
    expect(num.type).toBe("number");
    expect(num.className).toContain("foliplus-form-number-input");
    expect(num.className).toContain("extra");
    expect(num.min).toBe("6");
    expect(num.max).toBe("32");
    expect(num.value).toBe("11");

    const bareNum = numberInput({ value: 8, min: 1, max: 10 }) as HTMLInputElement;
    expect(bareNum.className).toBe("foliplus-form-number-input");
    expect(bareNum.step).toBe("1");

    const row = inlineControls(color, num);
    expect(row.className).toBe("foliplus-form-inline");
    expect(row.children.length).toBe(2);
  });

  it("formRow assembles the shared row chrome (label + control cell)", () => {
    const control = inlineControls(
      colorInput({}),
      numberInput({ value: 5, min: 0, max: 10 }),
    );
    const row = formRow("Fill Color", control, "row-extra");

    expect(row.className).toBe("foliplus-form-row row-extra");
    const label = row.querySelector(".foliplus-form-label");
    expect(label?.textContent).toBe("Fill Color");
    const cell = row.querySelector(".foliplus-form-control");
    expect(cell?.firstElementChild?.className).toBe("foliplus-form-inline");

    const bare = formRow("Plain", document.createElement("input"));
    expect(bare.className).toBe("foliplus-form-row");
  });
});

describe("bindLiveNumber / bindLiveColor", () => {
  it("applies in-range values on input and clamps on change", () => {
    const input = document.createElement("input");
    input.type = "number";
    const onCommit = vi.fn();
    bindLiveNumber(input, {
      min: LABEL_SIZE.SIZE_MIN,
      max: LABEL_SIZE.SIZE_MAX,
      fallback: LABEL_SIZE.SIZE_DEFAULT,
      onCommit,
    });

    input.value = "99";
    input.dispatchEvent(new Event("input"));
    expect(onCommit).not.toHaveBeenCalled();

    input.value = "18";
    input.dispatchEvent(new Event("input"));
    expect(onCommit).toHaveBeenCalledWith(18);

    input.value = "99";
    input.dispatchEvent(new Event("change"));
    expect(input.value).toBe("32");
    expect(onCommit).toHaveBeenLastCalledWith(32);

    input.value = "";
    input.dispatchEvent(new Event("change"));
    expect(input.value).toBe("11");
    expect(onCommit).toHaveBeenLastCalledWith(11);
  });

  it("commits color on every input", () => {
    const input = document.createElement("input");
    input.type = "color";
    const onCommit = vi.fn();
    bindLiveColor(input, onCommit);
    input.value = "#00ff00";
    input.dispatchEvent(new Event("input"));
    expect(onCommit).toHaveBeenCalledWith("#00ff00");
  });
});

describe("normalizeHexColor", () => {
  it("expands #rgb to #rrggbb and leaves other values alone", () => {
    expect(normalizeHexColor("#fff")).toBe("#ffffff");
    expect(normalizeHexColor("#AbC")).toBe("#aabbcc");
    expect(normalizeHexColor("#ff0000")).toBe("#ff0000");
    expect(normalizeHexColor("red")).toBe("red");
  });
});

describe("colorInput / numberInput / inlineControls", () => {
  it("builds color and number inputs on the shared chrome", () => {
    const color = colorInput({ value: "#fff", ariaLabel: "c" }) as HTMLInputElement;
    expect(color.type).toBe("color");
    expect(color.className).toContain("foliplus-form-color-input");
    expect(color.value).toBe("#ffffff");
    expect(color.getAttribute("aria-label")).toBe("c");

    const num = numberInput({
      value: 11,
      min: 6,
      max: 32,
      className: "extra",
      ariaLabel: "n",
    }) as HTMLInputElement;
    expect(num.type).toBe("number");
    expect(num.className).toContain("foliplus-form-number-input");
    expect(num.className).toContain("extra");
    expect(num.min).toBe("6");
    expect(num.max).toBe("32");
    expect(num.value).toBe("11");

    const row = inlineControls(color, num);
    expect(row.className).toBe("foliplus-form-inline");
    expect(row.children.length).toBe(2);
  });
});

describe("bindLiveNumber / bindLiveColor", () => {
  it("applies in-range values on input and clamps on change", () => {
    const input = document.createElement("input");
    input.type = "number";
    const onCommit = vi.fn();
    bindLiveNumber(input, { min: 6, max: 32, fallback: 11, onCommit });

    input.value = "99";
    input.dispatchEvent(new Event("input"));
    expect(onCommit).not.toHaveBeenCalled();

    input.value = "18";
    input.dispatchEvent(new Event("input"));
    expect(onCommit).toHaveBeenCalledWith(18);

    input.value = "99";
    input.dispatchEvent(new Event("change"));
    expect(input.value).toBe("32");
    expect(onCommit).toHaveBeenLastCalledWith(32);

    input.value = "";
    input.dispatchEvent(new Event("change"));
    expect(input.value).toBe("11");
    expect(onCommit).toHaveBeenLastCalledWith(11);
  });

  it("normalizes a parsed value before the bounds check and the commit", () => {
    // The bounds check and the commit both run on the shaped value, so a
    // whole-number field cannot persist a fraction it will round on the next
    // read.
    const input = document.createElement("input");
    input.type = "number";
    const onCommit = vi.fn();
    bindLiveNumber(input, {
      min: 1,
      max: 64,
      fallback: 10,
      normalize: Math.round,
      onCommit,
    });

    input.value = "30.5";
    input.dispatchEvent(new Event("input"));
    expect(onCommit).toHaveBeenCalledWith(31);

    input.value = "30.5";
    input.dispatchEvent(new Event("change"));
    expect(input.value).toBe("31");
    expect(onCommit).toHaveBeenLastCalledWith(31);

    // A value that rounds below the floor is clamped, not committed as-is.
    input.value = "0.4";
    input.dispatchEvent(new Event("change"));
    expect(input.value).toBe("1");
    expect(onCommit).toHaveBeenLastCalledWith(1);
  });

  it("commits color on every input", () => {
    const input = document.createElement("input");
    input.type = "color";
    const onCommit = vi.fn();
    bindLiveColor(input, onCommit);
    input.value = "#00ff00";
    input.dispatchEvent(new Event("input"));
    expect(onCommit).toHaveBeenCalledWith("#00ff00");
  });
});

describe("BORDER_WEIGHT / clampBorderWeight", () => {
  it("clamps a hand-edited weight into the shared bounds", () => {
    expect(BORDER_WEIGHT.MIN).toBe(0);
    expect(BORDER_WEIGHT.MAX).toBe(10);
    expect(clampBorderWeight(-3)).toBe(0);
    expect(clampBorderWeight(42)).toBe(10);
    expect(clampBorderWeight(2.5)).toBe(2.5);
  });
});

describe("selectInput", () => {
  it("builds a native select and applies the current value", () => {
    const select = selectInput({
      className: "extra",
      ariaLabel: "pick",
      value: "b",
      options: [
        { value: "a", label: "A" },
        { value: "b", label: "B", disabled: true, title: "kept for context" },
      ],
    });

    expect(select.tagName).toBe("SELECT");
    expect(select.className).toBe("foliplus-form-select extra");
    expect(select.getAttribute("aria-label")).toBe("pick");
    expect(Array.from(select.options).map(o => o.value)).toEqual(["a", "b"]);
    expect(select.options[1].disabled).toBe(true);
    expect(select.options[1].title).toBe("kept for context");
    expect(select.value).toBe("b");
  });

  it("leaves the select unselected when the value has no option", () => {
    const select = selectInput({
      value: "gone",
      options: [{ value: "a", label: "A" }],
    });

    expect(select.value).toBe("");
  });
});

// ── Shared panel form geometry (stylesheet contract) ──
//
// The heatmap panel and LayerControl's style drawer both build their rows from
// these primitives, so their columns are the same only while these rules keep
// resolving from one token instead of a per-panel width. These assertions pin
// the *relationships* between the stylesheet sources — which token feeds which
// rule — rather than pixel values, which the browser probe records.

const ROOT = resolve(__dirname, "../../..");

/** Read a stylesheet with normalized line endings.
 *
 * The checkout is CRLF on Windows (`core.autocrlf=true`) and LF on the Linux
 * runner, so a multi-line selector literal would match on one platform and
 * miss on the other. Normalizing here keeps every assertion below
 * platform-independent. */
const css = (rel: string): string =>
  readFileSync(resolve(ROOT, rel), "utf-8").replace(/\r\n/g, "\n");

/** The declaration block that starts at `selector` (first match), found by
 *  brace matching so a block that contains nested rules (`&:hover`,
 *  `&::-webkit-…`) is returned whole instead of stopping at the first inner
 *  closing brace. */
const blockOf = (source: string, selector: string): string => {
  const start = source.indexOf(selector);
  expect(start, `${selector} is missing`).toBeGreaterThanOrEqual(0);
  const open = source.indexOf("{", start);
  expect(open, `${selector} has no opening brace`).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`${selector} block never closes`);
};

describe("form width tokens (stylesheet contract)", () => {
  const tokens = css("foliplus/css/common/token.css");
  const form = css("foliplus/css/common/form.css");

  it("defines the inline-secondary width as the number-field width", () => {
    // One token, not two numerically-equal constants: the class-count select
    // and the compact number field are the same role, so they cannot drift.
    expect(tokens).toMatch(
      /--foliplus-form-secondary-width:\s*var\(--foliplus-form-number-width\);/,
    );
  });

  it("feeds the number input and the classes select from that token", () => {
    const numberInput = blockOf(form, ".foliplus-form-number-input {");
    expect(numberInput).toContain("var(--foliplus-form-secondary-width");

    const classesSelect = blockOf(form, ".foliplus-classes-select {");
    expect(classesSelect).toContain("var(--foliplus-form-secondary-width");
    expect(classesSelect).toContain("flex-shrink: 0");
  });

  it("has no heatmap-local inline-width token or class override left", () => {
    // The heatmap namespaced both the token and the width rule; the shared
    // class replaced them, and a re-introduced override would split the two
    // panels' method/class-count rows again.
    expect(tokens).not.toContain("--foliplus-heatmap-inline-width");
    const heatmap = css("foliplus/css/HeatmapControl.css");
    expect(heatmap).not.toContain(".foliplus-heatmap-class-select");
    expect(heatmap).not.toContain(".foliplus-classes-select");
  });
});

describe("control column (stylesheet contract)", () => {
  const tokens = css("foliplus/css/common/token.css");
  const form = css("foliplus/css/common/form.css");
  const panel = css("foliplus/css/common/panel.css");

  it("derives the control width from the panel shell and the row inset", () => {
    const width = tokens.match(/--foliplus-form-control-width:([\s\S]*?);/);
    expect(width).not.toBeNull();
    for (const term of [
      "var(--foliplus-panel-width)",
      "var(--foliplus-panel-inset-x)",
      "var(--foliplus-form-label-width)",
      "var(--foliplus-space-md)",
    ]) {
      expect(width![1]).toContain(term);
    }
  });

  it("lets the shared form row own the horizontal inset", () => {
    const row = blockOf(form, ".foliplus-form-row {");
    expect(row).toContain("padding: 0 var(--foliplus-panel-inset-x)");
    // The row panel may only replace that inset inside its own border
    // compensation; a rule that reached every panel would be a second owner,
    // which is what shifted the style panel's columns off the heatmap's.
    const card = blockOf(panel, ".foliplus-panel.foliplus-row-panel {");
    expect(card).toContain(".foliplus-form-row");
    expect(panel.replace(card, "")).not.toContain(".foliplus-form-row");
  });

  it("resolves the control cell through the control-width token", () => {
    const control = blockOf(form, ".foliplus-form-control {");
    expect(control).toContain("var(--foliplus-form-control-width)");
  });

  it("keeps the row-panel hairline a border and derives its inset from it", () => {
    // An inset outline is painted under the header's background, so the top
    // hairline and the header segment of the side hairlines disappeared. The
    // card keeps a real border and subtracts it from the shared inset instead,
    // which holds the visual inset (11px + 1px) and the column edges.
    const rowPanel = blockOf(
      css("foliplus/css/common/menu.css"),
      ".foliplus-row-panel {",
    );
    expect(rowPanel).toContain(
      "border: var(--foliplus-border-thin) solid var(--foliplus-input-border)",
    );
    expect(rowPanel).not.toContain("outline");

    // The compensation is a token definition, so it lives in token.css with the
    // token it derives from; the component stylesheet only consumes it.
    const tokens = css("foliplus/css/common/token.css");
    expect(tokens).toMatch(
      /--foliplus-row-panel-inset-x:\s*calc\([\s\S]*?var\(--foliplus-panel-inset-x\)[\s\S]*?var\(--foliplus-border-thin\)/,
    );

    const panelCss = css("foliplus/css/common/panel.css");
    expect(panelCss).toMatch(
      /\.foliplus-form-row,\s*\n\s*\.foliplus-btn-row\s*\{[\s\S]*?padding-left: var\(--foliplus-row-panel-inset-x\)/,
    );
    expect(panelCss).toMatch(
      /\.foliplus-section-divider\s*\{[\s\S]*?margin-left: var\(--foliplus-row-panel-inset-x\)/,
    );
  });
});

describe("footer inset (stylesheet contract)", () => {
  it("insets the footer action row and its divider with the shared token", () => {
    const button = css("foliplus/css/common/button.css");
    const rows = blockOf(button, ":is(.foliplus-btn-row, .foliplus-heatmap-btn-row) {");
    expect(rows).toContain("var(--foliplus-panel-inset-x)");

    const panelCss = css("foliplus/css/common/panel.css");
    const panelCard = blockOf(panelCss, ".foliplus-panel {");
    expect(panelCard).toContain(".foliplus-section-divider");
    expect(panelCard).toContain(
      "margin: var(--foliplus-space-md) var(--foliplus-panel-inset-x)",
    );
  });
});

describe("clickable-box family (stylesheet contract)", () => {
  it("reads one height, radius and type-scale token per family", () => {
    const button = css("foliplus/css/common/button.css");
    const panelBtn = blockOf(button, ".foliplus-panel-btn {");
    expect(panelBtn).toContain("height: var(--foliplus-ctrl-size)");
    expect(panelBtn).toContain("border-radius: var(--foliplus-radius-sm)");
    expect(panelBtn).toContain("font-size: var(--foliplus-font-size-sm)");

    const toggles = blockOf(
      button,
      ".foliplus-toggle-btn,\n.foliplus-tool-btn,\n.foliplus-search-mode-btn {",
    );
    expect(toggles).toContain("height: var(--foliplus-ctrl-size)");
    expect(toggles).toContain("font-size: var(--foliplus-font-size-sm)");

    const close = blockOf(css("foliplus/css/common/menu.css"), ".foliplus-close-btn {");
    expect(close).toContain("font-size: var(--foliplus-font-size-sm)");
  });
});

describe("common/form.ts emits the shared chrome classes", () => {
  const source = readFileSync(resolve(ROOT, "foliplus/js/common/form.ts"), "utf-8");
  const form = css("foliplus/css/common/form.css");

  it("names the row, label and control classes the CSS styles", () => {
    // The builder and the stylesheet are one contract: a renamed class in
    // either file would silently drop the shared geometry.
    for (const cls of [
      "foliplus-form-row",
      "foliplus-form-label",
      "foliplus-form-control",
      "foliplus-form-inline",
    ]) {
      expect(source).toContain(cls);
      expect(form).toContain(`.${cls}`);
    }
  });

  it("names the input chrome classes the CSS styles", () => {
    for (const cls of [
      "foliplus-form-select",
      "foliplus-form-number-input",
      "foliplus-form-color-input",
    ]) {
      expect(source).toContain(cls);
      expect(form).toContain(`.${cls}`);
    }
  });
});
