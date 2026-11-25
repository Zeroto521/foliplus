// test/js/control/LayerControl/ui/style/apply.carrier — carrier dispatch.
import { makeOffMapFixture, paneCapableLayer } from "./apply.fixture.js";
import { TEST_ENV, installLeafletGlobals } from "./fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS } from "#core/event/index.js";
import { HIDDEN } from "#core/layer/index.js";
import { LayerController } from "#control/LayerControl/controller.js";
import {
  applyProjection,
  authorZoomBoundsForLayer,
  dispatchStateOp,
} from "#control/LayerControl/ui/apply.js";
import { LayerUI } from "#control/LayerControl/ui/index.js";
import { clearIntent, setIntent } from "#control/LayerControl/ui/intent.js";

// The carrier dispatcher is where the branches live: one write target per
// dimension per layer shape, and each shape has its own "no honest write"
// corner. These exercise the shapes the gates above do not touch.
describe("executor: carrier dispatch", () => {
  beforeEach(() => {
    installLeafletGlobals();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  const boot = (layers: ConstructorParameters<typeof LayerController>[1]) => {
    const { container, map } = makeOffMapFixture();
    const manager = new LayerController(map, layers);
    manager.ui = new LayerUI(manager, TEST_ENV);
    const ui = manager.ui as LayerUI;
    vi.useFakeTimers();
    manager.attachUI(container);
    vi.advanceTimersByTime(350);
    vi.useRealTimers();
    return { container, map, manager, ui };
  };

  it("an id with no registry entry is a no-op", () => {
    const { ui, map } = boot([{ id: "a", name: "A", role: "overlay" }]);
    (map.addLayer as ReturnType<typeof vi.fn>).mockClear();
    expect(() => applyProjection(ui, "ghost")).not.toThrow();
    expect(map.addLayer).not.toHaveBeenCalled();
  });

  it("a pane-carrier visible write toggles the canvas HIDDEN class", () => {
    // The canvas-only branch of the visibility dispatch: no Leaflet layer
    // exists to add/remove, so the class on the canvas IS the carrier.
    const canvas = document.createElement("canvas");
    const { ui } = boot([{ id: "cv", name: "CV", role: "overlay", canvas }]);
    const li = () => ui.c.layerRegistry.get("cv")!;

    dispatchStateOp(ui, li(), { type: "visible", value: false });
    expect(canvas.classList.contains("hidden")).toBe(true);

    dispatchStateOp(ui, li(), { type: "visible", value: true });
    expect(canvas.classList.contains("hidden")).toBe(false);
  });

  describe("LAYER_CHANGE — emitted once the operation has settled", () => {
    // The executor does not emit; the operation layer does, after its own
    // side effects (carrier write, row paint, tri-state count, hatch) have
    // landed. Both map-membership and canvas-HIDDEN-class writes are
    // visibility flips, so both ride the same `LAYER_CHANGE` notification.
    // The dispatcher returns `wrote` so a projection that finds the carrier
    // already matched never manufactures a change event.

    it("a canvas hide emits LAYER_CHANGE and the callback reads the new class", () => {
      const canvas = document.createElement("canvas");
      const { ui, manager } = boot([
        { id: "cv-e", name: "CV-E", role: "overlay", canvas },
      ]);
      ui.runtimeStore.setAuthorVisible("cv-e", true);
      const seen: Array<{ id: string; kind: string } | undefined> = [];
      const observedHidden: Array<boolean | undefined> = [];
      manager.events.on(EVENTS.LAYER_CHANGE, payload => {
        seen.push(payload as { id: string; kind: string } | undefined);
        // The event is delivered after the class flip, so a subscriber
        // reading the canvas sees the post-write state.
        observedHidden.push(canvas.classList.contains(HIDDEN));
      });

      ui.applyVisibility("cv-e", false);

      expect(seen).toEqual([{ id: "cv-e", kind: "canvas" }]);
      expect(observedHidden).toEqual([true]);
      expect(canvas.classList.contains(HIDDEN)).toBe(true);
    });

    it("a canvas show emits LAYER_CHANGE and the callback reads the new class", () => {
      const canvas = document.createElement("canvas");
      const { ui, manager } = boot([
        { id: "cv-f", name: "CV-F", role: "overlay", canvas },
      ]);
      ui.runtimeStore.setAuthorVisible("cv-f", true);
      ui.applyVisibility("cv-f", false);

      const seen: Array<{ id: string; kind: string } | undefined> = [];
      const observedHidden: Array<boolean | undefined> = [];
      manager.events.on(EVENTS.LAYER_CHANGE, payload => {
        seen.push(payload as { id: string; kind: string } | undefined);
        observedHidden.push(canvas.classList.contains(HIDDEN));
      });

      ui.applyVisibility("cv-f", true);

      expect(seen).toEqual([{ id: "cv-f", kind: "canvas" }]);
      expect(observedHidden).toEqual([false]);
      expect(canvas.classList.contains(HIDDEN)).toBe(false);
    });

    it("a repeated canvas hide emits only once", () => {
      const canvas = document.createElement("canvas");
      const { ui, manager } = boot([
        { id: "cv-g", name: "CV-G", role: "overlay", canvas },
      ]);
      ui.runtimeStore.setAuthorVisible("cv-g", true);
      setIntent(ui, "cv-g", "visible", false);
      applyProjection(ui, "cv-g");

      const spy = vi.fn();
      manager.events.on(EVENTS.LAYER_CHANGE, spy);

      applyProjection(ui, "cv-g");
      applyProjection(ui, "cv-g");

      expect(spy).not.toHaveBeenCalled();
    });

    it("a zoom sweep that moves a layer out of its range emits LAYER_CHANGE", () => {
      // A zoomend (`applyProjectionAll`) that pushes a layer past its stored
      // zoom range is a real visibility flip — the layer leaves the map.
      // This is the executor's one notification channel; without the emit
      // subscribers (label, controller) would never hear the sweep.
      const layer = paneCapableLayer();
      const onMap = { current: false };
      const { ui, manager, map } = boot([
        { id: "zv", name: "ZV", role: "overlay", layer },
      ]);
      ui.runtimeStore.setAuthorVisible("zv", true);
      map.hasLayer = vi.fn((l: L.Layer) => onMap.current && l === layer);
      map.addLayer = vi.fn(() => {
        onMap.current = true;
      });
      map.removeLayer = vi.fn(() => {
        onMap.current = false;
      });
      applyProjection(ui, "zv");
      expect(onMap.current).toBe(true);

      const seen: Array<{ id: string; kind: string } | undefined> = [];
      manager.events.on(EVENTS.LAYER_CHANGE, payload => {
        seen.push(payload as { id: string; kind: string } | undefined);
      });

      setIntent(ui, "zv", "zoomRange", [0, 1]);
      ui.intentStore.seedProvenance("zv", ["zoomRange"]);
      ui.onZoomEnd?.();

      expect(onMap.current).toBe(false);
      expect(seen.length).toBe(1);
      expect(seen[0]).toEqual({ id: "zv", kind: "vector" });
    });

    it("a zoom sweep that brings a layer back into range emits LAYER_CHANGE", () => {
      const layer = paneCapableLayer();
      const onMap = { current: false };
      const { ui, manager, map } = boot([
        { id: "zv2", name: "ZV2", role: "overlay", layer },
      ]);
      ui.runtimeStore.setAuthorVisible("zv2", true);
      map.hasLayer = vi.fn((l: L.Layer) => onMap.current && l === layer);
      map.addLayer = vi.fn(() => {
        onMap.current = true;
      });
      map.removeLayer = vi.fn(() => {
        onMap.current = false;
      });
      applyProjection(ui, "zv2");
      setIntent(ui, "zv2", "zoomRange", [0, 1]);
      ui.intentStore.seedProvenance("zv2", ["zoomRange"]);
      ui.onZoomEnd?.();
      expect(onMap.current).toBe(false);

      const seen: Array<{ id: string; kind: string } | undefined> = [];
      manager.events.on(EVENTS.LAYER_CHANGE, payload => {
        seen.push(payload as { id: string; kind: string } | undefined);
      });

      clearIntent(ui, "zv2", "zoomRange");
      ui.onZoomEnd?.();

      expect(onMap.current).toBe(true);
      expect(seen.length).toBe(1);
      expect(seen[0]).toEqual({ id: "zv2", kind: "vector" });
    });

    it("does not emit LAYER_CHANGE when the layer reference is still null", () => {
      // Late binding: the surface resolved `visibility: "native"` but the
      // registry entry lost its layer and `findLayer` returns nothing. The
      // projection sweep still runs — the diff disagrees on `effectiveShown`
      // — but the executor cannot write the map, so it must not manufacture
      // a change notification nobody can observe.
      const layer = paneCapableLayer();
      const { ui, manager } = boot([
        { id: "nv2", name: "NV2", role: "overlay", layer },
      ]);
      ui.runtimeStore.setAuthorVisible("nv2", true);
      applyProjection(ui, "nv2");

      ui.c.layerRegistry.get("nv2")!.layer = null;
      ui.c.findLayer = vi.fn(() => null) as typeof ui.c.findLayer;
      ui.c.surfaceFor = (() => ({
        capabilities: { visibility: "native", opacity: "none", zoomRange: "none" },
      })) as unknown as typeof ui.c.surfaceFor;
      ui.c.map.hasLayer = vi.fn(() => false);
      ui.c.map.addLayer = vi.fn();

      const spy = vi.fn();
      manager.events.on(EVENTS.LAYER_CHANGE, spy);

      setIntent(ui, "nv2", "visible", true);
      applyProjection(ui, "nv2");

      expect(spy).not.toHaveBeenCalled();
      expect(ui.c.map.addLayer).not.toHaveBeenCalled();
    });
  });

  describe("LAYER_INTENT_CHANGE — emitted once the operation has settled", () => {
    // `LAYER_CHANGE` rides the effective flip (intent && policy), so a
    // user-only intent movement gated by zoomRange never reaches it.
    // `LAYER_INTENT_CHANGE` is the separate channel for that user-only
    // signal — subscribers that mirror the user's checkbox state in
    // their own UI listen to it rather than re-reading the registry.
    //
    // Semantic matrix (intent / effective flip):
    //   intent moved + effective moved → INTENT + CHANGE
    //   intent moved + effective same  → INTENT only (policy-gated)
    //   intent same  + effective moved → CHANGE only (zoom sweep)
    //   intent same  + effective same  → neither
    //   first projection               → neither (no prev to diff)

    it("intent flip with an effective flip fires INTENT and CHANGE", () => {
      const canvas = document.createElement("canvas");
      const { ui, manager } = boot([
        { id: "ie-both", name: "IE-Both", role: "overlay", canvas },
      ]);
      ui.runtimeStore.setAuthorVisible("ie-both", true);
      applyProjection(ui, "ie-both");
      expect(canvas.classList.contains(HIDDEN)).toBe(false);

      const intentSeen: Array<{
        id: string;
        kind: string;
        intent: { visible: boolean };
      }> = [];
      const changeSeen: Array<{ id: string; kind: string }> = [];
      manager.events.on(EVENTS.LAYER_INTENT_CHANGE, payload =>
        intentSeen.push(
          payload as {
            id: string;
            kind: string;
            intent: { visible: boolean };
          },
        ),
      );
      manager.events.on(EVENTS.LAYER_CHANGE, payload =>
        changeSeen.push(payload as { id: string; kind: string }),
      );

      ui.applyVisibility("ie-both", false);

      expect(intentSeen).toEqual([
        { id: "ie-both", kind: "canvas", intent: { visible: false } },
      ]);
      expect(changeSeen).toEqual([{ id: "ie-both", kind: "canvas" }]);
      expect(canvas.classList.contains(HIDDEN)).toBe(true);
    });

    it("intent flip gated by zoomRange fires INTENT only, not CHANGE", () => {
      // The core policy-gated case: intent moves but the effective
      // visibility is already off (range excludes the current zoom),
      // so the executor has no map-membership write to notify of.
      // Only the user-only channel fires — external UIs reading INTENT
      // see the checkbox movement even though the layer never appears.
      const canvas = document.createElement("canvas");
      const { ui, manager } = boot([
        { id: "ie-oor", name: "IE-OOR", role: "overlay", canvas },
      ]);
      ui.runtimeStore.setAuthorVisible("ie-oor", true);
      // Push the range entirely above the current zoom (mock returns 5):
      // the layer starts hidden from the start, and stays hidden no
      // matter what the user's checkbox says.
      setIntent(ui, "ie-oor", "zoomRange", [15, 18]);
      ui.intentStore.seedProvenance("ie-oor", ["zoomRange"]);
      // Establish a false intent baseline first, so the second apply
      // below can exercise a real intent flip gated by the range.
      setIntent(ui, "ie-oor", "visible", false);
      applyProjection(ui, "ie-oor");
      expect(canvas.classList.contains(HIDDEN)).toBe(true);

      const intentSeen: Array<{ intent: { visible: boolean } }> = [];
      const changeSeen: unknown[] = [];
      manager.events.on(EVENTS.LAYER_INTENT_CHANGE, payload =>
        intentSeen.push(payload as { intent: { visible: boolean } }),
      );
      manager.events.on(EVENTS.LAYER_CHANGE, payload => changeSeen.push(payload));

      // User checks the box. Intent flips false → true; policy keeps the
      // layer off the map, so no effective change, no LAYER_CHANGE.
      ui.applyVisibility("ie-oor", true);

      expect(intentSeen).toEqual([
        { id: "ie-oor", kind: "canvas", intent: { visible: true } },
      ]);
      expect(changeSeen).toEqual([]);
      expect(canvas.classList.contains(HIDDEN)).toBe(true);
    });

    it("effective flip without intent change fires CHANGE only, not INTENT", () => {
      // A zoom sweep that pushes a layer out of its range moves
      // effectiveShown without touching the user's stored intent —
      // the executor's one policy-gated path. Only LAYER_CHANGE fires.
      const layer = paneCapableLayer();
      const onMap = { current: false };
      const { ui, manager, map } = boot([
        { id: "ie-oom", name: "IE-OOM", role: "overlay", layer },
      ]);
      ui.runtimeStore.setAuthorVisible("ie-oom", true);
      map.hasLayer = vi.fn((l: L.Layer) => onMap.current && l === layer);
      map.addLayer = vi.fn(() => {
        onMap.current = true;
      });
      map.removeLayer = vi.fn(() => {
        onMap.current = false;
      });
      applyProjection(ui, "ie-oom");
      expect(onMap.current).toBe(true);

      const intentSeen: unknown[] = [];
      const changeSeen: Array<{ id: string; kind: string }> = [];
      manager.events.on(EVENTS.LAYER_INTENT_CHANGE, payload =>
        intentSeen.push(payload),
      );
      manager.events.on(EVENTS.LAYER_CHANGE, payload =>
        changeSeen.push(payload as { id: string; kind: string }),
      );

      setIntent(ui, "ie-oom", "zoomRange", [0, 1]);
      ui.intentStore.seedProvenance("ie-oom", ["zoomRange"]);
      ui.onZoomEnd?.();

      expect(onMap.current).toBe(false);
      expect(changeSeen).toEqual([{ id: "ie-oom", kind: "vector" }]);
      expect(intentSeen).toEqual([]);
    });

    it("a repeated applyProjection with the same intent fires neither event", () => {
      const canvas = document.createElement("canvas");
      const { ui, manager } = boot([
        { id: "ie-nochange", name: "IE-NoChange", role: "overlay", canvas },
      ]);
      ui.runtimeStore.setAuthorVisible("ie-nochange", true);
      applyProjection(ui, "ie-nochange");

      const intentSpy = vi.fn();
      const changeSpy = vi.fn();
      manager.events.on(EVENTS.LAYER_INTENT_CHANGE, intentSpy);
      manager.events.on(EVENTS.LAYER_CHANGE, changeSpy);

      applyProjection(ui, "ie-nochange");
      applyProjection(ui, "ie-nochange");

      expect(intentSpy).not.toHaveBeenCalled();
      expect(changeSpy).not.toHaveBeenCalled();
    });

    it("the first projection records a baseline without emitting", () => {
      // First pass has no `prev` to diff against — nothing to say has
      // "changed". Recording the baseline is a projection, not a
      // user action.
      const canvas = document.createElement("canvas");
      const { ui, manager } = boot([
        { id: "ie-first", name: "IE-First", role: "overlay", canvas },
      ]);
      ui.runtimeStore.setAuthorVisible("ie-first", true);
      ui.runtimeStore.deleteApplied("ie-first");

      const intentSpy = vi.fn();
      const changeSpy = vi.fn();
      manager.events.on(EVENTS.LAYER_INTENT_CHANGE, intentSpy);
      manager.events.on(EVENTS.LAYER_CHANGE, changeSpy);

      applyProjection(ui, "ie-first");

      expect(intentSpy).not.toHaveBeenCalled();
      expect(changeSpy).not.toHaveBeenCalled();
    });

    describe("reentrancy", () => {
      // A subscriber that re-enters through the operation layer during
      // `LAYER_INTENT_CHANGE` sees whatever `runtimeStore.getApplied`
      // returns at that moment. The projection commits its baseline before
      // returning to the operation layer, so that baseline is fresh by the
      // time the subscriber runs. If it were stale, a same-value write-back
      // looks like a new change and re-emits; if the outer operation then
      // re-wrote its own projection on return, the inner snapshot would be
      // clobbered and the next real change would look like a no-op.

      it("a subscriber that writes the same value back emits exactly once", () => {
        // The recursive write-back loop: a subscriber that observes the
        // intent and mirrors it through the operation layer would, before
        // the fix, see the stale baseline (still the pre-emit value),
        // diff to a false positive, and re-emit. The projection commits
        // its baseline before the operation emits, so the reentrant
        // operation diffs against the already-committed value and no
        // further emit fires.
        const canvas = document.createElement("canvas");
        const { ui, manager } = boot([
          { id: "re-entry-1", name: "Re-Entry-1", role: "overlay", canvas },
        ]);
        ui.runtimeStore.setAuthorVisible("re-entry-1", true);
        ui.runtimeStore.deleteApplied("re-entry-1");
        applyProjection(ui, "re-entry-1");

        const intentSpy = vi.fn();
        const changeSpy = vi.fn();
        // A mirroring subscriber: on every intent change it re-applies
        // the same intent through the public operation. Before the
        // commit-before-emit fix, the inner call read a stale baseline
        // (outer's commit hadn't landed yet), saw the same value as a
        // new change, and re-emitted — the loop only stopped because a
        // call-budget safety net tripped it after six rounds.
        manager.events.on(EVENTS.LAYER_INTENT_CHANGE, payload => {
          intentSpy(payload);
          ui.applyVisibility(payload.id, payload.intent.visible);
        });
        manager.events.on(EVENTS.LAYER_CHANGE, payload => changeSpy(payload));

        ui.applyVisibility("re-entry-1", false);

        expect(intentSpy).toHaveBeenCalledTimes(1);
        expect(intentSpy.mock.calls[0][0].intent.visible).toBe(false);
        expect(changeSpy).toHaveBeenCalledTimes(1);
        expect(canvas.classList.contains(HIDDEN)).toBe(true);
      });

      it("a subscriber that reverses the value reports the new intent immediately", () => {
        // Reverse correction: the outer operation flips intent false
        // → true and emits; a subscriber that disagrees applies
        // `visible: false` through the same operation, synchronously.
        // The inner projection must land its own baseline without the
        // outer re-overwriting it on return, so the emitted intent and
        // the runtimeStore agree. Without this the outer would write
        // its own projection back over the inner snapshot and the
        // subscriber's correction would only surface on the next
        // zoomend sweep — one nobody is waiting for.
        const canvas = document.createElement("canvas");
        const { ui, manager } = boot([
          { id: "re-entry-2", name: "Re-Entry-2", role: "overlay", canvas },
        ]);
        ui.runtimeStore.setAuthorVisible("re-entry-2", false);
        ui.runtimeStore.deleteApplied("re-entry-2");
        // First pass seeds a false-intent baseline; intent stays
        // false through that first projection (the canvas starts
        // hidden and stays hidden — policy doesn't force it on).
        applyProjection(ui, "re-entry-2");
        expect(ui.runtimeStore.getApplied("re-entry-2")?.intent.visible).toBe(false);

        const intentSeen: Array<{ intent: { visible: boolean } }> = [];
        const changeSeen: Array<{ id: string; kind: string }> = [];
        manager.events.on(EVENTS.LAYER_INTENT_CHANGE, payload =>
          intentSeen.push(payload as { intent: { visible: boolean } }),
        );
        manager.events.on(EVENTS.LAYER_CHANGE, payload =>
          changeSeen.push(payload as { id: string; kind: string }),
        );
        // The reentrant subscriber: the outer flip triggers its handler,
        // which disagrees and writes back the opposite value. Because the
        // projection commits its baseline before the outer operation emits,
        // the inner projection reads a fresh baseline, sees its own diff as
        // a real movement, and lands its own setApplied — the last snapshot
        // that wins. Its operation then emits, so the correction is visible
        // immediately rather than on a later zoomend sweep.
        manager.events.on(EVENTS.LAYER_INTENT_CHANGE, () => {
          ui.applyVisibility("re-entry-2", false);
        });

        ui.applyVisibility("re-entry-2", true);

        // Outer fired once (intent true), inner fired once (intent
        // false). The inner's setApplied must have survived the outer
        // return — no second outer overwrite clobbered it.
        expect(intentSeen.map(p => p.intent.visible)).toEqual([true, false]);
        // Both the outer flip and the inner reverse flip land on the
        // carrier — the reverse is a real visibility movement the
        // subscriber intended, so it emits its own CHANGE.
        expect(changeSeen.length).toBe(2);
        expect(ui.runtimeStore.getApplied("re-entry-2")?.intent.visible).toBe(false);
        expect(canvas.classList.contains(HIDDEN)).toBe(true);
      });

      it("two subscribers that both re-write terminate with a consistent final state", () => {
        // Two subscribers reacting to the same emit each write their
        // own operation back. Both read the fresh baseline the outer
        // just committed; neither re-emits, so no infinite loop, and
        // the last writer's baseline is what wins. The outer operation
        // never re-commits over the inner — the final `getApplied`
        // matches the intent the last subscriber put in the store.
        const canvas = document.createElement("canvas");
        const { ui, manager } = boot([
          { id: "re-entry-3", name: "Re-Entry-3", role: "overlay", canvas },
        ]);
        ui.runtimeStore.setAuthorVisible("re-entry-3", true);
        ui.runtimeStore.deleteApplied("re-entry-3");
        applyProjection(ui, "re-entry-3");

        let intentTotal = 0;
        let changeTotal = 0;
        manager.events.on(EVENTS.LAYER_INTENT_CHANGE, () => {
          intentTotal++;
          ui.applyVisibility("re-entry-3", true);
        });
        manager.events.on(EVENTS.LAYER_INTENT_CHANGE, () => {
          ui.applyVisibility("re-entry-3", true);
        });
        manager.events.on(EVENTS.LAYER_CHANGE, () => changeTotal++);

        expect(() => {
          ui.applyVisibility("re-entry-3", false);
        }).not.toThrow();

        expect(intentTotal).toBeLessThanOrEqual(4);
        expect(changeTotal).toBeLessThanOrEqual(4);
        expect(ui.runtimeStore.getApplied("re-entry-3")?.intent.visible).toBe(true);
        expect(canvas.classList.contains(HIDDEN)).toBe(false);
      });
    });
  });

  it("applyProjection reads the canvas class back as the current carrier state", () => {
    // The executor's `currentShown` comes from the live class, not from
    // runtime `applied` row: a canvas somebody hid out-of-band converges back to
    // intent, and an intent hide lands even though the class started clear.
    const canvas = document.createElement("canvas");
    const { ui } = boot([{ id: "cv2", name: "CV2", role: "overlay", canvas }]);
    ui.runtimeStore.setAuthorVisible("cv2", true);

    canvas.classList.add("hidden"); // out-of-band hide while intent says shown
    applyProjection(ui, "cv2");
    expect(canvas.classList.contains("hidden")).toBe(false);

    setIntent(ui, "cv2", "visible", false); // the user unchecks
    applyProjection(ui, "cv2");
    expect(canvas.classList.contains("hidden")).toBe(true);
  });

  it("a visible op on a 'none' carrier writes nothing", () => {
    // No Leaflet layer, no canvas — neither branch of the dispatcher has an
    // honest target, and the read side reports `false` for "shown" rather
    // than guessing.
    const { ui, map } = boot([{ id: "nc", name: "NC", role: "overlay" }]);
    (map.addLayer as ReturnType<typeof vi.fn>).mockClear();

    dispatchStateOp(ui, ui.c.layerRegistry.get("nc")!, {
      type: "visible",
      value: false,
    });

    expect(map.addLayer).not.toHaveBeenCalled();
    expect(map.removeLayer).not.toHaveBeenCalled();
  });

  it("a pane-carrier visible write whose canvas vanished writes nothing", () => {
    // The surface resolved `visibility: "pane"` while the canvas existed;
    // if the element is gone by write time the dispatcher must not throw —
    // there is simply no element left to stamp.
    const canvas = document.createElement("canvas");
    const { ui } = boot([{ id: "pc", name: "PC", role: "overlay", canvas }]);
    ui.c.layerRegistry.get("pc")!.canvas = null;

    expect(() =>
      dispatchStateOp(ui, ui.c.layerRegistry.get("pc")!, {
        type: "visible",
        value: false,
      }),
    ).not.toThrow();
    expect(canvas.classList.contains("hidden")).toBe(false);
  });

  it("defensive: a pane carrier whose canvas target vanished writes nothing", () => {
    // Unlike the test above (where surfaceFor re-resolves and reports
    // "none"), pin the dispatcher's own guard: the carrier may still say
    // "pane" while the element is gone — stub the surface so the branch
    // under test is the `if (canvas)` miss, not the rebuild.
    const { ui, map } = boot([
      {
        id: "pc2",
        name: "PC2",
        role: "overlay",
        canvas: document.createElement("canvas"),
      },
    ]);
    const li = ui.c.layerRegistry.get("pc2")!;
    li.canvas = null;
    ui.c.surfaceFor = (() => ({
      capabilities: { visibility: "pane", opacity: "none", zoomRange: "none" },
    })) as unknown as typeof ui.c.surfaceFor;
    (map.addLayer as ReturnType<typeof vi.fn>).mockClear();

    dispatchStateOp(ui, li, { type: "visible", value: false });

    expect(map.addLayer).not.toHaveBeenCalled();
  });

  it("defensive: a native carrier whose layer target vanished writes nothing", () => {
    // Carrier says "native", but the registry entry lost its layer and the
    // window/map lookup finds nothing: both the `?? findLayer` miss and the
    // `if (layer)` miss must fall through to no write, and the projection's
    // currentShown read must report `false` rather than throw.
    const { ui, map } = boot([
      { id: "nv", name: "NV", role: "overlay", layer: { options: {} } as L.Layer },
    ]);
    const li = ui.c.layerRegistry.get("nv")!;
    li.layer = null;
    ui.c.findLayer = vi.fn(() => null) as typeof ui.c.findLayer;
    ui.c.surfaceFor = (() => ({
      capabilities: { visibility: "native", opacity: "none", zoomRange: "none" },
    })) as unknown as typeof ui.c.surfaceFor;
    ui.runtimeStore.setAuthorVisible("nv", true);
    (map.addLayer as ReturnType<typeof vi.fn>).mockClear();
    (map.hasLayer as ReturnType<typeof vi.fn>).mockReturnValue(false);

    dispatchStateOp(ui, li, { type: "visible", value: true });
    applyProjection(ui, "nv");

    expect(map.addLayer).not.toHaveBeenCalled();
  });

  it("throws on an unknown StateOp type — the exhaustiveness guard fires", () => {
    // `StateOp` is a closed union (`"visible" | "opacity"`). If someone adds
    // a new variant without extending the dispatcher, the trailing
    // `const _exhaustive: never = op; throw ...` is what makes the missing
    // branch loud instead of a silent `return false`. Exercised here by
    // deliberately violating the union — the throw is the honest outcome.
    const { ui } = boot([{ id: "x", name: "X", role: "overlay" }]);

    expect(() =>
      dispatchStateOp(ui, ui.c.layerRegistry.get("x")!, {
        type: "bogus" as never,
        value: 0,
      }),
    ).toThrow(/unreachable dispatchStateOp type/);
  });

  it("a 'none' opacity carrier stores nothing and writes nothing", () => {
    // A slider that writes nothing must not pretend it wrote. MarkerCluster
    // icons live in the shared markerPane, which no per-layer CSS write can
    // reach — the honest answer is "no write exists".
    const layer = paneCapableLayer();
    const { ui, manager } = boot([{ id: "n", name: "None", role: "overlay", layer }]);
    vi.spyOn(manager, "surfaceFor").mockReturnValue({
      capabilities: { opacity: "none", zoomRange: "none" },
      paneNames: [],
      geometryType: () => "point",
    } as unknown as ReturnType<typeof manager.surfaceFor>);

    setIntent(ui, "n", "opacity", 0.2);
    ui.intentStore.seedProvenance("n", ["opacity"]);
    applyProjection(ui, "n");

    expect((layer.options as { opacity?: number }).opacity).toBeUndefined();
    expect(manager.layerRegistry.get("n")?.opacity).toBe(1);
  });

  it("a native opacity carrier with setOpacity multiplies the author's base", () => {
    // The slider is a multiplier over the declared default, so the base is
    // captured once — repeated drags must not compound on their own output.
    const setOpacity = vi.fn();
    const layer = { options: { opacity: 0.5 }, setOpacity } as unknown as L.Layer;
    const { ui, manager } = boot([{ id: "img", name: "Img", role: "overlay", layer }]);
    vi.spyOn(manager, "surfaceFor").mockReturnValue({
      capabilities: { opacity: "native", zoomRange: "none" },
      paneNames: [],
      geometryType: () => "polygon",
    } as unknown as ReturnType<typeof manager.surfaceFor>);

    setIntent(ui, "img", "opacity", 0.5);
    ui.intentStore.seedProvenance("img", ["opacity"]);
    applyProjection(ui, "img");
    applyProjection(ui, "img");

    expect(setOpacity).toHaveBeenNthCalledWith(1, 0.25);
  });

  it("a native opacity carrier without setOpacity writes options.opacity", () => {
    // GridLayer / TileLayer honor `options.opacity` at the next tile cycle
    // rather than through a setter.
    const layer = { options: { opacity: 0.8 } } as L.Layer;
    const { ui, manager } = boot([
      { id: "tile", name: "Tile", role: "overlay", layer },
    ]);
    vi.spyOn(manager, "surfaceFor").mockReturnValue({
      capabilities: { opacity: "native", zoomRange: "native" },
      paneNames: [],
      geometryType: () => "polygon",
    } as unknown as ReturnType<typeof manager.surfaceFor>);

    setIntent(ui, "tile", "opacity", 0.5);
    ui.intentStore.seedProvenance("tile", ["opacity"]);
    applyProjection(ui, "tile");

    expect((layer.options as { opacity?: number }).opacity).toBe(0.4);
  });

  it("freezes the opacity base on the first write; later slider drags never re-read the mutated options", () => {
    // memoizeLayer idempotency contract: the base is captured once from
    // `options.opacity` at first access and never re-read. `dispatchStateOp`
    // writes the multiplied value back to `options.opacity`, so a second call
    // that re-read options.opacity would compound (0.8 → 0.4 → 0.24). The
    // frozen skeleton keeps it at 0.8 * slider — the second drag lands at
    // 0.8 * 0.6 = 0.48, not the ratcheted 0.24.
    const layer = { options: { opacity: 0.8 } } as L.Layer;
    const { ui, manager } = boot([
      { id: "tile", name: "Tile", role: "overlay", layer },
    ]);
    vi.spyOn(manager, "surfaceFor").mockReturnValue({
      capabilities: { opacity: "native", zoomRange: "native" },
      paneNames: [],
      geometryType: () => "polygon",
    } as unknown as ReturnType<typeof manager.surfaceFor>);

    setIntent(ui, "tile", "opacity", 0.5);
    ui.intentStore.seedProvenance("tile", ["opacity"]);
    applyProjection(ui, "tile");
    expect((layer.options as { opacity?: number }).opacity).toBe(0.4);

    setIntent(ui, "tile", "opacity", 0.6);
    applyProjection(ui, "tile");
    expect((layer.options as { opacity?: number }).opacity).toBe(0.48);

    // Third drag — the base is still 0.8, not the previous 0.48.
    setIntent(ui, "tile", "opacity", 0.25);
    applyProjection(ui, "tile");
    expect((layer.options as { opacity?: number }).opacity).toBe(0.2);
  });

  it("memoizeLayer skips caching for a null layer — a later call with the same id still reads fresh", () => {
    // The zoom-bounds memo is keyed by layer identity. A layer id that the
    // registry doesn't know about (or a layer that hasn't materialized yet)
    // means `ui.c.layerRegistry.get(id)?.layer` is undefined and the memo
    // takes its null-layer branch: no cache entry, no cache lookup. Every
    // call falls through to the read closure, so the map's live min/max is
    // consulted each time — the correct answer for a not-yet-registered
    // layer, whose author bounds could still arrive.
    const { ui } = boot([]);
    const first = authorZoomBoundsForLayer(ui, "ghost");
    expect(first).toEqual([0, 18]);

    // A later call re-reads the map, not a cached value from the first call.
    // We verify this by advancing the map's maxZoom and seeing the new value
    // — a cached result would still report 18.
    (ui as any).c.map.getMaxZoom = vi.fn(() => 20);
    const second = authorZoomBoundsForLayer(ui, "ghost");
    expect(second).toEqual([0, 20]);
  });

  it("zoomRange does not write to layer options (visibility-only resolution)", () => {
    // Writing `options.minZoom/maxZoom` pollutes `map.getMaxZoom()` —
    // Leaflet derives map zoom from layer options, so the +/- controls
    // lock. The zoomRange resolves through the `visible` op instead.
    const layer = paneCapableLayer();
    let onMap = false;
    const { ui, map } = boot([{ id: "z", name: "Z", role: "overlay", layer }]);
    map.hasLayer.mockImplementation(() => onMap);
    map.addLayer.mockImplementation(() => {
      onMap = true;
    });
    map.removeLayer.mockImplementation(() => {
      onMap = false;
    });
    ui.intentStore.seedProvenance("z", ["visible"]); // authorize map writes

    // A range that includes the current zoom: layer is added.
    setIntent(ui, "z", "zoomRange", [4, 10]);
    applyProjection(ui, "z");
    const opts = layer.options as { minZoom?: number; maxZoom?: number };
    expect("minZoom" in opts).toBe(false);
    expect("maxZoom" in opts).toBe(false);
    expect(map.addLayer).toHaveBeenCalledWith(layer);

    // A range that excludes the current zoom: layer is removed, but
    // options are still untouched.
    map.getZoom.mockReturnValue(12);
    applyProjection(ui, "z");
    expect("minZoom" in opts).toBe(false);
    expect("maxZoom" in opts).toBe(false);
    expect(map.removeLayer).toHaveBeenCalledWith(layer);
  });

  it("the LayerUI delegates reach the same executor", () => {
    const { ui, map, manager } = boot([
      {
        id: "d",
        name: "D",
        role: "overlay",
        layer: paneCapableLayer(),
        show: false,
      },
    ]);
    setIntent(ui, "d", "opacity", 0.6);
    ui.intentStore.seedProvenance("d", ["opacity"]);
    (map.addLayer as ReturnType<typeof vi.fn>).mockClear();

    ui.applyProjection("d");
    expect(manager.layerRegistry.get("d")?.opacity).toBe(0.6);

    ui.applyProjectionAll();
    expect(map.addLayer).not.toHaveBeenCalled(); // idempotent: nothing moved
  });
});
