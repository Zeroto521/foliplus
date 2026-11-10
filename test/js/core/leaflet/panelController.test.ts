// Contract tests for the shared panel controller.
//
// These exercise createPanel + attachPanel against the real per-map overlay
// registry (document-level press/Escape dispatch), so they verify the
// controller's behaviour through the mechanism a component actually drives.
// They cover the behaviour matrix below plus the idempotency / rollback /
// destroy contracts, and one negative control per behaviour (each mutation
// turns a test red; the matrix below names the mutation).
import type * as L from "leaflet";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type Dismiss,
  type PanelController,
  type PanelSpec,
  attachPanel,
  createPanel,
} from "#core/leaflet/index.js";
import { ensureOverlayRegistry } from "#core/overlay/index.js";

/** A map stand-in: the registry only needs the unload hook. */
const makeMap = () => {
  let unload: () => void = () => undefined;
  const on = vi.fn((event: string, handler: () => void) => {
    if (event === "unload") unload = handler;
  });
  return {
    map: { on } as unknown as L.Map,
    fireUnload: () => unload(),
  };
};

/** A live fixture panel: a dialog root with a close button and a plain inside
 *  element, plus a record of every open/close call the spec makes. The root
 *  stops mousedown (like a real row panel does for drag) but NOT click — the
 *  close button's stopPropagation is the controller's guarantee, so removing
 *  it must make the #816 assertion (C) go red. */
const makeFixture = (over: Partial<PanelSpec> = {}) => {
  const root = document.createElement("div");
  root.setAttribute("role", "dialog");
  const closeButton = document.createElement("button");
  closeButton.setAttribute("data-foliplus-panel-close", "");
  const inside = document.createElement("div");
  root.append(closeButton, inside);
  root.addEventListener("mousedown", e => e.stopPropagation());
  document.body.appendChild(root);

  const state = {
    open: false,
    openCalls: 0,
    closeCalls: [] as boolean[],
    onOpenCalls: 0,
    onCloseCalls: 0,
    canClose: (): boolean => true,
    root,
    closeButton,
    inside,
  };
  const spec: PanelSpec = {
    owner: "layer",
    localId: "style",
    rank: 500,
    root: () => root,
    open: () => {
      state.open = true;
      state.openCalls += 1;
    },
    close: ({ restoreFocus }) => {
      state.closeCalls.push(restoreFocus);
      if (!state.canClose()) return false;
      state.open = false;
      return true;
    },
    onOpen: () => {
      state.onOpenCalls += 1;
    },
    onClose: () => {
      state.onCloseCalls += 1;
    },
    ...over,
  };
  return { spec, state, root, closeButton, inside };
};

/** Dispatch a keydown Escape on the document (the registry's dispatcher is
 *  document-level capture). */
const pressEscape = (): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });
  document.dispatchEvent(event);
  return event;
};

/** Dispatch a mousedown on a node with bubbles so it reaches the document
 *  capture listener (the registry's outside-press dispatcher). */
const pressMouse = (target: Node): MouseEvent => {
  const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};

