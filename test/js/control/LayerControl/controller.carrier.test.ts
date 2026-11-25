// test/js/control/LayerControl/controller.carrier — carrier recovery.
import {
  ENFORCE_ORDER_DEBOUNCE_MS,
  TestGroup,
  stableStamp,
} from "./controller.fixture.js";
import { initFixture } from "./ui/fixture.js";
import { describe, expect, it, vi } from "vitest";
import { EVENTS } from "#core/event/index.js";
import * as coreLayer from "#core/layer/index.js";

describe("carrier recovery (controller wiring)", () => {
  it("recovers opacity after a content removal attributed by layerremove", () => {
    const { manager, map } = initFixture({ data: [] });
    map.hasLayer.mockReturnValue(true);
    const group = new TestGroup([new window.L.Path()]);
    manager.registerLayer({
      id: "recover-direct",
      name: "Recover",
      layer: group as unknown as L.Layer,
    });
    const surface = manager.surfaceFor(manager.layerRegistry.get("recover-direct")!);
    expect(surface.capabilities.opacity).toBe("pane");

    const foreignEl = document.createElement("div");
    const foreign = { options: {}, getElement: () => foreignEl };
    group.addLayer(foreign);
    manager.onLayerAdd({ layer: foreign } as never);
    manager.enforceOrder();
    expect(surface.capabilities.opacity).toBe("none");

    // Leaflet fires `layerremove` while the group still holds the child;
    // mark first, then let the group finish the removal — the production
    // order for `LayerGroup.removeLayer`.
    manager.onLayerRemove({ layer: foreign } as never);
    group.removeLayer(foreign);
    manager.enforceOrder();
    expect(surface.capabilities.opacity).toBe("pane");
  });

  it("attributes a nested group's content change without an owner scan", () => {
    const { manager, map } = initFixture({ data: [] });
    map.hasLayer.mockReturnValue(true);
    const inner = new TestGroup([new window.L.Path()]);
    const outer = new TestGroup([inner]);
    manager.registerLayer({
      id: "recover-nested",
      name: "Nested",
      layer: outer as unknown as L.Layer,
    });
    const surface = manager.surfaceFor(manager.layerRegistry.get("recover-nested")!);
    expect(surface.capabilities.opacity).toBe("pane");

    // A nested leaf has no O(1) owner signal (no stamp index, no write-point
    // row, no `hasLayer` on the root), so the event marks every live surface
    // and the pass re-audits each tree once — the behavior survives, the
    // per-surface tree scan does not.
    const foreign = { options: {}, getElement: () => document.createElement("div") };
    inner.addLayer(foreign);
    manager.onLayerAdd({ layer: foreign } as never);
    manager.enforceOrder();
    expect(surface.capabilities.opacity).toBe("none");

    manager.onLayerRemove({ layer: foreign } as never);
    inner.removeLayer(foreign);
    manager.enforceOrder();
    expect(surface.capabilities.opacity).toBe("pane");
  });

  it("re-audits a same-layer re-registration without a layeradd", () => {
    const { manager, map } = initFixture({ data: [] });
    map.hasLayer.mockReturnValue(true);
    const group = new TestGroup([new window.L.Path()]);
    const opts = {
      id: "recover-rereg",
      name: "Rereg",
      layer: group as unknown as L.Layer,
    };
    manager.registerLayer(opts);
    const surface = manager.surfaceFor(manager.layerRegistry.get("recover-rereg")!);
    expect(surface.capabilities.opacity).toBe("pane");

    const foreign = { options: {}, getElement: () => document.createElement("div") };
    group.addLayer(foreign);
    // No layeradd is fired: same-object re-registration is the change signal.
    manager.registerLayer(opts);
    expect(surface.capabilities.opacity).toBe("none");

    group.removeLayer(foreign);
    manager.registerLayer(opts);
    expect(surface.capabilities.opacity).toBe("pane");
  });

  it("re-audits after invalidateType without a manual enforce", async () => {
    // The registration schedules its own ordering pass. This test settles
    // that pass BEFORE the DOM-only change, so it can only pass because
    // `invalidateType` scheduled one — otherwise (the pre-fix behavior) the
    // registration pass is what audits the change and the test is a no-op
    // that also passes on the unfixed code.
    const { manager, map } = initFixture({ data: [] });
    map.hasLayer.mockReturnValue(true);
    vi.useFakeTimers();
    try {
      const group = new TestGroup([new window.L.Path()]);
      manager.registerLayer({
        id: "invalidate-only",
        name: "Inv",
        layer: group as unknown as L.Layer,
      });
      const surface = manager.surfaceFor(manager.layerRegistry.get("invalidate-only")!);
      await vi.advanceTimersByTimeAsync(ENFORCE_ORDER_DEBOUNCE_MS);
      expect(surface.capabilities.opacity).toBe("pane");

      const foreignEl = document.createElement("div");
      const foreign = { options: {}, getElement: () => foreignEl };
      group.addLayer(foreign);
      // No layeradd/layerremove: a DOM-only tree change. Only the invalidate
      // hook can tell the ordering pass to re-audit.
      manager.invalidateType("invalidate-only");
      // Nothing has been audited yet — the pass is still pending.
      expect(surface.capabilities.opacity).toBe("pane");
      await vi.advanceTimersByTimeAsync(ENFORCE_ORDER_DEBOUNCE_MS);
      expect(surface.capabilities.opacity).toBe("none");

      group.removeLayer(foreign);
      manager.invalidateType("invalidate-only");
      await vi.advanceTimersByTimeAsync(ENFORCE_ORDER_DEBOUNCE_MS);
      expect(surface.capabilities.opacity).toBe("pane");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not mark a surface or schedule a pass for its own hide/show", () => {
    const { manager, map } = initFixture({ data: [] });
    map.hasLayer.mockReturnValue(true);
    const group = new TestGroup([new window.L.Path()]);
    manager.registerLayer({
      id: "own-membership",
      name: "Own",
      layer: group as unknown as L.Layer,
    });
    const surface = manager.surfaceFor(manager.layerRegistry.get("own-membership")!);
    // Settle the registration pass, then spy: a hide/show of the registered
    // layer is map membership, not content, so it must neither mark the
    // surface nor queue an ordering pass.
    manager.debouncedEnforce.cancel();
    vi.useFakeTimers();
    const mark = vi.spyOn(surface, "markContentDirty");
    const pass = vi.spyOn(manager, "enforceOrder");
    try {
      manager.onLayerRemove({ layer: group } as never);
      vi.advanceTimersByTime(ENFORCE_ORDER_DEBOUNCE_MS);
      expect(mark).not.toHaveBeenCalled();
      expect(pass).not.toHaveBeenCalled();
    } finally {
      mark.mockRestore();
      pass.mockRestore();
      vi.useRealTimers();
    }
  });

  it("short-circuits attribution for a registered layer's own hide/show", () => {
    // With Leaflet's identity-stable stamp the first O(1) signal answers: the
    // registered layer resolves from the index's layer-stamp direction, so a
    // hide/show returns
    // before the O(surfaces) scans and cannot mark a neighbouring tree dirty —
    // the optimization the fallback path in the test above cannot exercise.
    const { manager, map } = initFixture({ data: [] });
    map.hasLayer.mockReturnValue(true);
    vi.useFakeTimers();
    const realStamp = window.L.stamp;
    window.L.stamp = stableStamp;
    try {
      const group = new TestGroup([new window.L.Path()]);
      manager.registerLayer({ id: "own-stamp", name: "Own", layer: group as never });
      manager.registerLayer({
        id: "other-stamp",
        name: "Other",
        layer: new TestGroup([new window.L.Path()]) as never,
      });
      const surface = manager.surfaceFor(manager.layerRegistry.get("own-stamp")!);
      const other = manager.surfaceFor(manager.layerRegistry.get("other-stamp")!);
      manager.debouncedEnforce.cancel();
      const mark = vi.spyOn(surface, "markContentDirty");
      const otherMark = vi.spyOn(other, "markContentDirty");
      const pass = vi.spyOn(manager, "enforceOrder");
      manager.onLayerRemove({ layer: group } as never);
      vi.advanceTimersByTime(ENFORCE_ORDER_DEBOUNCE_MS);
      expect(mark).not.toHaveBeenCalled();
      expect(otherMark).not.toHaveBeenCalled();
      expect(pass).not.toHaveBeenCalled();
    } finally {
      window.L.stamp = realStamp;
      vi.useRealTimers();
    }
  });

  it("marks surfaces for an unattributed add without scanning any tree", () => {
    // The old fallback ran one `findNode` per live surface for every event it
    // could not attribute — O(sum of tree sizes) per event, and again on every
    // re-add after a remove. The fallback now marks each live surface once
    // (O(surfaces)) and lets the coalesced pass walk each dirty tree once.
    const { manager, map } = initFixture({ data: [] });
    map.hasLayer.mockReturnValue(true);
    vi.useFakeTimers();
    const findSpy = vi.spyOn(coreLayer, "findNode");
    try {
      const surfaces = [];
      for (let i = 0; i < 5; i++) {
        const leaves = Array.from({ length: 40 }, () => new window.L.Path());
        manager.registerLayer({
          id: `scan${i}` as never,
          name: `Scan ${i}`,
          layer: new TestGroup(leaves) as unknown as L.Layer,
        });
        surfaces.push(manager.surfaceFor(manager.layerRegistry.get(`scan${i}`)!));
      }
      const marks = surfaces.map(surface => vi.spyOn(surface, "markContentDirty"));

      // A layer nothing provably owns (a third-party control's own layer).
      manager.onLayerAdd({ layer: { options: {}, eachLayer: vi.fn() } } as never);

      expect(findSpy).not.toHaveBeenCalled();
      for (const mark of marks) expect(mark).toHaveBeenCalledTimes(1);
    } finally {
      findSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("does not rescan the trees when a nested leaf is removed and re-added", () => {
    // The regression the cache delete-on-remove left behind: a remove lost the
    // reverse entry, so the re-add paid a full owner scan again. Neither event
    // may scan now — both take the mark-all fallback.
    const { manager, map } = initFixture({ data: [] });
    map.hasLayer.mockReturnValue(true);
    const inner = new TestGroup([new window.L.Path()]);
    const outer = new TestGroup([inner]);
    manager.registerLayer({
      id: "re-add",
      name: "Re-add",
      layer: outer as unknown as L.Layer,
    });
    const surface = manager.surfaceFor(manager.layerRegistry.get("re-add")!);
    expect(surface.capabilities.opacity).toBe("pane");
    const findSpy = vi.spyOn(coreLayer, "findNode");
    try {
      const foreign = { options: {}, getElement: () => document.createElement("div") };
      inner.addLayer(foreign);
      manager.onLayerAdd({ layer: foreign } as never);
      manager.enforceOrder();
      expect(surface.capabilities.opacity).toBe("none");

      // Remove (tree becomes migratable again), then re-add: neither the
      // remove nor the re-add may scan a tree for the owner.
      manager.onLayerRemove({ layer: foreign } as never);
      inner.removeLayer(foreign);
      manager.enforceOrder();
      expect(surface.capabilities.opacity).toBe("pane");

      inner.addLayer(foreign);
      manager.onLayerAdd({ layer: foreign } as never);
      manager.enforceOrder();

      expect(findSpy).not.toHaveBeenCalled();
      expect(surface.capabilities.opacity).toBe("none");
    } finally {
      findSpy.mockRestore();
    }
  });

  it("re-audits the new owner when a nested leaf moves without a layerremove", () => {
    // Probe V5: the reverse cache pointed at A after the first attribution, and
    // a blind hit marked A only. B then kept reporting opacity "pane" while its
    // tree already held a foreign leaf. A stale cache may never steer the mark.
    const { manager, map } = initFixture({ data: [] });
    map.hasLayer.mockReturnValue(true);
    const innerA = new TestGroup([new window.L.Path()]);
    const outerA = new TestGroup([innerA]);
    const outerB = new TestGroup([new window.L.Path()]);
    manager.registerLayer({
      id: "move-a",
      name: "A",
      layer: outerA as unknown as L.Layer,
    });
    manager.registerLayer({
      id: "move-b",
      name: "B",
      layer: outerB as unknown as L.Layer,
    });
    const surfaceA = manager.surfaceFor(manager.layerRegistry.get("move-a")!);
    const surfaceB = manager.surfaceFor(manager.layerRegistry.get("move-b")!);
    manager.enforceOrder();
    expect(surfaceA.capabilities.opacity).toBe("pane");
    expect(surfaceB.capabilities.opacity).toBe("pane");

    const foreign = { options: {}, getElement: () => document.createElement("div") };
    innerA.addLayer(foreign);
    manager.onLayerAdd({ layer: foreign } as never);
    manager.enforceOrder();
    expect(surfaceA.capabilities.opacity).toBe("none");

    // Move WITHOUT a layerremove: a detached source group does not propagate
    // child removals, so no re-attribution event reaches the controller.
    innerA.removeLayer(foreign);
    outerB.addLayer(foreign);
    manager.onLayerAdd({ layer: foreign } as never);
    manager.enforceOrder();

    // B holds the leaf now, so B must report the degrade. A is left
    // conservatively degraded: nothing told the controller that A lost the
    // leaf (that is the missing `layerremove`), and a stale "none" hides a
    // control rather than offering one that writes into a foreign pane.
    expect(surfaceB.capabilities.opacity).toBe("none");
  });

  it("confirms a direct-child attribution before trusting a stale cache", () => {
    // A cached owner that no longer holds the leaf must be dropped, not
    // returned: the surface that holds it now is the one that has to re-audit.
    const { manager, map } = initFixture({ data: [] });
    map.hasLayer.mockReturnValue(true);
    const groupA = new TestGroup([new window.L.Path()]);
    const groupB = new TestGroup([new window.L.Path()]);
    manager.registerLayer({
      id: "own-a",
      name: "A",
      layer: groupA as unknown as L.Layer,
    });
    manager.registerLayer({
      id: "own-b",
      name: "B",
      layer: groupB as unknown as L.Layer,
    });
    const surfaceA = manager.surfaceFor(manager.layerRegistry.get("own-a")!);
    const surfaceB = manager.surfaceFor(manager.layerRegistry.get("own-b")!);
    manager.enforceOrder();

    const foreign = { options: {}, getElement: () => document.createElement("div") };
    groupA.addLayer(foreign);
    manager.onLayerAdd({ layer: foreign } as never);
    manager.enforceOrder();
    expect(surfaceA.capabilities.opacity).toBe("none");

    groupA.removeLayer(foreign);
    groupB.addLayer(foreign);
    manager.onLayerAdd({ layer: foreign } as never);
    manager.enforceOrder();

    expect(surfaceB.capabilities.opacity).toBe("none");
    expect(surfaceA.capabilities.opacity).toBe("pane");
  });

  it("treats a throwing hasLayer as no ownership evidence", () => {
    // Third-party groups are hostile inputs: hasLayer can throw. Attribution
    // must read that as "cannot confirm" (fail closed) instead of letting an
    // event handler die, and the O(surfaces) fallback still marks the live
    // trees once.
    const { manager, map } = initFixture({ data: [] });
    map.hasLayer.mockReturnValue(true);
    const hostile = {
      options: {},
      eachLayer: vi.fn(),
      hasLayer: vi.fn(() => {
        throw new Error("hasLayer boom");
      }),
    };
    manager.registerLayer({
      id: "hostile-has-layer",
      name: "Hostile",
      layer: hostile as unknown as L.Layer,
    });
    const surface = manager.surfaceFor(manager.layerRegistry.get("hostile-has-layer")!);
    const foreign = { options: {}, getElement: () => document.createElement("div") };
    const mark = vi.spyOn(surface, "markContentDirty");
    try {
      expect(() => manager.onLayerAdd({ layer: foreign } as never)).not.toThrow();
      // Confirmation failed, so the fallback marked the one live tree.
      expect(mark).toHaveBeenCalledTimes(1);
      expect(hostile.hasLayer).toHaveBeenCalled();
    } finally {
      mark.mockRestore();
    }
  });

  it("announces a capability change only when the projection actually moved", () => {
    // The style-panel live refresh rides this event. It has to fire on a
    // degrade and on a recovery, and stay silent on a pass that changed
    // nothing (the ordering pass runs on ordinary reorders too).
    const { manager, map } = initFixture({ data: [] });
    map.hasLayer.mockReturnValue(true);
    const group = new TestGroup([new window.L.Path()]);
    manager.registerLayer({
      id: "caps",
      name: "Caps",
      layer: group as unknown as L.Layer,
    });
    // Seed the snapshot silently: the first observation of a surface is not a
    // change.
    manager.enforceOrder();
    const seen: Array<{ id: string }> = [];
    manager.events.on(EVENTS.LAYER_CAPABILITY_CHANGED, payload => seen.push(payload));

    const foreign = { options: {}, getElement: () => document.createElement("div") };
    group.addLayer(foreign);
    manager.onLayerAdd({ layer: foreign } as never);
    manager.enforceOrder();
    expect(seen).toEqual([{ id: "caps" }]);

    // Unchanged projection: the next pass must not re-announce it.
    manager.enforceOrder();
    expect(seen).toHaveLength(1);

    // Recovery is a change too.
    manager.onLayerRemove({ layer: foreign } as never);
    group.removeLayer(foreign);
    manager.enforceOrder();
    expect(seen).toEqual([{ id: "caps" }, { id: "caps" }]);
  });

  it("drops a reverse-index entry whose surface retired", () => {
    const { manager, map } = initFixture({ data: [] });
    map.hasLayer.mockReturnValue(true);
    const inner = new TestGroup([new window.L.Path()]);
    const outer = new TestGroup([inner]);
    manager.registerLayer({
      id: "retired-cache",
      name: "Retired",
      layer: outer as unknown as L.Layer,
    });
    const foreign = { options: {}, getElement: () => document.createElement("div") };
    inner.addLayer(foreign);
    manager.onLayerAdd({ layer: foreign } as never);
    manager.unregisterLayer("retired-cache");

    expect(() => manager.onLayerRemove({ layer: foreign } as never)).not.toThrow();
  });

  it("re-attributes after a cached owner retired instead of steering its mark", () => {
    // The reverse cache outlives a surface: a direct child is attributed, then
    // its owner is unregistered (the surface retires, the WeakMap row is still
    // there), and a late event for the same leaf arrives. The stale row must be
    // dropped before anything is trusted — never marked onto the retired face,
    // and the live scan decides the new owner.
    const { manager, map } = initFixture({ data: [] });
    map.hasLayer.mockReturnValue(true);
    const ownerGroup = new TestGroup([new window.L.Path()]);
    manager.registerLayer({
      id: "retired-owner",
      name: "Owner",
      layer: ownerGroup as unknown as L.Layer,
    });
    const survivorGroup = new TestGroup([new window.L.Path()]);
    manager.registerLayer({
      id: "retired-survivor",
      name: "Survivor",
      layer: survivorGroup as unknown as L.Layer,
    });
    const owner = manager.surfaceFor(manager.layerRegistry.get("retired-owner")!);
    const survivor = manager.surfaceFor(manager.layerRegistry.get("retired-survivor")!);

    const foreign = { options: {}, getElement: () => document.createElement("div") };
    ownerGroup.addLayer(foreign);
    // Direct membership, so this attribution is cached for the leaf.
    manager.onLayerAdd({ layer: foreign } as never);

    manager.unregisterLayer("retired-owner");
    expect(owner.retired).toBe(true);

    const ownerMark = vi.spyOn(owner, "markContentDirty");
    const survivorMark = vi.spyOn(survivor, "markContentDirty");
    try {
      expect(() => manager.onLayerAdd({ layer: foreign } as never)).not.toThrow();
      expect(ownerMark).not.toHaveBeenCalled();
      // Unattributed now (no live tree holds it): the mark-all fallback marks
      // the one live tree-bearing surface.
      expect(survivorMark).toHaveBeenCalledTimes(1);
    } finally {
      ownerMark.mockRestore();
      survivorMark.mockRestore();
    }
  });

  it("does not schedule an enforce after destroy", () => {
    const { manager } = initFixture({ data: [] });
    manager.destroy();
    expect(() => manager.invalidateType("gone")).not.toThrow();
  });
});
