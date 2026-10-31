import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DIM } from "#core/layer/index.js";
import { OVERLAY_IDS, ensureOverlayRegistry } from "#core/overlayRegistry.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import type { LayerController } from "#foliplus/LayerControl/controller.js";
import { sliderOf } from "#foliplus/LayerControl/slider.js";
import { applyProjection } from "#foliplus/LayerControl/ui/apply.js";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import {
  getIntent,
  seedIntentMap,
  setIntent,
} from "#foliplus/LayerControl/ui/intent.js";
import { renderInitialList } from "#foliplus/LayerControl/ui/listPanel/list.js";
import {
  buildDelegatedBorderRow,
  renderDelegatedStylePanel,
} from "#foliplus/LayerControl/ui/style/delegated.js";
import {
  closeStylePanel,
  layerHasLabelFields,
  layerHasStyleDelegation,
} from "#foliplus/LayerControl/ui/style/index.js";
import { coerceAnnotationFields } from "#foliplus/LayerControl/ui/style/label.js";
import {
  clampPct,
  resetLayerOpacity,
} from "#foliplus/LayerControl/ui/style/opacity.js";
import { getDimension } from "#foliplus/LayerControl/ui/style/registry.js";
import { resetLayerZoomRange } from "#foliplus/LayerControl/ui/style/zoomRange.js";
import { EVENTS } from "#foliplus/core/event/index.js";
import { ensureModes } from "#foliplus/core/mode.js";
import { getLayerAlpha } from "#common/canvasAlpha.js";
import { NUMBER_FORMAT } from "#common/format.js";
import { registerPortalRoot } from "#common/portalRoot.js";
import {
  GridLayer,
  attachedPanel,
  findItem,
  initFixture,
  installLeafletGlobals,
  oneOverlay,
} from "./fixture.js";

// The carrier contract promises pane coverage only to migratable families
// (Path / Marker / GridLayer / ImageOverlay). Style-row stubs for vector
// layers declare the Path identity so the executor treats them as
// pane-capable, matching the real layers they stand in for.
const pathify = <T extends object>(stub: T): T => {
  Object.setPrototypeOf(stub, new window.L.Path());
  return stub;
};

/** Percentage the slider fill is drawn at, read off the primitive's inline
 *  width. The fill spans the rail's travel range, so 0.35 means 35%. */
const fillPct = (el: HTMLElement): number =>
  Number(el.style.width.match(/^([\d.]+)%$/)?.[1] ?? NaN) / 100;

/** The value bubble is a module-level singleton portaled to <body>. Clearing
 *  the body between tests would leave the primitive holding a detached node,
 *  so the node is moved aside and re-attached rather than discarded. */
let portalBubble: HTMLElement | null = null;
const keepBubble = (): void => {
  const bubble = document.querySelector<HTMLElement>(".foliplus-slider-bubble");
  if (bubble) portalBubble = bubble;
  portalBubble?.classList.remove("is-on");
  if (portalBubble) portalBubble.hidden = true;
  portalBubble?.remove();
};
const restoreBubble = (): void => {
  if (portalBubble) document.body.appendChild(portalBubble);
};

