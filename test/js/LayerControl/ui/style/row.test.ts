// buildModeRow — the shared mode selector used by the fill row (and later by
// icon / size by value). Kept in its own suite so the primitive is tested for
// what it promises, independent of any one dimension's wiring.
import { describe, expect, it } from "vitest";
import { buildModeRow } from "#foliplus/LayerControl/ui/style/row.js";

const build = (
  overrides: Partial<Parameters<typeof buildModeRow>[0]> = {},
): ReturnType<typeof buildModeRow> =>
  buildModeRow({
    label: "Fill",
    selectClass: "mode-select",
    rowClass: "mode-row",
    detailClass: "mode-detail",
    value: "solid",
    options: [
      { value: "solid", label: "Single color" },
      { value: "ramp", label: "Color by value" },
    ],
    ...overrides,
  });

describe("buildModeRow", () => {
  it("renders a labelled form row with a native select and a detail slot", () => {
    const { block, select, detail } = build();

    const row = block.querySelector(".foliplus-form-row")!;
    expect(row.classList.contains("mode-row")).toBe(true);
    expect(row.querySelector(".foliplus-form-label")!.textContent).toBe("Fill");
    expect(select.classList.contains("foliplus-form-select")).toBe(true);
    expect(select.classList.contains("mode-select")).toBe(true);
    expect(select.getAttribute("aria-label")).toBe("Fill");
    expect(detail.classList.contains("mode-detail")).toBe(true);
    expect(block.contains(detail)).toBe(true);
    expect(detail.childElementCount).toBe(0);
  });

  it("renders one option per mode and selects the current value", () => {
    const { select } = build({ value: "ramp" });

    expect(Array.from(select.options).map(o => o.value)).toEqual(["solid", "ramp"]);
    expect(Array.from(select.options).map(o => o.textContent)).toEqual([
      "Single color",
      "Color by value",
    ]);
    expect(select.value).toBe("ramp");
  });

  it("keeps an unavailable mode visible but disabled, with its reason", () => {
    const { select } = build({
      options: [
        { value: "solid", label: "Single color" },
        {
          value: "ramp",
          label: "Color by value",
          disabled: true,
          title: "No numeric field",
        },
      ],
    });

    const ramp = select.querySelector('option[value="ramp"]') as HTMLOptionElement;
    expect(ramp.disabled).toBe(true);
    expect(ramp.title).toBe("No numeric field");
    // The available option stays enabled.
    expect(
      (select.querySelector('option[value="solid"]') as HTMLOptionElement).disabled,
    ).toBe(false);
  });

  it("lets the caller pick a different row/select/detail class", () => {
    const { block, select, detail } = build({
      selectClass: "size-mode",
      rowClass: "size-row",
      detailClass: "size-detail",
    });

    expect(
      block.querySelector(".foliplus-form-row")!.classList.contains("size-row"),
    ).toBe(true);
    expect(select.classList.contains("size-mode")).toBe(true);
    expect(detail.classList.contains("size-detail")).toBe(true);
  });
});
