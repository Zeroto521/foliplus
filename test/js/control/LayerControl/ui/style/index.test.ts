// test/js/control/LayerControl/ui/style/index — panel opening, closing and the label section.
import { findItem, initFixture } from "../fixture.js";
import { keepBubble, restoreBubble } from "./index.fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureModes } from "#core/lifecycle/index.js";
import { OVERLAY_IDS, ensureOverlayRegistry } from "#core/overlay/index.js";
import { NUMBER_FORMAT } from "#platform/format.js";
import { registerPortalRoot } from "#platform/portalRoot.js";
import * as CONST from "#control/LayerControl/const.js";
import { type LayerController } from "#control/LayerControl/controller.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";
import { seedIntentMap } from "#control/LayerControl/ui/intent.js";
import { closeStylePanel } from "#control/LayerControl/ui/style/index.js";
import { coerceAnnotationFields } from "#control/LayerControl/ui/style/label.js";

describe("LayerUI style panel", () => {
  let manager: LayerController;

  let ui: LayerUI;

  let map: any;

  beforeEach(() => {
    restoreBubble();
    ({ manager, ui, map } = initFixture());
    ui.listPanel.foldedRoles = {};
    seedIntentMap(ui, "visible", {});
    window.localStorage.removeItem(CONST.STORAGE.KEY);
    // Seed the field cache so the panel builds: collectFields walks the
    // layer's leaves, and the fixture's data layer has none. `count` is a
    // number, which is what makes the number-format row reachable.
    ui.runtimeStore.setFields("overlay1", [{ name: "count", numeric: true }]);
    // The Label section's gate is the surface's label capability — a
    // probe over real feature data, which this fixture layer has none of.
    // The field cache supplies the picker's options; this bit supplies the
    // section's right to render — the two dials the old `hasLabel` gate
    // read from a single place.
    const li = manager.layerRegistry.get("overlay1")!;
    const surface = manager.surfaceFor(li) as unknown as {
      capabilities: Record<string, unknown>;
    };
    surface.capabilities = { ...surface.capabilities, label: "pane" };
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

  it("deleting the layer closes its open style panel (LAYER_REMOVED)", () => {
    // A user-added layer retires through retireEntry → LAYER_REMOVED; the
    // style panel must close itself rather than leave a drawer for a row
    // that is about to disappear.
    manager.registerLayer({
      id: "L1",
      name: "Added",
      role: "overlay",
      layer: { options: {}, eachLayer: vi.fn() },
    } as any);
    const item = findItem(ui, "L1");
    ui.openStylePanel("L1");
    expect(panelOf(item)).not.toBeUndefined();

    expect(manager.deleteLayer("L1")).toBe(true);

    // The row is gone from the DOM; the panel state must be fully closed.
    expect(ui.overlayPanel.stylePanelLayerId).toBeNull();
    expect(ui.overlayPanel.stylePanelEl).toBeNull();
    expect(ui.overlayPanel.styleUnsubscribe).toBeNull();
    expect(ui.overlayPanel.styleRemovedUnsub).toBeNull();
    expect(document.querySelector(`.${CONST.CLASSES.STYLE_PANEL}`)).toBeNull();
  });

  it("deleting another layer keeps this style panel open", () => {
    manager.registerLayer({
      id: "L1",
      name: "Added",
      role: "overlay",
      layer: { options: {}, eachLayer: vi.fn() },
    } as any);
    manager.registerLayer({
      id: "L2",
      name: "Other",
      role: "overlay",
      layer: { options: {}, eachLayer: vi.fn() },
    } as any);
    const item = findItem(ui, "L1");
    ui.openStylePanel("L1");
    expect(panelOf(item)).not.toBeUndefined();

    expect(manager.deleteLayer("L2")).toBe(true);

    expect(panelOf(findItem(ui, "L1"))).not.toBeUndefined();
    expect(ui.overlayPanel.stylePanelLayerId).toBe("L1");
    expect(ui.overlayPanel.styleRemovedUnsub).not.toBeNull();
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
    surface.capabilities = { ...surface.capabilities, label: "none" };
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
    // label bit included — `label: "none"` is what says "no labelable
    // content" (a missing key would read as capable).
    const li = manager.layerRegistry.get("overlay1")!;
    (manager.surfaceFor(li) as any).capabilities = {
      opacity: "none",
      zoomRange: "none",
      label: "none",
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
    // primitive owns that, platform/portalRoot); the fixture mounts the same
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

  it("a press on another surface's picker portal dismisses this drawer", () => {
    // The class alone is not ownership. A list registered for a trigger outside
    // this drawer belongs to that surface, so this drawer must dismiss: matching
    // the class document-wide would keep it open under a press it does not own.
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;

    const foreignTrigger = document.createElement("button");
    document.body.appendChild(foreignTrigger);
    const foreign = document.createElement("div");
    foreign.className = "foliplus-scheme-picker-portal";
    const foreignRow = document.createElement("button");
    foreignRow.className = "foliplus-scheme-picker-item";
    foreign.appendChild(foreignRow);
    document.body.appendChild(foreign);
    // The drawer is live on its own panel, and the foreign portal is outside that
    // panel's subtree: neither a subtree walk nor a document-wide class match can
    // produce the dismissal this test asserts — only trigger ownership can.
    expect(panelOf(item)).toBe(panel);
    expect(panel.contains(foreign)).toBe(false);
    const release = registerPortalRoot(foreign, foreignTrigger);

    try {
      foreignRow.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );

      expect(panelOf(item)).toBeUndefined();
    } finally {
      release();
      foreign.remove();
      foreignTrigger.remove();
    }
  });

  it("a press on another surface's picker portal dismisses this drawer via the outside-mousedown handler", () => {
    // The class alone is not ownership. handleOutsideMousedown classifies a
    // press through core/overlay's predicate, and a codebase that still passes
    // a portal selector would answer "mine" for a portal this drawer does not
    // own (its trigger is outside the drawer) — the same press-stealing bug
    // from the other side. Only trigger ownership can dismiss here.
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");

    const foreignTrigger = document.createElement("button");
    document.body.appendChild(foreignTrigger);
    const foreign = document.createElement("div");
    foreign.className = "foliplus-scheme-picker-portal";
    const foreignRow = document.createElement("button");
    foreignRow.className = "foliplus-scheme-picker-item";
    foreign.appendChild(foreignRow);
    document.body.appendChild(foreign);
    const release = registerPortalRoot(foreign, foreignTrigger);

    try {
      // jsdom does not populate event.target on dispatch, so pin it directly.
      const event = new MouseEvent("mousedown", { bubbles: true });
      Object.defineProperty(event, "target", { value: foreignRow });
      ui.handleOutsideMousedown(event);

      expect(panelOf(item)).toBeUndefined();
    } finally {
      release();
      foreign.remove();
      foreignTrigger.remove();
    }
  });

  // ─────────────────── control interactions ───────────────────

  it("flipping the toggle updates the config, labels and persistence", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const setConfig = vi.spyOn(manager.label, "setConfig");
    const renderLabels = vi.spyOn(manager.label, "renderLabels");
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
    // label`) — the legacy top-level `annotations` source is gone.
    const fields = saveAnnotations.mock.calls.at(-1)![0] as {
      layers: () => Record<string, { label?: Record<string, unknown> }>;
    };
    expect(fields.layers().overlay1.label).toEqual(
      expect.objectContaining({ show: true }),
    );
    expect(manager.label.getConfig("overlay1").show).toBe(true);
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
    const setConfig = vi.spyOn(manager.label, "setConfig");

    const collide = panelOf(item)!.querySelector(
      ".foliplus-style-collide-input",
    ) as HTMLInputElement;
    collide.checked = false;
    collide.dispatchEvent(new Event("change", { bubbles: true }));

    expect(setConfig).toHaveBeenCalled();
    expect(manager.label.getConfig("overlay1").collide).toBe(false);
  });

  it("label body order is field → color/size → format → collide", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");

    const rows = [
      ...panelOf(item)!.querySelectorAll(".foliplus-style-body .foliplus-form-row"),
    ];
    const labels = rows.map(
      r => r.querySelector(".foliplus-form-label")?.textContent ?? "",
    );
    expect(labels).toEqual([
      // Field is label-only, so it stays component-scoped; the rest come
      // from the shared vocabulary the drawer renders from the common table.
      "LayerControl.style_label_field",
      "foliplus.label_style",
      "foliplus.label_format",
      "foliplus.label_collide",
    ]);
  });

  it("label color and size inputs are live and clamp on commit", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const renderLabels = vi.spyOn(manager.label, "renderLabels");

    const color = panelOf(item)!.querySelector(
      ".foliplus-style-label-color-input",
    ) as HTMLInputElement;
    const size = panelOf(item)!.querySelector(
      ".foliplus-style-label-size-input",
    ) as HTMLInputElement;

    color.value = "#00ff00";
    color.dispatchEvent(new Event("input", { bubbles: true }));
    expect(manager.label.getConfig("overlay1").color).toBe("#00ff00");
    expect(renderLabels).toHaveBeenCalled();

    size.value = "18";
    size.dispatchEvent(new Event("input", { bubbles: true }));
    expect(manager.label.getConfig("overlay1").size).toBe(18);

    size.value = "99";
    size.dispatchEvent(new Event("change", { bubbles: true }));
    expect(manager.label.getConfig("overlay1").size).toBe(32);
    expect(size.value).toBe("32");
  });

  it("label panel falls back when config color/size are empty", () => {
    manager.label.setConfig("overlay1", {
      ...CONST.DEFAULT_LABEL,
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
    manager.label.setConfig("overlay1", {
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
    seedIntentMap(ui, "label", {
      overlay1: { show: true, field: 42, format: 7 } as any,
    });

    ui.applyStyleLabelState();

    const cfg = manager.label.getConfig("overlay1");
    expect(cfg.field).toBe("");
    expect(cfg.format).toBe(NUMBER_FORMAT.AUTO);
  });

  it("coerceAnnotationFields is the single home of the field rules", () => {
    // Every future label field (e.g. position) extends this one function —
    // the tolerant parse passes unknown keys through untouched.
    expect(coerceAnnotationFields(null)).toEqual({
      show: false,
      field: "",
      color: CONST.DEFAULT_LABEL.color,
      size: CONST.DEFAULT_LABEL.size,
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
    manager.label.setConfig("overlay1", {
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
    const setConfig = vi.spyOn(manager.label, "setConfig");

    const field = panelOf(item)!.querySelector(
      ".foliplus-style-field-select",
    ) as HTMLSelectElement;
    field.value = "count";
    field.dispatchEvent(new Event("change", { bubbles: true }));

    expect(setConfig).toHaveBeenCalled();
    expect(manager.label.getConfig("overlay1").field).toBe("count");
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
    expect(manager.label.getConfig("overlay1").field).toBe("count");
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
    expect(manager.label.getConfig("overlay1").field).toBe("count");
  });
});