describe("LayerUI style panel", () => {
  let manager: LayerController;
  let ui: LayerUI;
  let map: any;

  beforeEach(() => {
    restoreBubble();
    ({ manager, ui, map } = initFixture());
    ui.listPanel.foldedRoles = new Set();
    seedIntentMap(ui, "visible", {});
    window.localStorage.removeItem(CONST.STORAGE.KEY);
    // Seed the field cache so the panel builds: collectFields walks the
    // layer's leaves, and the fixture's data layer has none. `count` is a
    // number, which is what makes the number-format row reachable.
    ui.runtimeStore.setFields("overlay1", [{ name: "count", numeric: true }]);
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
    keepBubble();
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

    expect(ui.overlayPanel.stylePanelLayerId).toBe("overlay1");
    const panel = panelOf(item)!;
    expect(panel).not.toBeNull();
    expect(panel.getAttribute("role")).toBe("dialog");
  });

  it("its registry entry reports no containment once the panel is gone", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const entry = ensureOverlayRegistry(map).owningEntry(panel);
    expect(entry?.id).toBe(OVERLAY_IDS.LAYER_STYLE);
    expect(entry?.panels()).toEqual([panel]);

    closeStylePanel(ui, false);

    // A late dispatch after the close asks the same closure, and it reads the
    // live state — containment must be empty, not a detached panel.
    expect(entry?.panels()).toEqual([]);
  });

  it("builds on the shared panel vocabulary (header, content, close)", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;

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
    const panel = panelOf(item)!;

    const toggle = panel.querySelector(
      ".foliplus-style-toggle-input",
    ) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    const field = panel.querySelector(
      ".foliplus-style-field-select",
    ) as HTMLSelectElement;
    // No field is stored, so the picker shows its default (the only field).
    expect(field.value).toBe("count");
    const format = panel.querySelector(
      ".foliplus-style-format-select",
    ) as HTMLSelectElement;
    expect(format.value).toBe(NUMBER_FORMAT.AUTO);
    // One option per cached field, no placeholder.
    expect(field.options.length).toBe(1);
  });

  it("opens a Layer-only panel for a layer without labelable content and capable dimensions", () => {
    // Field-less now means capability "none" (the probe over real features,
    // which the fixture layer has none of) — the field cache only feeds the
    // picker's options and cannot veto the section.
    ui.runtimeStore.deleteFields("overlay1");
    const li = manager.layerRegistry.get("overlay1")!;
    const surface = manager.surfaceFor(li) as unknown as {
      capabilities: Record<string, unknown>;
    };
    surface.capabilities = { ...surface.capabilities, annotation: "none" };
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");

    expect(ui.overlayPanel.stylePanelLayerId).toBe("overlay1");
    const panel = panelOf(item)!;
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
    expect(panel!.querySelector(".foliplus-style-opacity-track")).not.toBeNull();
    expect(panel!.querySelector(".foliplus-style-zoom-range-row")).not.toBeNull();
    expect(panel!.querySelector(".foliplus-style-border-row")).toBeNull();
    expect(panel!.querySelector(".foliplus-style-fill-row")).toBeNull();
  });

  it("opens no panel for a layer with neither a labelable field nor a capable dimension", () => {
    ui.runtimeStore.deleteFields("overlay1");
    const item = findItem(ui, "overlay1");
    // Strip every dimension: the surface can carry no honest write. The
    // label bit included — `annotation: "none"` is what says "no labelable
    // content" (a missing key would read as capable).
    const li = manager.layerRegistry.get("overlay1")!;
    (manager.surfaceFor(li) as any).capabilities = {
      opacity: "none",
      zoomRange: "none",
      annotation: "none",
      relocatable: false,
      bounds: false,
    };
    ui.openStylePanel("overlay1");

    expect(ui.overlayPanel.stylePanelLayerId).toBeNull();
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
    ui.runtimeStore.setFields("growing", [{ name: "count", numeric: true }]);
    ui.openStylePanel("growing");
    expect(panelOf(item)!.querySelector(".foliplus-style-toggle-input")).not.toBeNull();
    ui.closeStylePanel(false);

    // Loses it again: the section leaves with the capability.
    li = manager.layerRegistry.get("growing")!;
    li.layer = bareLeaf();
    ui.runtimeStore.deleteFields("growing");
    ui.openStylePanel("growing");
    expect(panelOf(item)!.querySelector(".foliplus-style-toggle-input")).toBeNull();
    ui.closeStylePanel(false);
  });

  it("closes the previous panel before opening a new one", () => {
    const a = findItem(ui, "overlay1");
    ui.runtimeStore.setFields("base1", [{ name: "name", numeric: false }]);
    const b = findItem(ui, "base1");

    ui.openStylePanel("overlay1");
    ui.openStylePanel("base1");

    expect(panelOf(a)).toBeUndefined();
    expect(panelOf(b)).not.toBeNull();
    expect(ui.overlayPanel.stylePanelLayerId).toBe("base1");
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
    expect(ui.overlayPanel.stylePanelLayerId).toBeNull();
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
    expect(ui.overlayPanel.stylePanelLayerId).toBeNull();
    wrapper.remove();
  });

  it("mousedown inside the panel does not dismiss it", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;

    panel.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    expect(panelOf(item)).toBe(panel);
  });

  it("a press outside the panel dismisses it via the outside-mousedown hook", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;

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

  it("a press on the scheme picker's portalled list does not dismiss it", () => {
    // The picker portals its dropdown to <body> so the list can paint above
    // this drawer. The portal is outside the panel's subtree while still being
    // part of the overlay, so a dismiss predicate that only walks the subtree
    // closes the drawer on the press that selects a color.
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;

    const portal = document.createElement("div");
    portal.className = "foliplus-scheme-picker-portal";
    const row = document.createElement("button");
    row.className = "foliplus-scheme-picker-item";
    portal.appendChild(row);
    document.body.appendChild(portal);
    // The picker registers its portalled list against its trigger (the
    // primitive owns that, common/portalRoot); the fixture mounts the same
    // registration so the registry's press dispatcher can attribute the press
    // to this drawer. Without it the node is an orphan <body> child and every
    // dismiss predicate rightly calls the press "outside".
    const releasePortal = registerPortalRoot(portal, panel);

    // Capture-phase listener on document: a bubbling press on the portalled row
    // is exactly what the browser delivers for a real click on the list.
    row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

    expect(panelOf(item)).toBe(panel);
    expect(ui.overlayPanel.stylePanelLayerId).toBe("overlay1");
    releasePortal();
    portal.remove();
  });

  // ─────────────────── control interactions ───────────────────

  it("flipping the toggle updates the config, labels and persistence", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const setConfig = vi.spyOn(manager.annotation, "setConfig");
    const renderLabels = vi.spyOn(manager.annotation, "renderLabels");
    const saveAnnotations = vi.spyOn(manager.persistence, "schedule");

    const toggle = panelOf(item)!.querySelector(
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

    expect(ui.overlayPanel.stylePanelLayerId).toBeNull();
  });

  it("renders the avoid-overlap switch, defaulting on from the page", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");

    const collide = panelOf(item)!.querySelector(
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

    const collide = panelOf(item)!.querySelector(
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
      ...panelOf(item)!.querySelectorAll(".foliplus-style-body .foliplus-form-row"),
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

    const color = panelOf(item)!.querySelector(
      ".foliplus-style-label-color-input",
    ) as HTMLInputElement;
    const size = panelOf(item)!.querySelector(
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
    } as any);
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");

    const color = panelOf(item)!.querySelector(
      ".foliplus-style-label-color-input",
    ) as HTMLInputElement;
    const size = panelOf(item)!.querySelector(
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
    } as any);
    ui.applyStyleLabelState();
    const item = findItem(ui, "overlay1");

    ui.openStylePanel("overlay1");

    const collide = panelOf(item)!.querySelector(
      ".foliplus-style-collide-input",
    ) as HTMLInputElement;
    expect(collide.checked).toBe(false);
  });

  it("normalizes non-string persisted values instead of trusting storage", () => {
    // localStorage is writable by anything on the page, so a field or format of
    // the wrong shape must not reach the config as-is.
    seedIntentMap(ui, "annotation", {
      overlay1: { show: true, field: 42, format: 7 } as any,
    });

    ui.applyStyleLabelState();

    const cfg = manager.annotation.getConfig("overlay1");
    expect(cfg.field).toBe("");
    expect(cfg.format).toBe(NUMBER_FORMAT.AUTO);
  });

  it("coerceAnnotationFields is the single home of the field rules", () => {
    // Every future label field (e.g. position) extends this one function —
    // the tolerant parse passes unknown keys through untouched.
    expect(coerceAnnotationFields(null)).toEqual({
      show: false,
      field: "",
      color: CONST.DEFAULT_ANNOTATION.color,
      size: CONST.DEFAULT_ANNOTATION.size,
      format: NUMBER_FORMAT.AUTO,
      collide: true,
    });
    expect(coerceAnnotationFields({ collide: false })).toMatchObject({
      collide: false,
    });
    expect(coerceAnnotationFields({ size: 99 }).size).not.toBe(99); // clamped
  });

  it("shows auto for a persisted config with no format", () => {
    ui.runtimeStore.setFields("overlay1", [{ name: "count", numeric: true }]);
    manager.annotation.setConfig("overlay1", {
      show: true,
      field: "count",
      format: "" as never,
    } as any);
    const item = findItem(ui, "overlay1");

    ui.openStylePanel("overlay1");

    expect(formatSelectOf(item).value).toBe(NUMBER_FORMAT.AUTO);
  });

  it("choosing a field updates the config", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const setConfig = vi.spyOn(manager.annotation, "setConfig");

    const field = panelOf(item)!.querySelector(
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
    panelOf(item)!.querySelector(".foliplus-style-format-row")?.remove();
    const field = panelOf(item)!.querySelector(
      ".foliplus-style-field-select",
    ) as HTMLSelectElement;
    field.value = "count";
    field.dispatchEvent(new Event("change", { bubbles: true }));
    expect(manager.annotation.getConfig("overlay1").field).toBe("count");
  });

  it("omits the format key when the format select is absent from the DOM", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    panelOf(item)!.querySelector(".foliplus-style-format-select")?.remove();
    const field = panelOf(item)!.querySelector(
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

  it("reveals the body when switched on, showing the picker's default field", () => {
    // The default pick (first numeric, else first) is a concrete field: the
    // select always names one, while the config stays untouched until the user
    // actually picks a column. The rule itself is asserted in
    // core/labelField.test.ts and below for the format row.
    ui.runtimeStore.setFields("overlay1", [
      { name: "name", numeric: false },
      { name: "count", numeric: true },
    ]);
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");

    const toggle = toggleOf(item);
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));

    expect(bodyOf(item).classList.contains("foliplus-hidden")).toBe(false);
    expect(fieldSelectOf(item).value).toBe("count");
    // Switching the labels on is not a field choice: nothing is persisted.
    expect(manager.annotation.getConfig("overlay1").field).toBe("");
  });

  it("shows the number-format row for the field the picker defaults to", () => {
    ui.runtimeStore.setFields("overlay1", [
      { name: "name", numeric: false },
      { name: "count", numeric: true },
    ]);
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");

    // The default resolves to the numeric `count`, so the row is live even
    // though no field was ever stored.
    expect(fieldSelectOf(item).value).toBe("count");
    expect(formatRowOf(item).classList.contains("foliplus-hidden")).toBe(false);
  });

  it("offers only the layer's real fields, with no placeholder entry", () => {
    ui.runtimeStore.setFields("overlay1", [
      { name: "name", numeric: false },
      { name: "count", numeric: true },
    ]);
    const item = findItem(ui, "overlay1");

    ui.openStylePanel("overlay1");

    const options = Array.from(fieldSelectOf(item).options);
    expect(options.map(o => o.value)).toEqual(["name", "count"]);
    expect(options.map(o => o.textContent)).toEqual(["name", "count"]);
    // Nothing disabled: every entry is a real field the user can pick.
    expect(options.some(o => o.disabled)).toBe(false);
  });

  it("shows the default field when the stored one no longer exists", () => {
    // A re-registered layer can drop the column a config still names. The
    // picker must land on a field it actually offers, not on a stale value.
    manager.annotation.setConfig("overlay1", {
      show: true,
      field: "retired",
      format: NUMBER_FORMAT.AUTO,
    } as any);
    ui.runtimeStore.setFields("overlay1", [
      { name: "name", numeric: false },
      { name: "count", numeric: true },
    ]);
    const item = findItem(ui, "overlay1");

    ui.openStylePanel("overlay1");

    expect(fieldSelectOf(item).value).toBe("count");
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
    ui.runtimeStore.setFields("overlay1", [
      { name: "count", numeric: true },
      { name: "name", numeric: false },
    ]);
    const item = findItem(ui, "overlay1");
    manager.annotation.setConfig("overlay1", {
      show: true,
      field: "name",
      format: NUMBER_FORMAT.AUTO,
    } as any);

    ui.openStylePanel("overlay1");

    expect(formatRowOf(item).classList.contains("foliplus-hidden")).toBe(true);
  });

  it("shows the number-format row for a numeric field and flips it on switch", () => {
    ui.runtimeStore.setFields("overlay1", [
      { name: "count", numeric: true },
      { name: "name", numeric: false },
    ]);
    const item = findItem(ui, "overlay1");
    manager.annotation.setConfig("overlay1", {
      show: true,
      field: "count",
      format: NUMBER_FORMAT.AUTO,
    } as any);

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
    expect(ui.listPanel.dragEntry).toBeNull();
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

    const format = panelOf(item)!.querySelector(
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
    } as any);

    const btn = panelOf(item)!.querySelector(
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

  it("reset closes the panel without bubbling to the map", () => {
    // A press on the Reset button must not also become a map click: closing the
    // panel removes it mid-dispatch, so the click would otherwise keep walking
    // its original path with no live control ancestor and land on the map (the
    // same guarantee as the ⋮ menu — #807).
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const bubbled = vi.fn();
    item.addEventListener("click", bubbled);

    const btn = panelOf(item)!.querySelector(
      ".foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    // The panel still closes…
    expect(panelOf(item)).toBeUndefined();
    // …and the press was swallowed, never reaching the row / map.
    expect(bubbled).not.toHaveBeenCalled();
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
    } as any);

    const btn = panelOf(item)!.querySelector(
      ".foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(manager.annotation.getConfig("overlay1").collide).toBe(true);
  });

  it("reset drops the entry, so the author's declaration shows through", () => {
    // A declaration lives on the layer's own options (folium's
    // `explore(foliplus=...)`), not in CONFIG. Writing the defaults back on
    // Reset would shadow the author's field, and persisting that shadow would
    // keep it for good.
    const li = manager.layerRegistry.get("overlay1")!;
    (li.layer as any).options.foliplus = { label: { field: "declared" } };
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    manager.annotation.setConfig("overlay1", {
      show: true,
      field: "count",
      format: NUMBER_FORMAT.AUTO,
      collide: false,
    } as any);
    expect(manager.annotation.getConfig("overlay1").field).toBe("count");

    // Arm the timers before the click: the save is debounced, and the timer
    // must be created against the fake clock to be advanceable.
    vi.useFakeTimers();
    const btn = panelOf(item)!.querySelector(
      ".foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    vi.advanceTimersByTime(CONST.SAVE_DEBOUNCE_MS + 50);

    expect(manager.annotation.hasConfig("overlay1")).toBe(false);
    expect(manager.annotation.getConfig("overlay1").field).toBe("declared");
    // The declaration implies show, so the labels are back on — Reset returns the
    // layer to the author's default, not to "labels off".
    expect(manager.annotation.getConfig("overlay1").show).toBe(true);
    // No stored choice means collide comes from the page-level default again.
    expect(manager.annotation.getConfig("overlay1").collide).toBe(true);
    // configEntries is the record's only source for the annotation key, so an
    // empty result is what keeps a reload from re-seeding the shadow.
    expect(manager.annotation.configEntries()).toHaveLength(0);
    const rec = JSON.parse(window.localStorage.getItem(CONST.STORAGE.KEY)!);
    expect(rec.layers.overlay1?.annotation).toBeUndefined();
  });

  it("renders the labels a layer declares, with no panel interaction", () => {
    // The load-time half of the declaration: getConfig's `show` alone draws
    // nothing, because the canvas is only built by renderLabels. This sweep is
    // what puts a declared field on the map at all.
    const li = manager.layerRegistry.get("overlay1")!;
    (li.layer as any).options.foliplus = { label: { field: "count" } };

    const render = vi
      .spyOn(manager.annotation, "renderLabels")
      .mockImplementation(() => []);
    ui.applyStyleLabelState();

    expect(render).toHaveBeenCalledWith("overlay1");
  });

  it("leaves labels off when the declaration says show: false", () => {
    const li = manager.layerRegistry.get("overlay1")!;
    (li.layer as any).options.foliplus = {
      annotation: { field: "count", show: false },
    };

    const render = vi
      .spyOn(manager.annotation, "renderLabels")
      .mockImplementation(() => []);
    ui.applyStyleLabelState();

    expect(render).not.toHaveBeenCalledWith("overlay1");
  });

  it("does not re-render a layer the user has configured for themselves", () => {
    // The live config wins over the declaration, so the sweep must not redraw a
    // layer the user has already tuned.
    const li = manager.layerRegistry.get("overlay1")!;
    (li.layer as any).options.foliplus = { label: { field: "count" } };
    manager.annotation.setConfig("overlay1", {
      show: true,
      field: "name",
      format: NUMBER_FORMAT.AUTO,
    } as any);

    const render = vi
      .spyOn(manager.annotation, "renderLabels")
      .mockImplementation(() => []);
    ui.applyStyleLabelState();

    expect(render).not.toHaveBeenCalled();
  });

  it("does not render a declaration the layer has no labelable fields for", () => {
    // A declaration is an author's promise about the panel's starting point, not a
    // reason to paint. Building a canvas over an empty field list would leave a
    // blank layer with the toggle reading on.
    const li = manager.layerRegistry.get("overlay1")!;
    (li.layer as any).options.foliplus = { label: { field: "count" } };
    ui.runtimeStore.deleteFields("overlay1");
    expect(layerHasLabelFields(ui, "overlay1")).toBe(false);

    const render = vi
      .spyOn(manager.annotation, "renderLabels")
      .mockImplementation(() => []);
    ui.applyStyleLabelState();

    expect(render).not.toHaveBeenCalledWith("overlay1");
  });

  // ─────────────────── row groups + opacity ───────────────────

  it("renders the layer and label rows with no group headings", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    // Headings are gone; the two groups are told apart by document order.
    expect(panel.querySelectorAll(".foliplus-section-heading")).toHaveLength(0);
    const order = [...panel.querySelectorAll("*")];
    const layer = panel.querySelector(".foliplus-style-opacity-track");
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

  it("finishes sliders before a list rebuild", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const host = panel.querySelector(
      "." + CONST.CLASSES.STYLE_OPACITY_TRACK,
    ) as HTMLElement;
    const finish = vi.spyOn(sliderOf(host)!, "finish");
    // A reorder / fold rebuild clears the container without closing the panel.
    renderInitialList(ui);
    expect(finish).toHaveBeenCalled();
  });

  it("finishes sliders when their layer is unregistered", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const host = panel.querySelector(
      "." + CONST.CLASSES.STYLE_OPACITY_TRACK,
    ) as HTMLElement;
    const finish = vi.spyOn(sliderOf(host)!, "finish");
    manager.unregisterLayer("overlay1");
    expect(finish).toHaveBeenCalled();
  });

  it("finishes every slider before the panel is removed", () => {
    // closing mid-drag is a commit boundary: the pointer already set the
    // value, so the session must end (and emit change) before remove().
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const host = panel.querySelector(
      "." + CONST.CLASSES.STYLE_OPACITY_TRACK,
    ) as HTMLElement;
    const slider = sliderOf(host)!;
    const finish = vi.spyOn(slider, "finish");
    closeStylePanel(ui, false);
    expect(finish).toHaveBeenCalledTimes(1);
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
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const host = panel.querySelector(
      `.${CONST.CLASSES.STYLE_OPACITY_TRACK}`,
    ) as HTMLElement;
    const fill = panel.querySelector(".foliplus-slider-fill") as HTMLElement;
    // Freshly opened → full width.
    expect(fillPct(fill)).toBeCloseTo(1);

    sliderOf(host)!.setValue(35);

    expect(fillPct(fill)).toBeCloseTo(0.35);
  });

  it("does not rewrite the layer when the committed opacity is unchanged", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const host = panel.querySelector(
      "." + CONST.CLASSES.STYLE_OPACITY_TRACK,
    ) as HTMLElement;
    const li = manager.layerRegistry.get("overlay1")!;
    // The layer changes outside the panel while it is open; moving the thumb
    // to that same value must sync the control without a second write.
    li.opacity = 0.5;
    sliderOf(host)!.setValue(50);
    expect(li.opacity).toBe(0.5);
    expect(sliderOf(host)!.value).toBe(50);
  });

  it("covers the opacity end dots only as far as the thumb reaches", () => {
    // Single thumb: the covered span is [min, value]. The 0 dot is accent
    // from the start (the layer is painted from 0); the 100 dot is accent
    // only at full opacity.
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const host = panel.querySelector(
      `.${CONST.CLASSES.STYLE_OPACITY_TRACK}`,
    ) as HTMLElement;
    const dotAt = (at: string): HTMLElement =>
      host.querySelector(`.foliplus-slider-dot[data-at="${at}"]`) as HTMLElement;

    expect(dotAt("0").classList.contains("foliplus-slider-dot-covered")).toBe(true);
    expect(dotAt("100").classList.contains("foliplus-slider-dot-covered")).toBe(true);

    sliderOf(host)!.setValue(35);
    expect(dotAt("0").classList.contains("foliplus-slider-dot-covered")).toBe(true);
    expect(dotAt("100").classList.contains("foliplus-slider-dot-covered")).toBe(false);

    sliderOf(host)!.setValue(0);
    expect(dotAt("0").classList.contains("foliplus-slider-dot-covered")).toBe(true);
    expect(dotAt("100").classList.contains("foliplus-slider-dot-covered")).toBe(false);
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
    const host = panel.querySelector(
      `.${CONST.CLASSES.STYLE_OPACITY_TRACK}`,
    ) as HTMLElement;

    sliderOf(host)!.setValue(40);

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
    const host = panel.querySelector(
      `.${CONST.CLASSES.STYLE_OPACITY_TRACK}`,
    ) as HTMLElement;

    sliderOf(host)!.setValue(40);

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
    const host = panel.querySelector(
      `.${CONST.CLASSES.STYLE_OPACITY_TRACK}`,
    ) as HTMLElement;

    sliderOf(host)!.setValue(50);

    expect(onOpacity).toHaveBeenCalledWith(0.5);
  });

  it("reset restores opacity to fully opaque and drops the persisted entry", () => {
    const li = manager.layerRegistry.get("overlay1")!;
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const host = panel.querySelector(
      `.${CONST.CLASSES.STYLE_OPACITY_TRACK}`,
    ) as HTMLElement;
    sliderOf(host)!.setValue(30);

    const btn = panel.querySelector(".foliplus-style-reset-btn") as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(li.opacity).toBe(1);
    expect(getIntent(ui, "overlay1", "opacity")).toBeUndefined();
  });

  it("dragging back to fully opaque drops the provenance as well as the value", () => {
    // 100% is the declared default, so a drag back to it is a reset by another
    // route and must leave no override behind -- otherwise the record keeps a
    // marker with no value for it.
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const host = panel.querySelector(
      `.${CONST.CLASSES.STYLE_OPACITY_TRACK}`,
    ) as HTMLElement;
    const slider = sliderOf(host)!;

    slider.setValue(30);
    expect(ui.intentStore.isUserSet("overlay1", "opacity")).toBe(true);

    slider.setValue(100);

    expect(getIntent(ui, "overlay1", "opacity")).toBeUndefined();
    expect(ui.intentStore.isUserSet("overlay1", "opacity")).toBe(false);
  });

  it("opacity 0 is kept in the map (only 1 is treated as default)", () => {
    const li = manager.layerRegistry.get("overlay1")!;
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const host = panelOf(item)!.querySelector(
      `.${CONST.CLASSES.STYLE_OPACITY_TRACK}`,
    ) as HTMLElement;

    sliderOf(host)!.setValue(0);

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
    const host = panel.querySelector(
      `.${CONST.CLASSES.STYLE_OPACITY_TRACK}`,
    ) as HTMLElement;
    sliderOf(host)!.setValue(15);
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
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const host = panel.querySelector(
      `.${CONST.CLASSES.STYLE_OPACITY_TRACK}`,
    ) as HTMLElement;

    // The row outlives its registry entry (a provider unregistered the layer).
    vi.spyOn(manager.layerRegistry, "get").mockReturnValue(undefined);
    expect(() => {
      sliderOf(host)!.setValue(20);
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
    const panel = panelOf(item)!;

    panel
      .querySelector(".foliplus-panel-header")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(panelOf(item)).toBeUndefined();
  });

  it("header click closes the panel without bubbling to the map", () => {
    // A press on the header (or the × inside it) must not also become a map
    // click: closing the panel removes it mid-dispatch, so the click would
    // otherwise keep walking its original path with no live control ancestor
    // and land on the map (the same guarantee as the ⋮ menu — #807).
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const bubbled = vi.fn();
    item.addEventListener("click", bubbled);

    panel
      .querySelector(".foliplus-panel-header")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    // The panel still closes…
    expect(panelOf(item)).toBeUndefined();
    // …and the press was swallowed, never reaching the row / map.
    expect(bubbled).not.toHaveBeenCalled();
  });

  it("Escape closes an open style panel and returns focus to its row", () => {
    const item = findItem(ui, "overlay1");
    const focusSpy = vi.fn();
    item.focus = focusSpy;

    ui.openStylePanel("overlay1");
    const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
    checkbox.focus();

    // Real keydown: the overlay registry owns Escape now.
    checkbox.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Escape",
      }),
    );

    expect(panelOf(item)).toBeUndefined();
    expect(focusSpy).toHaveBeenCalled();
  });

  it("layerCanOpacity declines a 'none' carrier: no opacity row is built", () => {
    // The `capabilities.opacity !== "none"` half of the guard. A layer whose
    // icons live in a shared pane we do not own (MarkerCluster) has no honest
    // opacity write — showing a slider would persist a value nothing applies.
    ui.runtimeStore.setFields("overlay1", [{ name: "count", numeric: true }]);
    vi.spyOn(manager, "surfaceFor").mockReturnValue({
      capabilities: { opacity: "none", zoomRange: "none" },
      paneNames: [],
      geometryType: () => "point",
    } as unknown as ReturnType<typeof manager.surfaceFor>);

    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    expect(panel, "the style panel rendered").toBeTruthy();

    expect(panel!.querySelector(".foliplus-style-opacity-track")).toBeNull();
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
    const leaf = pathify({
      options: { color: "#3388ff", weight: 2 },
      setStyle: vi.fn(),
      on: vi.fn(),
    });
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
    ui.runtimeStore.setFields("border1", [{ name: "count", numeric: true }]);
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
      index(".foliplus-style-opacity-track"),
    );
    expect(index(".foliplus-style-opacity-track")).toBeLessThan(
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
      role: "overlay",
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
    const p1 = new window.L.Polygon();
    console.log(
      "POLY_PROBE",
      p1 instanceof window.L.Polygon,
      p1 instanceof window.L.Path,
      typeof window.L.Path,
      Object.getPrototypeOf(window.L.Polygon.prototype) === window.L.Path.prototype,
    );
    console.log(
      "POLY1_CAPS",
      JSON.stringify(
        manager.surfaceFor(manager.layerRegistry.get("poly1")!).capabilities,
      ),
    );
    ui.runtimeStore.setFields("poly1", [{ name: "count", numeric: true }]);

    const item = findItem(ui, "poly1");
    ui.openStylePanel("poly1");
    const panel = panelOf(item)!;

    const rows = Array.from(panel.querySelectorAll(".foliplus-form-row"));
    const index = (sel: string) =>
      rows.findIndex(row => row.matches(sel) || row.querySelector(sel) !== null);
    const positions = [
      index(".foliplus-style-fill-row"),
      index(".foliplus-style-border-row"),
      index(".foliplus-style-opacity-track"),
      index(".foliplus-style-zoom-range-row"),
    ];
    console.log("POSITIONS", JSON.stringify(positions));
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
      ".foliplus-style-opacity-track",
      ".foliplus-style-zoom-range-row",
    ];

    // Path A — annotation panel (no styleSetters): a vector layer whose
    // surface admits all four Layer dims.
    const leaf = pathify({
      options: {
        color: "#000000",
        weight: 2,
        fillColor: "#aabbcc",
        fillOpacity: 0.5,
      },
      setStyle: vi.fn(),
      on: vi.fn(),
    });
    manager.registerLayer({
      id: "sweepVector",
      name: "Vector",
      role: "overlay",
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
    ui.runtimeStore.setFields("sweepVector", [{ name: "count", numeric: true }]);
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
      ".foliplus-style-opacity-track",
      ".foliplus-style-zoom-range-row",
    ]);
  });

  // Row-rendering matrix for the two basemap faces — this matrix pins the
  // zoomRange cells. Both basemap kinds now render the zoomRange row: a real
  // GridLayer carries it through native min/maxZoom (the honest carrier), and the
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
    // The old `li.role !== "base"` blanket was dropped: a TileLayer is a
    // GridLayer subclass whose options.minZoom/maxZoom are exactly the
    // carrier the row writes through, so refusing it was a false refusal.
    // GridLayer is required — a bare `{ options: {} } as never` also gets a
    // row, but through the content-panes fallback, which is not the carrier
    // this test is checking.
    manager.registerLayer({
      id: "tileBase1",
      name: "OSM",
      role: "base",
      layer: new GridLayer() as never,
    });
    ui.runtimeStore.setFields("tileBase1", [{ name: "count", numeric: true }]);

    const item = findItem(ui, "tileBase1");
    ui.openStylePanel("tileBase1");
    const panel = panelOf(item)!;
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
      role: "base",
      color: "#3366cc",
    });
    ui.runtimeStore.setFields("colormap", [{ name: "count", numeric: true }]);

    const item = findItem(ui, "colormap");
    ui.openStylePanel("colormap");
    const panel = panelOf(item)!;
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
      role: "base",
      layer: pathify({ options: {} }) as never,
      // An owned pane name: a shared-pane declaration is refused now (the
      // layer gets its own synthesized pane instead of adopting tilePane).
      paneName: "norange-pane",
    });
    const li = manager.layerRegistry.get("norange1")!;
    manager.surfaceFor(li).capabilities.zoomRange = "none";
    ui.runtimeStore.setFields("norange1", [{ name: "count", numeric: true }]);

    const item = findItem(ui, "norange1");
    ui.openStylePanel("norange1");
    const panel = panelOf(item)!;
    expect(panel, "the style panel rendered").toBeTruthy();

    expect(panel!.querySelector(".foliplus-style-zoom-range-row")).toBeNull();
  });

  it("layerCanOpacity returns false when the layer is not in the registry", () => {
    // Covers the `!li` guard in layerCanOpacity: a layer with cached fields but
    // no registry entry cannot have its surface queried.
    ui.runtimeStore.setFields("overlay1", [{ name: "count", numeric: true }]);
    const li = manager.layerRegistry.get("overlay1");
    manager.layerRegistry.remove("overlay1");

    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;

    // Panel is rendered (fields are cached) but without the opacity row.
    if (panel) {
      expect(panel.querySelector(".foliplus-style-opacity-track")).toBeNull();
    }

    // Restore for cleanup
    if (li) manager.layerRegistry.upsert(li);
  });

  // ─────────────────── ⋮ menu item ───────────────────

  it("the ⋮ menu's Style item is enabled for pane-capable layers even without labels", () => {
    // Capability-driven gate. A layer whose surface reports opacity/zoomRange
    // capability gets the panel enabled — the opacity and zoomRange sliders are
    // useful even without label fields.
    ui.runtimeStore.deleteFields("overlay1");
    const item = findItem(ui, "overlay1");

    ui.openMoreMenu(item);

    const styleItem = item.querySelector(
      `.foliplus-layer-more-menu button[data-action="${CONST.ACTION.STYLE_LAYER}"]`,
    ) as HTMLElement;
    expect(styleItem.getAttribute("aria-disabled")).not.toBe("true");
    expect(styleItem.getAttribute("title")).toBe("LayerControl.style_layer_tooltip");
  });

  it("the ⋮ menu's Style item is enabled once the layer has fields", () => {
    const item = findItem(ui, "overlay1");

    ui.openMoreMenu(item);

    const styleItem = item.querySelector(
      `.foliplus-layer-more-menu button[data-action="${CONST.ACTION.STYLE_LAYER}"]`,
    ) as HTMLElement;
    expect(styleItem.getAttribute("aria-disabled")).not.toBe("true");
    expect(styleItem.getAttribute("title")).toBe("LayerControl.style_layer_tooltip");
  });

  it("the ⋮ menu's Style item follows the checkbox on a basemap row too", () => {
    // Every row obeys one rule: Style is clickable only while the row is
    // checked. A basemap row is not exempt — consulted ahead of the basemap
    // "no extent" verdict, an off row is simply hidden and has nothing to
    // style. The color basemap starts unchecked, so its Style entry starts
    // disabled and turns on with the box.
    const item = attachedPanel(ui).querySelector(
      `[${CONST.DATA.LAYER_ID}="${CONST.SOLID_BASEMAP_ID}"]`,
    ) as HTMLElement;
    const box = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
    const styleItemOf = () =>
      item.querySelector(
        `.foliplus-layer-more-menu button[data-action="${CONST.ACTION.STYLE_LAYER}"]`,
      ) as HTMLElement;

    box.checked = false;
    ui.openMoreMenu(item);
    expect(styleItemOf().getAttribute("aria-disabled")).toBe("true");

    box.checked = true;
    ui.openMoreMenu(item);
    expect(styleItemOf().getAttribute("aria-disabled")).not.toBe("true");
  });

  // ─────────────────── field cache ───────────────────

  it("caches collectFields per layer id", () => {
    ui.runtimeStore.deleteFields("overlay1");
    const collect = vi.spyOn(manager.annotation, "collectFields");

    expect(layerHasLabelFields(ui, "overlay1")).toBe(false);
    expect(layerHasLabelFields(ui, "overlay1")).toBe(false);
    expect(collect).toHaveBeenCalledTimes(1);
    expect(ui.runtimeStore.getFields("overlay1")).toEqual([]);
  });

  it("drops a stale cached empty field list on LAYER_ITEM_COUNT_CHANGE", () => {
    // A layer registered with no labelable fields caches an empty list; a
    // runtime createLayers may later add features carrying properties, which
    // must un-stick the ⋮ menu's Style item.
    ui.runtimeStore.deleteFields("overlay1");
    expect(layerHasLabelFields(ui, "overlay1")).toBe(false);
    expect(ui.runtimeStore.getFields("overlay1")).toEqual([]);

    const fields = [
      { name: "count", numeric: true },
      { name: "name", numeric: false },
    ];
    vi.spyOn(manager.annotation, "collectFields").mockReturnValue(fields);

    ui.onLayerItemCountChange("overlay1");

    expect(ui.runtimeStore.getFields("overlay1")).toBeUndefined();
    expect(layerHasLabelFields(ui, "overlay1")).toBe(true);
  });

  it("re-renders a shown layer when its fields are invalidated", () => {
    // Dropping the cache is not enough: the drawn labels carry text baked from
    // the old fields while the picker would resolve a new default field, so the
    // map and the panel would disagree until the user touched a control.
    manager.annotation.setConfig("overlay1", {
      show: true,
      field: "count",
      format: NUMBER_FORMAT.AUTO,
    } as any);
    const renderLabels = vi.spyOn(manager.annotation, "renderLabels");

    ui.invalidateFields("overlay1");

    expect(renderLabels).toHaveBeenCalledWith("overlay1");
  });

  it("does not re-render a layer whose labels are off", () => {
    manager.annotation.setConfig("overlay1", {
      show: false,
      field: "",
      format: NUMBER_FORMAT.AUTO,
    } as any);
    const renderLabels = vi.spyOn(manager.annotation, "renderLabels");

    ui.invalidateFields("overlay1");

    expect(renderLabels).not.toHaveBeenCalled();
  });

  it("invalidateFields drops a layer's cached list", () => {
    layerHasLabelFields(ui, "overlay1");
    expect(ui.runtimeStore.getFields("overlay1")).toBeDefined();

    // The delegate is the surface `manager.unregisterLayer` drives.
    ui.invalidateFields("overlay1");
    expect(ui.runtimeStore.getFields("overlay1")).toBeUndefined();
  });

  it("keeps the field cache across close/reopen (count changes invalidate)", () => {
    // Closing the panel must not defeat the cache: re-collection on every
    // reopen walks every feature for nothing. The cache is dropped by
    // onLayerItemCountChange instead, when features actually change.
    const item = findItem(ui, "overlay1");

    ui.openStylePanel("overlay1");
    ui.closeStylePanel(true);

    expect(panelOf(item)).toBeUndefined();
    expect(ui.runtimeStore.getFields("overlay1")).toEqual([
      { name: "count", numeric: true },
    ]);
  });

  // ─────────────────── persisted state ───────────────────

  it("applyStyleLabelState seeds a stored config for a layer that has none", () => {
    seedIntentMap(ui, "annotation", {
      overlay1: { show: true, field: "count", format: NUMBER_FORMAT.AUTO } as any,
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
      } as any,
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
      } as any,
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
    } as any);
    seedIntentMap(ui, "annotation", {
      overlay1: { show: true, field: "count", format: NUMBER_FORMAT.AUTO } as any,
    });
    const setConfig = vi.spyOn(manager.annotation, "setConfig");
    const renderLabels = vi.spyOn(manager.annotation, "renderLabels");

    ui.applyStyleLabelState();

    expect(setConfig).not.toHaveBeenCalled();
    expect(renderLabels).not.toHaveBeenCalled();
    expect(manager.annotation.getConfig("overlay1").show).toBe(false);
  });

  it("applyStyleLabelState renders a shown config that names no field", () => {
    // `field: ""` means "never picked", not "nothing to show" — a shown config
    // must still render (renderLabels resolves the layer's default pick).
    seedIntentMap(ui, "annotation", { overlay1: { show: true, field: "" } as any });
    const renderLabels = vi.spyOn(manager.annotation, "renderLabels");

    ui.applyStyleLabelState();

    expect(renderLabels).toHaveBeenCalledWith("overlay1");
  });

  it("applyStyleLabelState skips configs that are switched off", () => {
    seedIntentMap(ui, "annotation", {
      overlay1: { show: false, field: "count" } as any,
    });
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
      ghost: { show: true, field: "count", format: NUMBER_FORMAT.AUTO } as any,
    });
    const setConfig = vi.spyOn(manager.annotation, "setConfig");
    const renderLabels = vi.spyOn(manager.annotation, "renderLabels");

    ui.applyStyleLabelState();

    // A stale id must not be written back into the live config map, or the
    // next annotations save would resurrect a removed layer.
    expect(setConfig).not.toHaveBeenCalled();
    expect(renderLabels).not.toHaveBeenCalled();
  });

  it("applyStyleLabelState skips an intent that carries no annotation", () => {
    // An id present in `ui.intentStore` for a different dimension (e.g. a rename)
    // must not be treated as a label seed.
    seedIntentMap(ui, "name", { overlay1: "Renamed" });
    const setConfig = vi.spyOn(manager.annotation, "setConfig");
    const renderLabels = vi.spyOn(manager.annotation, "renderLabels");

    ui.applyStyleLabelState();

    expect(setConfig).not.toHaveBeenCalled();
    expect(renderLabels).not.toHaveBeenCalled();
  });

  it("applyStyleLabelState is a no-op when the IntentStore is empty", () => {
    ui.intentStore.clearAll();
    expect(() => ui.applyStyleLabelState()).not.toThrow();
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
    expect(ui.overlayPanel.stylePanelLayerId).toBeNull();
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
    } as any);
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
      order.indexOf(panel.querySelector(".foliplus-style-opacity-track")!),
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

    expect(panel.querySelector(`.${CONST.CLASSES.STYLE_OPACITY_TRACK}`)).toBeNull();
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
    const leaf = pathify({
      options: { color: "#3388ff", weight: 2, fillColor: "#3388ff", fillOpacity: 0.2 },
      setStyle: vi.fn(),
      on: vi.fn(),
    });
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
    ui.runtimeStore.setFields("measure1", [{ name: "count", numeric: true }]);
    const item = findItem(ui, "measure1");
    ui.openStylePanel("measure1");
    const panel = panelOf(item)!;

    // No fill or border rows — the delegated drawer skips both.
    expect(panel.querySelector(`.${CONST.CLASSES.STYLE_FILL_ROW}`)).toBeNull();
    expect(panel.querySelector(`.${CONST.CLASSES.STYLE_BORDER_ROW}`)).toBeNull();

    // Opacity and zoomRange are LayerControl-owned — they survive.
    expect(panel.querySelector(`.${CONST.CLASSES.STYLE_OPACITY_TRACK}`)).not.toBeNull();
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
    expect(ui.overlayPanel.styleUnsubscribe).not.toBeNull();

    // Capture the unsubscribe and verify it is called on close.
    const unsub = ui.overlayPanel.styleUnsubscribe!;
    ui.overlayPanel.styleUnsubscribe = () => {
      offSpy();
      unsub();
    };
    ui.closeStylePanel(false);

    expect(offSpy).toHaveBeenCalled();
    expect(ui.overlayPanel.styleUnsubscribe).toBeNull();
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

  // ─────────────────── delegated reset (Python CONFIG defaults) ───────────────────

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

    // Python CONFIG defaults — never the live / persisted values.
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
      styleProvider: (() => provide()) as any,
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

  it("buildDelegatedBorderRow returns null when the layer has no border setters", () => {
    manager.registerLayer({
      id: "dataOnly",
      name: "DataOnly",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({}),
      styleSetters: { field: vi.fn() },
    });
    expect(buildDelegatedBorderRow(ui, "dataOnly")).toBeNull();
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
    const host = panel.querySelector(
      `.${CONST.CLASSES.STYLE_OPACITY_TRACK}`,
    ) as HTMLElement;
    expect(host).not.toBeNull();
    // The primitive owns the class, mode and aria; the row only names its
    // host so a later pass can reach the instance through sliderOf().
    expect(host.classList.contains(CONST.CLASSES.SLIDER)).toBe(true);
    expect(host.dataset.mode).toBe("single");
    const thumb = host.querySelector(".foliplus-slider-thumb") as HTMLElement;
    expect(thumb.getAttribute("role")).toBe("slider");
    expect(thumb.getAttribute("aria-orientation")).toBe("horizontal");
    expect(thumb.getAttribute("aria-valuemin")).toBe("0");
    expect(thumb.getAttribute("aria-valuemax")).toBe("100");
    expect(thumb.getAttribute("aria-valuenow")).toBe("100");
    expect(sliderOf(host)!.value).toBe(100);
  });

  it("an opacity change applies to the layer and persists", () => {
    const li = manager.layerRegistry.get("overlay1")!;
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const host = panel.querySelector(
      `.${CONST.CLASSES.STYLE_OPACITY_TRACK}`,
    ) as HTMLElement;

    sliderOf(host)!.setValue(60);

    expect(li.opacity).toBe(0.6);
    expect(getIntent(ui, "overlay1", "opacity")).toBe(0.6);
  });

  it("commitOpacityPct re-syncs the no-basemap hatch for base layers", () => {
    // Dragging the only basemap to opacity=0 leaves it visually empty — the
    // hatch has to light up, which happens only if commitOpacityPct fires
    // syncNoBasemap. Overlay opacity is unrelated, so a base-vs-overlay
    // toggle must be observable.
    const toggleSpy = vi.fn();
    vi.spyOn(ui.c.map, "getContainer").mockImplementation(
      () =>
        ({
          classList: { toggle: toggleSpy, remove: vi.fn() },
        }) as unknown as HTMLElement,
    );
    try {
      const item = findItem(ui, "base1");
      ui.openStylePanel("base1");
      console.log(
        "BASE1_DEBUG",
        JSON.stringify(
          manager.surfaceFor(manager.layerRegistry.get("base1")!).capabilities,
        ),
      );
      const host = panelOf(item)!.querySelector(
        `.${CONST.CLASSES.STYLE_OPACITY_TRACK}`,
      ) as HTMLElement;
      sliderOf(host)!.setValue(0);
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
    vi.spyOn(ui.c.map, "getContainer").mockImplementation(
      () =>
        ({
          classList: { toggle: toggleSpy, remove: vi.fn() },
        }) as unknown as HTMLElement,
    );
    try {
      const item = findItem(ui, "overlay1");
      ui.openStylePanel("overlay1");
      const host = panelOf(item)!.querySelector(
        `.${CONST.CLASSES.STYLE_OPACITY_TRACK}`,
      ) as HTMLElement;
      sliderOf(host)!.setValue(0);
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
    vi.spyOn(ui.c.map, "getContainer").mockImplementation(
      () =>
        ({
          classList: { toggle: toggleSpy, remove: vi.fn() },
        }) as unknown as HTMLElement,
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
    vi.spyOn(ui.c.map, "getContainer").mockImplementation(
      () =>
        ({
          classList: { toggle: toggleSpy, remove: vi.fn() },
        }) as unknown as HTMLElement,
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
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const host = panelOf(item)!.querySelector(
      `.${CONST.CLASSES.STYLE_OPACITY_TRACK}`,
    ) as HTMLElement;
    sliderOf(host)!.setValue(25);
    ui.closeStylePanel(false);

    ui.openStylePanel("overlay1");
    const reopened = panelOf(item)!;
    const reopenedHost = reopened.querySelector(
      `.${CONST.CLASSES.STYLE_OPACITY_TRACK}`,
    ) as HTMLElement;
    expect(sliderOf(reopenedHost)!.value).toBe(25);
    expect(
      fillPct(reopened.querySelector(".foliplus-slider-fill") as HTMLElement),
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

    const host = panel.querySelector(
      `.${CONST.CLASSES.STYLE_OPACITY_TRACK}`,
    ) as HTMLElement;
    expect(sliderOf(host)!.value).toBe(100);
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
    expect(panel.querySelector(".foliplus-style-opacity-track")).toBeNull();
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
    ui.runtimeStore.setFields("cluster2", [{ name: "count", numeric: true }]);
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

    expect(panel.querySelector(".foliplus-style-opacity-track")).toBeNull();
    expect(panel.querySelector(".foliplus-style-opacity-number")).toBeNull();
    // Annotation rows are still there.
    expect(panel.querySelector(".foliplus-style-field-select")).not.toBeNull();
    expect(panel.querySelector(".foliplus-style-label-color-input")).not.toBeNull();
  });
});

describe("LayerUI style panel — zoom range", () => {
  let manager: LayerController;
  let ui: LayerUI;
  let map: any;

  beforeEach(() => {
    restoreBubble();
    ({ manager, ui, map } = initFixture());
    ui.listPanel.foldedRoles = new Set();
    seedIntentMap(ui, "visible", {});
    window.localStorage.removeItem(CONST.STORAGE.KEY);
    ui.runtimeStore.setFields("overlay1", [{ name: "count", numeric: true }]);
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    keepBubble();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  const panelOf = (item: HTMLElement): HTMLElement | undefined =>
    (item.querySelector(`.${CONST.CLASSES.STYLE_PANEL}`) as HTMLElement | null) ??
    undefined;

  const zoomRowOf = (panel: HTMLElement): HTMLElement | null =>
    panel.querySelector(`.${CONST.CLASSES.STYLE_ZOOM_RANGE_ROW}`);

  /** The primitive's host inside a zoom-range row. */
  const zoomHostOf = (row: HTMLElement): HTMLElement =>
    row.querySelector(`.${CONST.CLASSES.STYLE_ZOOM_RANGE_CONTROL}`) as HTMLElement;

  const zoomSliderOf = (row: HTMLElement) => sliderOf(zoomHostOf(row))!;

  const thumbOf = (row: HTMLElement, index: number): HTMLElement =>
    zoomHostOf(row).querySelectorAll<HTMLElement>(".foliplus-slider-thumb")[index];

  /** A real keyboard press on a thumb — the path the primitive listens on. */
  const press = (el: HTMLElement, key: string): void => {
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  };

  /** The singleton value bubble, portaled to <body>. */
  const bubbleOf = (): HTMLElement | null =>
    document.querySelector(".foliplus-slider-bubble");

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
    const host = zoomHostOf(row);

    expect(host.classList.contains(CONST.CLASSES.SLIDER)).toBe(true);
    expect(host.dataset.mode).toBe("range");
    expect(host.querySelector(".foliplus-slider-fill")).not.toBeNull();
    expect(host.querySelectorAll(".foliplus-slider-dot")).toHaveLength(3);
    expect(host.querySelectorAll(".foliplus-slider-thumb")).toHaveLength(2);

    const values = host.querySelector(".foliplus-slider-values") as HTMLElement;
    expect(values.querySelector(".foliplus-slider-value-min")?.textContent).toBe("0");
    expect(values.querySelector(".foliplus-slider-value-max")?.textContent).toBe("18");
    const current = values.querySelector(
      ".foliplus-slider-value-current",
    ) as HTMLElement;
    expect(current.textContent).toBe("5");
    expect(thumbOf(row, 0).getAttribute("aria-label")).toBe(
      ui.T("style_zoom_range_min"),
    );
    expect(thumbOf(row, 1).getAttribute("aria-label")).toBe(
      ui.T("style_zoom_range_max"),
    );
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

  it("moving a thumb updates map state and the visual row (live pass)", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const row = zoomRowOf(panel)!;

    zoomSliderOf(row).setValue([5, 18]);

    expect(getIntent(ui, "overlay1", "zoomRange")).toEqual([5, 18]);
    expect(thumbOf(row, 0).getAttribute("aria-valuenow")).toBe("5");
    expect(thumbOf(row, 0).getAttribute("aria-valuemax")).toBe("18");
  });

  it("commit persists the range to localStorage", () => {
    vi.useFakeTimers();
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const row = zoomRowOf(panel)!;

    zoomSliderOf(row).setValue([5, 18]);
    zoomSliderOf(row).commit();

    vi.advanceTimersByTime(400);
    const stored = JSON.parse(window.localStorage.getItem(CONST.STORAGE.KEY) ?? "{}");
    expect(stored.layers?.overlay1?.overrides).toContain("zoomRange");
    expect(stored.layers?.overlay1?.zoomRange).toEqual([5, 18]);
    vi.useRealTimers();
  });

  it("slides a collapsed pair as one instead of dead-locking", () => {
    // Both thumbs start on 10. Moving one toward the other must carry the
    // pair — clamping here would leave the value unable to move one way.
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const row = zoomRowOf(panelOf(item)!)!;
    zoomSliderOf(row).setValue([10, 10], { silent: true });

    press(thumbOf(row, 0), "ArrowRight");
    expect(getIntent(ui, "overlay1", "zoomRange")).toEqual([11, 11]);
    expect(zoomSliderOf(row).value).toEqual([11, 11]);

    press(thumbOf(row, 1), "ArrowLeft");
    expect(getIntent(ui, "overlay1", "zoomRange")).toEqual([10, 10]);
  });

  it("clamps a normal range at its neighbour instead of crossing", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const row = zoomRowOf(panelOf(item)!)!;
    zoomSliderOf(row).setValue([5, 9], { silent: true });

    for (let index = 0; index < 4; index += 1) {
      press(thumbOf(row, 0), "ArrowRight");
    }
    // Four steps land the lower thumb on the upper one.
    expect(getIntent(ui, "overlay1", "zoomRange")).toEqual([9, 9]);

    // Once collapsed, the next step carries both thumbs.
    press(thumbOf(row, 0), "ArrowRight");
    expect(getIntent(ui, "overlay1", "zoomRange")).toEqual([10, 10]);
  });

  it("clamps zoom values to map bounds", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const row = zoomRowOf(panel)!;

    zoomSliderOf(row).setValue([-5, 10]);

    const range = getIntent(ui, "overlay1", "zoomRange");
    expect(range![0]).toBeGreaterThanOrEqual(0);
    expect(zoomSliderOf(row).value).toEqual([0, 10]);
  });

  it("moves the current dot on zoomend", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const row = zoomRowOf(panel)!;
    const before = row.querySelector<HTMLElement>(".foliplus-slider-dot-current")!.style
      .left;

    map.getZoom.mockReturnValue(12);
    ui.onZoomEnd?.();

    // setMarks rebuilds the dots when the current level moves, so the live
    // node is the new one, not the reference captured before the event.
    const after = row.querySelector(".foliplus-slider-dot-current") as HTMLElement;
    expect(after.style.left).not.toBe(before);
  });

  it("updates values row on zoomend", () => {
    const item = findItem(ui, "overlay1");
    setIntent(ui, "overlay1", "zoomRange", [0, 18]);
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const row = zoomRowOf(panel)!;
    const current = row.querySelector(".foliplus-slider-value-current") as HTMLElement;
    const beforeCurrent = current.textContent;

    map.getZoom.mockReturnValue(12);
    ui.onZoomEnd?.();

    const afterCurrent = row.querySelector(
      ".foliplus-slider-value-current",
    ) as HTMLElement;
    expect(afterCurrent.textContent).toBe("12");
    expect(beforeCurrent).not.toBe(afterCurrent.textContent);
  });

  it("covers only the dots the selected range reaches", () => {
    // A range covers [min, max]: the 0 and 18 limit dots sit outside
    // [4, 9] and stay grey, while the current-zoom dot at 5 is inside.
    const item = findItem(ui, "overlay1");
    setIntent(ui, "overlay1", "zoomRange", [4, 9]);
    ui.openStylePanel("overlay1");
    const row = zoomRowOf(panelOf(item)!)!;
    const dotAt = (at: number): HTMLElement =>
      row.querySelector(`.foliplus-slider-dot[data-at="${at}"]`) as HTMLElement;

    expect(dotAt(0).classList.contains("foliplus-slider-dot-covered")).toBe(false);
    expect(dotAt(5).classList.contains("foliplus-slider-dot-covered")).toBe(true);
    expect(dotAt(18).classList.contains("foliplus-slider-dot-covered")).toBe(false);
  });

  it("leaves the current dot grey when it sits outside the range", () => {
    const item = findItem(ui, "overlay1");
    // Current zoom is 5; the range starts above it.
    setIntent(ui, "overlay1", "zoomRange", [7, 10]);
    ui.openStylePanel("overlay1");
    const row = zoomRowOf(panelOf(item)!)!;
    const currentDot = (): HTMLElement =>
      row.querySelector(".foliplus-slider-dot-current") as HTMLElement;
    expect(currentDot().classList.contains("foliplus-slider-dot-covered")).toBe(false);

    // A range that covers the current level lights the same dot.
    zoomSliderOf(row).setValue([0, 10]);
    expect(currentDot().classList.contains("foliplus-slider-dot-covered")).toBe(true);
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

    // The current zoom is 5. Pushing the lower bound past it takes the canvas
    // out of range, and its HIDDEN class is what hides it.
    zoomSliderOf(row).setValue([6, 18]);
    expect(getIntent(ui, "canvas1", "zoomRange")).toEqual([6, 18]);
    expect(canvas.classList.contains("hidden")).toBe(true);

    // Dragging the bound back drops it again — the write is reversible.
    zoomSliderOf(row).setValue([0, 18]);
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

    zoomSliderOf(row).setValue([6, 18]);

    expect(getIntent(ui, "measure1", "zoomRange")).toEqual([6, 18]);
    expect(map.removeLayer).toHaveBeenCalledWith(measureLayer);
  });

  it("gives the fixture's tile base layer a zoom row: the GridLayer native min/maxZoom is the carrier", () => {
    // The old `li.role !== "base"` blanket was dropped; the fixture's base1 is
    // a TileLayer (GridLayer subclass) whose options.minZoom/maxZoom are the
    // honest carrier, so the row now renders for it just like any overlay.
    const item = findItem(ui, "base1");
    ui.openStylePanel("base1");
    const panel = panelOf(item)!;
    if (!panel) return;
    const row = zoomRowOf(panel);
    expect(row).not.toBeNull();
  });

  it("reset button clears zoom range and restores full map range", () => {
    const item = findItem(ui, "overlay1");
    setIntent(ui, "overlay1", "zoomRange", [5, 15]);
    ui.intentStore.seedProvenance("overlay1", ["zoomRange"]);
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const resetBtn = panel.querySelector(
      ".foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    resetBtn.click();

    expect(getIntent(ui, "overlay1", "zoomRange")).toBeUndefined();
    expect(ui.intentStore.dumpProvenance()["overlay1"]).toBeUndefined();
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
    expect(zoomSliderOf(row).value).toEqual([3, 3]);
    expect(thumbOf(row, 0).getAttribute("aria-valuenow")).toBe("3");
    expect(thumbOf(row, 1).getAttribute("aria-valuenow")).toBe("3");
  });

  it("delegated panel includes zoom-range row when capability is present", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const hasRow = panel.querySelector(`.${CONST.CLASSES.STYLE_ZOOM_RANGE_ROW}`);
    expect(hasRow).not.toBeNull();
  });

  it("the live pass paints the opacity fill and floats the value", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const host = panel.querySelector(
      `.${CONST.CLASSES.STYLE_OPACITY_TRACK}`,
    ) as HTMLElement;
    const slider = sliderOf(host)!;

    slider.setValue(40);

    // The live pass moves the fill ...
    const fill = host.querySelector(".foliplus-slider-fill") as HTMLElement;
    expect(fillPct(fill)).toBeCloseTo(0.4);

    // ... and the bubble is the singleton portaled to <body>, shown once the
    // thumb has focus (the same path a keyboard user takes).
    const thumb = host.querySelector(".foliplus-slider-thumb") as HTMLElement;
    thumb.focus();
    let bubble = bubbleOf();
    expect(bubble).not.toBeNull();
    expect(bubble!.hidden).toBe(false);
    expect(bubble!.textContent).toBe("40");

    // A second live pass updates that one bubble instead of stacking another.
    slider.setValue(60);
    expect(document.querySelectorAll(".foliplus-slider-bubble")).toHaveLength(1);
    bubble = bubbleOf();
    expect(bubble!.textContent).toBe("60");

    // Blur is the release path.
    thumb.blur();
    expect(bubble!.classList.contains("is-on")).toBe(false);
  });

  it("a single-level map yields a zero percentage rather than NaN", () => {
    map.getMinZoom.mockReturnValue(7);
    map.getMaxZoom.mockReturnValue(7);
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const row = zoomRowOf(panelOf(item)!)!;

    zoomSliderOf(row).setValue([7, 7]);

    const values = row.querySelector(".foliplus-slider-values")!;
    expect(values.textContent).not.toMatch(/NaN/);
    expect(thumbOf(row, 0).style.left).toBe("0%");
  });

  it("keeps working when the row has lost its marks and current label", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const row = zoomRowOf(panelOf(item)!)!;

    // The primitive caches the nodes it paints while syncing, so removing
    // them must not throw — a row a consumer emptied (or a stale panel) still
    // answers a value change.
    row.querySelector(".foliplus-slider-marks")?.remove();
    row.querySelector(".foliplus-slider-value-current")?.remove();

    expect(() => {
      zoomSliderOf(row).setValue([4, map.getMaxZoom()]);
      zoomSliderOf(row).commit();
    }).not.toThrow();
    expect(getIntent(ui, "overlay1", "zoomRange")).toEqual([4, map.getMaxZoom()]);
  });

  it("the zoom-range live pass updates the map and the bubble", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const row = zoomRowOf(panelOf(item)!)!;

    zoomSliderOf(row).setValue([0, 10]);

    expect(getIntent(ui, "overlay1", "zoomRange")).toEqual([0, 10]);
    const thumb = thumbOf(row, 1);
    thumb.focus();
    const bubble = bubbleOf()!;
    expect(bubble).not.toBeNull();
    expect(bubble.textContent).toBe("10");
    expect(bubble.classList.contains("is-on")).toBe(true);

    thumb.blur();
    expect(bubble.classList.contains("is-on")).toBe(false);
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
    zoomSliderOf(row).setValue([0, 10]);

    expect(row.classList.contains(CONST.CLASSES.STYLE_ZOOM_RANGE_OUT_OF_RANGE)).toBe(
      false,
    );
    expect(row.title).toContain("style_zoom_range_current");
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

    expect(panel.querySelector(`.${CONST.CLASSES.STYLE_OPACITY_TRACK}`)).toBeNull();
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
    const host = panel.querySelector(
      `.${CONST.CLASSES.STYLE_OPACITY_TRACK}`,
    ) as HTMLElement;
    const slider = sliderOf(host)!;

    // The thumb outlives the rail it was drawn in, and the rail took the fill
    // with it. Neither ornament carries the value — the slider instance does,
    // so the write still has to land.
    host.querySelector(".foliplus-slider-rail")?.remove();
    slider.setValue(30);

    expect(host.querySelector(".foliplus-slider-fill")).toBeNull();
    expect(li.opacity).toBe(0.3);
  });

  it("resets the range when the row has lost a thumb", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const row = zoomRowOf(panel)!;
    setIntent(ui, "overlay1", "zoomRange", [4, 9]);
    row.querySelector('.foliplus-slider-thumb[data-index="1"]')?.remove();

    // The reset pass syncs the row's remaining marks, so a missing thumb has
    // to be skipped rather than dereferenced — and the click still has to
    // reach the panel close at the end of the handler.
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
    const thumb = thumbOf(row, 0);

    zoomSliderOf(row).setValue([4, 18]);
    expect(getIntent(ui, "overlay1", "zoomRange")).toEqual([4, 18]);

    // The row outlives its layer: nothing is left to write the range into, so
    // the live pass has to bail instead of writing a range for a ghost.
    manager.unregisterLayer("overlay1");
    press(thumb, "ArrowRight");
    press(thumb, "ArrowRight");

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

    expect(panel.querySelector(`.${CONST.CLASSES.STYLE_OPACITY_TRACK}`)).toBeNull();
    expect(zoomRowOf(panel)).not.toBeNull();
  });

  it("gives an annotation layer a zoom row when only opacity is unavailable", () => {
    // Same split, annotation flavour: the panel still offers the zoom range.
    manager.registerLayer({
      id: "annotOnly",
      name: "AnnotOnly",
      layer: { options: {}, eachLayer: vi.fn() },
    });
    ui.runtimeStore.setFields("annotOnly", [{ name: "count", numeric: true }]);
    const li = manager.layerRegistry.get("annotOnly")!;
    manager.surfaceFor(li).capabilities.opacity = "none";

    const item = findItem(ui, "annotOnly");
    ui.openStylePanel("annotOnly");
    const panel = panelOf(item)!;

    expect(panel.querySelector(`.${CONST.CLASSES.STYLE_OPACITY_TRACK}`)).toBeNull();
    expect(zoomRowOf(panel)).not.toBeNull();
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
    expect(thumbOf(row, 1).getAttribute("aria-valuemax")).toBe("15");
  });

  it("does not ratchet the slider's max when the map derives from the write", () => {
    // If dispatchStateOp wrote layer.options.maxZoom, Leaflet would derive
    // the map's max from the layer's max, and the map's max would drop to
    // the last drag. The WeakMap snapshot prevents the slider from
    // re-reading the polluted value. The mock simulates the pollution.
    const li = manager.layerRegistry.get("base1")!;
    (li.layer!.options as { maxZoom?: number }).maxZoom = 15;
    map.getMaxZoom.mockReturnValue(18);
    const item = findItem(ui, "base1");
    ui.openStylePanel("base1");
    const row = zoomRowOf(panelOf(item)!)!;
    expect(thumbOf(row, 1).getAttribute("aria-valuemax")).toBe("15");

    zoomSliderOf(row).setValue([0, 10]);
    // Polluted map max after the drag — the ratchet case.
    map.getMaxZoom.mockReturnValue(10);
    (ui.c as any).onZoomend?.();
    // Reopen the panel and check the bound has not been narrowed.
    ui.closeStylePanel?.(false);
    ui.openStylePanel("base1");
    const newRow = zoomRowOf(panelOf(item)!)!;
    expect(thumbOf(newRow, 1).getAttribute("aria-valuemax")).toBe("15");
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
    const max = thumbOf(row, 1).getAttribute("aria-valuemax");
    expect(max).not.toBe("Infinity");
    expect(Number(max)).toBe(20);
    const maxLabel = row.querySelector(".foliplus-slider-value-max") as HTMLElement;
    expect(maxLabel.textContent).not.toBe("Infinity");
  });

  it("the slider's min bound is the layer's declared minZoom, not the map's", () => {
    const li = manager.layerRegistry.get("base1")!;
    (li.layer!.options as { minZoom?: number }).minZoom = 2;
    map.getMinZoom.mockReturnValue(0);
    const item = findItem(ui, "base1");
    ui.openStylePanel("base1");
    const row = zoomRowOf(panelOf(item)!)!;
    expect(thumbOf(row, 0).getAttribute("aria-valuemin")).toBe("2");
  });

  it("does not ratchet the slider's min when the map derives from the write", () => {
    const li = manager.layerRegistry.get("base1")!;
    (li.layer!.options as { minZoom?: number }).minZoom = 3;
    map.getMinZoom.mockReturnValue(0);
    const item = findItem(ui, "base1");
    ui.openStylePanel("base1");
    const row = zoomRowOf(panelOf(item)!)!;
    expect(thumbOf(row, 0).getAttribute("aria-valuemin")).toBe("3");

    zoomSliderOf(row).setValue([7, 18]);
    map.getMinZoom.mockReturnValue(7);
    ui.closeStylePanel?.(false);
    ui.openStylePanel("base1");
    const newRow = zoomRowOf(panelOf(item)!)!;
    expect(thumbOf(newRow, 0).getAttribute("aria-valuemin")).toBe("3");
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
      role: "overlay",
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
    // The author declared no max, so it fell back to the map's 18 —
    // not the persisted zoomRange value of 10.
    expect(Number(thumbOf(row, 1).getAttribute("aria-valuemax"))).toBe(18);
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
    ui.runtimeStore.setFields("overlay1", [{ name: "count", numeric: true }]);
    // The Label section needs the annotation capability (the gate no longer
    // reads the field cache).
    const li = ui.c.layerRegistry.get("overlay1")!;
    const surface = ui.c.surfaceFor(li) as unknown as {
      capabilities: Record<string, unknown>;
    };
    surface.capabilities = { ...surface.capabilities, annotation: "pane" };
    const panelOf = (item: HTMLElement) =>
      item.querySelector(`.${CONST.CLASSES.STYLE_PANEL}`) as HTMLElement | null;
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
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
    expect(ui.c.annotation.getConfig("overlay1")!.show).toBe(true);
  });

  it("annotation panel setup tolerates missing color/size inputs", () => {
    // Covers `if (colorEl)` and `if (sizeEl)` false sides in the panel setup.
    // We mock querySelector to return null for the color/size selectors so the
    // setup code skips the live-binding step.
    const { ui } = initFixture();
    ui.runtimeStore.setFields("overlay1", [{ name: "count", numeric: true }]);
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
    // `if (!ui.c.layerRegistry.has(layerId)) return` — a Reset aimed at a
    // layer that has already left must not rewrite the record or save.
    const { ui } = initFixture({});
    setIntent(ui, "ghost", "opacity", 0.4);
    ui.intentStore.seedProvenance("ghost", ["opacity"]);
    expect(() => resetLayerOpacity(ui, "ghost")).not.toThrow();
    expect(getIntent(ui, "ghost", "opacity")).toBe(0.4);
    expect(ui.intentStore.dumpProvenance().ghost).toEqual(["opacity"]);
  });

  it("resetLayerZoomRange returns before touching state", () => {
    const { ui } = initFixture({});
    setIntent(ui, "ghost", "zoomRange", [3, 12]);
    ui.intentStore.seedProvenance("ghost", ["zoomRange"]);
    expect(() => resetLayerZoomRange(ui, "ghost")).not.toThrow();
    expect(getIntent(ui, "ghost", "zoomRange")).toEqual([3, 12]);
    expect(ui.intentStore.dumpProvenance().ghost).toEqual(["zoomRange"]);
  });
});

