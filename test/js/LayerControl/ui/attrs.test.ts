import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/LayerControl/const.js";
import type { LayerManager } from "#foliplus/LayerControl/manager.js";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import { ensureModes } from "#foliplus/core/mode.js";
import {
  allFolded,
  attachWithGroup,
  findItem,
  initFixture,
  overlayFoldBtn,
  pressKey,
} from "./fixture.js";

describe("LayerUI attrs", () => {
  let manager: LayerManager;
  let ui: LayerUI;
  let map: any;

  beforeEach(() => {
    ({ manager, ui, map } = initFixture());
    // Fold tests need two overlay layers, so overlay1 isn't collapsed into the
    // single-child "no toggle-all" layout. Registered here (not in the tests)
    // because initFixture() flushes the 300ms initTypesAndVisibility timeout
    // AFTER any nested beforeEach, which would drop a layer added inside a test.
    if (!manager.layerRegistry.get("overlay2")) {
      manager.registerLayer({
        id: "overlay2",
        name: "Circles",
        isBase: false,
        layer: { options: {}, eachLayer: vi.fn() },
      });
    }
    ui.foldedGroups = new Set();
    ui.hiddenIds = new Set();
    // Folded-group state is persisted to localStorage, so a fold from one test
    // would be re-read by the next test's LayerUI constructor and present as
    // already-folded.
    window.localStorage.removeItem(CONST.STORAGE.FOLD_KEY);
  });

  afterEach(() => {
    // Drop the debounced enforceOrder before tearing down the DOM — a real
    // timer would otherwise fire after body.innerHTML = "" and hit a detached
    // container (PaneManager.ensurePane).
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
    // LayerControl holds "focusing" mode during an in-flight focus; clear it
    // on the FIXTURE map (not window.map) so a focus-holding test cannot leak.
    if (map) {
      const modes = ensureModes(map);
      if (modes.getMode("LayerControl") === "focusing") {
        modes.setMode("LayerControl", null);
      }
    }
  });

  // ─────────────────── focusLayer() ───────────────────

  describe("openAttrsPanel() / closeAttrsPanel()", () => {
    const rows = (panel: HTMLElement): Array<[string, string]> =>
      Array.from(panel.querySelectorAll(".foliplus-form-row")).map(
        r =>
          [
            r.querySelector(".foliplus-form-label")!.textContent!,
            r.querySelector(".foliplus-form-control")!.textContent!,
          ] as [string, string],
      );

    it("renders the built-in rows only (nothing registered → no — padding)", () => {
      const item = findItem(ui, "overlay1");

      ui.openAttrsPanel(item);

      const panel = item.querySelector(".foliplus-layer-attrs-panel")!;
      expect(panel).not.toBeNull();
      expect(panel.getAttribute("role")).toBe("dialog");
      const rendered = rows(panel);
      // T() falls back to the locale key in jsdom, so assert on keys. The
      // layer name lives in the header, not in the row list; type and feature
      // count stay on the layer row, so the panel carries provenance only.
      const keys = rendered.map(([label]) => label);
      // Nothing registered → no source / no update time. Type, feature count
      // and the registration timestamp are always known, so those rows show.
      expect(keys).toEqual([
        "LayerControl.attr_type",
        "LayerControl.attr_feature_count",
        "LayerControl.attr_created_at",
      ]);
      expect(keys).not.toContain("LayerControl.attr_name");
      expect(panel.querySelector(".foliplus-header-title")!.textContent).toContain(
        "Polygons",
      );
    });

    it("reads name / source / updatedAt / meta from registerLayer opts", () => {
      // A fresh id — `opts.name` only applies on first registration; the
      // registry keeps the existing name for an already-known id (a user
      // rename must survive the provider re-registering).
      manager.registerLayer({
        id: "attr-prov1",
        name: "Parks",
        source: "https://example.com/parks.geojson",
        updatedAt: "2026-09-01T08:00:00Z",
        meta: { area_km2: 12.5 },
      });

      const item = findItem(ui, "attr-prov1");
      ui.openAttrsPanel(item);
      const panel = item.querySelector(".foliplus-layer-attrs-panel")!;
      const rendered = rows(panel);

      // The layer name is the panel header now, not a row.
      expect(panel.querySelector(".foliplus-header-title")!.textContent).toContain(
        "Parks",
      );
      expect(rendered).toContainEqual([
        "LayerControl.attr_source",
        "https://example.com/parks.geojson",
      ]);
      expect(rendered.find(([k]) => k === "LayerControl.attr_updated_at")?.[1]).toBe(
        // Expectation built with the same formatTimestamp options, so the
        // assertion holds regardless of the runner's timezone / ICU data.
        new Date("2026-09-01T08:00:00Z").toLocaleString(CONF.locale_code, {
          dateStyle: "medium",
          timeStyle: "short",
        }),
      );
      expect(rendered).toContainEqual(["area_km2", "12.5"]);
      // No grouping: third-party rows continue the same list, so there is no
      // separator and only one list in the panel.
      expect(item.querySelectorAll(".foliplus-layer-attrs-sep").length).toBe(0);
      expect(item.querySelectorAll(".foliplus-layer-attrs-panel dl").length).toBe(1);
    });

    it("omits the custom-attributes block when meta is empty", () => {
      manager.registerLayer({ id: "overlay1", meta: { empty: "" } });

      const item = findItem(ui, "overlay1");
      ui.openAttrsPanel(item);

      expect(item.querySelectorAll(".foliplus-layer-attrs-sep").length).toBe(0);
      // One block only: a single heading and a single list.
      expect(item.querySelectorAll(".foliplus-header-title").length).toBe(1);
      expect(item.querySelectorAll(".foliplus-layer-attrs-panel dl").length).toBe(1);
    });

    it("continues meta rows in the same list, after the built-in rows", () => {
      manager.registerLayer({ id: "attr-meta1", meta: { area_km2: 12.5 } });

      const item = findItem(ui, "attr-meta1");
      ui.openAttrsPanel(item);

      // One flat list: no separator, no second block heading.
      expect(item.querySelectorAll(".foliplus-layer-attrs-panel dl").length).toBe(1);
      expect(item.querySelectorAll(".foliplus-layer-attrs-sep").length).toBe(0);

      const labels = Array.from(item.querySelectorAll(".foliplus-form-label")).map(
        el => el.textContent,
      );
      expect(labels[labels.length - 1]).toBe("area_km2");
    });

    it("names the panel in its header and flags the source row as wide", () => {
      manager.registerLayer({
        id: "attr-hero1",
        name: "Parks",
        source: "https://example.com/parks.geojson",
      });

      const item = findItem(ui, "attr-hero1");
      ui.openAttrsPanel(item);

      const header = item.querySelector(".foliplus-panel-header")!;
      expect(header.querySelector(".foliplus-header-title")!.textContent).toContain(
        "Parks",
      );
      // A close affordance sits at the end of the header bar (shared ×).
      expect(header.querySelector(".foliplus-close-btn")).not.toBeNull();
      const wide = item.querySelector(".foliplus-form-control.wide");
      expect(wide!.textContent).toBe("https://example.com/parks.geojson");
    });

    it("formats the timestamp from epoch ms", () => {
      manager.registerLayer({
        id: "attr-time1",
        updatedAt: new Date(Date.UTC(2026, 8, 1, 8, 0, 0)).getTime(),
      });

      const item = findItem(ui, "attr-time1");
      ui.openAttrsPanel(item);

      expect(
        rows(item.querySelector(".foliplus-layer-attrs-panel")!).find(
          ([k]) => k === "LayerControl.attr_updated_at",
        )?.[1],
        // Derived from the same Date + options the implementation formats, so
        // this passes under any runner timezone or ICU build.
      ).toBe(
        new Date(Date.UTC(2026, 8, 1, 8, 0, 0)).toLocaleString(CONF.locale_code, {
          dateStyle: "medium",
          timeStyle: "short",
        }),
      );
    });

    it("reflects the hidden state in the type row's neighbour set", () => {
      const item = findItem(ui, "overlay1");
      (item.querySelector('input[type="checkbox"]') as HTMLInputElement).checked =
        false;

      ui.openAttrsPanel(item);

      // Visibility is intentionally not listed; the panel still opens and
      // names the layer.
      const panel = item.querySelector(".foliplus-layer-attrs-panel")!;
      const labels = Array.from(panel.querySelectorAll(".foliplus-form-label")).map(
        el => el.textContent,
      );
      expect(labels).not.toContain("LayerControl.attr_visible");
      expect(panel.querySelector(".foliplus-header-title")!.textContent).toContain(
        "Polygons",
      );
    });

    it("color basemap shows type and no provenance rows", () => {
      const item = ui.uiContainer.querySelector(`${CONST.SEL.COLOR_ITEM}`)!;

      ui.openAttrsPanel(item);

      const panel = item.querySelector(".foliplus-layer-attrs-panel")!;
      const keys = rows(panel).map(([label]) => label);
      // No source / timestamp registered → the color basemap's panel shows its
      // type only.
      expect(keys).toEqual(["LayerControl.attr_type"]);
      expect(keys).not.toContain("LayerControl.attr_source");
      // The color basemap's own name still titles the panel (T() falls back to
      // the key in jsdom).
      expect(panel.querySelector(".foliplus-header-title")!.textContent).toContain(
        "color_map_label",
      );
      expect(keys).not.toContain("LayerControl.attr_updated_at");
    });

    it("names the type row by what the layer is, not by a missing geometry", () => {
      manager.registerLayer({ id: "attr-base1", isBase: true });
      const baseItem = findItem(ui, "attr-base1");
      ui.openAttrsPanel(baseItem);
      expect(
        rows(baseItem.querySelector(".foliplus-layer-attrs-panel")!),
      ).toContainEqual(["LayerControl.attr_type", "LayerControl.type_base"]);

      ui.closeAttrsPanel(false);
      const colorItem = ui.uiContainer.querySelector(`${CONST.SEL.COLOR_ITEM}`)!;
      ui.openAttrsPanel(colorItem);
      expect(
        rows(colorItem.querySelector(".foliplus-layer-attrs-panel")!),
      ).toContainEqual(["LayerControl.attr_type", "LayerControl.type_color_map"]);
    });

    it("shows the feature count grouped, without a stray fraction digit", () => {
      vi.spyOn(ui.m, "getFeatureCount").mockReturnValue(1234);

      const item = findItem(ui, "overlay1");
      ui.openAttrsPanel(item);

      const count = rows(item.querySelector(".foliplus-layer-attrs-panel")!).find(
        ([k]) => k === "LayerControl.attr_feature_count",
      )?.[1];
      // `comma` is language-agnostic (always en grouping) and the panel passes
      // fractionDigits 0, so the value is exactly "1,234" — not "1,234.0".
      expect(count).toBe("1,234");
    });

    it("builds on the shared panel vocabulary (header, content, form rows)", () => {
      const item = findItem(ui, "overlay1");
      ui.openAttrsPanel(item);
      const panel = item.querySelector(".foliplus-layer-attrs-panel")!;

      expect(panel.classList.contains("foliplus-panel")).toBe(true);
      expect(panel.querySelector(".foliplus-panel-header")).not.toBeNull();
      expect(panel.querySelector(".foliplus-panel-content")).not.toBeNull();
      expect(panel.querySelectorAll(".foliplus-form-row").length).toBeGreaterThan(0);
      expect(panel.querySelectorAll(".foliplus-form-label").length).toBeGreaterThan(0);

      const close = panel.querySelector(".foliplus-close-btn");
      expect(close).not.toBeNull();
      expect(close!.querySelector("svg")).not.toBeNull();
    });

    it("prefers the layer's own iconSvg for the header logo", () => {
      // A non-empty logo: the registry rejects an icon with no content (the
      // allowlist gate treats a bare <svg> as "no icon") and falls through to
      // the geometry glyph, which is what this test must beat. The mark rides
      // on class - the gate keeps presentation attributes, never data-*.
      const logo =
        '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" class="logo"/></svg>';
      manager.registerLayer({ id: "attr-logo1", name: "Logo Layer", iconSvg: logo });

      const item = findItem(ui, "attr-logo1");
      ui.openAttrsPanel(item);

      const icon = item.querySelector(".foliplus-layer-attrs-icon")!.innerHTML;
      // Both marks are this layer's logo; the UNKNOWN/geometry glyphs do not
      // carry either.
      expect(icon).toContain('r="10"');
      expect(icon).toContain('class="logo"');
    });

    it("closeAttrsPanel(setFocus=true) returns focus to the layer row", () => {
      const item = findItem(ui, "overlay1");
      const focusSpy = vi.fn();
      item.focus = focusSpy;

      ui.openAttrsPanel(item);
      ui.closeAttrsPanel(true);

      expect(focusSpy).toHaveBeenCalled();
      expect(item.querySelector(".foliplus-layer-attrs-panel")).toBeNull();
    });

    it("closeAttrsPanel(setFocus=false) does not focus the layer row", () => {
      const item = findItem(ui, "overlay1");
      const focusSpy = vi.fn();
      item.focus = focusSpy;

      ui.openAttrsPanel(item);
      ui.closeAttrsPanel(false);

      expect(focusSpy).not.toHaveBeenCalled();
    });

    it("closeAttrsPanel() is a no-op when no panel is open", () => {
      expect(() => ui.closeAttrsPanel(false)).not.toThrow();
    });

    it("document capture mousedown outside the panel dismisses it", () => {
      const item = findItem(ui, "overlay1");
      ui.openAttrsPanel(item);
      expect(item.querySelector(".foliplus-layer-attrs-panel")).not.toBeNull();

      // Capture phase: the layer control's disableClickPropagation never
      // lets a bubble-phase press reach document.
      document.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );
      expect(item.querySelector(".foliplus-layer-attrs-panel")).toBeNull();
    });

    it("mousedown inside the panel does not dismiss it", () => {
      const item = findItem(ui, "overlay1");
      ui.openAttrsPanel(item);
      const panel = item.querySelector(".foliplus-layer-attrs-panel")!;
      panel.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );
      expect(item.querySelector(".foliplus-layer-attrs-panel")).not.toBeNull();
    });

    it("Escape closes an open attributes panel and returns focus to its row", () => {
      const item = findItem(ui, "overlay1");
      const focusSpy = vi.fn();
      item.focus = focusSpy;

      ui.openAttrsPanel(item);
      const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
      checkbox.focus();

      ui.handleKeyDown(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Escape",
        }) as unknown as KeyboardEvent,
      );

      expect(item.querySelector(".foliplus-layer-attrs-panel")).toBeNull();
      expect(focusSpy).toHaveBeenCalled();
    });

    it("Escape prefers the overflow menu over an open attributes panel", () => {
      const item = findItem(ui, "overlay1");

      // openAttrsPanel dismisses the menu it came from, so open both and
      // rebuild the "menu sits on top" state to exercise the precedence.
      ui.openAttrsPanel(item);
      const panel = item.querySelector(".foliplus-layer-attrs-panel")!;
      ui.activeAttrsPanel = { item, panel, layerId: "overlay1" };
      ui.openMoreMenu(item);

      const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
      checkbox.focus();

      ui.handleKeyDown(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Escape",
        }) as unknown as KeyboardEvent,
      );

      expect(ui.activeMenu).toBeNull();
      // One surface per keypress — the panel survives this Escape.
      expect(item.querySelector(".foliplus-layer-attrs-panel")).toBe(panel);
    });

    it("closes the previously open panel before opening a new one", () => {
      const a = findItem(ui, "overlay1");
      const b = findItem(ui, "base1");

      ui.openAttrsPanel(a);
      ui.openAttrsPanel(b);

      expect(a.querySelector(".foliplus-layer-attrs-panel")).toBeNull();
      expect(b.querySelectorAll(".foliplus-layer-attrs-panel").length).toBe(1);
    });

    it("dismisses the panel on a press outside it, keeps it on a press inside", () => {
      const item = findItem(ui, "overlay1");
      ui.openAttrsPanel(item);
      const panel = item.querySelector(".foliplus-layer-attrs-panel")!;

      // jsdom does not populate event.target on dispatch, so pin it directly.
      const pressOn = (el: Element): void => {
        const event = new MouseEvent("mousedown", { bubbles: true });
        Object.defineProperty(event, "target", { value: el });
        ui.handleOutsideMousedown(event);
      };

      pressOn(panel.firstElementChild!);
      expect(item.querySelector(".foliplus-layer-attrs-panel")).toBe(panel);

      pressOn(document.body);
      expect(item.querySelector(".foliplus-layer-attrs-panel")).toBeNull();
    });
  });

  // ─────────────────── more button visibility ───────────────────
});
