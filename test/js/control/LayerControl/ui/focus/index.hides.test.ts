// test/js/control/LayerControl/ui/style/index.hides — hiding the other layers and the row dblclick path.
import {
  GridLayer,
  attachWithGroup,
  attachedPanel,
  findItem,
  initFixture,
  makePane,
} from "../fixture.js";
import { readFileSync } from "fs";
import { resolve } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureModes } from "#core/lifecycle/index.js";
import { ensureInteraction } from "#foliplus/core/interaction/index.js";
import { type LayerInfo, ROLE } from "#foliplus/core/layer/index.js";
import * as CONST from "#control/LayerControl/const.js";
import { type LayerController } from "#control/LayerControl/controller.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";
import { seedIntentMap } from "#control/LayerControl/ui/intent.js";

// ── Interaction-manager teardown ─────────────────────────────────────
// Every fixture attaches a panel, so LayerControl registers its keyboard
// shortcuts through the per-map InteractionManager. That manager keeps a
// MutationObserver on document.body for as long as the map lives, and a
// fixture map never fires "unload" (its `on` is a spy), so the observer
// outlives the test file. jsdom then tears the document down, mutates it, and
// the queued mutation callbacks run after `HTMLElement` is gone — a wall of
// ReferenceError on stderr that never changes the exit code but buries real
// errors. Track every map a fixture creates and destroy its interaction
// manager with the file. `ensureInteraction` returns the cached manager when
// one exists, and creating-then-destroying one for a map that never registered
// is harmless.
const fixtureMaps: any[] = [];

const trackFixture = <T extends { map?: any }>(fixture: T): T => {
  if (fixture?.map) fixtureMaps.push(fixture.map);
  return fixture;
};

afterEach(() => {
  for (const fixtureMap of fixtureMaps.splice(0)) {
    ensureInteraction(fixtureMap).destroy();
  }
});

// ── Mocked core/mode — LayerControl.focusing ownership ──────
// core/mode owns guardBlocked() and ModeManager.setMode(); these tests cover
// focusLayer()'s registration of the exclusive "focusing" mode across its entry
// and release paths. core/mode is mocked (not patched) because focusLayer()
// reaches it through a free import, not a `map.foliplus` reference.

// ── Hoistable mock state ──────────────────────────────────────────────
// vi.hoisted() declares state that exists BEFORE the module body runs, so
// the hoisted vi.mock() factory can reference it without TDZ errors. The
// factory returns `get` accessors so tests can grab the SAME live spy
// objects the code under test (focusLayer / dismissFocus) calls, and call
// .mockReturnValue / vi.clearAllMocks on them.
const modeMocks = vi.hoisted(() => {
  const states = new Map<string, string | null>();
  const setMode = vi.fn((component: string, mode: string | null) => {
    if (mode === null) states.delete(component);
    else states.set(component, mode);
  });
  const getMode = vi.fn((component: string) => states.get(component) ?? null);
  const guardBlocked = vi.fn(() => false);
  const clear = vi.fn(() => states.clear());
  const ensureModes = vi.fn(() => ({
    setMode,
    getMode,
    isBlocked: vi.fn(() => false),
    clear,
  }));
  return {
    ensureModes,
    guardBlocked,
    ModeManager: vi.fn(),
    _setMode: setMode,
    _getMode: getMode,
    _reset: () => states.clear(),
  };
});

// Match the exact specifier LayerControl/ui.ts uses; both "#core/lifecycle/mode.js" and
// "#foliplus/core/lifecycle/mode.js" resolve to the same file, but mocking the alias
// specifier prevents future alias changes from silently breaking this test.
vi.mock("#core/lifecycle/mode.js", () => ({
  ensureModes: modeMocks.ensureModes,
  guardBlocked: modeMocks.guardBlocked,
  ModeManager: modeMocks.ModeManager,
}));