describe("reset whose dimension reports no delta", () => {
  // `reset?` is typed `ProjectionDelta | void`: a dimension runs its own side
  // effects and is free to report nothing back. Both entry points fall back to
  // the empty delta for that case, so the publish contract still holds — a
  // reset that cannot say what moved announces nothing.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resetLayerOpacity returns the empty delta", () => {
    const { ui } = initFixture({});
    const descriptor = getDimension(DIM.OPACITY)!;
    const resetSpy = vi.spyOn(descriptor, "reset").mockReturnValue(undefined);

    expect(resetLayerOpacity(ui, "overlay1")).toEqual({
      wroteVisible: false,
      intentMoved: false,
    });
    expect(resetSpy).toHaveBeenCalledWith(ui, "overlay1");
  });

  it("resetLayerZoomRange returns the empty delta", () => {
    const { ui } = initFixture({});
    const descriptor = getDimension(DIM.ZOOM_RANGE)!;
    const resetSpy = vi.spyOn(descriptor, "reset").mockReturnValue(undefined);

    expect(resetLayerZoomRange(ui, "overlay1")).toEqual({
      wroteVisible: false,
      intentMoved: false,
    });
    expect(resetSpy).toHaveBeenCalledWith(ui, "overlay1");
  });
});

// ── Notification-contract cases, moved from the former
// ── notifyContract.test.ts so they live with the script they drive. ──
it("a reset button announces once, after the panel is closed", () => {
  // The panel Reset restores every dimension, then the delegated defaults
  // (or the label config), then closes the panel — and only then announces,
  // once, for the whole operation. A notify fired by one dimension mid-way
  // would hand a subscriber a panel that is still open, and a subscriber
  // that tears the control down there would take the handler's own
  // closeStylePanel lookup with it.
  const { ui, layer, onMap } = oneOverlay();

  setIntent(ui, "overlay1", "zoomRange", [0, 3]);
  ui.intentStore.seedProvenance("overlay1", ["zoomRange"]);
  ui.onZoomEnd?.();
  expect(onMap.get(layer)).toBe(false);

  ui.openStylePanel("overlay1");
  const resetBtn = findItem(ui, "overlay1").querySelector(
    ".foliplus-style-reset-btn",
  ) as HTMLElement;
  expect(resetBtn).not.toBeNull();

  const atDelivery: Array<{ onMap: boolean; panelOpen: boolean }> = [];
  ui.events.on(EVENTS.LAYER_CHANGE, payload => {
    if (payload.id !== "overlay1") return;
    const item = ui.uiContainer?.querySelector(
      `[${CONST.DATA.LAYER_ID}="${payload.id}"]`,
    );
    atDelivery.push({
      onMap: onMap.get(layer) ?? false,
      panelOpen: !!item?.querySelector(`.${CONST.CLASSES.STYLE_PANEL}`),
    });
    if (atDelivery.length === 1) ui.c.destroy();
  });

  expect(() =>
    resetBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })),
  ).not.toThrow();
  expect(atDelivery).toEqual([{ onMap: true, panelOpen: false }]);
  expect(ui.c.isDestroyed).toBe(true);
});

