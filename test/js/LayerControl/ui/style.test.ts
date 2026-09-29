import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/LayerControl/const.js";
import type { LayerManager } from "#foliplus/LayerControl/manager.js";
import { applyProjection } from "#foliplus/LayerControl/ui/apply.js";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import {
  buildBorderRow,
  renderDelegatedStylePanel,
} from "#foliplus/LayerControl/ui/style/delegated.js";
import {
  layerHasLabelFields,
  layerHasStyleDelegation,
} from "#foliplus/LayerControl/ui/style/index.js";
import {
  clampPct,
  resetLayerOpacity,
} from "#foliplus/LayerControl/ui/style/opacity.js";
import { resetLayerZoomRange } from "#foliplus/LayerControl/ui/style/zoomRange.js";
import { AUTO_FIELD } from "#foliplus/core/labelField.js";
import { ensureModes } from "#foliplus/core/mode.js";
import { getLayerAlpha } from "#common/canvasAlpha.js";
import { NUMBER_FORMAT } from "#common/format.js";
import { GridLayer, findItem, initFixture, installLeafletGlobals } from "./fixture.js";
import { getIntent, seedIntentMap, setIntent } from "#foliplus/LayerControl/ui/intent.js";

/** Percentage the opacity fill is drawn at, read off its width expression.
 *  The fill's width is `calc((100% - var(--foliplus-slider-thumb-hit)) * <fraction>)` —
 *  measured against the handle's travel range, not the rail's own width. */
const fillPct = (el: HTMLElement): number =>
  Number(el.style.width.match(/^([\d.]+)%$/)?.[1] ?? NaN) / 100;

