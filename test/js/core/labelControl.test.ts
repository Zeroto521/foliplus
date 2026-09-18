// core/labelControl.ts — the shared label-control renderer that the heatmap
// panel and LayerControl's style drawer both build from. These tests pin its
// contract: which rows a declaration renders, how changes dispatch, how the
// refresh mirrors a remote write, and where its vocabulary resolves from.
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderLabelControls } from "#core/labelControl.js";
import { createTranslator } from "#common/locale.js";

interface Values {
  labelShow?: boolean;
  labelColor?: string;
  labelSize?: number;
  labelFormat?: string;
  labelCollide?: boolean;
}

type Setters = Record<string, (v: never) => void>;

const fire = (el: HTMLElement, type: string): void => {
  el.dispatchEvent(new Event(type, { bubbles: true }));
};

const ALL_SETTERS = (): Setters => ({
  labelShow: vi.fn(),
  labelColor: vi.fn(),
  labelSize: vi.fn(),
  labelFormat: vi.fn(),
  labelCollide: vi.fn(),
});

/** Render the controls into the document; the provider/setters stay mutable so
 *  a test can play a remote write or a layer teardown. */
const render = (
  init: {
    values?: Values;
    setters?: Setters;
    T?: (key: string) => string;
  } = {},
) => {
  let values: Values | undefined = init.values ?? {};
  // A passed map is the exact declaration — that is what the "renders only the
  // declared rows" cases exercise; omitting it means the full vocabulary.
  const setters: Setters = init.setters ? { ...init.setters } : ALL_SETTERS();
  const result = renderLabelControls({
    styleProvider: () => values,
    getSetters: () => setters,
    T: init.T ?? ((key: string) => key),
  });
  document.body.appendChild(result.root);
  return {
    ...result,
    setters,
    setValues: (next: Values | undefined) => {
      values = next;
    },
  };
};

const bodyOf = (root: HTMLElement): HTMLElement =>
  root.querySelector(".foliplus-style-body") as HTMLElement;

const inRoot = <T extends Element>(root: HTMLElement, sel: string): T =>
  root.querySelector(sel) as T;

const rowLabels = (root: HTMLElement): string[] =>
  [...root.querySelectorAll(".foliplus-form-label")].map(n => n.textContent ?? "");

afterEach(() => {
  document.body.innerHTML = "";
  delete (window.foliplus as { _TABLES?: unknown })._TABLES;
  vi.restoreAllMocks();
});

describe("renderLabelControls — which rows render", () => {
  it("renders the whole vocabulary when every setter is declared", () => {
    const { root } = render({ values: { labelShow: true, labelCollide: true } });

    expect(inRoot(root, ".foliplus-style-toggle-input")).not.toBeNull();
    expect(inRoot(root, ".foliplus-style-label-color-input")).not.toBeNull();
    expect(inRoot(root, ".foliplus-style-label-size-input")).not.toBeNull();
    expect(inRoot(root, ".foliplus-style-format-select")).not.toBeNull();
    expect(inRoot(root, ".foliplus-style-collide-input")).not.toBeNull();
  });

  it("renders only the rows whose setter the component declared", () => {
    // The heatmap panel delegates no collide, so that row must not appear.
    const { root } = render({
      values: { labelShow: true },
      setters: { labelShow: vi.fn(), labelFormat: vi.fn() },
    });

    expect(inRoot(root, ".foliplus-style-toggle-input")).not.toBeNull();
    expect(inRoot(root, ".foliplus-style-format-select")).not.toBeNull();
    expect(inRoot(root, ".foliplus-style-label-color-input")).toBeNull();
    expect(inRoot(root, ".foliplus-style-label-size-input")).toBeNull();
    expect(inRoot(root, ".foliplus-style-collide-input")).toBeNull();
  });

  it("renders the size slot alone when only the size setter is declared", () => {
    const { root } = render({ setters: { labelShow: vi.fn(), labelSize: vi.fn() } });

    expect(inRoot(root, ".foliplus-style-label-color-input")).toBeNull();
    expect(inRoot(root, ".foliplus-style-label-size-input")).not.toBeNull();
  });
});

describe("renderLabelControls — body collapse", () => {
  it("hides the body when labels are off and reveals it on flip", () => {
    const { root, setters } = render({ values: { labelShow: false } });
    const toggle = inRoot<HTMLInputElement>(root, ".foliplus-style-toggle-input");
    expect(bodyOf(root).classList.contains("foliplus-hidden")).toBe(true);

    toggle.checked = true;
    fire(toggle, "change");

    expect(bodyOf(root).classList.contains("foliplus-hidden")).toBe(false);
    expect(setters.labelShow).toHaveBeenCalledWith(true);
  });

  it("collapses again when the toggle goes back off", () => {
    const { root } = render({ values: { labelShow: true } });
    const toggle = inRoot<HTMLInputElement>(root, ".foliplus-style-toggle-input");

    toggle.checked = false;
    fire(toggle, "change");

    expect(bodyOf(root).classList.contains("foliplus-hidden")).toBe(true);
  });
});

