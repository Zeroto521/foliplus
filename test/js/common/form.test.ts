import { describe, expect, it, vi } from "vitest";
import {
  bindLiveColor,
  bindLiveNumber,
  colorInput,
  inlineControls,
  normalizeHexColor,
  numberInput,
} from "#common/form.js";

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