describe("LayerUI focus", () => {
  let manager: LayerController;

  let ui: LayerUI;

  let map: any;

  beforeEach(() => {
    ({ manager, ui, map } = trackFixture(initFixture()));
    // Fold tests need two overlay layers, so overlay1 isn't collapsed into the
    // single-child "no toggle-all" layout. Registered here (not in the tests)
    // because initFixture() flushes the 300ms initTypesAndVisibility timeout
    // AFTER any nested beforeEach, which would drop a layer added inside a test.
    if (!manager.layerRegistry.get("overlay2")) {
      manager.registerLayer({
        id: "overlay2",
        name: "Circles",
        role: "overlay",
        layer: { options: {}, eachLayer: vi.fn() },
      });
    }
    ui.listPanel.foldedRoles = {};
    seedIntentMap(ui, "visible", {});
    // Folded-role state is persisted to localStorage, so a fold from one test
    // would be re-read by the next test's LayerUI constructor and present as
    // already-folded.
    window.localStorage.removeItem(CONST.STORAGE.KEY);
  });

  afterEach(() => {
    // Cancel a focus the test left live. Its auto-dismiss timer stays armed
    // after the test ends and calls dismissFocus during the file teardown,
    // where the console output it produces races the worker's closing console
    // RPC. Cancelling first makes that stale callback a no-op: it only
    // dismisses while the rect it captured is still the live one.
    if (ui?.isFocusing()) ui.cancelFocus();
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
  // ─────────────────── hide other layers (declarative CSS class) ───────────────────

  describe("focusLayer hides other layers", () => {
    const container = () => ui.c.map.getContainer() as HTMLElement;

    it("adds the focus-active class to the map container on focus", () => {
      ui.focusLayer("overlay1");

      expect(container().classList.contains(CONST.CLASSES.FOCUS_ACTIVE)).toBe(true);
    });

    it("marks the focused layer's pane with focus-pane so CSS keeps it visible", () => {
      const panes = new Map<string, HTMLElement>();
      map.getPane.mockImplementation((name: string) => {
        if (!panes.has(name)) panes.set(name, makePane());
        return panes.get(name)!;
      });
      manager.registerLayer({
        id: "overlay2",
        name: "Shapes",
        layer: {
          options: { pane: "custom_pane" },
          eachLayer: vi.fn(),
          getBounds: () => ({
            isValid: () => true,
            getSouthWest: () => ({ lat: 30, lng: 100 }),
            getNorthEast: () => ({ lat: 40, lng: 110 }),
          }),
        } as unknown as L.Layer,
      });

      ui.focusLayer("overlay2");

      expect(
        panes.get("custom_pane")?.classList.contains(CONST.CLASSES.FOCUS_PANE),
      ).toBe(true);
    });

    it("marks a canvas (heatmap) focused layer's dedicated pane with focus-pane", () => {
      const canvas = document.createElement("canvas");
      const canvasPane = document.createElement("div");
      canvasPane.classList.add("foliplus-layer-pane");
      canvasPane.appendChild(canvas);
      const paneName = "foliplus-canvas-heat1";
      manager.map.getPane.mockImplementation((name: string) => {
        if (name === paneName) return canvasPane;
        return document.createElement("div");
      });
      manager.registerLayer({
        id: "heat1",
        name: "Heat",
        canvas,
        paneName,
        getBounds: () => ({
          isValid: () => true,
          getSouthWest: () => ({ lat: 30, lng: 100 }),
          getNorthEast: () => ({ lat: 40, lng: 110 }),
        }),
      });

      ui.focusLayer("heat1");

      expect(canvasPane.classList.contains(CONST.CLASSES.FOCUS_PANE)).toBe(true);
      expect(canvas.classList.contains(CONST.CLASSES.FOCUS_PANE)).toBe(false);
    });

    it("falls back to lifting the canvas when its dedicated pane is missing", () => {
      const canvas = document.createElement("canvas");
      manager.map.getPane.mockImplementation(() => null);
      manager.registerLayer({
        id: "heat2",
        name: "Heat",
        canvas,
        paneName: "foliplus-canvas-heat2",
        getBounds: () => ({
          isValid: () => true,
          getSouthWest: () => ({ lat: 30, lng: 100 }),
          getNorthEast: () => ({ lat: 40, lng: 110 }),
        }),
      });

      ui.focusLayer("heat2");

      expect(canvas.classList.contains(CONST.CLASSES.FOCUS_PANE)).toBe(true);
    });

    it("does not mark shared default panes (overlayPane/markerPane)", () => {
      // overlay1's mock layer has no custom pane, so getLayerPanes falls back
      // to overlayPane/markerPane — those are shared and must not be touched.
      const panes = new Map<string, HTMLElement>();
      map.getPane.mockImplementation((name: string) => {
        if (!panes.has(name)) panes.set(name, makePane());
        return panes.get(name)!;
      });

      ui.focusLayer("overlay1");

      // The per-layer label pane is rightly marked — the focused layer's own
      // labels must stay visible — but the *shared* panes must not be touched.
      const shared = Array.from(panes.entries()).filter(([name]) =>
        ["overlayPane", "markerPane"].includes(name),
      );
      expect(
        shared.every(([, p]) => !p.classList.contains(CONST.CLASSES.FOCUS_PANE)),
      ).toBe(true);
    });

    it("applies the glow class to the focused pane (not per leaf element)", () => {
      const panes = new Map<string, HTMLElement>();
      map.getPane.mockImplementation((name: string) => {
        if (!panes.has(name)) panes.set(name, makePane());
        return panes.get(name)!;
      });
      manager.registerLayer({
        id: "overlay2",
        name: "Shapes",
        layer: {
          options: { pane: "custom_pane" },
          eachLayer: vi.fn(),
          getBounds: () => ({
            isValid: () => true,
            getSouthWest: () => ({ lat: 30, lng: 100 }),
            getNorthEast: () => ({ lat: 40, lng: 110 }),
          }),
        } as unknown as L.Layer,
      });

      ui.focusLayer("overlay2");

      expect(
        panes.get("custom_pane")?.classList.contains(CONST.CLASSES.FOCUS_PANE),
      ).toBe(true);
      expect(
        panes.get("custom_pane")?.classList.contains(CONST.CLASSES.FOCUS_GLOW),
      ).toBe(true);

      ui.cancelFocus();

      expect(
        panes.get("custom_pane")?.classList.contains(CONST.CLASSES.FOCUS_GLOW),
      ).toBe(false);
    });

    it("applies the glow class to a focused canvas (heatmap) layer", () => {
      const canvas = document.createElement("canvas");
      manager.registerLayer({
        id: "heat1",
        name: "Heat",
        canvas,
        getBounds: () => ({
          isValid: () => true,
          getSouthWest: () => ({ lat: 30, lng: 100 }),
          getNorthEast: () => ({ lat: 40, lng: 110 }),
        }),
      });

      ui.focusLayer("heat1");

      expect(canvas.classList.contains(CONST.CLASSES.FOCUS_GLOW)).toBe(true);

      ui.cancelFocus();

      expect(canvas.classList.contains(CONST.CLASSES.FOCUS_GLOW)).toBe(false);
    });

    it("cancelFocus removes the focus-active class and the focus-pane markers", () => {
      const canvas = document.createElement("canvas");
      manager.registerLayer({
        id: "heat1",
        name: "Heat",
        canvas,
        getBounds: () => ({
          isValid: () => true,
          getSouthWest: () => ({ lat: 30, lng: 100 }),
          getNorthEast: () => ({ lat: 40, lng: 110 }),
        }),
      });

      ui.focusLayer("heat1");
      expect(container().classList.contains(CONST.CLASSES.FOCUS_ACTIVE)).toBe(true);
      expect(canvas.classList.contains(CONST.CLASSES.FOCUS_PANE)).toBe(true);

      ui.cancelFocus();

      expect(container().classList.contains(CONST.CLASSES.FOCUS_ACTIVE)).toBe(false);
      expect(canvas.classList.contains(CONST.CLASSES.FOCUS_PANE)).toBe(false);
    });

    it("lifts the focused layer's pane above others and restores it on cancel", () => {
      const panes = new Map<string, HTMLElement>();
      map.getPane.mockImplementation((name: string) => {
        if (!panes.has(name)) panes.set(name, makePane());
        return panes.get(name)!;
      });
      manager.registerLayer({
        id: "overlay2",
        name: "Shapes",
        layer: {
          options: { pane: "custom_pane" },
          eachLayer: vi.fn(),
          getBounds: () => ({
            isValid: () => true,
            getSouthWest: () => ({ lat: 30, lng: 100 }),
            getNorthEast: () => ({ lat: 40, lng: 110 }),
          }),
        } as unknown as L.Layer,
      });

      ui.focusLayer("overlay2");

      expect(panes.get("custom_pane")?.style.zIndex).toBe(
        String(CONST.FOCUS.PANE_Z - CONST.FOCUS.FOCUSED_Z_GAP),
      );

      ui.cancelFocus();

      expect(panes.get("custom_pane")?.style.zIndex).toBe("0");
    });

    it("lifts the focused layer's label pane one step above it, without the glow", () => {
      const panes = new Map<string, HTMLElement>();
      map.getPane.mockImplementation((name: string) => {
        if (!panes.has(name)) panes.set(name, makePane());
        return panes.get(name)!;
      });
      manager.registerLayer({
        id: "overlay2",
        name: "Shapes",
        layer: {
          options: { pane: "custom_pane" },
          // One labelable child: the registration edge's `hasLabelField`
          // probe walks leaves, so the group itself carrying nothing is
          // fine — its child declares the label spec. (The label pane
          // is a PaneHandle now, and `setZOverride` prices it at
          // focusedZ + 1 through the same ladder this used to spot-write
          // by hand.)
          eachLayer: (fn: (l: L.Layer) => void) =>
            fn({
              options: {},
              feature: { properties: { name: "x" } },
            } as unknown as L.Layer),
          getBounds: () => ({
            isValid: () => true,
            getSouthWest: () => ({ lat: 30, lng: 100 }),
            getNorthEast: () => ({ lat: 40, lng: 110 }),
          }),
        } as unknown as L.Layer,
      });

      ui.focusLayer("overlay2");

      // The layer's labels ride one step above the raised layer (focusedZ + 1),
      // so they stay readable over its geometry — and get no glow of their own.
      const labelPane = panes.get(`${CONST.LABEL_PANE_PREFIX}overlay2`)!;
      expect(labelPane.style.zIndex).toBe(
        String(CONST.FOCUS.PANE_Z - CONST.FOCUS.FOCUSED_Z_GAP + 1),
      );
      expect(labelPane.classList.contains(CONST.CLASSES.FOCUS_GLOW)).toBe(false);
      // The visibility mark still lands — without it the focus-hide CSS
      // would swallow the layer's own labels.
      expect(labelPane.classList.contains(CONST.CLASSES.FOCUS_PANE)).toBe(true);

      ui.cancelFocus();

      expect(labelPane.style.zIndex).toBe("0");
    });

    it("lifts the layer even when pane discovery throws", () => {
      const panes = new Map<string, HTMLElement>();
      map.getPane.mockImplementation((name: string) => {
        if (!panes.has(name)) panes.set(name, makePane());
        return panes.get(name)!;
      });
      manager.registerLayer({
        id: "overlay2",
        name: "Shapes",
        layer: {
          options: { pane: "custom_pane" },
          eachLayer: vi.fn(),
          getBounds: () => ({
            isValid: () => true,
            getSouthWest: () => ({ lat: 30, lng: 100 }),
            getNorthEast: () => ({ lat: 40, lng: 110 }),
          }),
        } as unknown as L.Layer,
      });
      vi.spyOn(manager, "getLayerPanes").mockImplementation(() => {
        throw new Error("boom");
      });

      // Best-effort lift: discovery failure skips the pane loop, not the focus.
      expect(() => ui.focusLayer("overlay2")).not.toThrow();
    });

    it("lifts the surface's synthesized pane for a basemap layer", () => {
      // First-class basemaps: a TileLayer/GridLayer now owns a synthesized
      // pane, so the focus lift writes there directly (setZOverride returns
      // true) instead of falling back to getLayerPanes discovery.
      const panes = new Map<string, HTMLElement>();
      map.getPane.mockImplementation((name: string) => {
        if (!panes.has(name)) panes.set(name, makePane());
        return panes.get(name)!;
      });
      const gridLayer = Object.assign(new GridLayer(), {
        getBounds: () => ({
          isValid: () => true,
          getSouthWest: () => ({ lat: 30, lng: 100 }),
          getNorthEast: () => ({ lat: 40, lng: 110 }),
        }),
      });
      manager.registerLayer({
        id: "tiles",
        name: "Tiles",
        layer: gridLayer,
      });

      ui.focusLayer("tiles");

      // The layer's own pane got the focus class — the direct lift path.
      const layerPane = map.getPane((gridLayer.options as any).pane);
      expect(layerPane?.classList.contains(CONST.CLASSES.FOCUS_PANE)).toBe(true);

      ui.cancelFocus();
      expect(layerPane?.classList.contains(CONST.CLASSES.FOCUS_PANE)).toBe(false);
    });

    it("skips the pane loop without throwing when discovery fails on a pane-less surface", () => {
      const gridLayer = Object.assign(new GridLayer(), {
        getBounds: () => ({
          isValid: () => true,
          getSouthWest: () => ({ lat: 30, lng: 100 }),
          getNorthEast: () => ({ lat: 40, lng: 110 }),
        }),
      });
      manager.registerLayer({
        id: "tiles",
        name: "Tiles",
        layer: gridLayer,
      });
      vi.spyOn(manager, "getLayerPanes").mockImplementation(() => {
        throw new Error("boom");
      });

      expect(() => ui.focusLayer("tiles")).not.toThrow();
    });

    it("skips the lift when a discovered pane doesn't exist", () => {
      // getLayerPanes returns a name that isn't a default pane, but getPane
      // returns null — the pane was never created. The lift is best-effort:
      // skip the missing pane without breaking the focus.
      const panes = new Map<string, HTMLElement>();
      map.getPane.mockImplementation((name: string) => {
        if (name === "phantom_pane") return null;
        if (!panes.has(name)) panes.set(name, makePane());
        return panes.get(name)!;
      });
      const gridLayer = Object.assign(new GridLayer(), {
        getBounds: () => ({
          isValid: () => true,
          getSouthWest: () => ({ lat: 30, lng: 100 }),
          getNorthEast: () => ({ lat: 40, lng: 110 }),
        }),
      });
      manager.registerLayer({
        id: "tiles",
        name: "Tiles",
        layer: gridLayer,
      });
      vi.spyOn(manager, "getLayerPanes").mockReturnValue(["phantom_pane"]);

      expect(() => ui.focusLayer("tiles")).not.toThrow();
    });

    it("skips a missing native pane without affecting the others", () => {
      // markerPane was never created on this map — liftZ returns early, but
      // tooltipPane and popupPane are still lifted to their ladder slots.
      const panes = new Map<string, HTMLElement>();
      map.getPane.mockImplementation((name: string) => {
        if (name === "markerPane") return null;
        if (!panes.has(name)) panes.set(name, makePane());
        return panes.get(name)!;
      });
      manager.registerLayer({
        id: "overlay2",
        name: "Shapes",
        layer: {
          options: { pane: "custom_pane" },
          eachLayer: vi.fn(),
          getBounds: () => ({
            isValid: () => true,
            getSouthWest: () => ({ lat: 30, lng: 100 }),
            getNorthEast: () => ({ lat: 40, lng: 110 }),
          }),
        } as unknown as L.Layer,
      });

      ui.focusLayer("overlay2");

      // liftZ sets the z-index on the native panes (tooltip +3, popup +4),
      // but does not add the FOCUS_PANE class — that is the layer's own panes.
      expect(Number(panes.get("tooltipPane")!.style.zIndex)).toBeGreaterThan(0);
      expect(Number(panes.get("popupPane")!.style.zIndex)).toBeGreaterThan(
        Number(panes.get("tooltipPane")!.style.zIndex),
      );
    });

    it("skips the label pane when it doesn't exist", () => {
      // The label pane is created by the label system on first
      // render. A layer that was never annotated has no label pane — the
      // lift just skips it, the rest of the ladder still works.
      const panes = new Map<string, HTMLElement>();
      map.getPane.mockImplementation((name: string) => {
        if (name.startsWith(CONST.LABEL_PANE_PREFIX)) return null;
        if (!panes.has(name)) panes.set(name, makePane());
        return panes.get(name)!;
      });
      manager.registerLayer({
        id: "overlay2",
        name: "Shapes",
        layer: {
          options: { pane: "custom_pane" },
          eachLayer: vi.fn(),
          getBounds: () => ({
            isValid: () => true,
            getSouthWest: () => ({ lat: 30, lng: 100 }),
            getNorthEast: () => ({ lat: 40, lng: 110 }),
          }),
        } as unknown as L.Layer,
      });

      expect(() => ui.focusLayer("overlay2")).not.toThrow();
      expect(
        panes.get("custom_pane")?.classList.contains(CONST.CLASSES.FOCUS_PANE),
      ).toBe(true);
    });

    it("creates the focus pane when the map lacks it", () => {
      const realGetPane = map.getPane;
      map.getPane = vi.fn((name: string) =>
        name === CONST.FOCUS_PANE ? null : realGetPane(name),
      );

      ui.focusLayer("overlay1");

      expect(map.createPane).toHaveBeenCalledWith(CONST.FOCUS_PANE);
    });

    it("lifts a canvas (heatmap) focused layer above others and restores it", () => {
      const canvas = document.createElement("canvas");
      canvas.style.zIndex = "5";
      manager.registerLayer({
        id: "heat1",
        name: "Heat",
        canvas,
        getBounds: () => ({
          isValid: () => true,
          getSouthWest: () => ({ lat: 30, lng: 100 }),
          getNorthEast: () => ({ lat: 40, lng: 110 }),
        }),
      });

      ui.focusLayer("heat1");
      expect(canvas.style.zIndex).toBe(String(CONST.FOCUS.PANE_Z - 10));

      ui.cancelFocus();
      expect(canvas.style.zIndex).toBe("5");
    });

    // ── CSS selector contract for the declarative hide rule ──
    // `hideOtherLayers` adds `foliplus-is-focus-mode` to the container and
    // trusts the CSS in `focus.css` to do the visibility bookkeeping. These
    // tests pin that CSS contract against jsdom's real selector engine —
    // the active basemap and the focused layer's pane are excluded, every
    // other `foliplus-layer-pane` is matched. The Python-side companion test
    // only greps the CSS source for the two `:not()` exclusions; this one
    // proves the rule *behaves* the way it reads.

    describe("focus-mode hide rule (CSS selector contract)", () => {
      const HIDE_RULE =
        ".foliplus-is-focus-mode .foliplus-layer-pane:not(.foliplus-focus-pane):not(.foliplus-focus-basemap)";
      const makeContainer = (focusMode: boolean): HTMLElement => {
        const el = document.createElement("div");
        el.classList.add("leaflet-container");
        if (focusMode) el.classList.add("foliplus-is-focus-mode");
        return el;
      };
      const makePane = (extraClasses: string[]): HTMLElement => {
        const el = document.createElement("div");
        el.classList.add("foliplus-layer-pane");
        for (const cls of extraClasses) el.classList.add(cls);
        return el;
      };

      afterEach(() => {
        document.body.innerHTML = "";
      });

      it("matches an ordinary overlay pane when focus is active", () => {
        const container = makeContainer(true);
        const pane = makePane([]);
        container.appendChild(pane);
        document.body.appendChild(container);

        expect(document.querySelectorAll(HIDE_RULE)).toContain(pane);
      });

      it("does not match the active basemap pane", () => {
        const container = makeContainer(true);
        const basePane = makePane(["foliplus-focus-basemap"]);
        container.appendChild(basePane);
        document.body.appendChild(container);

        expect(document.querySelectorAll(HIDE_RULE)).not.toContain(basePane);
      });

      it("does not match the focused layer's own pane", () => {
        const container = makeContainer(true);
        const focusedPane = makePane(["foliplus-focus-pane"]);
        container.appendChild(focusedPane);
        document.body.appendChild(container);

        expect(document.querySelectorAll(HIDE_RULE)).not.toContain(focusedPane);
      });

      it("does not match a pane that carries both exclusions (defensive: a basemap that is also the focused layer)", () => {
        const container = makeContainer(true);
        const both = makePane(["foliplus-focus-pane", "foliplus-focus-basemap"]);
        container.appendChild(both);
        document.body.appendChild(container);

        expect(document.querySelectorAll(HIDE_RULE)).not.toContain(both);
      });

      it("matches a base pane that is not the active basemap (any non-focused, non-focus-basemap layer-pane)", () => {
        const container = makeContainer(true);
        const otherBase = makePane([]);
        container.appendChild(otherBase);
        document.body.appendChild(container);

        expect(document.querySelectorAll(HIDE_RULE)).toContain(otherBase);
      });

      it("does not match any pane when focus is not active (the outer class is the gate)", () => {
        const container = makeContainer(false);
        const base = makePane(["foliplus-focus-basemap"]);
        const focused = makePane(["foliplus-focus-pane"]);
        const other = makePane([]);
        container.appendChild(base);
        container.appendChild(focused);
        container.appendChild(other);
        document.body.appendChild(container);

        expect(document.querySelectorAll(HIDE_RULE).length).toBe(0);
      });

      it("matches only the unmarked panes when a mix of pane types is present under focus", () => {
        const container = makeContainer(true);
        const basePane = makePane(["foliplus-focus-basemap"]);
        const focusPane = makePane(["foliplus-focus-pane"]);
        const otherPane = makePane([]);
        container.appendChild(basePane);
        container.appendChild(focusPane);
        container.appendChild(otherPane);
        document.body.appendChild(container);

        const matched = Array.from(document.querySelectorAll(HIDE_RULE));
        expect(matched).toHaveLength(1);
        expect(matched[0]).toBe(otherPane);
      });

      // ── Leaflet's native UI panes get their own hide rules ──
      // HIDE_RULE only touches `foliplus-layer-pane`. Hover tooltips and
      // popups live in Leaflet's `leaflet-*-pane` divs and escape the foliplus
      // rule entirely, so two dedicated selectors hide them during focus —
      // one per native pane. Marker shadows do NOT need one anymore: each
      // marker layer carries its own shadow pane (`PaneRole.SHADOW`,
      // moved in by `PaneManager.pinLateContent`), so HIDE_RULE hides a
      // non-focused layer's shadows and the focused layer keeps its own —
      // the global `.leaflet-shadow-pane { visibility: hidden }` rule this
      // used to pair with is gone. These matchers must be kept in sync with
      // `focus.css`: delete one of the two selectors and the matching case
      // below goes red.
      const NATIVE_PANE_RULES: Record<string, string> = {
        "tooltip-pane": ".foliplus-is-focus-mode .leaflet-tooltip-pane",
        "popup-pane": ".foliplus-is-focus-mode .leaflet-popup-pane",
      };

      it("hides Leaflet's tooltip pane during focus (hover tooltips escape the foliplus rule)", () => {
        const container = makeContainer(true);
        const tooltipPane = document.createElement("div");
        tooltipPane.classList.add("leaflet-tooltip-pane");
        container.appendChild(tooltipPane);
        document.body.appendChild(container);

        expect(document.querySelectorAll(NATIVE_PANE_RULES["tooltip-pane"])).toContain(
          tooltipPane,
        );
      });

      it("hides Leaflet's popup pane during focus (popup during focus animation)", () => {
        const container = makeContainer(true);
        const popupPane = document.createElement("div");
        popupPane.classList.add("leaflet-popup-pane");
        container.appendChild(popupPane);
        document.body.appendChild(container);

        expect(document.querySelectorAll(NATIVE_PANE_RULES["popup-pane"])).toContain(
          popupPane,
        );
      });

      it("focus.css carries no shadow-pane rule anymore (shadows are layer-owned panes)", () => {
        // Selector-shape checks (like the two above) only prove what a
        // selector WOULD match — querySelectorAll reads DOM structure, not
        // CSS. The removed blanket hide needs a file-level assertion: the
        // old `.leaflet-shadow-pane { visibility: hidden }` took the focused
        // marker layer's own shadows down with everyone else's, and shadows
        // are foliplus layer panes now (PaneRole.SHADOW), covered by the
        // layer-pane rule above.
        const css = readFileSync(
          resolve(".", "foliplus/css/control/LayerControl/focus.css"),
          "utf8",
        );
        expect(css).not.toContain("leaflet-shadow-pane");
        expect(css).toContain(".foliplus-is-focus-mode .leaflet-tooltip-pane");
        expect(css).toContain(".foliplus-is-focus-mode .leaflet-popup-pane");
      });

      it("the native pane rules do not match when focus is not active", () => {
        const container = makeContainer(false);
        const shadowPane = document.createElement("div");
        shadowPane.classList.add("leaflet-shadow-pane");
        const tooltipPane = document.createElement("div");
        tooltipPane.classList.add("leaflet-tooltip-pane");
        const popupPane = document.createElement("div");
        popupPane.classList.add("leaflet-popup-pane");
        container.appendChild(shadowPane);
        container.appendChild(tooltipPane);
        container.appendChild(popupPane);
        document.body.appendChild(container);

        for (const rule of Object.values(NATIVE_PANE_RULES)) {
          expect(document.querySelectorAll(rule).length).toBe(0);
        }
      });
    });

    // ── hideOtherLayers marks the active basemap ──
    // The CSS contract tests above prove which panes the hide rule matches;
    // these prove the JS side actually stamps `.foliplus-focus-basemap` on
    // the right panes. `hideOtherLayers` runs inside `focusLayer`, so the
    // tests drive it through the public entry (no direct export).

    describe("hideOtherLayers marks only the active basemap", () => {
      const registerBase = (id: string): void => {
        manager.registerLayer({
          id,
          name: id,
          role: "base",
          layer: { options: {} },
          paneName: `${id}Pane`,
        });
        manager.enforceOrder();
      };
      const basePanes = (id: string) => {
        const li = manager.layerRegistry.get(id)!;
        return ui.c.surfaceFor(li)!.panes;
      };

      it("marks the topmost effectiveShown base pane and skips a hidden base", () => {
        registerBase("base2");
        seedIntentMap(ui, "visible", { base2: false }); // user-hidden base

        ui.focusLayer("overlay1");

        // base1 (effectiveShown) is the topmost visible base → marked.
        for (const pane of basePanes("base1")) {
          expect(pane.element.classList.contains(CONST.CLASSES.FOCUS_BASEMAP)).toBe(
            true,
          );
        }
        // base2 (effectiveShown=false) is not marked — it hides like a data
        // layer instead of staying visible under the dim.
        for (const pane of basePanes("base2")) {
          expect(pane.element.classList.contains(CONST.CLASSES.FOCUS_BASEMAP)).toBe(
            false,
          );
        }

        // The restore was queued; canceling focus clears the marking.
        expect(ui.focusController.focusedPaneRestores.length).toBeGreaterThan(0);
        ui.cancelFocus();
        for (const pane of basePanes("base1")) {
          expect(pane.element.classList.contains(CONST.CLASSES.FOCUS_BASEMAP)).toBe(
            false,
          );
        }
      });

      it("marks only the topmost of two effectiveShown base layers", () => {
        registerBase("base2"); // base2 visible like base1

        ui.focusLayer("overlay1");

        // base2 registered after base1 → topmost base → the active basemap.
        for (const pane of basePanes("base2")) {
          expect(pane.element.classList.contains(CONST.CLASSES.FOCUS_BASEMAP)).toBe(
            true,
          );
        }
        for (const pane of basePanes("base1")) {
          expect(pane.element.classList.contains(CONST.CLASSES.FOCUS_BASEMAP)).toBe(
            false,
          );
        }
      });

      it("skips a base layer whose surface is missing", () => {
        registerBase("base2");

        // surfaceFor is typed to always return a surface, but hideOtherLayers
        // carries a `if (!surface) continue` guard against a missing one —
        // cover that defensive branch: no base may be marked, no throw.
        const realSurfaceFor = ui.c.surfaceFor.bind(ui.c);
        vi.spyOn(ui.c, "surfaceFor").mockImplementation(((li: LayerInfo) =>
          li.role === ROLE.BASE
            ? null
            : realSurfaceFor(li)) as unknown as typeof ui.c.surfaceFor);

        expect(() => ui.focusLayer("overlay1")).not.toThrow();
        expect(
          document.querySelectorAll(`.${CONST.CLASSES.FOCUS_BASEMAP}`).length,
        ).toBe(0);
      });
    });
  });

  // ─────────────────── overflow menu ───────────────────

  describe("row dblclick only focuses from dead space", () => {
    // The Label section exists iff the surface declares the label
    // capability (the panel gate reads it through surfaceFor). The three
    // style-panel denylist tests below only need the section's controls in
    // the DOM — the denylist is what they pin — so they flip the shared
    // fixture layer's capability bit rather than reshaping its data.
    const stubLabelPanelSurface = () => {
      const li = ui.c.layerRegistry.get("overlay1")!;
      const surface = ui.c.surfaceFor(li) as unknown as {
        capabilities: Record<string, unknown>;
      };
      surface.capabilities = { ...surface.capabilities, label: "pane" };
    };

    it("focuses the layer on a dblclick of the row's label area", () => {
      const focusSpy = vi.spyOn(ui, "focusLayer");
      const label = findItem(ui, "overlay1").querySelector(
        `.${CONST.CLASSES.LAYER_LABEL}`,
      )!;
      ui.handleDblClick({ target: label, bubbles: true } as unknown as MouseEvent);
      expect(focusSpy).toHaveBeenCalledWith("overlay1");
      focusSpy.mockRestore();
    });

    it("does NOT focus the layer on a dblclick of the more button", () => {
      const focusSpy = vi.spyOn(ui, "focusLayer");
      const more = findItem(ui, "overlay1").querySelector(
        `.${CONST.CLASSES.MORE_BTN}`,
      )!;
      ui.handleDblClick({ target: more, bubbles: true } as unknown as MouseEvent);
      expect(focusSpy).not.toHaveBeenCalled();
      focusSpy.mockRestore();
    });

    it("does NOT focus the layer on a dblclick of the checkbox", () => {
      // Two quick checkbox toggles fire a browser dblclick. That must not
      // zoom the map to the layer (focusLayer) — the user only meant to
      // show/hide it twice.
      const focusSpy = vi.spyOn(ui, "focusLayer");
      const checkbox = findItem(ui, "overlay1").querySelector(
        'input[type="checkbox"]',
      )!;
      ui.handleDblClick({ target: checkbox, bubbles: true } as unknown as MouseEvent);
      expect(focusSpy).not.toHaveBeenCalled();
      focusSpy.mockRestore();
    });

    it("double-click on a base basemap row shows a hint instead of focusLayer", () => {
      const hintSpy = vi.fn();
      map.foliplus.hint.set = hintSpy;
      const focusSpy = vi.spyOn(ui, "focusLayer");
      const item = findItem(ui, "base1");

      ui.handleDblClick({ target: item, bubbles: true } as unknown as MouseEvent);

      expect(focusSpy).not.toHaveBeenCalled();
      expect(hintSpy).toHaveBeenCalledWith(
        "LayerControl",
        "",
        "LayerControl.focus_base",
        { duration: expect.any(Number) },
      );
      focusSpy.mockRestore();
    });

    it("double-click on a hidden row still reaches focusLayer (hint path)", () => {
      // Hidden layers are NOT focusable via the menu, but double-click must
      // still run focusLayer so the user gets the "hidden" hint instead of
      // nothing.
      const focusSpy = vi.spyOn(ui, "focusLayer");
      const item = findItem(ui, "overlay1");
      const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
      checkbox.checked = false;

      ui.handleDblClick({ target: item, bubbles: true } as unknown as MouseEvent);
      expect(focusSpy).toHaveBeenCalledWith("overlay1");
      focusSpy.mockRestore();
    });

    it("does NOT focus the layer on a dblclick of the fold button", () => {
      const focusSpy = vi.spyOn(ui, "focusLayer");
      const { foldBtn } = attachWithGroup(ui);
      ui.handleDblClick({ target: foldBtn, bubbles: true } as unknown as MouseEvent);
      expect(focusSpy).not.toHaveBeenCalled();
      focusSpy.mockRestore();
    });

    it("does NOT focus the layer on a dblclick of the rename input", () => {
      const focusSpy = vi.spyOn(ui, "focusLayer");
      ui.renameLayer("overlay1");
      const input = attachedPanel(ui).querySelector(
        `.${CONST.CLASSES.RENAME_INPUT}`,
      ) as HTMLElement;
      expect(input).not.toBeNull();
      ui.handleDblClick({ target: input, bubbles: true } as unknown as MouseEvent);
      expect(focusSpy).not.toHaveBeenCalled();
      focusSpy.mockRestore();
    });

    it("does NOT focus the layer on a dblclick of a more-menu item", () => {
      const focusSpy = vi.spyOn(ui, "focusLayer");
      const overlay = findItem(ui, "overlay1");
      const menuBtn = overlay.querySelector(
        `.${CONST.CLASSES.MORE_BTN}`,
      ) as HTMLElement;
      menuBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      const menuItem = overlay.querySelector(
        ".foliplus-layer-more-menu button",
      ) as HTMLElement;
      expect(menuItem).not.toBeNull();
      ui.handleDblClick({ target: menuItem, bubbles: true } as unknown as MouseEvent);
      expect(focusSpy).not.toHaveBeenCalled();
      focusSpy.mockRestore();
    });

    it("does NOT focus the layer on a dblclick of the drag handle", () => {
      const focusSpy = vi.spyOn(ui, "focusLayer");
      const handle = findItem(ui, "overlay1").querySelector(
        ".drag-handle",
      ) as HTMLElement;
      ui.handleDblClick({ target: handle, bubbles: true } as unknown as MouseEvent);
      expect(focusSpy).not.toHaveBeenCalled();
      focusSpy.mockRestore();
    });

    it("does NOT focus the layer on a dblclick of the style-panel toggle slider", () => {
      // The toggle switch is <label><input><span.slider></label>. Users click
      // the slider span, which is not an `input`/`button` — two quick flips
      // used to bubble a dblclick that fell through to focusLayer.
      stubLabelPanelSurface();
      ui.runtimeStore.setFields("overlay1", [{ name: "count", numeric: true }]);
      ui.openStylePanel("overlay1");
      const focusSpy = vi.spyOn(ui, "focusLayer");
      const slider = findItem(ui, "overlay1").querySelector(
        ".foliplus-toggle-slider",
      ) as HTMLElement;
      expect(slider).not.toBeNull();
      ui.handleDblClick({ target: slider, bubbles: true } as unknown as MouseEvent);
      expect(focusSpy).not.toHaveBeenCalled();
      focusSpy.mockRestore();
      ui.closeStylePanel(false);
    });

    it("does NOT focus the layer on a dblclick of the style-panel field select", () => {
      // Same class of hit as the toggle slider: a <select> is neither
      // `input` nor `button` in the denylist, so only the floating-panel
      // early return keeps a double-click on it from focusing the layer.
      stubLabelPanelSurface();
      ui.runtimeStore.setFields("overlay1", [{ name: "count", numeric: true }]);
      ui.openStylePanel("overlay1");
      const focusSpy = vi.spyOn(ui, "focusLayer");
      const select = findItem(ui, "overlay1").querySelector(
        `.${CONST.CLASSES.STYLE_FIELD_SELECT}`,
      ) as HTMLElement;
      expect(select).not.toBeNull();
      ui.handleDblClick({ target: select, bubbles: true } as unknown as MouseEvent);
      expect(focusSpy).not.toHaveBeenCalled();
      focusSpy.mockRestore();
      ui.closeStylePanel(false);
    });

    it("does NOT focus the layer on a dblclick of the style-panel collide slider", () => {
      // The "avoid overlap" switch uses the same <label><input><span.slider>
      // chrome as the show toggle — same double-flip hazard.
      stubLabelPanelSurface();
      ui.runtimeStore.setFields("overlay1", [{ name: "count", numeric: true }]);
      ui.openStylePanel("overlay1");
      const focusSpy = vi.spyOn(ui, "focusLayer");
      const collide = findItem(ui, "overlay1").querySelector(
        `.${CONST.CLASSES.STYLE_COLLIDE_INPUT}`,
      ) as HTMLInputElement;
      expect(collide).not.toBeNull();
      const slider = collide.parentElement!.querySelector(
        ".foliplus-toggle-slider",
      ) as HTMLElement;
      ui.handleDblClick({ target: slider, bubbles: true } as unknown as MouseEvent);
      expect(focusSpy).not.toHaveBeenCalled();
      focusSpy.mockRestore();
      ui.closeStylePanel(false);
    });

    it("does NOT focus the layer on a dblclick inside the attrs panel", () => {
      const focusSpy = vi.spyOn(ui, "focusLayer");
      const item = findItem(ui, "overlay1");
      ui.openAttrsPanel(item);
      const panel = item.querySelector(`.${CONST.CLASSES.ATTRS_PANEL}`) as HTMLElement;
      expect(panel).not.toBeNull();
      ui.handleDblClick({ target: panel, bubbles: true } as unknown as MouseEvent);
      expect(focusSpy).not.toHaveBeenCalled();
      focusSpy.mockRestore();
      ui.closeAttrsPanel(false);
    });

    it("ignores a dblclick outside the layer panel", () => {
      const focusSpy = vi.spyOn(ui, "focusLayer");
      const outside = document.createElement("div");
      document.body.appendChild(outside);
      ui.handleDblClick({ target: outside, bubbles: true } as unknown as MouseEvent);
      expect(focusSpy).not.toHaveBeenCalled();
      outside.remove();
      focusSpy.mockRestore();
    });
  });

  describe("focusLayer via Alt+Enter keyboard shortcut", () => {
    it("Alt+Enter on a navigated layer row triggers focusLayer", () => {
      const focusSpy = vi.spyOn(ui, "focusLayer");

      // navigate to overlay1 by name so activeIdx matches getNavigableItems().
      ui.setActiveItem(1); // overlay1 is index 1 (base1 is 0).
      expect(ui.listPanel.activeIdx).toBe(1);

      // handleKeyDown requires the active element to be inside uiContainer.
      const checkbox = findItem(ui, "overlay1").querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;
      checkbox.focus();
      expect(document.activeElement).toBe(checkbox);

      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
        altKey: true,
      });
      ui.handleKeyDown(event as unknown as KeyboardEvent);

      expect(focusSpy).toHaveBeenCalledWith("overlay1");

      focusSpy.mockRestore();
    });

    it("Enter (without Alt) does NOT trigger focusLayer", () => {
      const focusSpy = vi.spyOn(ui, "focusLayer");

      ui.listPanel.activeIdx = 0;
      const checkbox = findItem(ui, "overlay1").querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;
      checkbox.focus();

      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
        altKey: false,
      });
      ui.handleKeyDown(event as unknown as KeyboardEvent);

      expect(focusSpy).not.toHaveBeenCalled();

      focusSpy.mockRestore();
    });

    it("Alt+Enter auto-resolves activeIdx from the focused element, then focuses that layer", () => {
      const focusSpy = vi.spyOn(ui, "focusLayer");
      ui.listPanel.activeIdx = null;

      // Focus overlay1's checkbox — handleKeyDown resolves activeIdx
      // from the focused element before checking Alt+Enter, so even starting
      // with activeIdx=null it still triggers focus on overlay1.
      const overlayCheckbox = findItem(ui, "overlay1").querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;
      overlayCheckbox.focus();

      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
        altKey: true,
      });
      ui.handleKeyDown(event as unknown as KeyboardEvent);

      expect(focusSpy).toHaveBeenCalledWith("overlay1");

      focusSpy.mockRestore();
    });
  });
});