describe("renderLabelControls — change dispatch", () => {
  it("dispatches the format select and the collide switch to their setters", () => {
    const { root, setters } = render({
      values: { labelShow: true, labelCollide: true },
    });

    const format = inRoot<HTMLSelectElement>(root, ".foliplus-style-format-select");
    format.value = "comma";
    fire(format, "change");
    expect(setters.labelFormat).toHaveBeenCalledWith("comma");

    const collide = inRoot<HTMLInputElement>(root, ".foliplus-style-collide-input");
    collide.checked = false;
    fire(collide, "change");
    expect(setters.labelCollide).toHaveBeenCalledWith(false);
  });

  it("binds color and size live and clamps the size on commit", () => {
    const { root, setters } = render({ values: { labelShow: true, labelSize: 11 } });

    const color = inRoot<HTMLInputElement>(root, ".foliplus-style-label-color-input");
    color.value = "#00ff00";
    fire(color, "input");
    expect(setters.labelColor).toHaveBeenCalledWith("#00ff00");

    const size = inRoot<HTMLInputElement>(root, ".foliplus-style-label-size-input");
    size.value = "18";
    fire(size, "input");
    expect(setters.labelSize).toHaveBeenCalledWith(18);

    // Out of range is left alone on input and rewritten to the bound on commit.
    size.value = "99";
    fire(size, "input");
    expect(setters.labelSize).toHaveBeenCalledTimes(1);
    fire(size, "change");
    expect(size.value).toBe("32");
    expect(setters.labelSize).toHaveBeenLastCalledWith(32);
  });

  it("re-reads the setters at event time, so a cleared layer no-ops", () => {
    const labelShow = vi.fn();
    const { root, setters } = render({
      values: { labelShow: true },
      setters: { labelShow },
    });
    // The layer is torn down while its panel is still open.
    delete setters.labelShow;

    const toggle = inRoot<HTMLInputElement>(root, ".foliplus-style-toggle-input");
    toggle.checked = false;
    fire(toggle, "change");

    expect(labelShow).not.toHaveBeenCalled();
  });

  it("leaves an unrecognised change alone so a panel-level handler still sees it", () => {
    const { root } = render({ values: { labelShow: true } });
    const stray = document.createElement("input");
    root.appendChild(stray);
    const event = new Event("change", { bubbles: true, cancelable: true });
    const stop = vi.fn();
    Object.defineProperty(event, "stopPropagation", { value: stop });
    stray.dispatchEvent(event);

    expect(stop).not.toHaveBeenCalled();
  });
});

describe("renderLabelControls — refresh", () => {
  it("mirrors a remote write into every control", () => {
    const { root, setValues, refresh } = render({
      values: {
        labelShow: false,
        labelCollide: true,
        labelFormat: "auto",
        labelColor: "#111111",
        labelSize: 11,
      },
    });

    setValues({
      labelShow: true,
      labelCollide: false,
      labelFormat: "percent",
      labelColor: "#00ff00",
      labelSize: 20,
    });
    refresh();

    expect(inRoot<HTMLInputElement>(root, ".foliplus-style-toggle-input").checked).toBe(
      true,
    );
    expect(bodyOf(root).classList.contains("foliplus-hidden")).toBe(false);
    expect(inRoot<HTMLSelectElement>(root, ".foliplus-style-format-select").value).toBe(
      "percent",
    );
    expect(
      inRoot<HTMLInputElement>(root, ".foliplus-style-collide-input").checked,
    ).toBe(false);
    expect(
      inRoot<HTMLInputElement>(root, ".foliplus-style-label-color-input").value,
    ).toBe("#00ff00");
    expect(
      inRoot<HTMLInputElement>(root, ".foliplus-style-label-size-input").value,
    ).toBe("20");
  });

  it("bails when the provider publishes nothing, leaving the controls as-is", () => {
    const { root, setValues, refresh } = render({ values: { labelShow: true } });
    const toggle = inRoot<HTMLInputElement>(root, ".foliplus-style-toggle-input");
    expect(toggle.checked).toBe(true);

    setValues(undefined);
    refresh();

    // A provider that gates on readiness must not reset the panel to defaults.
    expect(toggle.checked).toBe(true);
  });

  it("skips the control the user is editing", () => {
    const { root, setValues, refresh } = render({
      values: { labelShow: true, labelFormat: "auto" },
    });
    const format = inRoot<HTMLSelectElement>(root, ".foliplus-style-format-select");
    format.focus();

    setValues({ labelShow: true, labelFormat: "percent" });
    refresh();

    expect(document.activeElement).toBe(format);
    expect(format.value).toBe("auto");
  });
});

describe("renderLabelControls — shared vocabulary", () => {
  it("resolves foliplus.label* from the common table, not a component table", () => {
    // The regression this guards: the renderer was fed a component-scoped
    // translator, so its "style_label_*" keys missed the heatmap's table and
    // the panel rendered raw keys. The vocabulary is now component-agnostic and
    // lives in the common table, resolved through an unscoped translator.
    window.foliplus._TABLES = {
      en: {
        "locale.code": "en",
        "foliplus.label": "Labels!",
        "foliplus.label_style": "Appearance",
        "foliplus.label_format": "Format",
        "foliplus.label_format_auto": "Auto!",
        "foliplus.label_collide": "Collide",
        "foliplus.label_tooltip": "Toggle labels",
      },
    };
    const { root } = render({
      values: { labelShow: true, labelCollide: true },
      T: createTranslator({
        name: "AnyControl",
        locale_code: "en",
        locale_tables: null,
      } as never),
    });

    expect(rowLabels(root)).toEqual(["Labels!", "Appearance", "Format", "Collide"]);
    expect(
      root.querySelector(".foliplus-style-format-select option")?.textContent,
    ).toBe("Auto!");
    expect(
      inRoot(root, ".foliplus-style-toggle-input").getAttribute("aria-label"),
    ).toBe("Toggle labels");
  });
});