describe("LayerUI style panel", () => {
  let manager: LayerManager;
  let ui: LayerUI;
  let map: any;

  beforeEach(() => {
    ({ manager, ui, map } = initFixture());
    ui.foldedGroups = new Set();
    seedIntentMap(ui, "visible", {});
    window.localStorage.removeItem(CONST.STORAGE.KEY);
    // Seed the field cache so the panel builds: collectFields walks the
    // layer's leaves, and the fixture's data layer has none. `count` is a
    // number, which is what makes the number-format row reachable.
    ui.fieldCache.set("overlay1", [{ name: "count", numeric: true }]);
    // The Label section's gate is the surface's annotation capability — a
    // probe over real feature data, which this fixture layer has none of.
    // The field cache supplies the picker's options; this bit supplies the
    // section's right to render — the two dials the old `hasLabel` gate
    // read from a single place.
    const li = manager.layerRegistry.get("overlay1")!;
    const surface = manager.surfaceFor(li) as unknown as {
      capabilities: Record<string, unknown>;
    };
    surface.capabilities = { ...surface.capabilities, annotation: "pane" };
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
    if (map) {
      const modes = ensureModes(map);
      if (modes.getMode("LayerControl") === "focusing") {
        modes.setMode("LayerControl", null);
      }
    }
  });

  const panelOf = (item: HTMLElement): HTMLElement | undefined =>
    (item.querySelector(`.${CONST.CLASSES.STYLE_PANEL}`) as HTMLElement | null) ??
    undefined;

  const formatRowOf = (item: HTMLElement): HTMLElement =>
    panelOf(item)!.querySelector(".foliplus-style-format-row") as HTMLElement;

  const bodyOf = (item: HTMLElement): HTMLElement =>
    panelOf(item)!.querySelector(".foliplus-style-body") as HTMLElement;

  const toggleOf = (item: HTMLElement): HTMLInputElement =>
    panelOf(item)!.querySelector(".foliplus-style-toggle-input") as HTMLInputElement;

  const fieldSelectOf = (item: HTMLElement): HTMLSelectElement =>
    panelOf(item)!.querySelector(".foliplus-style-field-select") as HTMLSelectElement;

  const formatSelectOf = (item: HTMLElement): HTMLSelectElement =>
    panelOf(item)!.querySelector(".foliplus-style-format-select") as HTMLSelectElement;

  // ─────────────────── open / close lifecycle ───────────────────

  it("mounts the panel inside the layer row (attrs panel recipe)", () => {
    const item = findItem(ui, "overlay1");

    ui.openStylePanel("overlay1");

    expect(ui.stylePanelLayerId).toBe("overlay1");
    const panel = panelOf(item);
    expect(panel).not.toBeNull();
    expect(panel.getAttribute("role")).toBe("dialog");
  });

  it("builds on the shared panel vocabulary (header, content, close)", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item);

    expect(panel.classList.contains("foliplus-panel")).toBe(true);
    expect(panel.querySelector(".foliplus-panel-header")).not.toBeNull();
    expect(panel.querySelector(".foliplus-panel-content")).not.toBeNull();
    const close = panel.querySelector(".foliplus-close-btn");
    expect(close).not.toBeNull();
    expect(close!.querySelector("svg")).not.toBeNull();
    // The label glyph sits inside the header title, like the attrs panel.
    expect(panel.querySelector(".foliplus-layer-style-icon svg")).not.toBeNull();
  });

  it("renders the toggle and both selects from the layer's config", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item);

    const toggle = panel.querySelector(
      ".foliplus-style-toggle-input",
    ) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    const field = panel.querySelector(
      ".foliplus-style-field-select",
    ) as HTMLSelectElement;
    expect(field.value).toBe("");
    const format = panel.querySelector(
      ".foliplus-style-format-select",
    ) as HTMLSelectElement;
    expect(format.value).toBe(NUMBER_FORMAT.AUTO);
    // One option per cached field plus the placeholder.
    expect(field.options.length).toBe(2);
  });

  it("opens a Layer-only panel for a layer without labelable content and capable dimensions", () => {
    // Field-less now means capability "none" (the probe over real features,
    // which the fixture layer has none of) — the field cache only feeds the
    // picker's options and cannot veto the section.
    ui.fieldCache.delete("overlay1");
    const li = manager.layerRegistry.get("overlay1")!;
    const surface = manager.surfaceFor(li) as unknown as {
      capabilities: Record<string, unknown>;
    };
    surface.capabilities = { ...surface.capabilities, annotation: "none" };
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");

    expect(ui.stylePanelLayerId).toBe("overlay1");
    const panel = panelOf(item);
    expect(panel).toBeDefined();
    // No labelable field -> the whole Label section is absent, not just empty.
    expect(panel!.querySelector(".foliplus-style-toggle-input")).toBeNull();
    expect(panel!.querySelector(".foliplus-style-field-select")).toBeNull();
    expect(panel!.querySelector(".foliplus-style-body")).toBeNull();
    expect(panel!.querySelectorAll(".foliplus-section-heading")).toHaveLength(0);
    // The Layer dimensions still render — opacity and zoom range own a pane
    // carrier. Border and fill need a setStyle leaf (the fill / border gate),
    // and the
    // fixture's bare group has none, so those rows are absent here.
    expect(panel!.querySelector(".foliplus-style-opacity-range")).not.toBeNull();
    expect(panel!.querySelector(".foliplus-style-zoom-range-row")).not.toBeNull();
    expect(panel!.querySelector(".foliplus-style-border-row")).toBeNull();
    expect(panel!.querySelector(".foliplus-style-fill-row")).toBeNull();
  });

  it("opens no panel for a layer with neither a labelable field nor a capable dimension", () => {
    ui.fieldCache.delete("overlay1");
    const item = findItem(ui, "overlay1");
    // Strip every dimension: the surface can carry no honest write. The
    // label bit included — `annotation: "none"` is what says "no labelable
    // content" (a missing key would read as capable).
    const li = manager.layerRegistry.get("overlay1")!;
    manager.surfaceFor(li).capabilities = {
      opacity: "none",
      zoomRange: "none",
      annotation: "none",
      relocatable: false,
      bounds: false,
    };
    ui.openStylePanel("overlay1");

    expect(ui.stylePanelLayerId).toBeNull();
    expect(panelOf(item)).toBeUndefined();
  });

  it("the Label section follows a live layer's labelable content — no reload", () => {
    // The biggest risk of the capability move: the probe decides the section,
    // and the probe runs on the live tree — so a layer that GAINS its first
    // labelable feature must show the Label section on the next panel open,
    // and one that loses its last must drop it again. Same id, no
    // re-registration, no reload.
    const bareLeaf = () => ({ options: {}, eachLayer: vi.fn() }) as unknown as L.Layer;
    const labelableLeaf = () =>
      ({
        options: {},
        eachLayer: (fn: (l: L.Layer) => void) =>
          fn({
            options: {},
            feature: { properties: { count: 1 } },
          } as unknown as L.Layer),
      }) as unknown as L.Layer;

    manager.registerLayer({ id: "growing", name: "Growing", layer: bareLeaf() });
    let li = manager.layerRegistry.get("growing")!;
    const item = findItem(ui, "growing");
    ui.openStylePanel("growing");
    expect(panelOf(item)!.querySelector(".foliplus-style-toggle-input")).toBeNull();
    ui.closeStylePanel(false);

    // Gains labelable content: the next open re-probes through surfaceFor
    // (the same read every gate performs) and the section is there.
    li.layer = labelableLeaf();
    ui.fieldCache.set("growing", [{ name: "count", numeric: true }]);
    ui.openStylePanel("growing");
    expect(panelOf(item)!.querySelector(".foliplus-style-toggle-input")).not.toBeNull();
    ui.closeStylePanel(false);

    // Loses it again: the section leaves with the capability.
    li = manager.layerRegistry.get("growing")!;
    li.layer = bareLeaf();
    ui.fieldCache.delete("growing");
    ui.openStylePanel("growing");
    expect(panelOf(item)!.querySelector(".foliplus-style-toggle-input")).toBeNull();
    ui.closeStylePanel(false);
  });

  it("closes the previous panel before opening a new one", () => {
    const a = findItem(ui, "overlay1");
    ui.fieldCache.set("base1", [{ name: "name", numeric: false }]);
    const b = findItem(ui, "base1");

    ui.openStylePanel("overlay1");
    ui.openStylePanel("base1");

    expect(panelOf(a)).toBeUndefined();
    expect(panelOf(b)).not.toBeNull();
    expect(ui.stylePanelLayerId).toBe("base1");
  });

  it("dismisses the attributes panel when the style panel opens", () => {
    const item = findItem(ui, "overlay1");
    ui.openAttrsPanel(item);
    expect(item.querySelector(".foliplus-layer-attrs-panel")).not.toBeNull();

    ui.openStylePanel("overlay1");

    expect(item.querySelector(".foliplus-layer-attrs-panel")).toBeNull();
    expect(panelOf(item)).not.toBeNull();
  });

  it("closeStylePanel(setFocus=true) returns focus to the layer row", () => {
    const item = findItem(ui, "overlay1");
    const focusSpy = vi.fn();
    item.focus = focusSpy;

    ui.openStylePanel("overlay1");
    ui.closeStylePanel(true);

    expect(focusSpy).toHaveBeenCalled();
    expect(panelOf(item)).toBeUndefined();
    expect(ui.stylePanelLayerId).toBeNull();
  });

  it("closeStylePanel(setFocus=false) does not focus the layer row", () => {
    const item = findItem(ui, "overlay1");
    const focusSpy = vi.fn();
    item.focus = focusSpy;

    ui.openStylePanel("overlay1");
    ui.closeStylePanel(false);

    expect(focusSpy).not.toHaveBeenCalled();
  });

  it("closeStylePanel() is a no-op when no panel is open", () => {
    expect(() => ui.closeStylePanel(true)).not.toThrow();
  });

  // ─────────────────── outside dismissal ───────────────────

  it("document capture mousedown outside the panel dismisses it", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    expect(panelOf(item)).not.toBeNull();

    // The dismiss handler has to be registered in the *capture* phase, because
    // the layer control stops mousedown from bubbling (Leaflet's
    // disableClickPropagation). Dispatching on `document` cannot prove that —
    // target === currentTarget, so a bubble-phase listener would run too. A
    // wrapper that swallows the bubble, plus a press dispatched on its child,
    // does: capture runs on the way down (document is reached), bubble never
    // gets there. This test fails if the handler is ever moved to bubble.
    const wrapper = document.createElement("div");
    wrapper.addEventListener("mousedown", e => e.stopPropagation());
    const outside = document.createElement("button");
    wrapper.appendChild(outside);
    document.body.appendChild(wrapper);

    outside.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );

    expect(panelOf(item)).toBeUndefined();
    expect(ui.stylePanelLayerId).toBeNull();
    wrapper.remove();
  });

  it("mousedown inside the panel does not dismiss it", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item);

    panel.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    expect(panelOf(item)).toBe(panel);
  });

  it("a press outside the panel dismisses it via the outside-mousedown hook", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item);

    // jsdom does not populate event.target on dispatch, so pin it directly.
    const pressOn = (el: Element): void => {
      const event = new MouseEvent("mousedown", { bubbles: true });
      Object.defineProperty(event, "target", { value: el });
      ui.handleOutsideMousedown(event);
    };

    pressOn(panel.firstElementChild!);
    expect(panelOf(item)).toBe(panel);

    pressOn(document.body);
    expect(panelOf(item)).toBeUndefined();
  });

  // ─────────────────── control interactions ───────────────────

  it("flipping the toggle updates the config, labels and persistence", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const setConfig = vi.spyOn(manager.annotation, "setConfig");
    const renderLabels = vi.spyOn(manager.annotation, "renderLabels");
    const saveAnnotations = vi.spyOn(manager.persistence, "schedule");

    const toggle = panelOf(item).querySelector(
      ".foliplus-style-toggle-input",
    ) as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));

    expect(setConfig).toHaveBeenCalled();
    expect(renderLabels).toHaveBeenCalledWith("overlay1");
    expect(saveAnnotations).toHaveBeenCalled();
    // The label config rides the `layers` section now (`layers[id].
    // annotation`) — the legacy top-level `annotations` source is gone.
    const fields = saveAnnotations.mock.calls.at(-1)![0] as {
      layers: () => Record<string, { annotation?: Record<string, unknown> }>;
    };
    expect(fields.layers().overlay1.annotation).toEqual(
      expect.objectContaining({ show: true }),
    );
    expect(manager.annotation.getConfig("overlay1").show).toBe(true);
  });

  it("opens no panel for an empty layer id", () => {
    ui.openStylePanel("");

    expect(ui.stylePanelLayerId).toBeNull();
  });

  it("renders the avoid-overlap switch, defaulting on from the page", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");

    const collide = panelOf(item).querySelector(
      ".foliplus-style-collide-input",
    ) as HTMLInputElement;
    // No stored choice yet: the page default (label_collide ?? true) is on.
    expect(collide.checked).toBe(true);
    expect(collide.getAttribute("aria-label")).toBeTruthy();
  });

  it("flipping the avoid-overlap switch patches the layer's collide flag", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const setConfig = vi.spyOn(manager.annotation, "setConfig");

    const collide = panelOf(item).querySelector(
      ".foliplus-style-collide-input",
    ) as HTMLInputElement;
    collide.checked = false;
    collide.dispatchEvent(new Event("change", { bubbles: true }));

    expect(setConfig).toHaveBeenCalled();
    expect(manager.annotation.getConfig("overlay1").collide).toBe(false);
  });

  it("annotation body order is field → color/size → format → collide", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");

    const rows = [
      ...panelOf(item).querySelectorAll(".foliplus-style-body .foliplus-form-row"),
    ];
    const labels = rows.map(
      r => r.querySelector(".foliplus-form-label")?.textContent ?? "",
    );
    expect(labels).toEqual([
      // Field is annotation-only, so it stays component-scoped; the rest come
      // from the shared vocabulary the drawer renders from the common table.
      "LayerControl.style_label_field",
      "foliplus.label_style",
      "foliplus.label_format",
      "foliplus.label_collide",
    ]);
  });

  it("annotation color and size inputs are live and clamp on commit", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const renderLabels = vi.spyOn(manager.annotation, "renderLabels");

    const color = panelOf(item).querySelector(
      ".foliplus-style-label-color-input",
    ) as HTMLInputElement;
    const size = panelOf(item).querySelector(
      ".foliplus-style-label-size-input",
    ) as HTMLInputElement;

    color.value = "#00ff00";
    color.dispatchEvent(new Event("input", { bubbles: true }));
    expect(manager.annotation.getConfig("overlay1").color).toBe("#00ff00");
    expect(renderLabels).toHaveBeenCalled();

    size.value = "18";
    size.dispatchEvent(new Event("input", { bubbles: true }));
    expect(manager.annotation.getConfig("overlay1").size).toBe(18);

    size.value = "99";
    size.dispatchEvent(new Event("change", { bubbles: true }));
    expect(manager.annotation.getConfig("overlay1").size).toBe(32);
    expect(size.value).toBe("32");
  });

  it("annotation panel falls back when config color/size are empty", () => {
    manager.annotation.setConfig("overlay1", {
      ...CONST.DEFAULT_ANNOTATION,
      show: true,
      color: "",
      size: 0,
    });
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");

    const color = panelOf(item).querySelector(
      ".foliplus-style-label-color-input",
    ) as HTMLInputElement;
    const size = panelOf(item).querySelector(
      ".foliplus-style-label-size-input",
    ) as HTMLInputElement;
    expect(color.value).toBe("#ffffff");
    expect(size.value).toBe("11");
  });

  it("applyStyleLabelState restores the avoid-overlap switch from config", () => {
    manager.annotation.setConfig("overlay1", {
      show: true,
      field: "count",
      format: NUMBER_FORMAT.AUTO,
      collide: false,
    });
    ui.applyStyleLabelState();
    const item = findItem(ui, "overlay1");

    ui.openStylePanel("overlay1");

    const collide = panelOf(item).querySelector(
      ".foliplus-style-collide-input",
    ) as HTMLInputElement;
    expect(collide.checked).toBe(false);
  });

  it("normalizes non-string persisted values instead of trusting storage", () => {
    // localStorage is writable by anything on the page, so a field or format of
    // the wrong shape must not reach the config as-is.
    seedIntentMap(ui, "annotation", { overlay1: { show: true, field: 42, format: 7 } });

    ui.applyStyleLabelState();

    const cfg = manager.annotation.getConfig("overlay1");
    expect(cfg.field).toBe("");
    expect(cfg.format).toBe(NUMBER_FORMAT.AUTO);
  });

  it("shows auto for a persisted config with no format", () => {
    ui.fieldCache.set("overlay1", [{ name: "count", numeric: true }]);
    manager.annotation.setConfig("overlay1", {
      show: true,
      field: "count",
      format: "" as never,
    });
    const item = findItem(ui, "overlay1");

    ui.openStylePanel("overlay1");

    expect(formatSelectOf(item).value).toBe(NUMBER_FORMAT.AUTO);
  });

  it("choosing a field updates the config", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const setConfig = vi.spyOn(manager.annotation, "setConfig");

    const field = panelOf(item).querySelector(
      ".foliplus-style-field-select",
    ) as HTMLSelectElement;
    field.value = "count";
    field.dispatchEvent(new Event("change", { bubbles: true }));

    expect(setConfig).toHaveBeenCalled();
    expect(manager.annotation.getConfig("overlay1").field).toBe("count");
  });

  it("skips syncFormatRow when the format row is absent from the DOM", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    panelOf(item).querySelector(".foliplus-style-format-row")?.remove();
    const field = panelOf(item).querySelector(
      ".foliplus-style-field-select",
    ) as HTMLSelectElement;
    field.value = "count";
    field.dispatchEvent(new Event("change", { bubbles: true }));
    expect(manager.annotation.getConfig("overlay1").field).toBe("count");
  });

  it("omits the format key when the format select is absent from the DOM", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    panelOf(item).querySelector(".foliplus-style-format-select")?.remove();
    const field = panelOf(item).querySelector(
      ".foliplus-style-field-select",
    ) as HTMLSelectElement;
    field.value = "count";
    field.dispatchEvent(new Event("change", { bubbles: true }));
    expect(manager.annotation.getConfig("overlay1").field).toBe("count");
  });

  // ─────────────────── labels toggle (default off) ───────────────────

  it("defaults the labels toggle off, with the body collapsed", () => {
    const item = findItem(ui, "overlay1");

    ui.openStylePanel("overlay1");

    expect(toggleOf(item).checked).toBe(false);
    expect(bodyOf(item).classList.contains("foliplus-hidden")).toBe(true);
  });

  it("reveals the body when switched on, leaving the picker on Auto", () => {
    // The picker's Auto entry is not a placeholder: switching the toggle on
    // leaves the field unresolved on purpose, so the layer keeps labeling
    // itself if its columns change. The auto rule itself (first numeric, else
    // first) is asserted in core/labelField.test.ts and below for the format row.
    ui.fieldCache.set("overlay1", [
      { name: "name", numeric: false },
      { name: "count", numeric: true },
    ]);
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");

    const toggle = toggleOf(item);
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));

    expect(bodyOf(item).classList.contains("foliplus-hidden")).toBe(false);
    expect(fieldSelectOf(item).value).toBe(AUTO_FIELD);
    expect(manager.annotation.getConfig("overlay1").field).toBe(AUTO_FIELD);
  });

  it("shows the number-format row for the field Auto resolves to", () => {
    ui.fieldCache.set("overlay1", [
      { name: "name", numeric: false },
      { name: "count", numeric: true },
    ]);
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");

    // Auto resolves to the numeric `count`, so the row is live even though the
    // select's own value is the empty sentinel.
    expect(fieldSelectOf(item).value).toBe(AUTO_FIELD);
    expect(formatRowOf(item).classList.contains("foliplus-hidden")).toBe(false);
  });

  it("offers the auto entry first, then one option per field", () => {
    ui.fieldCache.set("overlay1", [
      { name: "name", numeric: false },
      { name: "count", numeric: true },
    ]);
    const item = findItem(ui, "overlay1");

    ui.openStylePanel("overlay1");

    const options = Array.from(fieldSelectOf(item).options);
    expect(options.map(o => o.value)).toEqual([AUTO_FIELD, "name", "count"]);
    expect(options[0].textContent).toBe("LayerControl.style_label_field_auto");
    // A disabled placeholder, exactly like the heatmap's field_auto: it shows
    // the current state rather than offering itself as a choice. Reset is how
    // the field goes back to auto.
    expect(options[0].disabled).toBe(true);
    expect(options[1].disabled).toBe(false);
  });

  it("collapses the body again when the toggle goes back off", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const toggle = toggleOf(item);

    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));

    expect(bodyOf(item).classList.contains("foliplus-hidden")).toBe(true);
  });

  // ─────────────────── number-format row ───────────────────

  it("hides the number-format row for a non-numeric field on first render", () => {
    // Regression: the initial sync searched the row for a descendant row and
    // matched nothing, so the format dropdown shipped visible for string
    // fields — where comma / percent / int render exactly like auto.
    ui.fieldCache.set("overlay1", [
      { name: "count", numeric: true },
      { name: "name", numeric: false },
    ]);
    const item = findItem(ui, "overlay1");
    manager.annotation.setConfig("overlay1", {
      show: true,
      field: "name",
      format: NUMBER_FORMAT.AUTO,
    });

    ui.openStylePanel("overlay1");

    expect(formatRowOf(item).classList.contains("foliplus-hidden")).toBe(true);
  });

  it("shows the number-format row for a numeric field and flips it on switch", () => {
    ui.fieldCache.set("overlay1", [
      { name: "count", numeric: true },
      { name: "name", numeric: false },
    ]);
    const item = findItem(ui, "overlay1");
    manager.annotation.setConfig("overlay1", {
      show: true,
      field: "count",
      format: NUMBER_FORMAT.AUTO,
    });

    ui.openStylePanel("overlay1");
    expect(formatRowOf(item).classList.contains("foliplus-hidden")).toBe(false);

    const field = fieldSelectOf(item);
    field.value = "name";
    field.dispatchEvent(new Event("change", { bubbles: true }));
    expect(formatRowOf(item).classList.contains("foliplus-hidden")).toBe(true);

    field.value = "count";
    field.dispatchEvent(new Event("change", { bubbles: true }));
    expect(formatRowOf(item).classList.contains("foliplus-hidden")).toBe(false);
  });

  // ─────────────────── row drag vs panel controls ───────────────────

  it("a press inside the panel does not start a row reorder drag", () => {
    // The row is the drag source for any press in the row, the floating panel
    // included, and `dragstart` is dispatched on the row — a listener on the
    // panel can never see it (the panel is a descendant, never on the event's
    // path). So the verdict is recorded from the press and read here.
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");

    panelOf(item)!.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    const dragstart = new Event("dragstart", { bubbles: true, cancelable: true });
    item.dispatchEvent(dragstart);

    expect(dragstart.defaultPrevented).toBe(true);
    expect(item.classList.contains(CONST.CLASSES.DRAGGING)).toBe(false);
    expect(ui.dragIdx).toBeNull();
  });

  it("a press outside the panel still starts the drag", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");

    document.body.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    const dragstart = new Event("dragstart", { bubbles: true, cancelable: true });
    item.dispatchEvent(dragstart);

    expect(dragstart.defaultPrevented).toBe(false);
    expect(item.classList.contains(CONST.CLASSES.DRAGGING)).toBe(true);
  });

  // ─────────────────── row cursor vs panel controls ───────────────────

  it("does not take the row cursor over for a press inside the panel", () => {
    // A press on a panel control belongs to the panel. The row-cursor takeover
    // calls row.focus(), and a native <select> popup is dismissed the moment it
    // loses focus — so the dropdown appeared to retract as it opened.
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    item.classList.remove(CONST.CLASSES.FOCUSED);
    const focusSpy = vi.spyOn(item, "focus");

    fieldSelectOf(item).dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(focusSpy).not.toHaveBeenCalled();
    expect(item.classList.contains(CONST.CLASSES.FOCUSED)).toBe(false);
  });

  it("choosing a format updates the config", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const setConfig = vi.spyOn(manager.annotation, "setConfig");

    const format = panelOf(item).querySelector(
      ".foliplus-style-format-select",
    ) as HTMLSelectElement;
    format.value = NUMBER_FORMAT.COMMA;
    format.dispatchEvent(new Event("change", { bubbles: true }));

    expect(setConfig).toHaveBeenCalled();
    expect(manager.annotation.getConfig("overlay1").format).toBe(NUMBER_FORMAT.COMMA);
  });

  it("reset restores the default config and closes the panel", () => {
    const item = findItem(ui, "overlay1");
    const focusSpy = vi.fn();
    item.focus = focusSpy;
    ui.openStylePanel("overlay1");
    manager.annotation.setConfig("overlay1", {
      show: true,
      field: "count",
      format: NUMBER_FORMAT.INT,
    });

    const btn = panelOf(item).querySelector(
      ".foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    // The default config, plus the page's collide default injected by getConfig.
    expect(manager.annotation.getConfig("overlay1")).toEqual({
      ...CONST.DEFAULT_ANNOTATION,
      collide: true,
    });
    expect(panelOf(item)).toBeUndefined();
    expect(focusSpy).toHaveBeenCalled();
  });

  it("reset also restores collide (not just show/field/format)", () => {
    // Regression: DEFAULT_ANNOTATION alone omits collide, so a user-toggled
    // avoid-overlap switch used to survive Reset. defaultConfig() carries it.
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    manager.annotation.setConfig("overlay1", {
      show: true,
      field: "count",
      format: NUMBER_FORMAT.AUTO,
      collide: false,
    });

    const btn = panelOf(item).querySelector(
      ".foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(manager.annotation.getConfig("overlay1").collide).toBe(true);
  });

  // ─────────────────── row groups + opacity ───────────────────

  it("renders the layer and label rows with no group headings", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    // Headings are gone; the two groups are told apart by document order.
    expect(panel.querySelectorAll(".foliplus-section-heading")).toHaveLength(0);
    const order = [...panel.querySelectorAll("*")];
    const layer = panel.querySelector(".foliplus-style-opacity-range");
    const label = panel.querySelector(".foliplus-style-toggle-input");
    expect(layer).not.toBeNull();
    expect(label).not.toBeNull();
    expect(order.indexOf(layer!)).toBeLessThan(order.indexOf(label as Element));
    // The annotation dimension's row is one wrapper (toggle + body) — the
    // structural hook the Label content is selected by.
    const labelSection = panel.querySelector(`.${CONST.CLASSES.STYLE_LABEL_SECTION}`);
    expect(labelSection).not.toBeNull();
    expect(
      labelSection!.querySelector(`.${CONST.CLASSES.STYLE_TOGGLE_INPUT}`),
    ).not.toBeNull();
  });

  it("suppresses the row's hover tooltip on the panel body", () => {
    // The panel is anchored inside the layer row, which carries a hover title
    // ("6 point layer"). An empty title on the panel container suppresses the
    // inherited tooltip so hovering the panel does not echo the row's text.
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    expect(panel.getAttribute("title")).toBe("");
  });

  it("paints the slider accent fill to the current value", () => {
    const li = manager.layerRegistry.get("overlay1")!;
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const range = panel.querySelector(
      ".foliplus-style-opacity-range",
    ) as HTMLInputElement;
    const fill = panel.querySelector(".foliplus-style-opacity-fill") as HTMLElement;
    // Freshly opened → full width.
    expect(fillPct(fill)).toBeCloseTo(1);

    range.value = "35";
    range.dispatchEvent(new Event("input", { bubbles: true }));

    expect(fillPct(fill)).toBeCloseTo(0.35);
  });

  it("canvas layers with opacityBake 'redraw' keep CSS on the slider commit", () => {
    // Heatmap arm (default): CSS live feedback, bake deferred to redraw.
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleSetters: { labelShow: vi.fn() },
    });
    const li = manager.layerRegistry.get("heat1")!;
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");
    const panel = panelOf(item)!;
    const range = panel.querySelector(
      ".foliplus-style-opacity-range",
    ) as HTMLInputElement;

    range.value = "40";
    range.dispatchEvent(new Event("input", { bubbles: true }));

    // CSS arm for live feedback; layerAlpha is stored for the next redraw.
    expect(li.canvas!.style.opacity).toBe("0.4");
    expect(getLayerAlpha(li.canvas)).toBeCloseTo(0.4);
    expect(li.opacity).toBe(0.4);
  });

  it("canvas layers with opacityBake 'commit' bake and clear CSS", () => {
    // Color-face arm: bake on the commit itself, CSS cleared.
    manager.registerLayer({
      id: "color1",
      name: "Color",
      canvas: document.createElement("canvas"),
      opacityBake: "commit",
    });
    const li = manager.layerRegistry.get("color1")!;
    const item = findItem(ui, "color1");
    ui.openStylePanel("color1");
    const panel = panelOf(item)!;
    const range = panel.querySelector(
      ".foliplus-style-opacity-range",
    ) as HTMLInputElement;

    range.value = "40";
    range.dispatchEvent(new Event("input", { bubbles: true }));

    expect(getLayerAlpha(li.canvas)).toBeCloseTo(0.4);
    expect(li.canvas!.style.opacity).toBe("");
    expect(li.opacity).toBe(0.4);
  });

  it("commit arm fires onOpacity when the layer registered one (branch cover)", () => {
    const onOpacity = vi.fn();
    manager.registerLayer({
      id: "color2",
      name: "Color2",
      canvas: document.createElement("canvas"),
      opacityBake: "commit",
      onOpacity,
    });
    const item = findItem(ui, "color2");
    ui.openStylePanel("color2");
    const panel = panelOf(item)!;
    const range = panel.querySelector(
      ".foliplus-style-opacity-range",
    ) as HTMLInputElement;

    range.value = "50";
    range.dispatchEvent(new Event("input", { bubbles: true }));

    expect(onOpacity).toHaveBeenCalledWith(0.5);
  });

  it("reset restores opacity to fully opaque and drops the persisted entry", () => {
    const li = manager.layerRegistry.get("overlay1")!;
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const range = panel.querySelector(
      ".foliplus-style-opacity-range",
    ) as HTMLInputElement;
    range.value = "30";
    range.dispatchEvent(new Event("input", { bubbles: true }));

    const btn = panel.querySelector(".foliplus-style-reset-btn") as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(li.opacity).toBe(1);
    expect(getIntent(ui, "overlay1", "opacity")).toBeUndefined();
  });

  it("dragging back to fully opaque drops the provenance as well as the value", () => {
    // 100% is the declared default, so a drag back to it is a reset by another
    // route and must leave no override behind -- otherwise the record keeps a
    // marker with no value for it.
    const li = manager.layerRegistry.get("overlay1")!;
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const range = panel.querySelector(
      ".foliplus-style-opacity-range",
    ) as HTMLInputElement;

    range.value = "30";
    range.dispatchEvent(new Event("input", { bubbles: true }));
    expect(ui.intentProvenance.overlay1).toContain("opacity");

    range.value = "100";
    range.dispatchEvent(new Event("input", { bubbles: true }));

    expect(getIntent(ui, "overlay1", "opacity")).toBeUndefined();
    expect(ui.intentProvenance.overlay1 ?? []).not.toContain("opacity");
  });

  it("opacity 0 is kept in the map (only 1 is treated as default)", () => {
    const li = manager.layerRegistry.get("overlay1")!;
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const range = panelOf(item)!.querySelector(
      ".foliplus-style-opacity-range",
    ) as HTMLInputElement;

    range.value = "0";
    range.dispatchEvent(new Event("input", { bubbles: true }));

    expect(getIntent(ui, "overlay1", "opacity")).toBe(0);
    expect(li.opacity).toBe(0);
  });

  it("delegated Reset also restores LayerControl-owned opacity", () => {
    const labelShowSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true }),
      styleSetters: { labelShow: labelShowSetter },
      styleDefaultsProvider: () => ({ labelShow: true }),
    });
    const li = manager.layerRegistry.get("heat1")!;
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");
    const panel = panelOf(item)!;
    const range = panel.querySelector(
      ".foliplus-style-opacity-range",
    ) as HTMLInputElement;
    range.value = "15";
    range.dispatchEvent(new Event("input", { bubbles: true }));
    expect(li.opacity).toBe(0.15);

    const btn = panel.querySelector(".foliplus-style-reset-btn") as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(li.opacity).toBe(1);
    expect(getLayerAlpha(li.canvas)).toBe(1);
    expect(li.canvas!.style.opacity).toBe("1");
    expect(getIntent(ui, "heat1", "opacity")).toBeUndefined();
    expect(labelShowSetter).toHaveBeenCalledWith(true);
  });

  it("no-ops when the layer disappears between open and edit", () => {
    const li = manager.layerRegistry.get("overlay1")!;
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const range = panel.querySelector(
      ".foliplus-style-opacity-range",
    ) as HTMLInputElement;

    // The row outlives its registry entry (a provider unregistered the layer).
    vi.spyOn(manager.layerRegistry, "get").mockReturnValue(undefined);
    expect(() => {
      range.value = "20";
      range.dispatchEvent(new Event("input", { bubbles: true }));
    }).not.toThrow();

    expect(getIntent(ui, "overlay1", "opacity")).toBeUndefined();
  });

  it("delegated panel renders the appearance row for labelSize alone", () => {
    // The color/size row is shared: a component that declares only the size
    // still gets it, with the swatch omitted.
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, labelSize: 14 }),
      styleSetters: { labelShow: vi.fn(), labelSize: vi.fn() },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");
    const panel = panelOf(item)!;

    expect(panel.querySelector(".foliplus-style-label-size-input")).not.toBeNull();
    expect(panel.querySelector(".foliplus-style-label-color-input")).toBeNull();
  });

  it("Reset survives a layer that vanished while the panel was open", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    vi.spyOn(manager.layerRegistry, "get").mockReturnValue(undefined);

    const btn = panel.querySelector(".foliplus-style-reset-btn") as HTMLButtonElement;
    expect(() =>
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })),
    ).not.toThrow();
  });

  it("header click closes the panel", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item);

    panel
      .querySelector(".foliplus-panel-header")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(panelOf(item)).toBeUndefined();
  });

  it("Escape closes an open style panel and returns focus to its row", () => {
    const item = findItem(ui, "overlay1");
    const focusSpy = vi.fn();
    item.focus = focusSpy;

    ui.openStylePanel("overlay1");
    const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
    checkbox.focus();

    ui.handleKeyDown(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Escape",
      }) as unknown as KeyboardEvent,
    );

    expect(panelOf(item)).toBeUndefined();
    expect(focusSpy).toHaveBeenCalled();
  });

  it("layerCanOpacity declines a 'none' carrier: no opacity row is built", () => {
    // The `capabilities.opacity !== "none"` half of the guard. A layer whose
    // icons live in a shared pane we do not own (MarkerCluster) has no honest
    // opacity write — showing a slider would persist a value nothing applies.
    ui.fieldCache.set("overlay1", [{ name: "count", numeric: true }]);
    vi.spyOn(manager, "surfaceFor").mockReturnValue({
      capabilities: { opacity: "none", zoomRange: "none" },
      paneNames: [],
      geometryType: () => "point",
    } as unknown as ReturnType<typeof manager.surfaceFor>);

    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item);
    expect(panel, "the style panel rendered").toBeTruthy();

    expect(panel!.querySelector(".foliplus-style-opacity-range")).toBeNull();
    expect(panel!.querySelector(".foliplus-style-zoom-range-row")).toBeNull();
  });

  // Every FORM_ROW whose label is the border label — counts a border row
  // regardless of whether the vector row or the delegated drawer's row built it.
  const borderRows = (panel: HTMLElement): HTMLElement[] =>
    Array.from(panel.querySelectorAll<HTMLElement>(".foliplus-form-row")).filter(
      row => row.querySelector(".foliplus-form-label")?.textContent === ui.T("border"),
    );

  it("builds one border row for a vector layer, before the opacity row", () => {
    // The fixture's default overlay1 layer is a bare group with no setStyle
    // leaves — border needs at least one such leaf (the border gate), so register a
    // real vector for this test.
    const leaf = {
      options: { color: "#3388ff", weight: 2 },
      setStyle: vi.fn(),
      on: vi.fn(),
    };
    manager.registerLayer({
      id: "border1",
      name: "Border",
      layer: {
        options: {},
        eachLayer: vi.fn((fn: (child: unknown) => void) => {
          fn(leaf);
        }),
        getBounds: vi.fn(() => ({
          isValid: vi.fn(() => true),
          getSouthWest: () => ({ lat: 0, lng: 0 }),
          getNorthEast: () => ({ lat: 1, lng: 1 }),
        })),
      } as never,
    });
    ui.fieldCache.set("border1", [{ name: "count", numeric: true }]);
    const item = findItem(ui, "border1");
    ui.openStylePanel("border1");
    const panel = panelOf(item)!;

    expect(borderRows(panel)).toHaveLength(1);
    const row = panel.querySelector(".foliplus-style-border-row") as HTMLElement;
    expect(row.querySelector(".foliplus-style-border-color-input")).not.toBeNull();
    const width = row.querySelector(
      ".foliplus-style-border-weight-input",
    ) as HTMLInputElement;
    expect(width.min).toBe("0");
    expect(width.max).toBe("10");
    expect(width.step).toBe("0.5");

    // Layer section order: fill, border, opacity, zoom range. The classes live
    // on the rows themselves, so both the row and its descendants are checked.
    const rows = Array.from(panel.querySelectorAll(".foliplus-form-row"));
    const index = (sel: string) =>
      rows.findIndex(row => row.matches(sel) || row.querySelector(sel) !== null);
    expect(index(".foliplus-style-border-row")).toBeLessThan(
      index(".foliplus-style-opacity-range"),
    );
    expect(index(".foliplus-style-opacity-range")).toBeLessThan(
      index(".foliplus-style-zoom-range-row"),
    );
  });

  it("renders both the border and the fill row in the layer section, in order", () => {
    // Border and fill landed on separate branches. Both rows must survive the
    // merge in one panel, and the two color axes sit adjacent — a slider
    // between them would read as two different concerns rather than as one
    // painted shape. Designed order: fill, border, opacity, zoom range.
    installLeafletGlobals();
    const leaves = [new L.Polygon(), new L.Polygon()] as L.Polygon[];
    leaves.forEach(leaf => {
      leaf.options = {
        color: "#000000",
        weight: 2,
        fillColor: "#aabbcc",
        fillOpacity: 0.5,
      };
      leaf.setStyle = vi.fn();
    });
    manager.registerLayer({
      id: "poly1",
      name: "Poly",
      group: "overlay",
      layer: {
        options: {},
        eachLayer: vi.fn((fn: (child: unknown) => void) => leaves.forEach(fn)),
        getBounds: vi.fn(() => ({
          isValid: vi.fn(() => true),
          getSouthWest: vi.fn(() => ({ lat: 0, lng: 0 })),
          getNorthEast: vi.fn(() => ({ lat: 1, lng: 1 })),
        })),
      },
    });
    ui.fieldCache.set("poly1", [{ name: "count", numeric: true }]);

    const item = findItem(ui, "poly1");
    ui.openStylePanel("poly1");
    const panel = panelOf(item)!;

    const rows = Array.from(panel.querySelectorAll(".foliplus-form-row"));
    const index = (sel: string) =>
      rows.findIndex(row => row.matches(sel) || row.querySelector(sel) !== null);
    const positions = [
      index(".foliplus-style-fill-row"),
      index(".foliplus-style-border-row"),
      index(".foliplus-style-opacity-range"),
      index(".foliplus-style-zoom-range-row"),
    ];
    expect(positions.every(pos => pos >= 0)).toBe(true);
    expect(positions[0]).toBeLessThan(positions[1]);
    expect(positions[1]).toBeLessThan(positions[2]);
    expect(positions[2]).toBeLessThan(positions[3]);
  });

  it("never builds the vector border row for a delegated layer — one border row total", () => {
    // The delegated drawer skips `border` in the DIM_ORDER sweep, so the
    // vector border row cannot render alongside the drawer's own border row.
    // The drawer's border row comes from the styleSetters path (setters
    // publishing borderWeight / borderColor), not the registry.
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({
        labelShow: true,
        borderColor: "#000000",
        borderWeight: 2,
      }),
      styleSetters: { borderColor: vi.fn(), borderWeight: vi.fn() },
      styleDefaultsProvider: () => ({
        labelShow: true,
        borderColor: "#000000",
        borderWeight: 2,
      }),
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");
    const panel = panelOf(item)!;

    expect(panel.querySelectorAll(".foliplus-style-border-row")).toHaveLength(0);
    expect(borderRows(panel)).toHaveLength(1);
  });

  it("panel and delegated share one gate sweep — delegated rows match panel Layer rows minus vector-only dims", () => {
    // Single gatedRows implementation behind both consumers: the rows the
    // delegated drawer renders through the registry sweep must be exactly
    // the rows the annotation panel renders for the same keys. Only
    // styleSetters differ between the two paths; capabilities are made
    // identical so the gates answer identically.
    installLeafletGlobals();
    const caps = {
      fill: "native",
      stroke: "native",
      opacity: "pane",
      zoomRange: "pane",
      annotation: "none",
    };
    const rowSel = [
      ".foliplus-style-fill-row",
      ".foliplus-style-border-row",
      ".foliplus-style-opacity-range",
      ".foliplus-style-zoom-range-row",
    ];

    // Path A — annotation panel (no styleSetters): a vector layer whose
    // surface admits all four Layer dims.
    const leaf = {
      options: {
        color: "#000000",
        weight: 2,
        fillColor: "#aabbcc",
        fillOpacity: 0.5,
      },
      setStyle: vi.fn(),
      on: vi.fn(),
    };
    manager.registerLayer({
      id: "sweepVector",
      name: "Vector",
      group: "overlay",
      layer: {
        options: {},
        eachLayer: vi.fn((fn: (child: unknown) => void) => fn(leaf)),
        getBounds: vi.fn(() => ({
          isValid: vi.fn(() => true),
          getSouthWest: () => ({ lat: 0, lng: 0 }),
          getNorthEast: () => ({ lat: 1, lng: 1 }),
        })),
      } as never,
    });
    ui.fieldCache.set("sweepVector", [{ name: "count", numeric: true }]);
    const surfaceV = manager.surfaceFor(
      manager.layerRegistry.get("sweepVector")!,
    ) as unknown as { capabilities: Record<string, unknown> };
    surfaceV.capabilities = { ...caps };

    const itemV = findItem(ui, "sweepVector");
    ui.openStylePanel("sweepVector");
    const panelV = panelOf(itemV)!;
    const panelRows = rowSel.filter(sel => panelV.querySelector(sel));
    expect(panelRows).toEqual(rowSel);
    ui.closeStylePanel(false);

    // Path B — delegated drawer (styleSetters present): the same
    // capabilities, so the registry gates answer the same way. The sweep
    // must render exactly the non-vector-only rows.
    manager.registerLayer({
      id: "sweepDeleg",
      name: "Deleg",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true }),
      styleSetters: { labelShow: vi.fn() },
      styleDefaultsProvider: () => ({ labelShow: true }),
    });
    const surfaceD = manager.surfaceFor(
      manager.layerRegistry.get("sweepDeleg")!,
    ) as unknown as { capabilities: Record<string, unknown> };
    surfaceD.capabilities = { ...caps };

    const itemD = findItem(ui, "sweepDeleg");
    ui.openStylePanel("sweepDeleg");
    const panelD = panelOf(itemD)!;
    const delegatedRows = rowSel.filter(sel => panelD.querySelector(sel));
    expect(delegatedRows).toEqual([
      ".foliplus-style-opacity-range",
      ".foliplus-style-zoom-range-row",
    ]);
  });

  // Row-rendering matrix for the two basemap faces — T190 pins the zoomRange
  // cells. Both basemap kinds now render the zoomRange row: a real GridLayer
  // carries it through native min/maxZoom (the honest carrier), and the
  // solid-color basemap through the isColorBasemap fallback (its surface
  // reports zoomRange: "none", but the executor's visible op is still the
  // carrier, so the row is not a lie). fill/border cells are documented for
  // the reader — border needs caps = {opacity:pane, zoomRange:pane}, which
  // no basemap satisfies; fill needs the same for the vector path but is
  // re-routed through isColorBasemap for the color face.
  //
  //   Tile (base + GridLayer): fill ✗ / border ✗ / opacity ✓ (native) / zoomRange ✓ (native)
  //   Color (base + pane):     fill ✓  / border ✗ / opacity ✓ (pane)   / zoomRange ✓ (isColorBasemap)

  it("tile basemap (GridLayer) renders the zoomRange row: native min/maxZoom is the carrier", () => {
    // The 398 R7 `li.group !== "base"` blanket was dropped in T190: a TileLayer is a
    // GridLayer subclass whose options.minZoom/maxZoom are exactly the
    // carrier the row writes through, so refusing it was a false refusal.
    // GridLayer is required — a bare `{ options: {} } as never` also gets a
    // row, but through the content-panes fallback, which is not the carrier
    // this test is checking.
    manager.registerLayer({
      id: "tileBase1",
      name: "OSM",
      group: "base",
      layer: new GridLayer() as never,
    });
    ui.fieldCache.set("tileBase1", [{ name: "count", numeric: true }]);

    const item = findItem(ui, "tileBase1");
    ui.openStylePanel("tileBase1");
    const panel = panelOf(item);
    expect(panel, "the style panel rendered").toBeTruthy();

    expect(panel!.querySelector(".foliplus-style-zoom-range-row")).not.toBeNull();
  });

  it("color basemap renders the zoomRange row through the isColorBasemap fallback", () => {
    // detectCapabilities reports zoomRange: "none" for the color face
    // (the always-on fallback color has no honest range carrier of its
    // own); isColorBasemap is the second clause that lets the row still
    // render, because the executor's visible op is the real carrier.
    // Without the flag the row would be a lie (writes a value that never
    // lands), which is what the flag guards against.
    manager.registerLayer({
      id: "colormap",
      name: "Color",
      group: "base",
      color: "#3366cc",
    });
    ui.fieldCache.set("colormap", [{ name: "count", numeric: true }]);

    const item = findItem(ui, "colormap");
    ui.openStylePanel("colormap");
    const panel = panelOf(item);
    expect(panel, "the style panel rendered").toBeTruthy();

    expect(panel!.querySelector(".foliplus-style-zoom-range-row")).not.toBeNull();
  });

  it("declines a zoomRange row for a base layer whose surface carries no range", () => {
    // A fake base layer with `capabilities.zoomRange` forced to "none" —
    // the honest-degradation path that used to be papered over by the
    // blanket base-group guard. The panel still renders (opacity carrier is
    // intact), but the zoomRange row is omitted rather than written as a
    // lie that would persist and never apply.
    manager.registerLayer({
      id: "norange1",
      name: "N",
      group: "base",
      layer: { options: {} } as never,
      paneName: "tilePane",
    });
    const li = manager.layerRegistry.get("norange1")!;
    manager.surfaceFor(li).capabilities.zoomRange = "none";
    ui.fieldCache.set("norange1", [{ name: "count", numeric: true }]);

    const item = findItem(ui, "norange1");
    ui.openStylePanel("norange1");
    const panel = panelOf(item);
    expect(panel, "the style panel rendered").toBeTruthy();

    expect(panel!.querySelector(".foliplus-style-zoom-range-row")).toBeNull();
  });

  it("layerCanOpacity returns false when the layer is not in the registry", () => {
    // Covers the `!li` guard in layerCanOpacity: a layer with cached fields but
    // no registry entry cannot have its surface queried.
    ui.fieldCache.set("overlay1", [{ name: "count", numeric: true }]);
    const li = manager.layerRegistry.get("overlay1");
    manager.layerRegistry.remove("overlay1");

    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item);

    // Panel is rendered (fields are cached) but without the opacity row.
    if (panel) {
      expect(panel.querySelector(".foliplus-style-opacity-range")).toBeNull();
    }

    // Restore for cleanup
    if (li) manager.layerRegistry.upsert(li);
  });

  // ─────────────────── ⋮ menu item ───────────────────

  it("the ⋮ menu's Style item is enabled for pane-capable layers even without labels", () => {
    // R5: capability-driven gate. A layer whose surface reports opacity/zoomRange
    // capability gets the panel enabled — the opacity and zoomRange sliders are
    // useful even without label fields.
    ui.fieldCache.delete("overlay1");
    const item = findItem(ui, "overlay1");

    ui.openMoreMenu(item);

    const styleItem = item.querySelector(
      `.foliplus-layer-more-menu li[data-action="${CONST.ACTION.STYLE_LAYER}"]`,
    ) as HTMLElement;
    expect(styleItem.getAttribute("disabled")).toBeNull();
    expect(styleItem.getAttribute("title")).toBe("LayerControl.style_layer_tooltip");
  });

  it("the ⋮ menu's Style item is enabled once the layer has fields", () => {
    const item = findItem(ui, "overlay1");

    ui.openMoreMenu(item);

    const styleItem = item.querySelector(
      `.foliplus-layer-more-menu li[data-action="${CONST.ACTION.STYLE_LAYER}"]`,
    ) as HTMLElement;
    expect(styleItem.getAttribute("disabled")).toBeNull();
    expect(styleItem.getAttribute("title")).toBe("LayerControl.style_layer_tooltip");
  });

  it("the ⋮ menu's Style item follows the checkbox on a basemap row too", () => {
    // Every row obeys one rule: Style is clickable only while the row is
    // checked. A basemap row is not exempt — consulted ahead of the basemap
    // "no extent" verdict, an off row is simply hidden and has nothing to
    // style. The colour basemap starts unchecked, so its Style entry starts
    // disabled and turns on with the box.
    const item = ui.uiContainer.querySelector(
      `[${CONST.DATA.LAYER_ID}="${CONST.SOLID_BASEMAP_ID}"]`,
    ) as HTMLElement;
    const box = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
    const styleItemOf = () =>
      item.querySelector(
        `.foliplus-layer-more-menu li[data-action="${CONST.ACTION.STYLE_LAYER}"]`,
      ) as HTMLElement;

    box.checked = false;
    ui.openMoreMenu(item);
    expect(styleItemOf().getAttribute("disabled")).toBe("disabled");

    box.checked = true;
    ui.openMoreMenu(item);
    expect(styleItemOf().getAttribute("disabled")).toBeNull();
  });

  // ─────────────────── field cache ───────────────────

  it("caches collectFields per layer id", () => {
    ui.fieldCache.delete("overlay1");
    const collect = vi.spyOn(manager.annotation, "collectFields");

    expect(layerHasLabelFields(ui, "overlay1")).toBe(false);
    expect(layerHasLabelFields(ui, "overlay1")).toBe(false);
    expect(collect).toHaveBeenCalledTimes(1);
    expect(ui.fieldCache.get("overlay1")).toEqual([]);
  });

  it("drops a stale cached empty field list on LAYER_ITEM_COUNT_CHANGE", () => {
    // A layer registered with no labelable fields caches an empty list; a
    // runtime createLayers may later add features carrying properties, which
    // must un-stick the ⋮ menu's Style item.
    ui.fieldCache.delete("overlay1");
    expect(layerHasLabelFields(ui, "overlay1")).toBe(false);
    expect(ui.fieldCache.get("overlay1")).toEqual([]);

    const fields = [
      { name: "count", numeric: true },
      { name: "name", numeric: false },
    ];
    vi.spyOn(manager.annotation, "collectFields").mockReturnValue(fields);

    ui.onLayerItemCountChange("overlay1");

    expect(ui.fieldCache.has("overlay1")).toBe(false);
    expect(layerHasLabelFields(ui, "overlay1")).toBe(true);
  });

  it("re-renders a shown layer when its fields are invalidated", () => {
    // Dropping the cache is not enough: the drawn labels carry text baked from
    // the old fields while the picker would resolve a new auto field, so the
    // map and the panel would disagree until the user touched a control.
    manager.annotation.setConfig("overlay1", {
      show: true,
      field: "count",
      format: NUMBER_FORMAT.AUTO,
    });
    const renderLabels = vi.spyOn(manager.annotation, "renderLabels");

    ui.invalidateFields("overlay1");

    expect(renderLabels).toHaveBeenCalledWith("overlay1");
  });

  it("does not re-render a layer whose labels are off", () => {
    manager.annotation.setConfig("overlay1", {
      show: false,
      field: "",
      format: NUMBER_FORMAT.AUTO,
    });
    const renderLabels = vi.spyOn(manager.annotation, "renderLabels");

    ui.invalidateFields("overlay1");

    expect(renderLabels).not.toHaveBeenCalled();
  });

  it("invalidateFields drops a layer's cached list", () => {
    layerHasLabelFields(ui, "overlay1");
    expect(ui.fieldCache.has("overlay1")).toBe(true);

    // The delegate is the surface `manager.unregisterLayer` drives.
    ui.invalidateFields("overlay1");
    expect(ui.fieldCache.has("overlay1")).toBe(false);
  });

  it("keeps the field cache across close/reopen (count changes invalidate)", () => {
    // Closing the panel must not defeat the cache: re-collection on every
    // reopen walks every feature for nothing. The cache is dropped by
    // onLayerItemCountChange instead, when features actually change.
    const item = findItem(ui, "overlay1");

    ui.openStylePanel("overlay1");
    ui.closeStylePanel(true);

    expect(panelOf(item)).toBeUndefined();
    expect(ui.fieldCache.get("overlay1")).toEqual([{ name: "count", numeric: true }]);
  });

  // ─────────────────── persisted state ───────────────────

  it("applyStyleLabelState seeds a stored config for a layer that has none", () => {
    seedIntentMap(ui, "annotation", {
      overlay1: { show: true, field: "count", format: NUMBER_FORMAT.AUTO },
    });
    const setConfig = vi.spyOn(manager.annotation, "setConfig");
    const renderLabels = vi.spyOn(manager.annotation, "renderLabels");

    ui.applyStyleLabelState();

    expect(setConfig).toHaveBeenCalledWith("overlay1", {
      show: true,
      field: "count",
      color: CONST.DEFAULT_ANNOTATION.color,
      size: CONST.DEFAULT_ANNOTATION.size,
      format: NUMBER_FORMAT.AUTO,
      collide: true,
    });
    expect(renderLabels).toHaveBeenCalledWith("overlay1");
  });

  it("applyStyleLabelState falls back for non-typed stored color/size", () => {
    seedIntentMap(ui, "annotation", {
      overlay1: {
        show: true,
        field: "count",
        color: 42 as unknown as string,
        size: "big" as unknown as number,
        format: NUMBER_FORMAT.AUTO,
      },
    });
    const setConfig = vi.spyOn(manager.annotation, "setConfig");

    ui.applyStyleLabelState();

    expect(setConfig).toHaveBeenCalledWith(
      "overlay1",
      expect.objectContaining({
        color: CONST.DEFAULT_ANNOTATION.color,
        size: CONST.DEFAULT_ANNOTATION.size,
      }),
    );
  });

  it("applyStyleLabelState normalizes a stored short hex color and clamps size", () => {
    seedIntentMap(ui, "annotation", {
      overlay1: {
        show: true,
        field: "count",
        color: "#abc",
        size: 99,
        format: NUMBER_FORMAT.AUTO,
      },
    });
    const setConfig = vi.spyOn(manager.annotation, "setConfig");

    ui.applyStyleLabelState();

    expect(setConfig).toHaveBeenCalledWith(
      "overlay1",
      expect.objectContaining({
        color: "#aabbcc",
        size: 32,
      }),
    );
  });

  it("applyStyleLabelState leaves an already-configured layer alone", () => {
    // The persisted table is a seed, not a restore. Re-entering (a runtime
    // addControl re-fires CONTROL_ATTACHED) used to re-apply the load-time
    // snapshot over the live config, silently reverting whatever the user had
    // changed since the page loaded.
    manager.annotation.setConfig("overlay1", {
      show: false,
      field: "",
      format: NUMBER_FORMAT.AUTO,
    });
    seedIntentMap(ui, "annotation", {
      overlay1: { show: true, field: "count", format: NUMBER_FORMAT.AUTO },
    });
    const setConfig = vi.spyOn(manager.annotation, "setConfig");
    const renderLabels = vi.spyOn(manager.annotation, "renderLabels");

    ui.applyStyleLabelState();

    expect(setConfig).not.toHaveBeenCalled();
    expect(renderLabels).not.toHaveBeenCalled();
    expect(manager.annotation.getConfig("overlay1").show).toBe(false);
  });

  it("applyStyleLabelState renders a shown config whose field is still auto", () => {
    // `field: ""` is the Auto sentinel, not "no field" — a shown config with it
    // must still render (renderLabels resolves the auto pick).
    seedIntentMap(ui, "annotation", { overlay1: { show: true, field: "" } });
    const renderLabels = vi.spyOn(manager.annotation, "renderLabels");

    ui.applyStyleLabelState();

    expect(renderLabels).toHaveBeenCalledWith("overlay1");
  });

  it("applyStyleLabelState skips configs that are switched off", () => {
    seedIntentMap(ui, "annotation", { overlay1: { show: false, field: "count" } });
    const renderLabels = vi.spyOn(manager.annotation, "renderLabels");
    const clearLabels = vi.spyOn(manager.annotation, "clearLabels");

    ui.applyStyleLabelState();

    expect(renderLabels).not.toHaveBeenCalled();
    // …and it clears instead: a stored `show: false` applied over labels left
    // on the map would leave the toggle reading off above visible labels.
    expect(clearLabels).toHaveBeenCalledWith("overlay1");
  });

  it("applyStyleLabelState skips stale ids whose layers are gone", () => {
    seedIntentMap(ui, "annotation", {
      ghost: { show: true, field: "count", format: NUMBER_FORMAT.AUTO },
    });
    const setConfig = vi.spyOn(manager.annotation, "setConfig");
    const renderLabels = vi.spyOn(manager.annotation, "renderLabels");

    ui.applyStyleLabelState();

    // A stale id must not be written back into the live config map, or the
    // next annotations save would resurrect a removed layer.
    expect(setConfig).not.toHaveBeenCalled();
    expect(renderLabels).not.toHaveBeenCalled();
  });

  // ─────────────────── dismiss / drag edge cases ───────────────────

  it("a document-level mousedown (target = document) dismisses the panel", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    expect(panelOf(item)).not.toBeNull();

    // jsdom dispatching on `document` itself yields target === document,
    // which has no closest() — the handler must still dismiss the panel.
    document.dispatchEvent(new MouseEvent("mousedown"));

    expect(panelOf(item)).toBeUndefined();
    expect(ui.stylePanelLayerId).toBeNull();
  });

  it("does not observe dragstart at all (the browser targets the row)", () => {
    // Replaces an earlier assertion that dispatched `dragstart` *on the panel*
    // and checked it was prevented. The browser never does that: the row is the
    // drag source, so `dragstart` is dispatched on the row and its path runs to
    // the row's ancestors — the panel, a descendant, is never on it. That test
    // passed while the real bug (a press on the panel dragged the row) shipped.
    // The guard now lives on the press; see the two drag tests above.
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    let seen = false;
    panel.addEventListener("dragstart", () => {
      seen = true;
    });

    item.dispatchEvent(
      new MouseEvent("dragstart", { bubbles: true, cancelable: true }),
    );

    expect(seen).toBe(false);
  });

  it("a change from an unrelated target is ignored and not stopped", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const content = panel.querySelector(".foliplus-panel-content") as HTMLElement;

    const event = new Event("change", { bubbles: true });
    Object.defineProperty(event, "stopPropagation", { value: vi.fn() });
    content.dispatchEvent(event);

    // No control matched → config untouched, event left to bubble.
    expect(manager.annotation.getConfig("overlay1").show).toBe(false);
    expect(event.stopPropagation).not.toHaveBeenCalled();
  });

  it("opening the panel reflects an existing show:true config on the toggle", () => {
    manager.annotation.setConfig("overlay1", {
      show: true,
      field: "count",
      format: NUMBER_FORMAT.AUTO,
    });
    const item = findItem(ui, "overlay1");

    ui.openStylePanel("overlay1");

    const toggle = panelOf(item)!.querySelector(
      ".foliplus-style-toggle-input",
    ) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
  });

  it("the debounced annotation save invokes the config getter", () => {
    vi.useFakeTimers();
    try {
      const saveAnnotations = vi.spyOn(manager.persistence, "schedule");
      const item = findItem(ui, "overlay1");
      ui.openStylePanel("overlay1");
      const panel = panelOf(item)!;
      const toggle = panel.querySelector(
        ".foliplus-style-toggle-input",
      ) as HTMLInputElement;
      toggle.checked = true;
      toggle.dispatchEvent(new Event("change", { bubbles: true }));
      // Show alone leaves field empty; a label needs a field too — pick one
      // the way a user would, through the field select's own change branch.
      const field = panel.querySelector(
        ".foliplus-style-field-select",
      ) as HTMLSelectElement;
      field.value = "count";
      field.dispatchEvent(new Event("change", { bubbles: true }));

      // The persistence write is debounced (~100ms); only on flush does the
      // config getter (Object.fromEntries over configEntries) execute.
      vi.advanceTimersByTime(200);

      expect(saveAnnotations).toHaveBeenCalled();
      // Label config rides `layers[id].annotation`; the layers source
      // re-reads every live dimension at flush, and this test touched only
      // the annotation one.
      const fields = saveAnnotations.mock.calls.at(-1)![0] as {
        layers: () => Record<string, { annotation?: Record<string, unknown> }>;
      };
      expect(fields.layers()).toEqual({
        overlay1: {
          overrides: [],
          annotation: {
            show: true,
            field: "count",
            color: CONST.DEFAULT_ANNOTATION.color,
            size: CONST.DEFAULT_ANNOTATION.size,
            format: NUMBER_FORMAT.AUTO,
            collide: true,
          },
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("annotation format labels fall back to the raw key when the translator returns empty", () => {
    const item = findItem(ui, "overlay1");
    const realUnderscore = ui._;
    ui._ = (key: string) =>
      key.startsWith("foliplus.label_format_") ? "" : realUnderscore(key);

    ui.openStylePanel("overlay1");

    const opts = panelOf(item)!.querySelectorAll(
      ".foliplus-style-format-select option",
    );
    expect([...opts].map(o => o.textContent)).toEqual([
      "auto",
      "int",
      "comma",
      "percent",
    ]);

    ui._ = realUnderscore;
  });

  // ─────────────────── delegated style panel (third-party) ───────────────────

  it("delegated panel with only labelShow + labelFormat omits color/size row", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, labelFormat: "auto" }),
      styleSetters: { labelShow: vi.fn(), labelFormat: vi.fn() },
    });
    const item = findItem(ui, "heat1");

    ui.openStylePanel("heat1");

    const panel = panelOf(item)!;
    expect(panel.querySelector(".foliplus-style-label-color-input")).toBeNull();
    expect(panel.querySelector(".foliplus-style-label-size-input")).toBeNull();
    expect(panel.querySelector(".foliplus-style-format-select")).not.toBeNull();
  });

  it("delegated format labels fall back to the raw key when the translator returns empty", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, labelFormat: "auto" }),
      styleSetters: { labelShow: vi.fn(), labelFormat: vi.fn() },
    });
    const item = findItem(ui, "heat1");
    const realUnderscore = ui._;
    ui._ = (key: string) =>
      key.startsWith("foliplus.label_format_") ? "" : realUnderscore(key);

    ui.openStylePanel("heat1");

    // The || f fallback made the option text the raw format key.
    const opts = panelOf(item)!.querySelectorAll(
      ".foliplus-style-format-select option",
    );
    expect([...opts].map(o => o.textContent)).toEqual([
      "auto",
      "int",
      "comma",
      "percent",
    ]);

    ui._ = realUnderscore;
  });

  it("delegated panel renders a format select when labelFormat setter is present", () => {
    const labelFormatSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, labelFormat: "comma" }),
      styleSetters: { labelShow: vi.fn(), labelFormat: labelFormatSetter },
    });
    const item = findItem(ui, "heat1");

    ui.openStylePanel("heat1");

    const panel = panelOf(item)!;
    const formatSelect = panel.querySelector(
      ".foliplus-style-format-select",
    ) as HTMLSelectElement;
    expect(formatSelect).not.toBeNull();
    expect(formatSelect.value).toBe("comma");
    const opts = Array.from(formatSelect.options).map(o => o.value);
    expect(opts).toEqual(Object.values(NUMBER_FORMAT));
  });

  it("delegated panel renders color and size inputs when those setters exist", () => {
    const labelColorSetter = vi.fn();
    const labelSizeSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({
        labelShow: true,
        labelColor: "#ff0000",
        labelSize: 14,
        labelFormat: "auto",
      }),
      styleSetters: {
        labelShow: vi.fn(),
        labelColor: labelColorSetter,
        labelSize: labelSizeSetter,
        labelFormat: vi.fn(),
      },
    });
    const item = findItem(ui, "heat1");

    ui.openStylePanel("heat1");

    const panel = panelOf(item)!;
    const color = panel.querySelector(
      ".foliplus-style-label-color-input",
    ) as HTMLInputElement;
    const size = panel.querySelector(
      ".foliplus-style-label-size-input",
    ) as HTMLInputElement;
    expect(color.value).toBe("#ff0000");
    expect(size.value).toBe("14");

    color.value = "#00ff00";
    color.dispatchEvent(new Event("input", { bubbles: true }));
    expect(labelColorSetter).toHaveBeenCalledWith("#00ff00");

    size.value = "18";
    size.dispatchEvent(new Event("input", { bubbles: true }));
    expect(labelSizeSetter).toHaveBeenCalledWith(18);
  });

  it("delegated size input clamps out-of-range values on commit, like the heatmap panel", () => {
    const labelSizeSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, labelSize: 11 }),
      styleSetters: { labelShow: vi.fn(), labelSize: labelSizeSetter },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const size = panelOf(item)!.querySelector(
      ".foliplus-style-label-size-input",
    ) as HTMLInputElement;

    size.value = "99";
    size.dispatchEvent(new Event("input", { bubbles: true }));
    expect(labelSizeSetter).not.toHaveBeenCalled();

    size.dispatchEvent(new Event("change", { bubbles: true }));
    expect(size.value).toBe("32");
    expect(labelSizeSetter).toHaveBeenCalledWith(32);
  });

  it("delegated panel falls back to defaults when provider returns non-typed color/size", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, labelColor: 42, labelSize: "big" }),
      styleSetters: { labelShow: vi.fn(), labelColor: vi.fn(), labelSize: vi.fn() },
    });
    const item = findItem(ui, "heat1");

    ui.openStylePanel("heat1");

    const panel = panelOf(item)!;
    const color = panel.querySelector(
      ".foliplus-style-label-color-input",
    ) as HTMLInputElement;
    const size = panel.querySelector(
      ".foliplus-style-label-size-input",
    ) as HTMLInputElement;
    expect(color.value).toBe("#ffffff");
    expect(size.value).toBe("11");
  });

  it("delegated panel returns null when setters declare only unknown keys", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ field: "count" }),
      styleSetters: { field: vi.fn() },
    });
    const item = findItem(ui, "heat1");

    ui.openStylePanel("heat1");

    expect(panelOf(item)).toBeUndefined();
  });

  it("LAYER_STYLE_CHANGE skips non-typed color/size provider values on refresh", () => {
    let color: unknown = "#ff0000";
    let size: unknown = 12;
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({
        labelShow: true,
        labelColor: color,
        labelSize: size,
      }),
      styleSetters: { labelShow: vi.fn(), labelColor: vi.fn(), labelSize: vi.fn() },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const panel = panelOf(item)!;
    const colorEl = panel.querySelector(
      ".foliplus-style-label-color-input",
    ) as HTMLInputElement;
    const sizeEl = panel.querySelector(
      ".foliplus-style-label-size-input",
    ) as HTMLInputElement;

    color = 42;
    size = "big";
    (manager.events as unknown as { emit: (e: string, p: unknown) => void }).emit(
      "foliplus:layer:style-change",
      { id: "heat1" },
    );

    // Non-typed provider values leave the inputs alone.
    expect(colorEl.value).toBe("#ff0000");
    expect(sizeEl.value).toBe("12");
  });

  it("LAYER_STYLE_CHANGE skips color/size overwrite when the user is editing them", () => {
    let color = "#ff0000";
    let size = 12;
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({
        labelShow: true,
        labelColor: color,
        labelSize: size,
      }),
      styleSetters: { labelShow: vi.fn(), labelColor: vi.fn(), labelSize: vi.fn() },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const panel = panelOf(item)!;
    const colorEl = panel.querySelector(
      ".foliplus-style-label-color-input",
    ) as HTMLInputElement;
    const sizeEl = panel.querySelector(
      ".foliplus-style-label-size-input",
    ) as HTMLInputElement;
    colorEl.focus();

    color = "#00ff00";
    size = 20;
    (manager.events as unknown as { emit: (e: string, p: unknown) => void }).emit(
      "foliplus:layer:style-change",
      { id: "heat1" },
    );

    expect(colorEl.value).toBe("#ff0000");
    expect(sizeEl.value).toBe("20");
  });

  it("delegated panel renders only the color input when size setter is absent", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, labelColor: "#ff0000" }),
      styleSetters: { labelShow: vi.fn(), labelColor: vi.fn() },
    });
    const item = findItem(ui, "heat1");

    ui.openStylePanel("heat1");

    const panel = panelOf(item)!;
    expect(panel.querySelector(".foliplus-style-label-color-input")).not.toBeNull();
    expect(panel.querySelector(".foliplus-style-label-size-input")).toBeNull();
  });

  it("delegated panel renders only the size input when color setter is absent", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, labelSize: 14 }),
      styleSetters: { labelShow: vi.fn(), labelSize: vi.fn() },
    });
    const item = findItem(ui, "heat1");

    ui.openStylePanel("heat1");

    const panel = panelOf(item)!;
    expect(panel.querySelector(".foliplus-style-label-color-input")).toBeNull();
    expect(panel.querySelector(".foliplus-style-label-size-input")).not.toBeNull();
  });

  it("LAYER_STYLE_CHANGE refreshes color and size inputs", () => {
    let color = "#ff0000";
    let size = 12;
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({
        labelShow: true,
        labelColor: color,
        labelSize: size,
      }),
      styleSetters: { labelShow: vi.fn(), labelColor: vi.fn(), labelSize: vi.fn() },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const panel = panelOf(item)!;
    const colorEl = panel.querySelector(
      ".foliplus-style-label-color-input",
    ) as HTMLInputElement;
    const sizeEl = panel.querySelector(
      ".foliplus-style-label-size-input",
    ) as HTMLInputElement;
    expect(colorEl.value).toBe("#ff0000");
    expect(sizeEl.value).toBe("12");

    color = "#00ff00";
    size = 20;
    (manager.events as unknown as { emit: (e: string, p: unknown) => void }).emit(
      "foliplus:layer:style-change",
      { id: "heat1" },
    );

    expect(colorEl.value).toBe("#00ff00");
    expect(sizeEl.value).toBe("20");
  });

  it("delegated panel omits the format select when labelFormat setter is absent", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true }),
      styleSetters: { labelShow: vi.fn() },
    });
    const item = findItem(ui, "heat1");

    ui.openStylePanel("heat1");

    expect(panelOf(item)!.querySelector(".foliplus-style-format-select")).toBeNull();
  });

  it("delegated format select dispatches to styleSetters.labelFormat", () => {
    const labelFormatSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, labelFormat: "auto" }),
      styleSetters: { labelShow: vi.fn(), labelFormat: labelFormatSetter },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const formatSelect = panelOf(item)!.querySelector(
      ".foliplus-style-format-select",
    ) as HTMLSelectElement;
    formatSelect.value = "percent";
    formatSelect.dispatchEvent(new Event("change", { bubbles: true }));

    expect(labelFormatSetter).toHaveBeenCalledWith("percent");
  });

  it("delegated panel refreshes format select on LAYER_STYLE_CHANGE", () => {
    let currentFormat = "auto";
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, labelFormat: currentFormat }),
      styleSetters: { labelShow: vi.fn(), labelFormat: vi.fn() },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const formatSelect = panelOf(item)!.querySelector(
      ".foliplus-style-format-select",
    ) as HTMLSelectElement;
    expect(formatSelect.value).toBe("auto");

    currentFormat = "int";
    (manager.events as unknown as { emit: (e: string, p: unknown) => void }).emit(
      "foliplus:layer:style-change",
      { id: "heat1" },
    );

    expect(formatSelect.value).toBe("int");
  });

  it("delegated panel hides format select under the label body when labels are off", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: false, labelFormat: "auto" }),
      styleSetters: { labelShow: vi.fn(), labelFormat: vi.fn() },
    });
    const item = findItem(ui, "heat1");

    ui.openStylePanel("heat1");

    const panel = panelOf(item)!;
    const body = panel.querySelector(".foliplus-style-body") as HTMLElement;
    expect(body.classList.contains("foliplus-hidden")).toBe(true);
    expect(body.querySelector(".foliplus-style-format-select")).not.toBeNull();
  });

  it("delegated Reset includes labelFormat when published in styleDefaultsProvider", () => {
    const labelShowSetter = vi.fn();
    const labelFormatSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, labelFormat: "comma" }),
      styleSetters: { labelShow: labelShowSetter, labelFormat: labelFormatSetter },
      styleDefaultsProvider: () => ({ labelShow: false, labelFormat: "auto" }),
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const btn = panelOf(item)!.querySelector(
      ".foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(labelFormatSetter).toHaveBeenCalledWith("auto");
  });

  it("layerHasStyleDelegation is true only for layers with styleSetters", () => {
    expect(layerHasStyleDelegation(ui, "overlay1")).toBe(false);

    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true }),
      styleSetters: { labelShow: vi.fn() },
    });
    expect(layerHasStyleDelegation(ui, "heat1")).toBe(true);
  });

  it("delegated panel renders only the controls the component declared", () => {
    const labelShowSetter = vi.fn();
    const labelCollideSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, labelCollide: false }),
      styleSetters: { labelShow: labelShowSetter, labelCollide: labelCollideSetter },
    });
    const item = findItem(ui, "heat1");

    ui.openStylePanel("heat1");

    const panel = panelOf(item)!;
    const showToggle = panel.querySelector(
      ".foliplus-style-toggle-input",
    ) as HTMLInputElement;
    const collideToggle = panel.querySelector(
      ".foliplus-style-collide-input",
    ) as HTMLInputElement;
    // labelShow true → checked; labelCollide false → unchecked.
    expect(showToggle.checked).toBe(true);
    expect(collideToggle.checked).toBe(false);
    // Aggregation field is data config on the component's own panel — never
    // delegated into the drawer.
    expect(panel.querySelector(".foliplus-style-field-select")).toBeNull();
    // The shared renderer emits controls only, so the panel owns its own
    // ordering: the Layer rows (which LayerControl adds) come before the Label
    // rows (which the component delegated). No heading carries that split any
    // more — document order does.
    expect(panel.querySelectorAll(".foliplus-section-heading")).toHaveLength(0);
    const order = [...panel.querySelectorAll("*")];
    expect(
      order.indexOf(panel.querySelector(".foliplus-style-opacity-range")!),
    ).toBeLessThan(order.indexOf(showToggle as unknown as Element));
  });

  it("gives the Layer section to a delegated layer that publishes only border setters", () => {
    // A styleSetters layer with neither an opacity carrier nor a zoom-range
    // carrier: the border row is LayerControl-owned, so the Layer section must
    // open for it — otherwise it renders orphaned under the label heading.
    manager.registerLayer({
      id: "borderOnly",
      name: "BorderOnly",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, borderColor: "#abcdef" }),
      styleSetters: {
        labelShow: vi.fn(),
        borderColor: vi.fn(),
      },
    });
    // Each row answers to its own capability, and `detectCapabilities` never
    // emits a surface that is opacity-less yet zoom-range-carrying — a canvas
    // declares `zoomRange: "pane"`, so the sparse case needs both forced off.
    const li = manager.layerRegistry.get("borderOnly")!;
    manager.surfaceFor(li).capabilities.opacity = "none";
    manager.surfaceFor(li).capabilities.zoomRange = "none";

    const item = findItem(ui, "borderOnly");
    ui.openStylePanel("borderOnly");
    const panel = panelOf(item)!;

    expect(panel.querySelector(`.${CONST.CLASSES.STYLE_OPACITY_RANGE}`)).toBeNull();
    expect(panel.querySelector(`.${CONST.CLASSES.STYLE_ZOOM_RANGE_ROW}`)).toBeNull();
    // No group headings — the Layer rows still render on their own.
    expect(panel.querySelectorAll(".foliplus-section-heading")).toHaveLength(0);
    expect(panel.querySelector("input[type=color]")).not.toBeNull();
  });

  it("delegated panel with vector geometry skips fill/border — the component redraws them", () => {
    // A measure-like layer: vector geometry (polygon) that detects fill/stroke
    // as "native", but the component only delegates label style (labelShow,
    // labelCollide) — no border/fill setters. The DIM_ORDER sweep must skip
    // fill and border (the vector setStyle write is unreliable against a
    // component that redraws its own geometry), keeping only opacity and
    // zoomRange (LayerControl-owned).
    const leaf = {
      options: { color: "#3388ff", weight: 2, fillColor: "#3388ff", fillOpacity: 0.2 },
      setStyle: vi.fn(),
      on: vi.fn(),
    };
    manager.registerLayer({
      id: "measure1",
      name: "Measure",
      layer: {
        options: {},
        eachLayer: vi.fn((fn: (child: unknown) => void) => {
          fn(leaf);
        }),
        getBounds: vi.fn(() => ({
          isValid: vi.fn(() => true),
          getSouthWest: () => ({ lat: 0, lng: 0 }),
          getNorthEast: () => ({ lat: 1, lng: 1 }),
        })),
      } as never,
      styleProvider: () => ({ labelShow: true, labelCollide: false }),
      styleSetters: { labelShow: vi.fn(), labelCollide: vi.fn() },
    });
    ui.fieldCache.set("measure1", [{ name: "count", numeric: true }]);
    const item = findItem(ui, "measure1");
    ui.openStylePanel("measure1");
    const panel = panelOf(item)!;

    // No fill or border rows — the delegated drawer skips both.
    expect(panel.querySelector(`.${CONST.CLASSES.STYLE_FILL_ROW}`)).toBeNull();
    expect(panel.querySelector(`.${CONST.CLASSES.STYLE_BORDER_ROW}`)).toBeNull();

    // Opacity and zoomRange are LayerControl-owned — they survive.
    expect(panel.querySelector(`.${CONST.CLASSES.STYLE_OPACITY_RANGE}`)).not.toBeNull();
    expect(
      panel.querySelector(`.${CONST.CLASSES.STYLE_ZOOM_RANGE_ROW}`),
    ).not.toBeNull();

    // The Layer rows still render — opacity and zoomRange above are the proof.
    // What is gone is the group heading that used to introduce them.
    expect(panel.querySelectorAll(".foliplus-section-heading")).toHaveLength(0);
  });

  it("delegated panel omits the field select even when field setter is present", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, field: "count" }),
      styleSetters: { labelShow: vi.fn(), field: vi.fn() },
    });
    const item = findItem(ui, "heat1");

    ui.openStylePanel("heat1");

    expect(panelOf(item)!.querySelector(".foliplus-style-field-select")).toBeNull();
  });

  it("delegated change dispatches to styleSetters", () => {
    const labelShowSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true }),
      styleSetters: { labelShow: labelShowSetter },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const toggle = panelOf(item)!.querySelector(
      ".foliplus-style-toggle-input",
    ) as HTMLInputElement;
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));

    expect(labelShowSetter).toHaveBeenCalledWith(false);
  });

  it("delegated panel refreshes when LAYER_STYLE_CHANGE fires for its layer", () => {
    const labelShowSetter = vi.fn();
    let currentLabelShow = true;
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: currentLabelShow }),
      styleSetters: { labelShow: labelShowSetter },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const toggle = panelOf(item)!.querySelector(
      ".foliplus-style-toggle-input",
    ) as HTMLInputElement;
    expect(toggle.checked).toBe(true);

    // Simulate the component's own panel flipping the value and emitting.
    currentLabelShow = false;
    (manager.events as unknown as { emit: (e: string, p: unknown) => void }).emit(
      "foliplus:layer:style-change",
      { id: "heat1" },
    );

    expect(toggle.checked).toBe(false);
  });

  it("delegated panel does not overwrite an input being edited", () => {
    let currentLabelShow = true;
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: currentLabelShow }),
      styleSetters: { labelShow: vi.fn() },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const toggle = panelOf(item)!.querySelector(
      ".foliplus-style-toggle-input",
    ) as HTMLInputElement;
    toggle.focus();

    currentLabelShow = false;
    (manager.events as unknown as { emit: (e: string, p: unknown) => void }).emit(
      "foliplus:layer:style-change",
      { id: "heat1" },
    );

    // The user is editing this input — the remote value must not overwrite it.
    expect(toggle.checked).toBe(true);
  });

  it("closeStylePanel unsubscribes from LAYER_STYLE_CHANGE", () => {
    const offSpy = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true }),
      styleSetters: { labelShow: vi.fn() },
    });
    ui.openStylePanel("heat1");
    expect(ui.styleUnsubscribe).not.toBeNull();

    // Capture the unsubscribe and verify it is called on close.
    const unsub = ui.styleUnsubscribe!;
    ui.styleUnsubscribe = () => {
      offSpy();
      unsub();
    };
    ui.closeStylePanel(false);

    expect(offSpy).toHaveBeenCalled();
    expect(ui.styleUnsubscribe).toBeNull();
  });

  it("empty styleSetters does not enable the delegated panel", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({}),
      styleSetters: {},
    });
    expect(layerHasStyleDelegation(ui, "heat1")).toBe(false);
  });

  it("delegated panel collapses body when label toggle is off", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: false, labelCollide: true }),
      styleSetters: { labelShow: vi.fn(), labelCollide: vi.fn() },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const body = panelOf(item)!.querySelector(".foliplus-style-body") as HTMLElement;
    expect(body.classList.contains("foliplus-hidden")).toBe(true);
  });

  it("delegated panel expands body when label toggle is flipped on", () => {
    const labelShowSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: false, labelCollide: true }),
      styleSetters: { labelShow: labelShowSetter, labelCollide: vi.fn() },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const toggle = panelOf(item)!.querySelector(
      ".foliplus-style-toggle-input",
    ) as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));

    const body = panelOf(item)!.querySelector(".foliplus-style-body") as HTMLElement;
    expect(body.classList.contains("foliplus-hidden")).toBe(false);
    expect(labelShowSetter).toHaveBeenCalledWith(true);
  });

  it("delegated change dispatches labelCollide to styleSetters", () => {
    const labelCollideSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, labelCollide: true }),
      styleSetters: { labelShow: vi.fn(), labelCollide: labelCollideSetter },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const collideToggle = panelOf(item)!.querySelector(
      ".foliplus-style-collide-input",
    ) as HTMLInputElement;
    collideToggle.checked = false;
    collideToggle.dispatchEvent(new Event("change", { bubbles: true }));

    expect(labelCollideSetter).toHaveBeenCalledWith(false);
  });

  it("LAYER_STYLE_CHANGE updates the collide toggle from the provider", () => {
    let currentCollide = true;
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, labelCollide: currentCollide }),
      styleSetters: { labelShow: vi.fn(), labelCollide: vi.fn() },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const collideToggle = panelOf(item)!.querySelector(
      ".foliplus-style-collide-input",
    ) as HTMLInputElement;
    expect(collideToggle.checked).toBe(true);

    currentCollide = false;
    (manager.events as unknown as { emit: (e: string, p: unknown) => void }).emit(
      "foliplus:layer:style-change",
      { id: "heat1" },
    );

    expect(collideToggle.checked).toBe(false);
  });

  it("delegated change handler ignores unrecognized controls", () => {
    const labelShowSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true }),
      styleSetters: { labelShow: labelShowSetter },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    // Dispatch a change on a plain div inside the panel — no known control
    // class matches, so the handler returns early without calling any setter.
    const bogus = document.createElement("div");
    panelOf(item)!.appendChild(bogus);
    bogus.dispatchEvent(new Event("change", { bubbles: true }));

    expect(labelShowSetter).not.toHaveBeenCalled();
  });

  it("delegated change handler ignores a stray field select", () => {
    const labelShowSetter = vi.fn();
    const fieldSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, field: "count" }),
      styleSetters: { labelShow: labelShowSetter, field: fieldSetter },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    // The drawer no longer renders a field select, but a third-party layer
    // could still register `field`. A stray change must not reach the setter.
    const stray = document.createElement("select");
    stray.className = "foliplus-form-select foliplus-style-field-select";
    panelOf(item)!.appendChild(stray);
    stray.value = "sum";
    stray.dispatchEvent(new Event("change", { bubbles: true }));

    expect(fieldSetter).not.toHaveBeenCalled();
  });

  // ─────────────────── delegated reset (Python CONF defaults) ───────────────────

  it("delegated panel hides Reset when the layer supplies no styleDefaultsProvider", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true }),
      styleSetters: { labelShow: vi.fn() },
    });
    const item = findItem(ui, "heat1");

    ui.openStylePanel("heat1");

    expect(panelOf(item)!.querySelector(".foliplus-style-reset-btn")).toBeNull();
  });

  it("delegated panel renders Reset when styleDefaultsProvider is present", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true }),
      styleSetters: { labelShow: vi.fn() },
      styleDefaultsProvider: () => ({ labelShow: false }),
    });
    const item = findItem(ui, "heat1");

    ui.openStylePanel("heat1");

    const btn = panelOf(item)!.querySelector(
      ".foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.textContent).toBe("LayerControl.style_reset");
  });

  it("delegated Reset calls each setter with its styleDefaultsProvider value and closes", () => {
    const labelShowSetter = vi.fn();
    const labelCollideSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, labelCollide: false }),
      styleSetters: { labelShow: labelShowSetter, labelCollide: labelCollideSetter },
      styleDefaultsProvider: () => ({ labelShow: false, labelCollide: true }),
    });
    const item = findItem(ui, "heat1");
    const focusSpy = vi.fn();
    item.focus = focusSpy;
    ui.openStylePanel("heat1");

    const btn = panelOf(item)!.querySelector(
      ".foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    // Python CONF defaults — never the live / persisted values.
    expect(labelShowSetter).toHaveBeenCalledWith(false);
    expect(labelCollideSetter).toHaveBeenCalledWith(true);
    expect(panelOf(item)).toBeUndefined();
    expect(focusSpy).toHaveBeenCalled();
  });

  it("delegated Reset skips setters with no matching default", () => {
    const labelShowSetter = vi.fn();
    const labelCollideSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, labelCollide: true }),
      styleSetters: { labelShow: labelShowSetter, labelCollide: labelCollideSetter },
      styleDefaultsProvider: () => ({ labelShow: false }),
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const btn = panelOf(item)!.querySelector(
      ".foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(labelShowSetter).toHaveBeenCalledWith(false);
    expect(labelCollideSetter).not.toHaveBeenCalled();
  });

  it("delegated panel tolerates a missing styleProvider (empty values)", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleSetters: { labelShow: vi.fn(), labelCollide: vi.fn() },
    });
    const item = findItem(ui, "heat1");

    ui.openStylePanel("heat1");

    const showToggle = panelOf(item)!.querySelector(
      ".foliplus-style-toggle-input",
    ) as HTMLInputElement;
    const collideToggle = panelOf(item)!.querySelector(
      ".foliplus-style-collide-input",
    ) as HTMLInputElement;
    // Empty provider → both toggles read as off / collide-on default.
    expect(showToggle.checked).toBe(false);
    expect(collideToggle.checked).toBe(true);
  });

  it("delegated panel with only labelCollide still renders (no show row)", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelCollide: true }),
      styleSetters: { labelCollide: vi.fn() },
    });
    const item = findItem(ui, "heat1");

    ui.openStylePanel("heat1");

    expect(panelOf(item)!.querySelector(".foliplus-style-toggle-input")).toBeNull();
    expect(
      panelOf(item)!.querySelector(".foliplus-style-collide-input"),
    ).not.toBeNull();
  });

  it("delegated Reset closes cleanly when styleDefaultsProvider returns undefined", () => {
    const labelShowSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true }),
      styleSetters: { labelShow: labelShowSetter },
      styleDefaultsProvider: () => undefined as unknown as Record<string, unknown>,
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const btn = panelOf(item)!.querySelector(
      ".foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    // No default keys → no setter call, but the panel still closes.
    expect(labelShowSetter).not.toHaveBeenCalled();
    expect(panelOf(item)).toBeUndefined();
  });

  it("LAYER_STYLE_CHANGE for a different layer id is ignored", () => {
    let currentLabelShow = true;
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: currentLabelShow }),
      styleSetters: { labelShow: vi.fn() },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const toggle = panelOf(item)!.querySelector(
      ".foliplus-style-toggle-input",
    ) as HTMLInputElement;
    expect(toggle.checked).toBe(true);

    currentLabelShow = false;
    (manager.events as unknown as { emit: (e: string, p: unknown) => void }).emit(
      "foliplus:layer:style-change",
      { id: "other-layer" },
    );

    expect(toggle.checked).toBe(true);
  });

  it("LAYER_STYLE_CHANGE bails when styleProvider returns nothing", () => {
    let provide: () => Record<string, unknown> | undefined = () => ({
      labelShow: true,
    });
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => provide(),
      styleSetters: { labelShow: vi.fn() },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");
    const toggle = panelOf(item)!.querySelector(
      ".foliplus-style-toggle-input",
    ) as HTMLInputElement;
    expect(toggle.checked).toBe(true);

    provide = () => undefined;
    (manager.events as unknown as { emit: (e: string, p: unknown) => void }).emit(
      "foliplus:layer:style-change",
      { id: "heat1" },
    );

    expect(toggle.checked).toBe(true);
  });

  it("delegated Reset no-ops when styleSetters is cleared after open", () => {
    const labelShowSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true }),
      styleSetters: { labelShow: labelShowSetter },
      styleDefaultsProvider: () => ({ labelShow: false }),
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    // Simulate the layer being torn down between open and Reset.
    const li = manager.layerRegistry.get("heat1")!;
    (li as { styleSetters: unknown }).styleSetters = null;

    const btn = panelOf(item)!.querySelector(
      ".foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(labelShowSetter).not.toHaveBeenCalled();
    expect(panelOf(item)).toBeUndefined();
  });

  it("delegated change no-ops when styleSetters is cleared after open", () => {
    const labelShowSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true }),
      styleSetters: { labelShow: labelShowSetter },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const li = manager.layerRegistry.get("heat1")!;
    (li as { styleSetters: unknown }).styleSetters = null;

    const toggle = panelOf(item)!.querySelector(
      ".foliplus-style-toggle-input",
    ) as HTMLInputElement;
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));

    expect(labelShowSetter).not.toHaveBeenCalled();
  });

  it("dispatches into a layer re-registered while its drawer is open", () => {
    const firstSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true }),
      styleSetters: { labelShow: firstSetter },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    // Re-registering upserts a fresh LayerInfo object in place of the old one.
    // The drawer must resolve through the registry rather than the entry it
    // captured at render time — a captured entry would keep driving a layer
    // that is no longer registered.
    const secondSetter = vi.fn();
    const current = manager.layerRegistry.get("heat1")!;
    manager.layerRegistry.upsert({
      ...current,
      styleSetters: { labelShow: secondSetter },
    } as never);

    const toggle = panelOf(item)!.querySelector(
      ".foliplus-style-toggle-input",
    ) as HTMLInputElement;
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));

    expect(secondSetter).toHaveBeenCalledWith(false);
    expect(firstSetter).not.toHaveBeenCalled();
  });

  it("delegated format select falls back to auto for a non-string provider value", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, labelFormat: 42 }),
      styleSetters: { labelShow: vi.fn(), labelFormat: vi.fn() },
    });
    const item = findItem(ui, "heat1");

    ui.openStylePanel("heat1");

    const formatSelect = panelOf(item)!.querySelector(
      ".foliplus-style-format-select",
    ) as HTMLSelectElement;
    expect(formatSelect.value).toBe("auto");
  });

  it("LAYER_STYLE_CHANGE resets format select to auto for a non-string value", () => {
    let currentFormat: unknown = "comma";
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, labelFormat: currentFormat }),
      styleSetters: { labelShow: vi.fn(), labelFormat: vi.fn() },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const formatSelect = panelOf(item)!.querySelector(
      ".foliplus-style-format-select",
    ) as HTMLSelectElement;
    expect(formatSelect.value).toBe("comma");

    currentFormat = 99;
    (manager.events as unknown as { emit: (e: string, p: unknown) => void }).emit(
      "foliplus:layer:style-change",
      { id: "heat1" },
    );

    expect(formatSelect.value).toBe("auto");
  });

  it("delegated panel renders a border section with color and weight inputs when both setters exist", () => {
    const borderColorSetter = vi.fn();
    const borderWeightSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({
        labelShow: true,
        labelFormat: "auto",
        borderWeight: 2,
        borderColor: "#ff0000",
      }),
      styleSetters: {
        labelShow: vi.fn(),
        labelFormat: vi.fn(),
        borderWeight: borderWeightSetter,
        borderColor: borderColorSetter,
      },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const panel = panelOf(item)!;
    const colorInput = panel.querySelector("input[type=color]") as HTMLInputElement;
    const weightInput = panel.querySelector("input[type=number]") as HTMLInputElement;
    expect(colorInput).not.toBeNull();
    expect(colorInput.value).toBe("#ff0000");
    expect(weightInput).not.toBeNull();
    expect(weightInput.value).toBe("2");
    expect(weightInput.min).toBe("0");
    expect(weightInput.max).toBe("10");
    expect(weightInput.step).toBe("0.5");
  });

  it("delegated border color input dispatches to styleSetters.borderColor on input", () => {
    const borderColorSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ borderColor: "#000000" }),
      styleSetters: { borderColor: borderColorSetter },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const colorInput = panelOf(item)!.querySelector(
      "input[type=color]",
    ) as HTMLInputElement;
    colorInput.value = "#abcdef";
    colorInput.dispatchEvent(new Event("input", { bubbles: true }));

    expect(borderColorSetter).toHaveBeenCalledWith("#abcdef");
  });

  it("delegated border weight input commits to styleSetters.borderWeight on change", () => {
    const borderWeightSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ borderWeight: 1 }),
      styleSetters: { borderWeight: borderWeightSetter },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const weightInput = panelOf(item)!.querySelector(
      "input[type=number]",
    ) as HTMLInputElement;
    weightInput.value = "3";
    weightInput.dispatchEvent(new Event("change", { bubbles: true }));

    expect(borderWeightSetter).toHaveBeenCalledWith(3);
  });

  it("delegated panel returns null when a layer publishes only data setters", () => {
    manager.registerLayer({
      id: "dataOnly",
      name: "DataOnly",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({}),
      styleSetters: { field: vi.fn() },
    });
    expect(renderDelegatedStylePanel(ui, "dataOnly")).toBeNull();
  });

  it("buildBorderRow returns null when the layer has no border setters", () => {
    manager.registerLayer({
      id: "dataOnly",
      name: "DataOnly",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({}),
      styleSetters: { field: vi.fn() },
    });
    expect(buildBorderRow(ui, "dataOnly")).toBeNull();
  });

  it("delegated Reset restores borderWeight and borderColor from styleDefaultsProvider", () => {
    const borderColorSetter = vi.fn();
    const borderWeightSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ borderWeight: 3, borderColor: "#000000" }),
      styleSetters: {
        borderWeight: borderWeightSetter,
        borderColor: borderColorSetter,
      },
      styleDefaultsProvider: () => ({
        borderWeight: 1,
        borderColor: "#333333",
      }),
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const resetBtn = panelOf(item)!.querySelector(
      "button.foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    expect(resetBtn).not.toBeNull();
    resetBtn.click();

    expect(borderWeightSetter).toHaveBeenCalledWith(1);
    expect(borderColorSetter).toHaveBeenCalledWith("#333333");
  });

  it("LAYER_STYLE_CHANGE refreshes border color and weight inputs from styleProvider", () => {
    let currentBorderColor = "#ff0000";
    let currentBorderWeight = 2;
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({
        borderColor: currentBorderColor,
        borderWeight: currentBorderWeight,
      }),
      styleSetters: {
        borderColor: vi.fn(),
        borderWeight: vi.fn(),
      },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const colorInput = panelOf(item)!.querySelector(
      "input[type=color]",
    ) as HTMLInputElement;
    const weightInput = panelOf(item)!.querySelector(
      "input[type=number]",
    ) as HTMLInputElement;
    expect(colorInput.value).toBe("#ff0000");
    expect(weightInput.value).toBe("2");

    currentBorderColor = "#00ff00";
    currentBorderWeight = 4;
    (manager.events as unknown as { emit: (e: string, p: unknown) => void }).emit(
      "foliplus:layer:style-change",
      { id: "heat1" },
    );

    expect(colorInput.value).toBe("#00ff00");
    expect(weightInput.value).toBe("4");
  });

  it("LAYER_STYLE_CHANGE skips border overwrite when the user is editing the input", () => {
    let currentBorderColor = "#ff0000";
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ borderColor: currentBorderColor }),
      styleSetters: { borderColor: vi.fn() },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const colorInput = panelOf(item)!.querySelector(
      "input[type=color]",
    ) as HTMLInputElement;
    colorInput.focus();

    currentBorderColor = "#0000ff";
    (manager.events as unknown as { emit: (e: string, p: unknown) => void }).emit(
      "foliplus:layer:style-change",
      { id: "heat1" },
    );

    expect(colorInput.value).toBe("#ff0000");
  });

  it("LAYER_STYLE_CHANGE skips non-string borderColor and non-number borderWeight on refresh", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({
        borderColor: 42 as unknown as string,
        borderWeight: "3" as unknown as number,
      }),
      styleSetters: {
        borderColor: vi.fn(),
        borderWeight: vi.fn(),
      },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const colorInput = panelOf(item)!.querySelector(
      "input[type=color]",
    ) as HTMLInputElement;
    const weightInput = panelOf(item)!.querySelector(
      "input[type=number]",
    ) as HTMLInputElement;
    const originalColor = colorInput.value;
    const originalWeight = weightInput.value;

    (manager.events as unknown as { emit: (e: string, p: unknown) => void }).emit(
      "foliplus:layer:style-change",
      { id: "heat1" },
    );

    expect(colorInput.value).toBe(originalColor);
    expect(weightInput.value).toBe(originalWeight);
  });

  it("LAYER_STYLE_CHANGE bails when styleProvider returns undefined for a border layer", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => undefined as unknown as { borderColor?: string },
      styleSetters: { borderColor: vi.fn() },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const colorInput = panelOf(item)!.querySelector(
      "input[type=color]",
    ) as HTMLInputElement;
    const originalColor = colorInput.value;

    (manager.events as unknown as { emit: (e: string, p: unknown) => void }).emit(
      "foliplus:layer:style-change",
      { id: "heat1" },
    );

    expect(colorInput.value).toBe(originalColor);
  });

  it("delegated panel returns null when a layer publishes only data setters", () => {
    manager.registerLayer({
      id: "dataOnly",
      name: "DataOnly",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({}),
      styleSetters: { field: vi.fn() },
    });
    expect(renderDelegatedStylePanel(ui, "dataOnly")).toBeNull();
  });

  it("renders the opacity slider defaulting to 100", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const range = panel.querySelector(
      ".foliplus-style-opacity-range",
    ) as HTMLInputElement;
    expect(range).not.toBeNull();
    expect(range.type).toBe("range");
    expect(range.min).toBe("0");
    expect(range.max).toBe("100");
    expect(range.step).toBe("1");
    expect(range.value).toBe("100");
  });

  it("an opacity change applies to the layer and persists", () => {
    const li = manager.layerRegistry.get("overlay1")!;
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const range = panel.querySelector(
      ".foliplus-style-opacity-range",
    ) as HTMLInputElement;

    range.value = "60";
    range.dispatchEvent(new Event("input", { bubbles: true }));

    expect(li.opacity).toBe(0.6);
    expect(getIntent(ui, "overlay1", "opacity")).toBe(0.6);
  });

  it("commitOpacityPct re-syncs the no-basemap hatch for base layers", () => {
    // Dragging the only basemap to opacity=0 leaves it visually empty — the
    // hatch has to light up, which happens only if commitOpacityPct fires
    // syncNoBasemap. Overlay opacity is unrelated, so a base-vs-overlay
    // toggle must be observable.
    const toggleSpy = vi.fn();
    vi.spyOn(ui.m.map, "getContainer").mockImplementation(
      () => ({ classList: { toggle: toggleSpy } }) as unknown as HTMLElement,
    );
    try {
      const item = findItem(ui, "base1");
      ui.openStylePanel("base1");
      const range = panelOf(item)!.querySelector(
        ".foliplus-style-opacity-range",
      ) as HTMLInputElement;
      range.value = "0";
      range.dispatchEvent(new Event("input", { bubbles: true }));
      const baseCalls = toggleSpy.mock.calls.filter(
        c => c[0] === CONST.CLASSES.NO_BASE_MAP,
      );
      expect(baseCalls.length).toBeGreaterThan(0);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("commitOpacityPct skips the hatch sync for overlays", () => {
    const toggleSpy = vi.fn();
    vi.spyOn(ui.m.map, "getContainer").mockImplementation(
      () => ({ classList: { toggle: toggleSpy } }) as unknown as HTMLElement,
    );
    try {
      const item = findItem(ui, "overlay1");
      ui.openStylePanel("overlay1");
      const range = panelOf(item)!.querySelector(
        ".foliplus-style-opacity-range",
      ) as HTMLInputElement;
      range.value = "0";
      range.dispatchEvent(new Event("input", { bubbles: true }));
      const calls = toggleSpy.mock.calls.filter(
        c => c[0] === CONST.CLASSES.NO_BASE_MAP,
      );
      expect(calls).toEqual([]);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("resetLayerOpacity re-syncs the hatch for base layers", () => {
    // Resetting a basemap that was at 0 back to 1 flips the hatch off.
    // Same invariant as commitOpacityPct: base → sync, overlay → skip.
    const toggleSpy = vi.fn();
    vi.spyOn(ui.m.map, "getContainer").mockImplementation(
      () => ({ classList: { toggle: toggleSpy } }) as unknown as HTMLElement,
    );
    try {
      const li = manager.layerRegistry.get("base1")!;
      setIntent(ui, "base1", "opacity", 0);
      li.opacity = 0;
      resetLayerOpacity(ui, "base1");
      const calls = toggleSpy.mock.calls.filter(
        c => c[0] === CONST.CLASSES.NO_BASE_MAP,
      );
      expect(calls.length).toBeGreaterThan(0);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("resetLayerOpacity skips the hatch sync for overlays", () => {
    const toggleSpy = vi.fn();
    vi.spyOn(ui.m.map, "getContainer").mockImplementation(
      () => ({ classList: { toggle: toggleSpy } }) as unknown as HTMLElement,
    );
    try {
      const li = manager.layerRegistry.get("overlay1")!;
      setIntent(ui, "overlay1", "opacity", 0);
      li.opacity = 0;
      resetLayerOpacity(ui, "overlay1");
      const calls = toggleSpy.mock.calls.filter(
        c => c[0] === CONST.CLASSES.NO_BASE_MAP,
      );
      expect(calls).toEqual([]);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("reopening the panel seeds the opacity slider from intents.opacity", () => {
    const li = manager.layerRegistry.get("overlay1")!;
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const range = panelOf(item)!.querySelector(
      ".foliplus-style-opacity-range",
    ) as HTMLInputElement;
    range.value = "25";
    range.dispatchEvent(new Event("input", { bubbles: true }));
    ui.closeStylePanel(false);

    ui.openStylePanel("overlay1");
    const reopened = panelOf(item)!;
    expect(
      (reopened.querySelector(".foliplus-style-opacity-range") as HTMLInputElement)
        .value,
    ).toBe("25");
    expect(
      fillPct(reopened.querySelector(".foliplus-style-opacity-fill") as HTMLElement),
    ).toBeCloseTo(0.25);
  });

  it("paints the row at 100% when nothing stored an opacity yet", () => {
    // Neither the persisted map nor the registry entry carries a value — the
    // fresh-open path must still paint a full slider rather than NaN/empty.
    const li = manager.layerRegistry.get("overlay1")!;
    delete (li as { opacity?: number }).opacity;
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;

    const range = panel.querySelector(
      ".foliplus-style-opacity-range",
    ) as HTMLInputElement;
    const fill = panel.querySelector(".foliplus-style-opacity-fill") as HTMLElement;
    expect(range.value).toBe("100");
  });

  it("omits the opacity row for a surface that cannot carry it (delegated)", () => {
    // MarkerCluster duck: `_topClusterLevel` triggers `opacity: "none"`.
    // The delegated label controls must still render — the panel is not
    // empty, only the opacity row is gone.
    manager.registerLayer({
      id: "cluster1",
      name: "Cluster",
      layer: { options: {}, eachLayer: vi.fn(), _topClusterLevel: {} } as never,
      styleProvider: () => ({ labelShow: true, labelSize: 14, labelColor: "#ff0000" }),
      styleSetters: { labelShow: vi.fn(), labelSize: vi.fn(), labelColor: vi.fn() },
    });
    const item = findItem(ui, "cluster1");
    ui.openStylePanel("cluster1");
    const panel = panelOf(item)!;

    // No opacity row at all.
    expect(panel.querySelector(".foliplus-style-opacity-range")).toBeNull();
    expect(panel.querySelector(".foliplus-style-opacity-number")).toBeNull();
    // The delegated label controls are still there.
    expect(panel.querySelector(".foliplus-style-label-size-input")).not.toBeNull();
    expect(panel.querySelector(".foliplus-style-label-color-input")).not.toBeNull();
  });

  it("omits the opacity row for a surface that cannot carry it (annotation)", () => {
    // Same duck, but the annotation panel (not delegated). The field/format/
    // collide rows must still render.
    manager.registerLayer({
      id: "cluster2",
      name: "Cluster2",
      layer: { options: {}, eachLayer: vi.fn(), _topClusterLevel: {} } as never,
    });
    ui.fieldCache.set("cluster2", [{ name: "count", numeric: true }]);
    // The cluster's own probe finds no labelable leaves (empty eachLayer),
    // but this test pins the OPACITY carrier — the Label section stands in
    // for "a panel exists at all", so declare the label bit by hand.
    const clusterLi = manager.layerRegistry.get("cluster2")!;
    const clusterSurface = manager.surfaceFor(clusterLi) as unknown as {
      capabilities: Record<string, unknown>;
    };
    clusterSurface.capabilities = {
      ...clusterSurface.capabilities,
      annotation: "pane",
    };
    const item = findItem(ui, "cluster2");
    ui.openStylePanel("cluster2");
    const panel = panelOf(item)!;

    expect(panel.querySelector(".foliplus-style-opacity-range")).toBeNull();
    expect(panel.querySelector(".foliplus-style-opacity-number")).toBeNull();
    // Annotation rows are still there.
    expect(panel.querySelector(".foliplus-style-field-select")).not.toBeNull();
    expect(panel.querySelector(".foliplus-style-label-color-input")).not.toBeNull();
  });
});

describe("LayerUI style panel — zoom range", () => {
  let manager: LayerManager;
  let ui: LayerUI;
  let map: any;

  beforeEach(() => {
    ({ manager, ui, map } = initFixture());
    ui.foldedGroups = new Set();
    seedIntentMap(ui, "visible", {});
    window.localStorage.removeItem(CONST.STORAGE.KEY);
    ui.fieldCache.set("overlay1", [{ name: "count", numeric: true }]);
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  const panelOf = (item: HTMLElement): HTMLElement | undefined =>
    (item.querySelector(`.${CONST.CLASSES.STYLE_PANEL}`) as HTMLElement | null) ??
    undefined;

  const zoomRowOf = (panel: HTMLElement): HTMLElement | null =>
    panel.querySelector(`.${CONST.CLASSES.STYLE_ZOOM_RANGE_ROW}`);

  it("renders the zoom-range row for a pane-capable layer", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const row = zoomRowOf(panel);
    expect(row).not.toBeNull();
  });

  it("renders the fill, three dots, two handles and the values row", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const row = zoomRowOf(panelOf(item)!)!;
    expect(row.querySelector(`.${CONST.CLASSES.STYLE_ZOOM_RANGE_FILL}`)).not.toBeNull();
    expect(row.querySelectorAll(`.${CONST.CLASSES.STYLE_ZOOM_RANGE_DOT}`).length).toBe(
      3,
    );
    expect(row.querySelector(`.${CONST.CLASSES.STYLE_ZOOM_RANGE_MIN}`)).not.toBeNull();
    expect(row.querySelector(`.${CONST.CLASSES.STYLE_ZOOM_RANGE_MAX}`)).not.toBeNull();
    const spans = row.querySelectorAll(`.${CONST.CLASSES.STYLE_ZOOM_RANGE_VAL} span`);
    expect(spans.length).toBe(3);
    expect(
      spans[1].classList.contains(CONST.CLASSES.STYLE_ZOOM_RANGE_CURRENT_VALUE),
    ).toBe(true);
  });

  it("shows out-of-range class when current zoom is outside the range", () => {
    const item = findItem(ui, "overlay1");
    setIntent(ui, "overlay1", "zoomRange", [0, 3]);
    ui.openStylePanel("overlay1");
    const row = zoomRowOf(panelOf(item)!)!;
    expect(row.classList.contains(CONST.CLASSES.STYLE_ZOOM_RANGE_OUT_OF_RANGE)).toBe(
      true,
    );
  });

  it("does not show out-of-range class when current zoom is inside the range", () => {
    const item = findItem(ui, "overlay1");
    setIntent(ui, "overlay1", "zoomRange", [0, 18]);
    ui.openStylePanel("overlay1");
    const row = zoomRowOf(panelOf(item)!)!;
    expect(row.classList.contains(CONST.CLASSES.STYLE_ZOOM_RANGE_OUT_OF_RANGE)).toBe(
      false,
    );
  });

  it("input event updates map state and visual row (live pass)", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const row = zoomRowOf(panel)!;
    const minInput = row.querySelector(
      `.${CONST.CLASSES.STYLE_ZOOM_RANGE_MIN}`,
    ) as HTMLInputElement;

    minInput.value = "5";
    minInput.dispatchEvent(new Event("input", { bubbles: true }));

    expect(getIntent(ui, "overlay1", "zoomRange")).toEqual([5, 18]);
  });

  it("change event persists the range to localStorage", () => {
    vi.useFakeTimers();
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const row = zoomRowOf(panel)!;
    const minInput = row.querySelector(
      `.${CONST.CLASSES.STYLE_ZOOM_RANGE_MIN}`,
    ) as HTMLInputElement;

    minInput.value = "5";
    minInput.dispatchEvent(new Event("input", { bubbles: true }));
    minInput.dispatchEvent(new Event("change", { bubbles: true }));

    vi.advanceTimersByTime(400);
    const stored = JSON.parse(window.localStorage.getItem(CONST.STORAGE.KEY) ?? "{}");
    expect(stored.layers?.overlay1?.overrides).toContain("zoomRange");
    expect(stored.layers?.overlay1?.zoomRange).toEqual([5, 18]);
    vi.useRealTimers();
  });

  it("clamps min to max when min exceeds max", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const row = zoomRowOf(panel)!;
    const minInput = row.querySelector(
      `.${CONST.CLASSES.STYLE_ZOOM_RANGE_MIN}`,
    ) as HTMLInputElement;
    const maxInput = row.querySelector(
      `.${CONST.CLASSES.STYLE_ZOOM_RANGE_MAX}`,
    ) as HTMLInputElement;

    minInput.value = "18";
    maxInput.value = "10";
    minInput.dispatchEvent(new Event("input", { bubbles: true }));

    expect(getIntent(ui, "overlay1", "zoomRange")).toEqual([10, 10]);
  });

  it("clamps max to min when max falls below min", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const row = zoomRowOf(panel)!;
    const minInput = row.querySelector(
      `.${CONST.CLASSES.STYLE_ZOOM_RANGE_MIN}`,
    ) as HTMLInputElement;
    const maxInput = row.querySelector(
      `.${CONST.CLASSES.STYLE_ZOOM_RANGE_MAX}`,
    ) as HTMLInputElement;

    minInput.value = "10";
    maxInput.value = "5";
    maxInput.dispatchEvent(new Event("input", { bubbles: true }));

    expect(getIntent(ui, "overlay1", "zoomRange")).toEqual([10, 10]);
  });

  it("clamps zoom values to map bounds", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const row = zoomRowOf(panel)!;
    const minInput = row.querySelector(
      `.${CONST.CLASSES.STYLE_ZOOM_RANGE_MIN}`,
    ) as HTMLInputElement;

    minInput.value = "-5";
    minInput.dispatchEvent(new Event("input", { bubbles: true }));

    const range = getIntent(ui, "overlay1", "zoomRange");
    expect(range![0]).toBeGreaterThanOrEqual(0);
  });

  it("moves the current dot on zoomend", () => {
    const item = findItem(ui, "overlay1");
    let zoomEndHandler: (() => void) | null = null;
    const origOn = map.on;
    map.on = (evt: string, fn: () => void) => {
      if (evt === "zoomend") zoomEndHandler = fn;
      return origOn(evt, fn);
    };
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const row = zoomRowOf(panel)!;
    const dot = row.querySelector(
      ".foliplus-style-zoom-range-dot-current",
    ) as HTMLElement;
    const before = dot.style.left;

    map.getZoom.mockReturnValue(12);
    zoomEndHandler?.();

    const after = dot.style.left;
    expect(before).not.toBe(after);
    map.on = origOn;
  });

  it("updates values row on zoomend", () => {
    const item = findItem(ui, "overlay1");
    setIntent(ui, "overlay1", "zoomRange", [0, 18]);
    let zoomEndHandler: (() => void) | null = null;
    const origOn = map.on;
    map.on = (evt: string, fn: () => void) => {
      if (evt === "zoomend") zoomEndHandler = fn;
      return origOn(evt, fn);
    };
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const row = zoomRowOf(panel)!;
    const spans = row.querySelectorAll(`.${CONST.CLASSES.STYLE_ZOOM_RANGE_VAL} span`);
    const beforeCurrent = spans[1].textContent;

    map.getZoom.mockReturnValue(12);
    zoomEndHandler?.();

    const afterCurrent = spans[1].textContent;
    expect(afterCurrent).toBe("12");
    expect(beforeCurrent).not.toBe(afterCurrent);
    map.on = origOn;
  });

  it("renders the zoom-range row for a canvas layer", () => {
    // A canvas has no Leaflet layer to add/remove, so the range's carrier is
    // the canvas's `HIDDEN` class — the executor's visible op is the carrier
    // for every surface, so capability alone decides (42.1).
    manager.registerLayer({
      id: "canvas1",
      name: "Canvas",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true }),
      styleSetters: { labelShow: vi.fn() },
    });
    const panel = renderDelegatedStylePanel(ui, "canvas1");
    expect(panel).not.toBeNull();
    expect(zoomRowOf(panel!)).not.toBeNull();
  });

  it("hides a canvas layer through its HIDDEN class when the range excludes the zoom", () => {
    const canvas = document.createElement("canvas");
    manager.registerLayer({
      id: "canvas1",
      name: "Canvas",
      canvas,
      styleProvider: () => ({ labelShow: true }),
      styleSetters: { labelShow: vi.fn() },
    });
    const item = findItem(ui, "canvas1");
    ui.openStylePanel("canvas1");
    const row = zoomRowOf(panelOf(item)!)!;
    const minInput = row.querySelector(
      `.${CONST.CLASSES.STYLE_ZOOM_RANGE_MIN}`,
    ) as HTMLInputElement;

    // The current zoom is 5. Pushing the lower bound past it takes the canvas
    // out of range, and its HIDDEN class is what hides it.
    minInput.value = "6";
    minInput.dispatchEvent(new Event("input", { bubbles: true }));
    expect(getIntent(ui, "canvas1", "zoomRange")).toEqual([6, 18]);
    expect(canvas.classList.contains("hidden")).toBe(true);

    // Dragging the bound back drops it again — the write is reversible.
    minInput.value = "0";
    minInput.dispatchEvent(new Event("input", { bubbles: true }));
    expect(getIntent(ui, "canvas1", "zoomRange")).toEqual([0, 18]);
    expect(canvas.classList.contains("hidden")).toBe(false);
  });

  it("gives a delegated layers-kind layer (Measure shape) a zoom row that hides it", () => {
    // Measure's createLayers shape: a real layer, so the range's carrier is map
    // membership rather than a canvas HIDDEN class.
    const measureLayer = { options: {}, eachLayer: vi.fn() } as never;
    manager.registerLayer({
      id: "measure1",
      name: "Measure",
      layer: measureLayer,
      styleProvider: () => ({ labelShow: true }),
      styleSetters: { labelShow: vi.fn() },
    });
    const item = findItem(ui, "measure1");
    ui.openStylePanel("measure1");
    const row = zoomRowOf(panelOf(item)!)!;
    const minInput = row.querySelector(
      `.${CONST.CLASSES.STYLE_ZOOM_RANGE_MIN}`,
    ) as HTMLInputElement;

    minInput.value = "6";
    minInput.dispatchEvent(new Event("input", { bubbles: true }));

    expect(getIntent(ui, "measure1", "zoomRange")).toEqual([6, 18]);
    expect(map.removeLayer).toHaveBeenCalledWith(measureLayer);
  });

  it("gives the fixture's tile base layer a zoom row: the GridLayer native min/maxZoom is the carrier", () => {
    // T190 — the old `li.group !== "base"` blanket was dropped; the fixture's base1 is
    // a TileLayer (GridLayer subclass) whose options.minZoom/maxZoom are the
    // honest carrier, so the row now renders for it just like any overlay.
    const item = findItem(ui, "base1");
    ui.openStylePanel("base1");
    const panel = panelOf(item);
    if (!panel) return;
    const row = zoomRowOf(panel);
    expect(row).not.toBeNull();
  });

  it("reset button clears zoom range and restores full map range", () => {
    const item = findItem(ui, "overlay1");
    setIntent(ui, "overlay1", "zoomRange", [5, 15]);
    ui.intentProvenance["overlay1"] = ["zoomRange"];
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const resetBtn = panel.querySelector(
      ".foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    resetBtn.click();

    expect(getIntent(ui, "overlay1", "zoomRange")).toBeUndefined();
    expect(ui.intentProvenance["overlay1"]).toBeUndefined();
  });

  it("zoomToPct returns 0 when map min equals max (degenerate range)", () => {
    map.getMinZoom.mockReturnValue(7);
    map.getMaxZoom.mockReturnValue(7);
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const row = zoomRowOf(panelOf(item)!)!;
    expect(row).not.toBeNull();
  });

  it("renders zoom-range row when map has a single zoom level", () => {
    map.getMinZoom.mockReturnValue(3);
    map.getMaxZoom.mockReturnValue(3);
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const row = zoomRowOf(panelOf(item)!)!;
    expect(row).not.toBeNull();
    const minInput = row.querySelector(
      `.${CONST.CLASSES.STYLE_ZOOM_RANGE_MIN}`,
    ) as HTMLInputElement;
    const maxInput = row.querySelector(
      `.${CONST.CLASSES.STYLE_ZOOM_RANGE_MAX}`,
    ) as HTMLInputElement;
    expect(minInput.value).toBe("3");
    expect(maxInput.value).toBe("3");
  });

  it("delegated panel includes zoom-range row when capability is present", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const hasRow = panel.querySelector(`.${CONST.CLASSES.STYLE_ZOOM_RANGE_ROW}`);
    expect(hasRow).not.toBeNull();
  });

  it("the live pass (input) drives the opacity row and floats the value", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const range = panel.querySelector(
      `.${CONST.CLASSES.STYLE_OPACITY_RANGE}`,
    ) as HTMLInputElement;
    const fill = panel.querySelector(
      `.${CONST.CLASSES.STYLE_OPACITY_FILL}`,
    ) as HTMLElement;
    const rail = panel.querySelector(
      `.${CONST.CLASSES.STYLE_OPACITY_RAIL}`,
    ) as HTMLElement;

    range.value = "40";
    range.dispatchEvent(new Event("input", { bubbles: true }));

    // The live pass moves the fill and shows the value above the handle.
    expect(fill.style.width).toBe("40%");
    const bubble = rail.querySelector(
      `.${CONST.CLASSES.SLIDER_BUBBLE}`,
    ) as HTMLElement | null;
    expect(bubble).not.toBeNull();
    expect(bubble!.textContent).toBe("40");

    // A second live pass reuses that bubble instead of stacking another.
    range.value = "60";
    range.dispatchEvent(new Event("input", { bubbles: true }));
    expect(rail.querySelectorAll(`.${CONST.CLASSES.SLIDER_BUBBLE}`).length).toBe(1);
    expect(bubble!.textContent).toBe("60");

    // The settle pass takes it away again.
    range.dispatchEvent(new Event("change", { bubbles: true }));
    expect(rail.querySelector(`.${CONST.CLASSES.SLIDER_BUBBLE}`)).toBeNull();
  });

  it("ignores a live value that does not parse", () => {
    const li = manager.layerRegistry.get("overlay1")!;
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const range = panel.querySelector(
      `.${CONST.CLASSES.STYLE_OPACITY_RANGE}`,
    ) as HTMLInputElement;
    const rail = panel.querySelector(
      `.${CONST.CLASSES.STYLE_OPACITY_RAIL}`,
    ) as HTMLElement;
    const before = li.opacity;

    // A range input refuses to hold a non-numeric value — it falls back to the
    // mid-point — so the guard is reached through a field that kept the
    // slider's class but no longer constrains its value, the shape a
    // consumer's hand-edited markup has. It must not write through.
    range.type = "text";
    range.value = "abc";
    range.dispatchEvent(new Event("input", { bubbles: true }));

    expect(li.opacity).toBe(before);
    expect(rail.querySelector(`.${CONST.CLASSES.SLIDER_BUBBLE}`)).toBeNull();
  });

  it("a single-level map yields a zero percentage rather than NaN", () => {
    map.getMinZoom.mockReturnValue(7);
    map.getMaxZoom.mockReturnValue(7);
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const row = zoomRowOf(panelOf(item)!)!;
    const minInput = row.querySelector(
      `.${CONST.CLASSES.STYLE_ZOOM_RANGE_MIN}`,
    ) as HTMLInputElement;

    minInput.value = "7";
    minInput.dispatchEvent(new Event("change", { bubbles: true }));

    const labels = row.querySelector(`.${CONST.CLASSES.STYLE_ZOOM_RANGE_VAL}`)!;
    expect(labels.textContent).not.toMatch(/NaN/);
  });

  it("keeps working when the row has lost its painted parts", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const row = zoomRowOf(panelOf(item)!)!;

    // Every sync guards these lookups, so removing them must not throw — a row
    // that a consumer emptied (or a stale panel) still answers a change.
    row.querySelector(`.${CONST.CLASSES.STYLE_ZOOM_RANGE_FILL}`)?.remove();
    row.querySelector(`.${CONST.CLASSES.STYLE_ZOOM_RANGE_DOT}-current`)?.remove();
    row.querySelector(`.${CONST.CLASSES.STYLE_ZOOM_RANGE_VAL}`)?.replaceChildren();
    const minInput = row.querySelector(
      `.${CONST.CLASSES.STYLE_ZOOM_RANGE_MIN}`,
    ) as HTMLInputElement;

    expect(() => {
      minInput.value = "4";
      minInput.dispatchEvent(new Event("change", { bubbles: true }));
    }).not.toThrow();
    expect(getIntent(ui, "overlay1", "zoomRange")).toEqual([4, map.getMaxZoom()]);
  });

  it("the zoom-range live pass updates the map and the bubble", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const row = zoomRowOf(panelOf(item)!)!;
    const rail = row.querySelector(
      `.${CONST.CLASSES.STYLE_ZOOM_RANGE_TRACK}`,
    ) as HTMLElement;
    const maxInput = row.querySelector(
      `.${CONST.CLASSES.STYLE_ZOOM_RANGE_MAX}`,
    ) as HTMLInputElement;

    maxInput.value = "10";
    maxInput.dispatchEvent(new Event("input", { bubbles: true }));

    expect(getIntent(ui, "overlay1", "zoomRange")).toEqual([0, 10]);
    const bubble = rail.querySelector(
      `.${CONST.CLASSES.SLIDER_BUBBLE}`,
    ) as HTMLElement | null;
    expect(bubble).not.toBeNull();
    expect(bubble!.textContent).toBe("10");

    maxInput.dispatchEvent(new Event("change", { bubbles: true }));
    expect(rail.querySelector(`.${CONST.CLASSES.SLIDER_BUBBLE}`)).toBeNull();
  });

  it("OOR state marks the row when current zoom is outside range", () => {
    const item = findItem(ui, "overlay1");
    setIntent(ui, "overlay1", "zoomRange", [7, 10]);
    ui.openStylePanel("overlay1");
    const row = zoomRowOf(panelOf(item)!)!;

    // Current zoom (5) is outside [7, 10] — out-of-range state should be active.
    expect(row.classList.contains(CONST.CLASSES.STYLE_ZOOM_RANGE_OUT_OF_RANGE)).toBe(
      true,
    );
    expect(row.title).toContain("style_zoom_range_out_of_range");
  });

  it("out-of-range sync clears the class when zoom returns inside range", () => {
    const item = findItem(ui, "overlay1");
    setIntent(ui, "overlay1", "zoomRange", [7, 10]);
    ui.openStylePanel("overlay1");
    const row = zoomRowOf(panelOf(item)!)!;
    expect(row.classList.contains(CONST.CLASSES.STYLE_ZOOM_RANGE_OUT_OF_RANGE)).toBe(
      true,
    );

    // Move the range to cover current zoom (5) — OOR clears.
    const minInput = row.querySelector(
      `.${CONST.CLASSES.STYLE_ZOOM_RANGE_MIN}`,
    ) as HTMLInputElement;
    minInput.value = "0";
    minInput.dispatchEvent(new Event("input", { bubbles: true }));

    expect(row.classList.contains(CONST.CLASSES.STYLE_ZOOM_RANGE_OUT_OF_RANGE)).toBe(
      false,
    );
    expect(row.title).toBe("");
  });

  it("renders no Layer rows for a delegated layer that carries neither", () => {
    // MarkerCluster duck: opacity "none" and zoomRange "none". The delegated
    // label controls are the panel's whole content — the Layer section has
    // nothing to put in it.
    manager.registerLayer({
      id: "cluster3",
      name: "Cluster3",
      layer: { options: {}, eachLayer: vi.fn(), _topClusterLevel: {} } as never,
      styleProvider: () => ({ labelShow: true, labelSize: 14, labelColor: "#ff0000" }),
      styleSetters: { labelShow: vi.fn(), labelSize: vi.fn(), labelColor: vi.fn() },
    });
    const item = findItem(ui, "cluster3");
    ui.openStylePanel("cluster3");
    const panel = panelOf(item)!;

    expect(panel.querySelector(`.${CONST.CLASSES.STYLE_OPACITY_RANGE}`)).toBeNull();
    expect(zoomRowOf(panel)).toBeNull();
    expect(
      panel.querySelector(`.${CONST.CLASSES.STYLE_LABEL_SIZE_INPUT}`),
    ).not.toBeNull();
  });

  it("still commits when the opacity row has lost its rail and fill", () => {
    const li = manager.layerRegistry.get("overlay1")!;
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const range = panel.querySelector(
      `.${CONST.CLASSES.STYLE_OPACITY_RANGE}`,
    ) as HTMLInputElement;

    // The handle outlives the rail it was drawn in, and the rail took the fill
    // and the dots with it. Neither ornament carries the value — the input does,
    // so the write still has to land.
    panel.appendChild(range);
    panel.querySelector(`.${CONST.CLASSES.STYLE_OPACITY_RAIL}`)?.remove();
    range.value = "30";
    range.dispatchEvent(new Event("input", { bubbles: true }));

    expect(panel.querySelector(`.${CONST.CLASSES.STYLE_OPACITY_FILL}`)).toBeNull();
    expect(li.opacity).toBe(0.3);
    expect(panel.querySelector(`.${CONST.CLASSES.SLIDER_BUBBLE}`)).toBeNull();
  });

  it("resets the range when the row has lost a handle", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const row = zoomRowOf(panel)!;
    setIntent(ui, "overlay1", "zoomRange", [4, 9]);
    row.querySelector(`.${CONST.CLASSES.STYLE_ZOOM_RANGE_MAX}`)?.remove();

    // The reset pass syncs the row's remaining marks, so a missing handle has to
    // be skipped rather than dereferenced — and the click still has to reach the
    // panel close at the end of the handler.
    const reset = panel.querySelector(".foliplus-style-reset-btn")!;
    reset.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(getIntent(ui, "overlay1", "zoomRange")).toBeUndefined();
    expect(panelOf(item)).toBeUndefined();
  });

  it("skips a layer that was unregistered mid-drag", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const row = zoomRowOf(panel)!;
    const minInput = row.querySelector(
      `.${CONST.CLASSES.STYLE_ZOOM_RANGE_MIN}`,
    ) as HTMLInputElement;

    minInput.value = "4";
    minInput.dispatchEvent(new Event("change", { bubbles: true }));
    expect(getIntent(ui, "overlay1", "zoomRange")).toEqual([4, 18]);

    // The row outlives its layer: nothing is left to write the range into, so
    // the live pass has to bail instead of writing a range for a ghost.
    manager.unregisterLayer("overlay1");
    minInput.value = "6";
    minInput.dispatchEvent(new Event("change", { bubbles: true }));

    expect(getIntent(ui, "overlay1", "zoomRange")).toEqual([4, 18]);
  });

  it("gives a delegated layer a zoom row when only opacity is unavailable", () => {
    manager.registerLayer({
      id: "rangeOnly",
      name: "RangeOnly",
      layer: { options: {}, eachLayer: vi.fn() },
      styleProvider: () => ({ labelShow: true }),
      styleSetters: { labelShow: vi.fn() },
    });
    // `detectCapabilities` never returns an opacity-less surface that can still
    // carry a zoom range, so the two gates' independence is pinned by hand: each
    // row answers to its own capability, never to its neighbor's.
    const li = manager.layerRegistry.get("rangeOnly")!;
    manager.surfaceFor(li).capabilities.opacity = "none";

    const item = findItem(ui, "rangeOnly");
    ui.openStylePanel("rangeOnly");
    const panel = panelOf(item)!;

    expect(panel.querySelector(`.${CONST.CLASSES.STYLE_OPACITY_RANGE}`)).toBeNull();
    expect(zoomRowOf(panel)).not.toBeNull();
  });

  it("gives an annotation layer a zoom row when only opacity is unavailable", () => {
    // Same split, annotation flavour: the panel still offers the zoom range.
    manager.registerLayer({
      id: "annotOnly",
      name: "AnnotOnly",
      layer: { options: {}, eachLayer: vi.fn() },
    });
    ui.fieldCache.set("annotOnly", [{ name: "count", numeric: true }]);
    const li = manager.layerRegistry.get("annotOnly")!;
    manager.surfaceFor(li).capabilities.opacity = "none";

    const item = findItem(ui, "annotOnly");
    ui.openStylePanel("annotOnly");
    const panel = panelOf(item)!;

    expect(panel.querySelector(`.${CONST.CLASSES.STYLE_OPACITY_RANGE}`)).toBeNull();
    expect(zoomRowOf(panel)).not.toBeNull();
  });

  it("ignores a range change once the row is out of the panel", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const row = zoomRowOf(panel)!;
    const minInput = row.querySelector(
      `.${CONST.CLASSES.STYLE_ZOOM_RANGE_MIN}`,
    ) as HTMLInputElement;

    minInput.value = "4";
    minInput.dispatchEvent(new Event("change", { bubbles: true }));
    expect(getIntent(ui, "overlay1", "zoomRange")).toEqual([4, 18]);

    // A handle whose row is gone still bubbles to the panel it was built in;
    // with no row to read there is nothing to write.
    panel.appendChild(minInput);
    row.remove();
    minInput.value = "6";
    minInput.dispatchEvent(new Event("change", { bubbles: true }));

    expect(getIntent(ui, "overlay1", "zoomRange")).toEqual([4, 18]);
  });

  it("reuses the range bubble and keeps the range when the rail is gone", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const row = zoomRowOf(panel)!;
    const track = row.querySelector(
      `.${CONST.CLASSES.STYLE_ZOOM_RANGE_TRACK}`,
    ) as HTMLElement;
    const minInput = row.querySelector(
      `.${CONST.CLASSES.STYLE_ZOOM_RANGE_MIN}`,
    ) as HTMLInputElement;
    const maxInput = row.querySelector(
      `.${CONST.CLASSES.STYLE_ZOOM_RANGE_MAX}`,
    ) as HTMLInputElement;

    minInput.value = "4";
    minInput.dispatchEvent(new Event("input", { bubbles: true }));
    maxInput.value = "9";
    maxInput.dispatchEvent(new Event("input", { bubbles: true }));

    // One bubble, moved to the handle being held — not one per live pass.
    const bubbles = track.querySelectorAll(`.${CONST.CLASSES.SLIDER_BUBBLE}`);
    expect(bubbles.length).toBe(1);
    expect(bubbles[0].textContent).toBe("9");

    // The rail is only the readout's host: losing it costs the bubble, not the
    // range.
    row.appendChild(minInput);
    row.appendChild(maxInput);
    track.remove();
    minInput.value = "3";
    minInput.dispatchEvent(new Event("input", { bubbles: true }));

    expect(getIntent(ui, "overlay1", "zoomRange")).toEqual([3, 9]);
  });

  // The two slider ends read the layer's author-declared bounds from the
  // WeakMap snapshot in apply.ts, not from `layer.options.maxZoom` (or
  // minZoom) directly — the map's max can change after the bounds are
  // frozen, and the slider must track the author's declaration, not the
  // map's current state. The tests below cover the freeze, the finite
  // fallback when the layer declares nothing, and the persistence-replay
  // path.
  it("the slider's max bound is the layer's declared maxZoom, not the map's", () => {
    const li = manager.layerRegistry.get("base1")!;
    (li.layer!.options as { maxZoom?: number }).maxZoom = 15;
    map.getMaxZoom.mockReturnValue(18);
    const item = findItem(ui, "base1");
    ui.openStylePanel("base1");
    const row = zoomRowOf(panelOf(item)!)!;
    const maxInput = row.querySelector(
      `.${CONST.CLASSES.STYLE_ZOOM_RANGE_MAX}`,
    ) as HTMLInputElement;
    expect(maxInput.max).toBe("15");
  });

  it("does not ratchet the slider's max when the map derives from the write", () => {
    // If applyStateOp wrote layer.options.maxZoom, Leaflet would derive
    // the map's max from the layer's max, and the map's max would drop to
    // the last drag. The WeakMap snapshot prevents the slider from
    // re-reading the polluted value. The mock simulates the pollution.
    const li = manager.layerRegistry.get("base1")!;
    (li.layer!.options as { maxZoom?: number }).maxZoom = 15;
    map.getMaxZoom.mockReturnValue(18);
    const item = findItem(ui, "base1");
    ui.openStylePanel("base1");
    const row = zoomRowOf(panelOf(item)!)!;
    const maxInput = row.querySelector(
      `.${CONST.CLASSES.STYLE_ZOOM_RANGE_MAX}`,
    ) as HTMLInputElement;
    expect(maxInput.max).toBe("15");

    maxInput.value = "10";
    maxInput.dispatchEvent(new Event("input", { bubbles: true }));
    // Polluted map max after the drag — the ratchet case.
    map.getMaxZoom.mockReturnValue(10);
    ui.m.onZoomend?.();
    // Reopen the panel and check the bound has not been narrowed.
    ui.closeStylePanel?.();
    ui.openStylePanel("base1");
    const newRow = zoomRowOf(panelOf(item)!)!;
    const newMaxInput = newRow.querySelector(
      `.${CONST.CLASSES.STYLE_ZOOM_RANGE_MAX}`,
    ) as HTMLInputElement;
    expect(newMaxInput.max).toBe("15");
  });

  it("falls back to a finite max when the layer and the map both declare none", () => {
    // A bare TileLayer without options.maxZoom reports Infinity from
    // map.getMaxZoom() in real Leaflet. The values row would print the
    // literal string "Infinity" and the slider would have an unbounded
    // right end; both are fixed by the finite fallback.
    const li = manager.layerRegistry.get("base1")!;
    delete (li.layer!.options as { maxZoom?: number }).maxZoom;
    map.getMaxZoom.mockReturnValue(Infinity);
    const item = findItem(ui, "base1");
    ui.openStylePanel("base1");
    const row = zoomRowOf(panelOf(item)!)!;
    const maxInput = row.querySelector(
      `.${CONST.CLASSES.STYLE_ZOOM_RANGE_MAX}`,
    ) as HTMLInputElement;
    expect(maxInput.max).not.toBe("Infinity");
    expect(Number(maxInput.max)).toBe(20);
    const spans = row.querySelectorAll(`.${CONST.CLASSES.STYLE_ZOOM_RANGE_VAL} span`);
    expect(spans[2]!.textContent).not.toBe("Infinity");
  });

  it("the slider's min bound is the layer's declared minZoom, not the map's", () => {
    const li = manager.layerRegistry.get("base1")!;
    (li.layer!.options as { minZoom?: number }).minZoom = 2;
    map.getMinZoom.mockReturnValue(0);
    const item = findItem(ui, "base1");
    ui.openStylePanel("base1");
    const row = zoomRowOf(panelOf(item)!)!;
    const minInput = row.querySelector(
      `.${CONST.CLASSES.STYLE_ZOOM_RANGE_MIN}`,
    ) as HTMLInputElement;
    expect(minInput.min).toBe("2");
  });

  it("does not ratchet the slider's min when the map derives from the write", () => {
    const li = manager.layerRegistry.get("base1")!;
    (li.layer!.options as { minZoom?: number }).minZoom = 3;
    map.getMinZoom.mockReturnValue(0);
    const item = findItem(ui, "base1");
    ui.openStylePanel("base1");
    const row = zoomRowOf(panelOf(item)!)!;
    const minInput = row.querySelector(
      `.${CONST.CLASSES.STYLE_ZOOM_RANGE_MIN}`,
    ) as HTMLInputElement;
    expect(minInput.min).toBe("3");

    minInput.value = "7";
    minInput.dispatchEvent(new Event("input", { bubbles: true }));
    map.getMinZoom.mockReturnValue(7);
    ui.closeStylePanel?.();
    ui.openStylePanel("base1");
    const newRow = zoomRowOf(panelOf(item)!)!;
    const newMinInput = newRow.querySelector(
      `.${CONST.CLASSES.STYLE_ZOOM_RANGE_MIN}`,
    ) as HTMLInputElement;
    expect(newMinInput.min).toBe("3");
  });

  it("persistence replay: slider bounds are the author's declared range, not the persisted zoomRange", () => {
    // On reload, applyUserState fires applyProjection before any panel opens.
    // The zoomRange resolves through the visible op — no write to
    // layer.options — so the author's declared bounds are never mutated.
    // The slider reads them on first panel open via the WeakMap snapshot.
    const gridLayer = new GridLayer();
    (gridLayer as unknown as { setOpacity: unknown }).setOpacity = vi.fn();
    manager.registerLayer({
      id: "grid1",
      name: "Grid",
      group: "overlay",
      layer: gridLayer,
    });
    // Author declared no maxZoom: the fallback is the map's declared max.
    setIntent(ui, "grid1", "zoomRange", [0, 10]);
    applyProjection(ui, "grid1");
    // The layer's options are untouched — the zoomRange did not write.
    expect((gridLayer.options as { maxZoom?: number }).maxZoom).toBeUndefined();
    const item = findItem(ui, "grid1");
    ui.openStylePanel("grid1");
    const row = zoomRowOf(panelOf(item)!)!;
    const maxInput = row.querySelector(
      `.${CONST.CLASSES.STYLE_ZOOM_RANGE_MAX}`,
    ) as HTMLInputElement;
    // The author declared no max, so it fell back to the map's 18 —
    // not the persisted zoomRange value of 10.
    expect(Number(maxInput.max)).toBe(18);
  });
});

