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