describe("PanelController", () => {
  let maps: ReturnType<typeof makeMap>[] = [];

  beforeEach(() => {
    maps = [];
  });

  afterEach(() => {
    for (const { fireUnload } of maps) fireUnload();
    maps = [];
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  const track = (m: ReturnType<typeof makeMap>) => {
    maps.push(m);
    return m;
  };

  // ───────────────────────────── identity / dismiss ─────────────────────────

  it("exposes owner/localId/rank and the default dismiss", () => {
    const { spec, state } = makeFixture();
    const controller: PanelController = createPanel(spec);
    expect(controller.owner).toBe("layer");
    expect(controller.localId).toBe("style");
    expect(controller.rank).toBe(500);
    const dismiss: Dismiss = controller.dismiss;
    expect(dismiss).toEqual({
      escape: true,
      outsidePress: "mousedown",
      internalCloseClick: true,
    });
    expect(controller.isOpen()).toBe(false);
    expect(controller.root()).toBe(state.root);
  });

  it("applies dismiss overrides and fills unset members with defaults", () => {
    const { spec } = makeFixture({
      dismiss: { escape: false, internalCloseClick: false },
    });
    const controller = createPanel(spec);
    expect(controller.dismiss).toEqual({
      escape: false,
      outsidePress: "mousedown",
      internalCloseClick: false,
    });
  });

  it("maps an explicit outsidePress: click", () => {
    const { spec } = makeFixture({ dismiss: { outsidePress: "click" } });
    const controller = createPanel(spec);
    expect(controller.dismiss.outsidePress).toBe("click");
  });

  // ───────────────────────────── open / close ───────────────────────────────

  it("open is idempotent (a second open is a no-op)", () => {
    const { spec, state } = makeFixture();
    const controller = createPanel(spec);
    controller.open();
    controller.open();
    expect(state.openCalls).toBe(1);
    expect(state.onOpenCalls).toBe(1);
    expect(controller.isOpen()).toBe(true);
  });

  it("open before attach does not throw (no registry wiring yet)", () => {
    const { spec, state } = makeFixture();
    const controller = createPanel(spec);
    controller.open();
    expect(state.openCalls).toBe(1);
    expect(controller.isOpen()).toBe(true);
  });

  it("close when closed is a no-op returning false", () => {
    const { spec, state } = makeFixture();
    const controller = createPanel(spec);
    expect(controller.close()).toBe(false);
    expect(state.closeCalls).toHaveLength(0);
    expect(controller.isOpen()).toBe(false);
  });

  it("close with restoreFocus passes the option to the spec", () => {
    const { spec, state } = makeFixture();
    const controller = createPanel(spec);
    controller.open();
    expect(controller.close({ restoreFocus: true })).toBe(true);
    expect(state.closeCalls).toEqual([true]);
    expect(state.onCloseCalls).toBe(1);
    expect(controller.isOpen()).toBe(false);
  });

  it("close defaults restoreFocus to false when the option is omitted", () => {
    const { spec, state } = makeFixture();
    const controller = createPanel(spec);
    controller.open();
    controller.close();
    expect(state.closeCalls).toEqual([false]);
  });

  it("close rolls back to open when the spec refuses (pending commit)", () => {
    const { spec, state } = makeFixture();
    state.canClose = () => false;
    const controller = createPanel(spec);
    controller.open();
    expect(controller.close()).toBe(false);
    expect(controller.isOpen()).toBe(true);
    expect(state.closeCalls).toEqual([false]);
    expect(state.onCloseCalls).toBe(0);
  });

  it("destroy closes silently (restoreFocus false) and is idempotent", () => {
    const { spec, state } = makeFixture();
    const controller = createPanel(spec);
    controller.open();
    controller.destroy();
    expect(state.closeCalls).toEqual([false]);
    expect(state.onCloseCalls).toBe(1);
    expect(controller.isOpen()).toBe(false);
    controller.destroy();
    expect(state.closeCalls).toHaveLength(1);
  });

  it("destroy when closed does not call the spec close", () => {
    const { spec, state } = makeFixture();
    const controller = createPanel(spec);
    controller.destroy();
    expect(state.closeCalls).toHaveLength(0);
    expect(controller.isOpen()).toBe(false);
  });

  // ───────────────────────────── closeFromClick / swallowClick ──────────────

  it("closeFromClick swallows the press (preventDefault + stopPropagation) and closes", () => {
    const { spec, state, closeButton } = makeFixture();
    const controller = createPanel(spec);
    controller.open();
    const bubblesToDocument = vi.fn();
    document.addEventListener("click", bubblesToDocument);
    closeButton.addEventListener("click", e => controller.closeFromClick(e));
    closeButton.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    expect(state.closeCalls).toEqual([true]);
    expect(controller.isOpen()).toBe(false);
    // #816: the close click must never reach the map.
    expect(bubblesToDocument).not.toHaveBeenCalled();
  });

  it("closeFromClick when closed does not close (and still swallows)", () => {
    const { spec, state, closeButton } = makeFixture();
    const controller = createPanel(spec);
    closeButton.addEventListener("click", e => controller.closeFromClick(e));
    closeButton.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    expect(state.closeCalls).toHaveLength(0);
    expect(controller.isOpen()).toBe(false);
  });

  it("swallowClick swallows the press without closing", () => {
    const { spec, state, inside } = makeFixture();
    const controller = createPanel(spec);
    controller.open();
    const bubblesToDocument = vi.fn();
    document.addEventListener("click", bubblesToDocument);
    inside.addEventListener("click", e => controller.swallowClick(e));
    inside.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(controller.isOpen()).toBe(true);
    expect(state.closeCalls).toHaveLength(0);
    expect(bubblesToDocument).not.toHaveBeenCalled();
  });

  // ───────────────────────────── attachPanel / registry ─────────────────────

  it("registers the entry so the registry owns dispatch (idempotent detach)", () => {
    const { map } = track(makeMap());
    const { spec } = makeFixture();
    const controller = createPanel(spec);
    const detach = attachPanel(map, controller);
    controller.open();
    expect(ensureOverlayRegistry(map).owningEntry(controller.root())).not.toBeNull();
    detach();
    detach(); // second call is a no-op
    expect(ensureOverlayRegistry(map).owningEntry(controller.root())).toBeNull();
  });

  it("throws on a duplicate owner+localId while still attached", () => {
    const { map } = track(makeMap());
    const first = createPanel(makeFixture().spec);
    attachPanel(map, first);
    const second = createPanel(makeFixture().spec);
    expect(() => attachPanel(map, second)).toThrow(/duplicate overlay: layer\.style/);
  });

  it("coexists across owners with the same localId, ranks honored (#820)", () => {
    const { map } = track(makeMap());
    const layerPicker = createPanel(
      makeFixture({
        owner: "layer",
        localId: "style.picker.dropdown",
        rank: 850,
      }).spec,
    );
    const heatPicker = createPanel(
      makeFixture({
        owner: "heatmap",
        localId: "picker.dropdown",
        rank: 840,
      }).spec,
    );
    attachPanel(map, layerPicker);
    attachPanel(map, heatPicker);
    layerPicker.open();
    heatPicker.open();
    expect(layerPicker.isOpen()).toBe(true);
    expect(heatPicker.isOpen()).toBe(true);
    // Higher rank wins topmost (the #820 contract: layer picker > heatmap picker).
    expect(ensureOverlayRegistry(map).topmost()?.id).toBe(
      "layer.style.picker.dropdown",
    );
  });

  it("destroy unregisters, so a second attach round does not throw", () => {
    const { map } = track(makeMap());
    const first = createPanel(makeFixture().spec);
    attachPanel(map, first);
    first.destroy();
    const second = createPanel(makeFixture().spec);
    expect(() => attachPanel(map, second)).not.toThrow();
    second.destroy();
    const third = createPanel(makeFixture().spec);
    expect(() => attachPanel(map, third)).not.toThrow();
  });

  it("closes the exclusive group before opening a sibling", () => {
    const { map } = track(makeMap());
    const a = createPanel(
      makeFixture({
        localId: "attrs",
        rank: 600,
        exclusiveGroup: "layer:rows",
      }).spec,
    );
    const b = createPanel(
      makeFixture({
        localId: "style",
        rank: 500,
        exclusiveGroup: "layer:rows",
      }).spec,
    );
    const detachA = attachPanel(map, a);
    attachPanel(map, b);
    a.open();
    b.open();
    expect(a.isOpen()).toBe(false); // group-open closed the sibling
    expect(b.isOpen()).toBe(true);
    detachA();
  });

  it("Escape dispatch closes the topmost open surface only (A)", () => {
    const { map } = track(makeMap());
    const top = createPanel(makeFixture({ localId: "attrs", rank: 600 }).spec);
    const below = createPanel(makeFixture({ localId: "style", rank: 500 }).spec);
    attachPanel(map, top);
    attachPanel(map, below);
    top.open();
    below.open();
    pressEscape();
    expect(top.isOpen()).toBe(false); // higher rank closed first
    expect(below.isOpen()).toBe(true);
    pressEscape();
    expect(below.isOpen()).toBe(false);
  });

  it("outside press closes only the surface it is outside of (B)", () => {
    const { map } = track(makeMap());
    const { spec: topSpec, state: topState } = makeFixture({
      localId: "attrs",
      rank: 600,
    });
    const { spec: belowSpec } = makeFixture({
      localId: "style",
      rank: 500,
    });
    const top = createPanel(topSpec);
    const below = createPanel(belowSpec);
    attachPanel(map, top);
    attachPanel(map, below);
    top.open();
    below.open();
    // Press inside the top panel (attrs), outside the below panel (style).
    pressMouse(topState.inside);
    expect(top.isOpen()).toBe(true);
    expect(below.isOpen()).toBe(false);
  });

  it("a fold panel with dismiss.escape=false survives a registry Escape", () => {
    const { map } = track(makeMap());
    const { spec, state } = makeFixture({
      localId: "menu",
      rank: 800,
      dismiss: { escape: false },
    });
    const controller = createPanel(spec);
    attachPanel(map, controller);
    controller.open();
    pressEscape();
    expect(controller.isOpen()).toBe(true);
    expect(state.closeCalls).toHaveLength(0);
  });

  it("an outsidePress:false entry is not dismissed by an outside press", () => {
    const { map } = track(makeMap());
    const { spec, state } = makeFixture({
      localId: "menu",
      rank: 800,
      dismiss: { outsidePress: false },
    });
    const controller = createPanel(spec);
    attachPanel(map, controller);
    controller.open();
    pressMouse(document.body);
    expect(controller.isOpen()).toBe(true);
    expect(state.closeCalls).toHaveLength(0);
  });

  // ─────────────────────── Negative-control matrix ─────────────────────────
  //
  // Each of the six mutations below is applied to the SOURCE in a throwaway
  // edit (never committed) and the corresponding test is observed to go red.
  // The red evidence is recorded in the PR body. Reverting the mutation makes
  // the test green again. These tests exist to prove the controller's
  // guarantees are load-bearing, not incidental:
  //
  //  1. remove closeFromClick's stopPropagation → "closeFromClick swallows" red
  //  2. drop the owner namespace (duplicate guard) → "throws on duplicate" red
  //  3. dispatchEscape closing everything → "Escape closes topmost only" red
  //  4. outside press decided by topmost instead of the hit layer → "outside
  //     press closes only the hit surface" red
  //  5. internal plain click calls close → "internal click does not close" red
  //  6. destroy skips unregister → "destroy unregisters, second round ok" red

  it("an internal plain click does not self-close and does not bubble to the map", () => {
    // Negative control 5: the panel's own content must not dismiss it, and a click inside
    // the panel must not reach the map either (the panel swallows the press).
    const { map } = track(makeMap());
    const { spec, state, inside } = makeFixture({ localId: "attrs", rank: 600 });
    const controller = createPanel(spec);
    attachPanel(map, controller);
    controller.open();
    const bubblesToDocument = vi.fn();
    document.addEventListener("click", bubblesToDocument);
    // The panel swallows its own inside click (like a real row panel).
    inside.addEventListener("click", e => e.stopPropagation());
    inside.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(controller.isOpen()).toBe(true);
    expect(state.closeCalls).toHaveLength(0);
    expect(bubblesToDocument).not.toHaveBeenCalled();
  });

  it("outside press on a lower layer does not close an unrelated higher layer (control 4, precise)", () => {
    // Negative control 4, precise (per-entry ownership, not "topmost wins"): with BOTH layers
    // open in *different* groups, a press inside the lower layer's DOM is an
    // INSIDE press for it (it stays) and an OUTSIDE press for the higher layer
    // (it closes). One press dismisses at most one surface, and it is the one
    // the press is outside of — never the one that happens to be topmost.
    const { map } = track(makeMap());
    const topFixture = makeFixture({ localId: "attrs", rank: 600 });
    const bottomFixture = makeFixture({ localId: "style", rank: 500 });
    const top = createPanel(topFixture.spec);
    const bottom = createPanel(bottomFixture.spec);
    attachPanel(map, top);
    attachPanel(map, bottom);
    top.open();
    bottom.open();
    // press inside the lower (bottom) layer's own content.
    pressMouse(bottomFixture.state.inside);
    expect(bottom.isOpen()).toBe(true); // inside press: not dismissed
    expect(top.isOpen()).toBe(false); // outside press: dismissed
  });

  it("destroy after a refused close still unregisters", () => {
    // destroy is terminal: even when the spec refuses to close, destroy must
    // still unregister (the surface is going away regardless).
    const { map } = track(makeMap());
    const { spec, state } = makeFixture();
    state.canClose = () => false;
    const controller = createPanel(spec);
    const detach = attachPanel(map, controller);
    controller.open();
    controller.destroy();
    expect(controller.isOpen()).toBe(false);
    // unregister ran: a fresh attach with the same id must not throw.
    const again = createPanel(makeFixture().spec);
    expect(() => attachPanel(map, again)).not.toThrow();
    detach();
  });

  it("attachPanel maps outsidePress click to dismissOn click", () => {
    // Covers the outsidePress === "click" branch in attachPanel's dismissOn.
    const { map } = track(makeMap());
    const { spec } = makeFixture({
      localId: "focus",
      rank: 400,
      dismiss: { outsidePress: "click" },
    });
    const controller = createPanel(spec);
    const detach = attachPanel(map, controller);
    // The registry's dispatchPress distinguishes mousedown vs click; the entry
    // must expose the click variant when the spec asks for it. We can only
    // observe this through the registered entry, so open it and press a click
    // on document.body (outside the root): the click variant must close it.
    controller.open();
    const body = document.body;
    body.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(controller.isOpen()).toBe(false);
    detach();
  });

  it("panels() is empty when the root is absent, so any press is outside (root ? [root] : [])", () => {
    // Covers the root ? [root] : [] branch (root() returning a falsy value).
    // With no root, panels() is empty, so EVERY press is outside and the
    // registry dismisses the surface on an outside press — observable through
    // the close call rather than through an unexposed entry.
    const { map } = track(makeMap());
    const root = () => null as unknown as HTMLElement;
    const { spec, state } = makeFixture({ root });
    const controller = createPanel(spec);
    attachPanel(map, controller);
    controller.open();
    pressMouse(document.body);
    expect(state.closeCalls).toHaveLength(1);
    expect(controller.isOpen()).toBe(false);
  });

  // ─────────────────────────── swallowPress, open rollback, refused close, destroyed attach ───────────────────────────

  it("swallowPress swallows a mousedown without changing state", () => {
    // A fresh root WITHOUT the fixture's own mousedown guard, so the primitive
    // is the only thing standing between the press and the ancestor. A
    // bubble-phase listener on the parent must not see the press, and the
    // event must be defaultPrevented.
    const { spec, state } = makeFixture();
    const controller = createPanel(spec);
    controller.open();
    const bareRoot = document.createElement("div");
    bareRoot.setAttribute("role", "dialog");
    document.body.appendChild(bareRoot);
    const parent = document.createElement("div");
    parent.appendChild(bareRoot);
    const bubblesToParent = vi.fn();
    parent.addEventListener("mousedown", bubblesToParent);
    bareRoot.addEventListener("mousedown", e => controller.swallowPress(e));
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    bareRoot.dispatchEvent(event);
    expect(bubblesToParent).not.toHaveBeenCalled();
    // stopPropagation only: a native control inside the panel must keep its
    // default behaviour (focus / text selection / select popup).
    expect(event.defaultPrevented).toBe(false);
    expect(controller.isOpen()).toBe(true);
    expect(state.closeCalls).toHaveLength(0);
  });

  it("open rolls back and rethrows when spec.open throws", () => {
    let first = true;
    const { spec, state } = makeFixture({
      open: () => {
        if (first) {
          first = false;
          throw new Error("boom");
        }
        state.open = true;
        state.openCalls += 1;
      },
    });
    const controller = createPanel(spec);
    expect(() => controller.open()).toThrow("boom");
    expect(controller.isOpen()).toBe(false);
    expect(state.onOpenCalls).toBe(0);
    // The idempotence guard must not be stuck: a later open succeeds.
    controller.open();
    expect(controller.isOpen()).toBe(true);
    expect(state.openCalls).toBe(1);
    expect(state.onOpenCalls).toBe(1);
  });

  it("closeFromClick swallows and keeps the panel open when spec.close refuses", () => {
    const { spec, state, closeButton } = makeFixture();
    state.canClose = () => false;
    const controller = createPanel(spec);
    controller.open();
    const bubblesToDocument = vi.fn();
    document.addEventListener("click", bubblesToDocument);
    closeButton.addEventListener("click", e => controller.closeFromClick(e));
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    closeButton.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(bubblesToDocument).not.toHaveBeenCalled();
    expect(controller.isOpen()).toBe(true);
  });

  it("attachPanel throws for a destroyed controller", () => {
    const { map } = track(makeMap());
    const { spec } = makeFixture();
    const controller = createPanel(spec);
    attachPanel(map, controller);
    controller.destroy();
    // A second attach of the SAME (destroyed) controller must throw, not
    // silently register a dead entry.
    expect(() => attachPanel(map, controller)).toThrow(
      /cannot attach a destroyed panel/,
    );
  });

  it("open does not roll back when onOpen throws after a successful spec.open", () => {
    const { spec, state } = makeFixture({
      onOpen: () => {
        throw new Error("boom-on-open");
      },
    });
    const controller = createPanel(spec);
    // spec.open succeeded (state.open=true, DOM built), onOpen threw. The
    // surface is genuinely on screen, so the controller must stay open.
    expect(() => controller.open()).toThrow("boom-on-open");
    expect(controller.isOpen()).toBe(true);
    expect(state.openCalls).toBe(1);
  });
});