describe("style utility guards", () => {
  it("clampPct falls back when the raw value is non-finite", () => {
    // Covers the `Number.isFinite(raw) ? ... : fallback` false side: an
    // emptied number field commits NaN, which the shared number field also
    // treats as an invalid commit (defaults to fully opaque / 100).
    expect(clampPct(NaN)).toBe(100);
    expect(clampPct(Infinity)).toBe(100);
    expect(clampPct(Number.POSITIVE_INFINITY)).toBe(100);
    // Custom fallback override.
    expect(clampPct(NaN, 40)).toBe(40);
    // Positive infinity is non-finite; -Infinity is also.
    expect(clampPct(-Infinity)).toBe(100);
    // In-range values still round + clamp.
    expect(clampPct(50)).toBe(50);
    expect(clampPct(-5)).toBe(0);
    expect(clampPct(105)).toBe(100);
  });

  it("renderDelegatedStylePanel returns null when the layer has no styleSetters", () => {
    // Covers the `!setters` branch of the early return: a layer that never
    // declared a setter has no delegation, so the drawer is not built.
    const { ui } = initFixture();
    // A plain overlay1 in the fixture has no styleSetters.
    expect(renderDelegatedStylePanel(ui, "overlay1")).toBeNull();
  });

  it("renderDelegatedStylePanel returns null when styleSetters is empty", () => {
    // Covers the `Object.keys(setters).length === 0` branch: a registry entry
    // that declares an empty setter map still falls through to the annotation
    // panel rather than opening an empty drawer.
    const { ui, manager } = initFixture();
    manager.registerLayer({
      id: "emptySetters",
      name: "Empty",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({}),
      styleSetters: {},
    });
    expect(renderDelegatedStylePanel(ui, "emptySetters")).toBeNull();
  });

  it("renderDelegatedStylePanel returns null when the layer is not registered", () => {
    // Covers the `li?.styleSetters` undefined access on a missing layer.
    const { ui } = initFixture();
    expect(renderDelegatedStylePanel(ui, "not-a-real-layer")).toBeNull();
  });

  it("toggle handler tolerates a panel with no body, field select, or format row", () => {
    // Covers the three defensive null checks in the annotation toggle handler:
    // `if (body)`, `fieldSel?.value ?? cfg.field`, and `if (fmtRow)`.
    // Removing the elements from the panel DOM exercises the false sides.
    const { ui } = initFixture();
    ui.fieldCache.set("overlay1", [{ name: "count", numeric: true }]);
    // The Label section needs the annotation capability (the gate no longer
    // reads the field cache).
    const li = ui.m.layerRegistry.get("overlay1")!;
    const surface = ui.m.surfaceFor(li) as unknown as {
      capabilities: Record<string, unknown>;
    };
    surface.capabilities = { ...surface.capabilities, annotation: "pane" };
    const panelOf = (item: HTMLElement) =>
      item.querySelector(`.${CONST.CLASSES.STYLE_PANEL}`) as HTMLElement | null;
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item);
    expect(panel).not.toBeNull();

    // Remove the body, field select, and format row.
    panel!.querySelector(`.${CONST.CLASSES.STYLE_BODY}`)?.remove();
    panel!.querySelector(".foliplus-style-field-select")?.remove();
    panel!.querySelector(`.${CONST.CLASSES.STYLE_FORMAT_ROW}`)?.remove();

    // Trigger the toggle.
    const toggle = panel!.querySelector(
      `.${CONST.CLASSES.STYLE_TOGGLE_INPUT}`,
    ) as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));

    // The patch is applied despite the missing elements.
    expect(ui.m.annotation.getConfig("overlay1")!.show).toBe(true);
  });

  it("annotation panel setup tolerates missing color/size inputs", () => {
    // Covers `if (colorEl)` and `if (sizeEl)` false sides in the panel setup.
    // We mock querySelector to return null for the color/size selectors so the
    // setup code skips the live-binding step.
    const { ui } = initFixture();
    ui.fieldCache.set("overlay1", [{ name: "count", numeric: true }]);
    const panelOf = (item: HTMLElement) =>
      item.querySelector(`.${CONST.CLASSES.STYLE_PANEL}`) as HTMLElement | null;
    const item = findItem(ui, "overlay1");
    // Mock querySelector to return null for the color/size selectors.
    const origQS = HTMLElement.prototype.querySelector;
    const colorSel = `.${CONST.CLASSES.STYLE_LABEL_COLOR_INPUT}`;
    const sizeSel = `.${CONST.CLASSES.STYLE_LABEL_SIZE_INPUT}`;
    vi.spyOn(HTMLElement.prototype, "querySelector").mockImplementation(function (
      this: HTMLElement,
      ...args
    ) {
      const sel = args[0] as string;
      if (sel === colorSel || sel === sizeSel) {
        return null;
      }
      return origQS.call(this, ...args);
    });
    // Open the panel (triggers setup code).
    ui.openStylePanel("overlay1");
    // Restore.
    vi.restoreAllMocks();
    // The panel still opens successfully.
    expect(panelOf(item)).not.toBeNull();
  });
});

describe("reset on an id the registry does not know", () => {
  it("resetLayerOpacity returns before touching state", () => {
    // `if (!ui.m.layerRegistry.has(layerId)) return` — a Reset aimed at a
    // layer that has already left must not rewrite the record or save.
    const { ui } = initFixture({});
    setIntent(ui, "ghost", "opacity", 0.4);
    ui.intentProvenance.ghost = ["opacity"];
    expect(() => resetLayerOpacity(ui, "ghost")).not.toThrow();
    expect(getIntent(ui, "ghost", "opacity")).toBe(0.4);
    expect(ui.intentProvenance.ghost).toEqual(["opacity"]);
  });

  it("resetLayerZoomRange returns before touching state", () => {
    const { ui } = initFixture({});
    setIntent(ui, "ghost", "zoomRange", [3, 12]);
    ui.intentProvenance.ghost = ["zoomRange"];
    expect(() => resetLayerZoomRange(ui, "ghost")).not.toThrow();
    expect(getIntent(ui, "ghost", "zoomRange")).toEqual([3, 12]);
    expect(ui.intentProvenance.ghost).toEqual(["zoomRange"]);
  });
});
