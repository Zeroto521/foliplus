// test/js/control/LayerControl/ui/style/index.guard — style utility guards and the hover carve-out.
import { findItem, initFixture, oneOverlay } from "../fixture.js";
import {
  BASE_RULE,
  CARVEOUT,
  ROW_PANEL_CLASS,
  css,
  hasZeroSpecificityCarveOut,
  selectorOf,
} from "./index.fixture.js";
import { describe, expect, it, vi } from "vitest";
import { EVENTS } from "#foliplus/core/event/index.js";
import * as CONST from "#control/LayerControl/const.js";
import { setIntent } from "#control/LayerControl/ui/intent.js";
import { renderDelegatedStylePanel } from "#control/LayerControl/ui/style/delegated.js";
import { clampPct } from "#control/LayerControl/ui/style/opacity.js";

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
    // that declares an empty setter map still falls through to the label
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
    // Covers the three defensive null checks in the label toggle handler:
    // `if (body)`, `fieldSel?.value ?? cfg.field`, and `if (fmtRow)`.
    // Removing the elements from the panel DOM exercises the false sides.
    const { ui } = initFixture();
    ui.runtimeStore.setFields("overlay1", [{ name: "count", numeric: true }]);
    // The Label section needs the label capability (the gate no longer
    // reads the field cache).
    const li = ui.c.layerRegistry.get("overlay1")!;
    const surface = ui.c.surfaceFor(li) as unknown as {
      capabilities: Record<string, unknown>;
    };
    surface.capabilities = { ...surface.capabilities, label: "pane" };
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
    expect(ui.c.label.getConfig("overlay1")!.show).toBe(true);
  });

  it("label panel setup tolerates missing color/size inputs", () => {
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

// ── Notification-contract cases, moved from the former
// ── notifyContract.test.ts so they live with the script they drive. ──
it("a reset button announces once, after the panel refresh", () => {
  // The panel Reset restores every dimension, then the delegated defaults
  // (or the label config), refreshes the open panel, and only then announces,
  // once, for the whole operation. A notify fired by one dimension mid-way
  // would hand a subscriber a half-restored panel.
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
  expect(atDelivery).toEqual([{ onMap: true, panelOpen: true }]);
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

describe("layer-row style-panel hover carve-out (stylesheet contract)", () => {
  const row = css("foliplus/css/control/LayerControl/row.css");
  const recipe = selectorOf(row, "&:is(");

  it("the row-cursor hover recipe excludes a hovered style panel at zero specificity", () => {
    expect(hasZeroSpecificityCarveOut(recipe)).toBe(true);
    // The carve-out rides the hover trigger (the row-cursor wake), so a panel
    // hover cannot light the owner row.
    expect(recipe).toContain(":is(");
    expect(recipe).toContain(`:has(.${ROW_PANEL_CLASS}:hover)`);
  });

  it("negative control: dropping the :has carve-out is exactly the regression", () => {
    // Rebuild the selector a future edit would leave behind: the hover trigger
    // stays, the carve-out is gone. That is the measured bug — a panel hover
    // lights the owner row again.
    const regressed = recipe.replace(CARVEOUT, "");
    expect(regressed).toContain(":is(");
    expect(regressed).not.toContain(`:has(.${ROW_PANEL_CLASS}:hover)`);
    expect(regressed).not.toContain(":has(");
    // The detection above (which the positive case uses) reports the
    // regression: the carve-out is the only thing standing between a panel
    // hover and the row-cursor wake.
    expect(hasZeroSpecificityCarveOut(regressed)).toBe(false);
  });

  it("base row hover stays quiet: the recipe must not out-rank the base-row rule", () => {
    // The row-cursor recipe and the base-row quiet rule race on hover. The
    // recipe must stay at (0,2,0) so the base rule (0,3,0) still wins and a
    // hovered basemap row shows no glow / white surface.
    const baseRule = selectorOf(row, BASE_RULE);
    expect(baseRule).toContain('[data-layer-type="base"]');
    // Red to green evidence: the bare :not(:has()) form (the P1-A regression)
    // raises the recipe to (0,4,0) and is DETECTED; the :where() form is not.
    const broken =
      ":is(:hover, .foliplus-is-focused-row):not(:has(.foliplus-row-panel:hover))";
    expect(hasZeroSpecificityCarveOut(broken)).toBe(false);
    expect(hasZeroSpecificityCarveOut(recipe)).toBe(true);
  });

  it("a keyboard-focused row keeps the wake while the panel is hovered", () => {
    // The focus branch (static class) is NOT carved out, so the recipe — the
    // white surface / glow — still matches a focused row that contains a style
    // panel. jsdom matches this branch behaviorally.
    document.body.innerHTML = `<div id="row" class="foliplus-layer-item foliplus-is-focused-row"><div class="foliplus-row-panel foliplus-layer-style-panel"></div></div>`;
    const focused = document.getElementById("row") as HTMLElement;
    const recipeSel = `.foliplus-layer-item:is(:hover:where(:not(:has(.${ROW_PANEL_CLASS}:hover))), .foliplus-is-focused-row)`;
    expect(focused.matches(recipeSel)).toBe(true);
    // And a non-focused row does not match without a pointer (the hover branch
    // is inert in jsdom; the point is the focus branch is the only gate left).
    document.body.innerHTML = `<div id="plain" class="foliplus-layer-item"><div class="foliplus-row-panel foliplus-layer-style-panel"></div></div>`;
    const plain = document.getElementById("plain") as HTMLElement;
    expect(plain.matches(recipeSel)).toBe(false);
  });
});