it("a zoomend skips the row sync once the zoom-range row is detached", () => {
  // The panel's zoom-end hook is registered while the drawer is open, but a
  // list rebuild or a teardown can take the row out from under it before the
  // map fires. Reading the detached node would repaint a row nobody sees, so
  // the hook checks first.
  const { ui } = oneOverlay();
  ui.openStylePanel("overlay1");
  const row = findItem(ui, "overlay1").querySelector(
    `.${CONST.CLASSES.STYLE_ZOOM_RANGE_ROW}`,
  ) as HTMLElement;
  expect(row).not.toBeNull();

  row.remove();

  expect(() => ui.onZoomEnd?.()).not.toThrow();
});

// ── Capability live refresh ─────────────────────────────────────
// The style panel gates its rows on the surface capability projection when it
// is built, so a recovery must reach a panel that is already open. The
// controller announces projection changes at the tail of every ordering pass
// (LAYER_CAPABILITY_CHANGED) and the open drawer re-renders from the fresh
// projection.

describe("style panel live capability refresh", () => {
  /** A container whose children can change under the surface, with Leaflet's
   *  membership shape (eachLayer / addLayer / removeLayer / hasLayer). */
  const mutableGroup = (children: unknown[] = []) => {
    const group = {
      options: {} as Record<string, unknown>,
      children,
      eachLayer(fn: (child: unknown) => void) {
        for (const child of group.children) fn(child);
      },
      addLayer(layer: unknown) {
        group.children.push(layer);
        return group;
      },
      removeLayer(layer: unknown) {
        group.children = group.children.filter(child => child !== layer);
        return group;
      },
      hasLayer(layer: unknown) {
        return group.children.includes(layer);
      },
    };
    return group as unknown as L.Layer & { children: unknown[] };
  };

  it("re-renders an open panel when the capability recovers", () => {
    const { manager, ui } = initFixture({ data: [] });
    const group = mutableGroup([new window.L.Path()]);
    manager.registerLayer({
      id: "recover1",
      name: "Recover",
      role: "overlay",
      layer: group,
    });
    // Seed the capability snapshot with the healthy projection (first sight is
    // recorded silently) before the degrade, so the recovery is a real diff.
    manager.enforceOrder();
    const surface = manager.surfaceFor(manager.layerRegistry.get("recover1")!);
    expect(surface.capabilities.opacity).toBe("pane");
    const item = findItem(ui, "recover1");

    // A leaf no migrator can relocate: a pane opacity write would fade part of
    // the layer and miss the rest, so the axis must degrade.
    const foreign = { options: {}, getElement: () => document.createElement("div") };
    group.addLayer(foreign);
    manager.onLayerAdd({ layer: foreign } as never);
    manager.enforceOrder();
    expect(surface.capabilities.opacity).toBe("none");

    ui.openStylePanel("recover1");
    expect(ui.overlayPanel.stylePanelLayerId).toBe("recover1");
    expect(item.querySelector(`.${CONST.CLASSES.STYLE_OPACITY_TRACK}`)).toBeNull();

    // The foreign leaf leaves. A pass re-derives the projection; the panel that
    // is open right now must show the recovered row without a close/reopen.
    manager.onLayerRemove({ layer: foreign } as never);
    group.removeLayer(foreign);
    manager.enforceOrder();

    expect(surface.capabilities.opacity).toBe("pane");
    expect(ui.overlayPanel.stylePanelLayerId).toBe("recover1");
    expect(item.querySelector(`.${CONST.CLASSES.STYLE_OPACITY_TRACK}`)).not.toBeNull();

    // The other direction too: a degrade while the panel is open drops the
    // row instead of leaving a control that would write into a foreign tree.
    group.addLayer(foreign);
    manager.onLayerAdd({ layer: foreign } as never);
    manager.enforceOrder();
    expect(surface.capabilities.opacity).toBe("none");
    expect(ui.overlayPanel.stylePanelLayerId).toBe("recover1");
    expect(item.querySelector(`.${CONST.CLASSES.STYLE_OPACITY_TRACK}`)).toBeNull();
  });
});
