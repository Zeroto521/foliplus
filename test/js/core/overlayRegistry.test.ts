import type * as L from "leaflet";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ESC_PRIORITY,
  type EscapeHandled,
  OVERLAY_IDS,
  type OverlayEntry,
  type OverlayPhase,
  type OverlayPress,
  type OverlayRegistry,
  ensureOverlayRegistry,
  orderOf,
} from "#core/overlayRegistry.js";
import { registerPortalRoot } from "#common/portalRoot.js";

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

const panel = (className = "panel"): HTMLElement => {
  const element = document.createElement("div");
  element.className = className;
  document.body.appendChild(element);
  return element;
};

const child = (parent: Element): HTMLElement => {
  const element = document.createElement("span");
  parent.appendChild(element);
  return element;
};

interface EntryOptions {
  id: string;
  dismissOn?: OverlayPhase;
  pressPriority?: number;
  exclusiveGroup?: string;
  open?: boolean;
  closable?: () => boolean;
  panels?: () => Element[];
  dismissOnOutside?: (press: OverlayPress) => boolean;
  dismissOnInside?: (press: OverlayPress) => boolean;
  consumePress?: (target: Element, press: OverlayPress) => boolean;
  clearsCursorOnClose?: boolean;
  escPassthroughOnEditable?: boolean;
}

interface FakeEntry {
  entry: OverlayEntry;
  /** The restoreFocus argument of every close call. */
  closeCalls: boolean[];
  isOpen: () => boolean;
}

const makeEntry = (options: EntryOptions): FakeEntry => {
  const state = {
    open: options.open ?? true,
    panels: options.panels ?? ((): Element[] => []),
  };
  const closeCalls: boolean[] = [];
  const entry: OverlayEntry = {
    id: options.id,
    exclusiveGroup: options.exclusiveGroup,
    dismissOn: options.dismissOn ?? "mousedown",
    pressPriority: options.pressPriority ?? 0,
    clearsCursorOnClose: options.clearsCursorOnClose,
    escPassthroughOnEditable: options.escPassthroughOnEditable,
    dismissOnOutside: options.dismissOnOutside,
    dismissOnInside: options.dismissOnInside,
    consumePress: options.consumePress,
    panels: () => state.panels(),
    isOpen: () => state.open,
    close: opts => {
      if (options.closable && !options.closable()) return false;
      closeCalls.push(opts.restoreFocus);
      state.open = false;
    },
  };
  return { entry, closeCalls, isOpen: () => state.open };
};

const press = (target: EventTarget, type: "mousedown" | "click"): MouseEvent => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};

const escape = (target: EventTarget = document.body): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
};

describe("OverlayRegistry", () => {
  let registry: OverlayRegistry;
  /** Portal registrations a test made, released after it. */
  const portalReleases: (() => void)[] = [];
  let addSpy: ReturnType<typeof vi.spyOn>;
  let removeSpy: ReturnType<typeof vi.spyOn>;

  const installed = (type: string): number =>
    addSpy.mock.calls.filter((call: unknown[]) => call[0] === type).length;
  const removed = (type: string): number =>
    removeSpy.mock.calls.filter((call: unknown[]) => call[0] === type).length;

  beforeEach(() => {
    registry = ensureOverlayRegistry(makeMap().map);
    addSpy = vi.spyOn(document, "addEventListener");
    removeSpy = vi.spyOn(document, "removeEventListener");
  });

  afterEach(() => {
    registry.destroy();
    vi.restoreAllMocks();
    for (const release of portalReleases.splice(0)) release();
    document.body.innerHTML = "";
  });

  // ───────────────────────────── registration ─────────────────────────────

  describe("registration", () => {
    it("rejects a duplicate id with a warning and a no-op unregister", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const first = makeEntry({ id: OVERLAY_IDS.LAYER_ATTRS });
      const second = makeEntry({ id: OVERLAY_IDS.LAYER_ATTRS });

      registry.register(first.entry);
      const unregisterSecond = registry.register(second.entry);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain(
        "duplicate overlay id: layer.attrs",
      );
      expect(registry.topmost()).toBe(first.entry);

      unregisterSecond();
      expect(registry.topmost()).toBe(first.entry);
    });

    it("accepts the same id again after unregister, with one live listener per type", () => {
      const first = makeEntry({ id: OVERLAY_IDS.LAYER_ATTRS });
      const unregister = registry.register(first.entry);
      unregister();

      const second = makeEntry({ id: OVERLAY_IDS.LAYER_ATTRS });
      registry.register(second.entry);

      // Two installations, one removal: the listener count follows the live
      // entries, not the registration calls.
      expect(installed("mousedown")).toBe(2);
      expect(removed("mousedown")).toBe(1);

      const outside = panel();
      press(outside, "mousedown");
      expect(second.closeCalls).toHaveLength(1);
    });

    it("a stale unregister cannot remove a newer entry with the same id", () => {
      const first = makeEntry({ id: OVERLAY_IDS.LAYER_ATTRS });
      const unregisterFirst = registry.register(first.entry);
      unregisterFirst();
      const second = makeEntry({ id: OVERLAY_IDS.LAYER_ATTRS });
      registry.register(second.entry);

      unregisterFirst();
      expect(registry.topmost()).toBe(second.entry);
    });

    it("unsubscribing an Escape listener twice is a no-op", () => {
      const off = registry.onEscapeHandled(() => undefined);
      off();
      off();
      expect(registry.topmost()).toBeNull();
    });

    it("registering on a destroyed registry installs nothing", () => {
      registry.destroy();
      const fake = makeEntry({ id: OVERLAY_IDS.LAYER_ATTRS });
      const unregister = registry.register(fake.entry);
      expect(installed("mousedown")).toBe(0);
      expect(installed("keydown")).toBe(0);
      unregister();
    });

    it("unregister is idempotent", () => {
      const entry = makeEntry({ id: OVERLAY_IDS.LAYER_ATTRS });
      const unregister = registry.register(entry.entry);
      unregister();
      unregister();
      expect(registry.topmost()).toBeNull();
    });
  });

  // ───────────────────────── listener lifetime ─────────────────────────

  describe("listener lifetime", () => {
    it("a mousedown entry installs the capture mousedown listener and Escape only", () => {
      registry.register(makeEntry({ id: OVERLAY_IDS.LAYER_ATTRS }).entry);
      expect(installed("mousedown")).toBe(1);
      expect(installed("click")).toBe(0);
      expect(installed("keydown")).toBe(1);
    });

    it("a click entry installs the bubble click listener and Escape only", () => {
      registry.register(
        makeEntry({ id: OVERLAY_IDS.LAYER_MENU, dismissOn: "click" }).entry,
      );
      expect(installed("click")).toBe(1);
      expect(installed("mousedown")).toBe(0);
      expect(installed("keydown")).toBe(1);
    });

    it("removes each listener type independently when its last entry goes away", () => {
      const mouse = makeEntry({ id: OVERLAY_IDS.LAYER_ATTRS });
      const click = makeEntry({ id: OVERLAY_IDS.LAYER_MENU, dismissOn: "click" });
      const unregisterMouse = registry.register(mouse.entry);
      registry.register(click.entry);

      unregisterMouse();
      expect(removed("mousedown")).toBe(1);
      expect(removed("click")).toBe(0);
      expect(removed("keydown")).toBe(0);
    });

    it("removes the click listener independently of the other phases", () => {
      const mouse = makeEntry({ id: OVERLAY_IDS.LAYER_ATTRS });
      const click = makeEntry({ id: OVERLAY_IDS.LAYER_MENU, dismissOn: "click" });
      registry.register(mouse.entry);
      const unregisterClick = registry.register(click.entry);

      unregisterClick();
      expect(removed("click")).toBe(1);
      expect(removed("mousedown")).toBe(0);
      // The Escape listener is driven by live entry count, not by phase.
      expect(removed("keydown")).toBe(0);
    });

    it("removes the capture flag with the listener", () => {
      registry.register(makeEntry({ id: OVERLAY_IDS.LAYER_ATTRS }).entry);
      registry.destroy();
      const add = addSpy.mock.calls.find((call: unknown[]) => call[0] === "mousedown");
      const remove = removeSpy.mock.calls.find(
        (call: unknown[]) => call[0] === "mousedown",
      );
      expect(add?.[2]).toBe(true);
      expect(remove?.[2]).toBe(true);
    });

    it("destroy removes every installed listener and is idempotent", () => {
      registry.register(makeEntry({ id: OVERLAY_IDS.LAYER_ATTRS }).entry);
      registry.register(
        makeEntry({ id: OVERLAY_IDS.LAYER_MENU, dismissOn: "click" }).entry,
      );
      registry.destroy();
      registry.destroy();
      expect(removed("mousedown")).toBe(1);
      expect(removed("click")).toBe(1);
      expect(removed("keydown")).toBe(1);
      // No listener survives: a press has no effect.
      const outside = panel();
      press(outside, "mousedown");
      expect(registry.topmost()).toBeNull();
    });

    it("destroy on a registry that never installed anything is a no-op", () => {
      registry.destroy();
      expect(removed("mousedown")).toBe(0);
      expect(removed("click")).toBe(0);
      expect(removed("keydown")).toBe(0);
    });

    it("shares one registry per map and tears it down on map unload", () => {
      const { map, fireUnload } = makeMap();
      const shared = ensureOverlayRegistry(map);
      expect(ensureOverlayRegistry(map)).toBe(shared);
      shared.register(makeEntry({ id: OVERLAY_IDS.LAYER_ATTRS }).entry);
      expect(shared.topmost()).not.toBeNull();
      fireUnload();
      expect(shared.topmost()).toBeNull();

      // A destroyed registry is not handed out again: a component that
      // registers after a map unload gets a working dispatcher, not a dead one.
      const revived = ensureOverlayRegistry(map);
      expect(revived).not.toBe(shared);
      revived.register(makeEntry({ id: OVERLAY_IDS.LAYER_ATTRS }).entry);
      press(panel(), "mousedown");
      expect(revived.lastPressInside()).toBe(false);
    });
  });

  // ─────────────────────────── containment ───────────────────────────

  describe("containment", () => {
    it("resolves no owner for a missing or non-Node target", () => {
      registry.register(
        makeEntry({ id: OVERLAY_IDS.LAYER_ATTRS, panels: () => [panel()] }).entry,
      );
      expect(registry.owningEntry(null)).toBeNull();
      expect(registry.owningEntry(window)).toBeNull();
    });

    it("accepts the panel, its descendants and its portals; rejects outsiders", () => {
      const own = panel("own");
      const inner = child(own);
      const portal = panel("portal");
      const portalRow = child(portal);
      const outside = panel("outside");
      const entry = makeEntry({
        id: OVERLAY_IDS.LAYER_STYLE,
        panels: () => [own],
      }).entry;
      // The portalled list is attributed through the trigger it was mounted
      // for; the trigger lives in the panel that owns the overlay.
      portalReleases.push(registerPortalRoot(portal, child(own)));

      expect(registry.contains(entry, own)).toBe(true);
      expect(registry.contains(entry, inner)).toBe(true);
      expect(registry.contains(entry, portalRow)).toBe(true);
      expect(registry.contains(entry, outside)).toBe(false);
      expect(registry.contains(entry, document)).toBe(false);
      expect(registry.contains(entry, null)).toBe(false);
    });

    it("reads the live panels: a rebuilt panel still counts as inside", () => {
      const firstPanel = panel("first");
      let current = firstPanel;
      const entry = makeEntry({
        id: OVERLAY_IDS.LAYER_ATTRS,
        panels: () => [current],
      }).entry;
      registry.register(entry);

      press(child(current), "mousedown");
      expect(entry.isOpen()).toBe(true);

      const rebuilt = panel("rebuilt");
      current = rebuilt;
      press(child(rebuilt), "mousedown");
      expect(entry.isOpen()).toBe(true);
      press(firstPanel, "mousedown");
      expect(entry.isOpen()).toBe(false);
    });
  });

  // ───────────────────────────── presses ─────────────────────────────

  describe("press dispatch", () => {
    it("closes on an outside mousedown without cancelling the event", () => {
      const own = panel();
      const outside = panel();
      const fake = makeEntry({
        id: OVERLAY_IDS.LAYER_ATTRS,
        panels: () => [own],
      });
      registry.register(fake.entry);

      const event = press(outside, "mousedown");

      expect(fake.closeCalls).toEqual([false]);
      expect(event.defaultPrevented).toBe(false);
      expect(registry.lastPressInside()).toBe(false);
    });

    it("keeps the surface on an inside mousedown and never evaluates inside dismiss", () => {
      const own = panel();
      const inner = child(own);
      const dismissOnInside = vi.fn(() => true);
      const fake = makeEntry({
        id: OVERLAY_IDS.LAYER_ATTRS,
        panels: () => [own],
        dismissOnInside,
      });
      registry.register(fake.entry);

      press(inner, "mousedown");

      expect(fake.closeCalls).toEqual([]);
      expect(dismissOnInside).not.toHaveBeenCalled();
      expect(registry.lastPressInside()).toBe(true);
    });

    it("overwrites lastPressInside on every press", () => {
      const own = panel();
      const outside = panel();
      registry.register(
        makeEntry({
          id: OVERLAY_IDS.LAYER_ATTRS,
          panels: () => [own],
        }).entry,
      );

      press(child(own), "mousedown");
      expect(registry.lastPressInside()).toBe(true);
      press(outside, "mousedown");
      expect(registry.lastPressInside()).toBe(false);
    });

    it("walks presses by pressPriority, not by the Escape rank table", () => {
      const outside = panel();
      // The ranks are deliberately inverted: the style id ranks lower for
      // Escape (500 vs 600) but owns the press through a higher pressPriority.
      const lowerRankHigherPress = makeEntry({
        id: OVERLAY_IDS.LAYER_STYLE,
        pressPriority: 900,
        panels: () => [panel("style")],
      });
      const higherRankLowerPress = makeEntry({
        id: OVERLAY_IDS.LAYER_ATTRS,
        pressPriority: 100,
        panels: () => [panel("attrs")],
      });
      registry.register(lowerRankHigherPress.entry);
      registry.register(higherRankLowerPress.entry);

      press(outside, "mousedown");
      expect(lowerRankHigherPress.closeCalls).toHaveLength(1);
      expect(higherRankLowerPress.closeCalls).toHaveLength(0);
    });

    it("keeps each press phase to the entries that declare it", () => {
      const outside = panel();
      const panelEntry = makeEntry({
        id: OVERLAY_IDS.LAYER_STYLE,
        dismissOn: "mousedown",
        pressPriority: 900,
        panels: () => [panel("style")],
      });
      const dropdown = makeEntry({
        id: OVERLAY_IDS.PICKER_DROPDOWN,
        dismissOn: "click",
        pressPriority: 100,
        panels: () => [panel("picker")],
      });
      registry.register(panelEntry.entry);
      registry.register(dropdown.entry);

      // A mousedown outside closes the capture-phase surface only; the
      // click-phase dropdown must not be closed by the wrong dispatcher.
      press(outside, "mousedown");
      expect(panelEntry.closeCalls).toHaveLength(1);
      expect(dropdown.closeCalls).toHaveLength(0);

      // The following outside click owns the dropdown.
      press(panel("outside-again"), "click");
      expect(dropdown.closeCalls).toHaveLength(1);
    });

    it("consumes before closing: a nested consumer keeps its host open", () => {
      const outside = panel();
      const host = makeEntry({
        id: OVERLAY_IDS.LAYER_FILTER,
        pressPriority: 700,
        panels: () => [panel("host")],
      });
      const nested = makeEntry({
        id: OVERLAY_IDS.LAYER_FILTER_ENUM,
        pressPriority: 750,
        panels: () => [panel("nested")],
        consumePress: () => true,
      });
      registry.register(host.entry);
      registry.register(nested.entry);

      const seen: string[] = [];
      const spy = { consume: false };
      nested.entry.consumePress = (target, currentPress) => {
        seen.push(currentPress.phase);
        expect(target).toBe(outside);
        expect(currentPress.consumed).toBe(false);
        spy.consume = true;
        return true;
      };

      press(outside, "mousedown");
      expect(spy.consume).toBe(true);
      expect(seen).toEqual(["mousedown"]);
      expect(nested.closeCalls).toHaveLength(0);
      expect(host.closeCalls).toHaveLength(0);
    });

    it("skips an entry another predicate closed during the walk", () => {
      const outside = panel();
      const low = makeEntry({
        id: OVERLAY_IDS.LAYER_STYLE,
        pressPriority: 500,
        panels: () => [panel("low")],
      });
      const high = makeEntry({
        id: OVERLAY_IDS.LAYER_ATTRS,
        pressPriority: 600,
        panels: () => [panel("high")],
        dismissOnOutside: () => {
          // A surface whose own dismissal predicate tears the lower one down
          // first; the walk must notice it is no longer open.
          low.entry.close({ restoreFocus: false });
          return false;
        },
      });
      registry.register(low.entry);
      registry.register(high.entry);

      press(outside, "mousedown");
      expect(low.closeCalls).toHaveLength(1);
      expect(high.closeCalls).toHaveLength(0);
    });

    it("falls through to the next entry when the owner cannot close", () => {
      const outside = panel();
      const high = makeEntry({
        id: OVERLAY_IDS.LAYER_ATTRS,
        pressPriority: 600,
        panels: () => [panel("high")],
        closable: () => false,
      });
      const low = makeEntry({
        id: OVERLAY_IDS.LAYER_STYLE,
        pressPriority: 500,
        panels: () => [panel("low")],
      });
      registry.register(high.entry);
      registry.register(low.entry);

      press(outside, "mousedown");
      expect(high.closeCalls).toHaveLength(0);
      expect(low.closeCalls).toHaveLength(1);
    });

    it("dismisses on an outside click and honours a click-phase predicate", () => {
      const own = panel();
      const defaultOutside = makeEntry({
        id: OVERLAY_IDS.LAYER_MENU,
        dismissOn: "click",
        panels: () => [own],
      });
      // Lower rank than the menu, so the first press reaches the menu and the
      // second one reaches this entry.
      const explicitOutside = makeEntry({
        id: OVERLAY_IDS.LAYER_FILTER,
        dismissOn: "click",
        panels: () => [own],
        dismissOnOutside: () => true,
      });
      registry.register(defaultOutside.entry);
      registry.register(explicitOutside.entry);

      // Higher priority handles first; with it closed, the next press reaches
      // the explicit-predicate entry.
      press(panel("outside"), "click");
      expect(defaultOutside.closeCalls).toHaveLength(1);
      expect(explicitOutside.closeCalls).toHaveLength(0);

      press(panel("outside"), "click");
      expect(explicitOutside.closeCalls).toHaveLength(1);
    });

    it("ignores a non-Node target", () => {
      const fake = makeEntry({ id: OVERLAY_IDS.LAYER_ATTRS });
      registry.register(fake.entry);
      window.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      expect(fake.closeCalls).toHaveLength(0);
    });

    it("passes the parent element to consumePress for a text-node target", () => {
      const host = panel();
      const text = document.createTextNode("row");
      host.appendChild(text);
      const seen: Element[] = [];
      const fake = makeEntry({
        id: OVERLAY_IDS.LAYER_MENU,
        dismissOn: "click",
        panels: () => [host],
        dismissOnInside: () => true,
        consumePress: target => {
          seen.push(target);
          return true;
        },
      });
      registry.register(fake.entry);

      // The click/to-inside path is where consumePress runs; the target is a
      // text node, so the handler must receive its parent element.
      press(text, "click");
      expect(seen).toEqual([host]);
      expect(fake.closeCalls).toHaveLength(0);
    });

    it("skips a registered but closed (detached) entry", () => {
      const own = panel();
      const fake = makeEntry({
        id: OVERLAY_IDS.LAYER_ATTRS,
        panels: () => [own],
        open: false,
      });
      registry.register(fake.entry);
      press(child(own), "mousedown");
      escape(child(own));
      expect(fake.closeCalls).toHaveLength(0);
      expect(registry.topmost()).toBeNull();
    });

    it("keeps an inside capture press native (no cancel, no dismiss)", () => {
      const own = panel();
      const fake = makeEntry({
        id: OVERLAY_IDS.LAYER_ATTRS,
        panels: () => [own],
      });
      registry.register(fake.entry);
      const event = press(child(own), "mousedown");
      expect(fake.closeCalls).toHaveLength(0);
      expect(event.defaultPrevented).toBe(false);
    });

    it("treats a portal node as inside the surface", () => {
      const portal = panel("portal");
      const host = panel("host");
      const fake = makeEntry({
        id: OVERLAY_IDS.LAYER_STYLE,
        panels: () => [host],
      });
      registry.register(fake.entry);
      portalReleases.push(registerPortalRoot(portal, child(host)));
      press(child(portal), "mousedown");
      expect(fake.closeCalls).toHaveLength(0);
      expect(registry.lastPressInside()).toBe(true);
    });

    it("runs an inside click dismissal after the target's own click handler", () => {
      const row = panel("row");
      const action = vi.fn();
      row.addEventListener("click", () => action());
      const order: string[] = [];
      action.mockImplementation(() => order.push("action"));
      const fake = makeEntry({
        id: OVERLAY_IDS.LAYER_MENU,
        dismissOn: "click",
        panels: () => [row],
        dismissOnInside: () => true,
      });
      const originalClose = fake.entry.close;
      fake.entry.close = opts => {
        order.push("close");
        return originalClose(opts);
      };
      registry.register(fake.entry);

      press(row, "click");

      expect(order).toEqual(["action", "close"]);
      expect(fake.closeCalls).toEqual([false]);
    });

    it("does not dismiss an inside click without dismissOnInside", () => {
      const row = panel("row");
      const fake = makeEntry({
        id: OVERLAY_IDS.LAYER_MENU,
        dismissOn: "click",
        panels: () => [row],
      });
      registry.register(fake.entry);
      press(row, "click");
      expect(fake.closeCalls).toHaveLength(0);
    });
  });

  // ───────────────────────────── escape ─────────────────────────────

  describe("escape table", () => {
    it("exposes one constant per table id and a rank per constant", () => {
      expect(Object.values(OVERLAY_IDS).sort()).toEqual(
        Object.keys(ESC_PRIORITY).sort(),
      );
      for (const id of Object.values(OVERLAY_IDS)) {
        expect(typeof ESC_PRIORITY[id]).toBe("number");
      }
    });

    it("orders known ids by descending rank and unknown ids last", () => {
      expect(orderOf(OVERLAY_IDS.LAYER_RENAME)).toBe(900);
      expect(orderOf(OVERLAY_IDS.LAYER_MENU)).toBe(800);
      expect(orderOf(OVERLAY_IDS.LAYER_STYLE)).toBe(500);
      expect(orderOf("layer.cursor")).toBe(Number.NEGATIVE_INFINITY);
      expect(orderOf("unknown.surface")).toBe(Number.NEGATIVE_INFINITY);
      const ranks = Object.values(OVERLAY_IDS).map(orderOf);
      expect(new Set(ranks).size).toBe(ranks.length);
      expect([...ranks].sort((a, b) => b - a)).toEqual(ranks);
    });
  });

  describe("escape dispatch", () => {
    it("closes the topmost open surface when no surface contains the target", () => {
      // Escape is a layer-stack key: focus may sit on <body> (a menu opened by
      // a pointer, a programmatic panel), so containment alone cannot decide.
      const attrs = makeEntry({
        id: OVERLAY_IDS.LAYER_ATTRS,
        panels: () => [panel()],
      });
      registry.register(attrs.entry);
      const seen: EscapeHandled[] = [];
      registry.onEscapeHandled(payload => seen.push(payload));
      const event = escape(document.body);

      expect(attrs.closeCalls).toEqual([true]);
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({
        handled: true,
        entryId: OVERLAY_IDS.LAYER_ATTRS,
        target: document.body,
        origin: "capture",
      });
      expect(event.defaultPrevented).toBe(true);
    });

    it("closes the owning entry once with restoreFocus and cancels the event", () => {
      const own = panel();
      const inner = child(own);
      const fake = makeEntry({
        id: OVERLAY_IDS.LAYER_MENU,
        panels: () => [own],
      });
      registry.register(fake.entry);
      const seen: { handled: boolean; entryId: string | null }[] = [];
      registry.onEscapeHandled(payload => seen.push(payload));

      const event = escape(inner);

      expect(fake.closeCalls).toEqual([true]);
      expect(event.defaultPrevented).toBe(true);
      expect(seen).toEqual([
        {
          handled: true,
          entryId: OVERLAY_IDS.LAYER_MENU,
          target: inner,
          origin: "capture",
        },
      ]);
    });

    it("closes an open picker before the menu that opened it", () => {
      const menuPanel = panel("menu");
      const menu = makeEntry({
        id: OVERLAY_IDS.LAYER_MENU,
        panels: () => [menuPanel],
        dismissOn: "click",
      });
      // The picker popup is portalled, so its entry owns no panel: Escape is
      // ordered by ESC_PRIORITY, not by which surface contains the focus.
      const picker = makeEntry({
        id: OVERLAY_IDS.PICKER_DROPDOWN,
        panels: () => [],
        dismissOn: "click",
      });
      registry.register(menu.entry);
      registry.register(picker.entry);

      // Focus still on the menu (the action that opened the picker leaves it
      // there): the popup ranks above the menu, so it must close alone first.
      escape(child(menuPanel));
      expect(picker.closeCalls).toHaveLength(1);
      expect(menu.closeCalls).toHaveLength(0);

      escape(child(menuPanel));
      expect(menu.closeCalls).toHaveLength(1);
    });

    it("closes the highest-ranked open surface even when focus sits lower (style + picker)", () => {
      const stylePanel = panel("style");
      const pickerPortal = panel("picker-portal");
      const style = makeEntry({
        id: OVERLAY_IDS.LAYER_STYLE,
        panels: () => [stylePanel],
      });
      const picker = makeEntry({
        id: OVERLAY_IDS.PICKER_DROPDOWN,
        panels: () => [],
      });
      registry.register(style.entry);
      registry.register(picker.entry);
      // The picker's list belongs to the style panel's trigger here.
      portalReleases.push(registerPortalRoot(pickerPortal, child(stylePanel)));

      // Focus inside the style panel but the picker popup is the top layer:
      // Escape must close only the picker, never tear the drawer down too.
      escape(child(stylePanel));
      expect(picker.closeCalls).toHaveLength(1);
      expect(style.closeCalls).toHaveLength(0);
    });

    it("closes the higher-ranked entry when both contain the target (picker portal)", () => {
      const stylePanel = panel("style");
      // The picker's trigger lives inside the picker's own nested surface, so
      // both entries contain the portalled row and the ranking decides.
      const pickerPanel = child(stylePanel);
      const pickerPortal = panel("picker-portal");
      const style = makeEntry({
        id: OVERLAY_IDS.LAYER_STYLE,
        panels: () => [stylePanel],
      });
      const picker = makeEntry({
        id: OVERLAY_IDS.PICKER_DROPDOWN,
        panels: () => [pickerPanel],
      });
      registry.register(style.entry);
      registry.register(picker.entry);
      portalReleases.push(registerPortalRoot(pickerPortal, pickerPanel));

      escape(child(pickerPortal));
      expect(picker.closeCalls).toHaveLength(1);
      expect(style.closeCalls).toHaveLength(0);
    });

    it("closes the menu above a lower panel, one layer per Escape", () => {
      const menuPanel = panel("menu");
      const stylePanel = panel("style");
      const menu = makeEntry({
        id: OVERLAY_IDS.LAYER_MENU,
        dismissOn: "click",
        panels: () => [menuPanel],
      });
      const style = makeEntry({
        id: OVERLAY_IDS.LAYER_STYLE,
        panels: () => [stylePanel],
      });
      registry.register(menu.entry);
      registry.register(style.entry);

      escape(child(stylePanel));
      expect(menu.closeCalls).toHaveLength(1);
      expect(style.closeCalls).toHaveLength(0);
    });

    it("closes exactly one layer per Escape when only one is open", () => {
      const own = panel("only");
      const entry = makeEntry({
        id: OVERLAY_IDS.LAYER_ATTRS,
        panels: () => [own],
      });
      registry.register(entry.entry);

      escape(child(own));
      expect(entry.closeCalls).toEqual([true]);

      // A second Escape has nothing left to close: it reports unhandled and
      // must not call close again.
      escape(child(own));
      expect(entry.closeCalls).toEqual([true]);
    });

    it("walks a three-layer stack by ESC_PRIORITY, one layer per press", () => {
      const attrsPanel = panel("attrs");
      const menuPanel = panel("menu");
      const attrs = makeEntry({
        id: OVERLAY_IDS.LAYER_ATTRS,
        panels: () => [attrsPanel],
      });
      const menu = makeEntry({
        id: OVERLAY_IDS.LAYER_MENU,
        panels: () => [menuPanel],
        dismissOn: "click",
      });
      const picker = makeEntry({
        id: OVERLAY_IDS.PICKER_DROPDOWN,
        panels: () => [],
        dismissOn: "click",
      });
      // Register in reverse priority order: the rank table, not insertion
      // order, decides the stack.
      registry.register(attrs.entry);
      registry.register(menu.entry);
      registry.register(picker.entry);

      // Focus stays in the lowest layer for every press.
      escape(child(attrsPanel));
      expect(picker.closeCalls).toEqual([true]);
      expect(menu.closeCalls).toEqual([]);
      expect(attrs.closeCalls).toEqual([]);

      escape(child(attrsPanel));
      expect(picker.closeCalls).toEqual([true]);
      expect(menu.closeCalls).toEqual([true]);
      expect(attrs.closeCalls).toEqual([]);

      escape(child(attrsPanel));
      expect(picker.closeCalls).toEqual([true]);
      expect(menu.closeCalls).toEqual([true]);
      expect(attrs.closeCalls).toEqual([true]);

      // Empty stack: no fourth close.
      escape(child(attrsPanel));
      expect(picker.closeCalls).toEqual([true]);
      expect(menu.closeCalls).toEqual([true]);
      expect(attrs.closeCalls).toEqual([true]);
    });

    it("does not handle Escape when the owner cannot close", () => {
      const own = panel();
      const fake = makeEntry({
        id: OVERLAY_IDS.LAYER_FOCUS,
        panels: () => [own],
        closable: () => false,
      });
      registry.register(fake.entry);
      const seen: { handled: boolean; entryId: string | null }[] = [];
      registry.onEscapeHandled(payload => seen.push(payload));

      const event = escape(child(own));

      expect(fake.closeCalls).toHaveLength(0);
      expect(fake.isOpen()).toBe(true);
      expect(event.defaultPrevented).toBe(false);
      expect(seen).toEqual([
        {
          handled: false,
          entryId: OVERLAY_IDS.LAYER_FOCUS,
          target: expect.anything(),
          origin: "capture",
        },
      ]);
    });

    it("ignores an Escape another handler already prevented", () => {
      const own = panel();
      const earlier = (event: KeyboardEvent): void => event.preventDefault();
      document.addEventListener("keydown", earlier, true);
      const fake = makeEntry({
        id: OVERLAY_IDS.LAYER_ATTRS,
        panels: () => [own],
      });
      registry.register(fake.entry);
      const seen: unknown[] = [];
      registry.onEscapeHandled(payload => seen.push(payload));

      escape(child(own));

      document.removeEventListener("keydown", earlier, true);
      expect(fake.closeCalls).toHaveLength(0);
      expect(seen).toHaveLength(0);
    });

    it("passes Escape through to an editor and notifies the cursor owner exactly once", () => {
      const own = panel();
      const input = document.createElement("input");
      own.appendChild(input);
      const rename = makeEntry({
        id: OVERLAY_IDS.LAYER_RENAME,
        panels: () => [own],
        escPassthroughOnEditable: true,
        clearsCursorOnClose: true,
      });
      const attrs = makeEntry({
        id: OVERLAY_IDS.LAYER_ATTRS,
        panels: () => [panel("attrs")],
        clearsCursorOnClose: true,
      });
      registry.register(rename.entry);
      registry.register(attrs.entry);
      const seen: { handled: boolean; entryId: string | null }[] = [];
      registry.onEscapeHandled(payload => seen.push(payload));

      const event = escape(input);

      expect(rename.closeCalls).toHaveLength(0);
      expect(attrs.closeCalls).toHaveLength(0);
      expect(event.defaultPrevented).toBe(false);
      expect(seen).toEqual([
        {
          handled: true,
          entryId: OVERLAY_IDS.LAYER_RENAME,
          target: input,
          origin: "capture",
          clearsCursorOnClose: true,
        },
      ]);
    });

    it("drives the three cursor rules from the payload", () => {
      const container = panel("layer-control");
      const cursor = { cleared: 0 };
      // A real cursor owner keeps its own entries and hears the close through
      // the payload (the closed entry is no longer open, so a live lookup by
      // containment would miss it).
      const byId = new Map<string, FakeEntry>();
      registry.onEscapeHandled(payload => {
        if (payload.handled) {
          const closed = payload.entryId ? byId.get(payload.entryId) : undefined;
          if (closed?.entry.clearsCursorOnClose) cursor.cleared += 1;
          return;
        }
        if (payload.target && container.contains(payload.target)) cursor.cleared += 1;
      });

      // Rule 1: a handled close of a surface that owns the cursor clears it.
      const rowPanel = panel("attrs");
      rowPanel.dataset.owner = "cursor";
      const attrs = makeEntry({
        id: OVERLAY_IDS.LAYER_ATTRS,
        panels: () => [rowPanel],
        clearsCursorOnClose: true,
      });
      registry.register(attrs.entry);
      byId.set(OVERLAY_IDS.LAYER_ATTRS, attrs);
      escape(child(rowPanel));
      expect(cursor.cleared).toBe(1);

      // Rule 2: nothing owned the key, but the press was inside the container.
      const inside = child(container);
      escape(inside);
      expect(cursor.cleared).toBe(2);

      // Rule 3: nothing owned it and the press was elsewhere — untouched.
      escape(panel("elsewhere"));
      expect(cursor.cleared).toBe(2);
    });

    it("notifies subscribers in registration order and survives a throwing one", () => {
      registry.register(
        makeEntry({ id: OVERLAY_IDS.LAYER_ATTRS, panels: () => [panel()] }).entry,
      );
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const order: string[] = [];
      registry.onEscapeHandled(() => {
        order.push("first");
        throw new Error("boom");
      });
      registry.onEscapeHandled(() => order.push("second"));

      escape(document.body);

      expect(order).toEqual(["first", "second"]);
      expect(error).toHaveBeenCalled();
    });

    it("ignores keys other than Escape", () => {
      const own = panel();
      const fake = makeEntry({
        id: OVERLAY_IDS.LAYER_ATTRS,
        panels: () => [own],
      });
      registry.register(fake.entry);
      const seen: unknown[] = [];
      registry.onEscapeHandled(payload => seen.push(payload));

      const event = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      child(own).dispatchEvent(event);

      expect(fake.closeCalls).toHaveLength(0);
      expect(seen).toHaveLength(0);
      expect(event.defaultPrevented).toBe(false);
    });

    it("treats a contentEditable host as an editor for the passthrough", () => {
      const own = panel();
      const editor = document.createElement("div");
      own.appendChild(editor);
      // jsdom does not implement isContentEditable; pin the property the
      // dispatcher reads so the contentEditable branch is exercised.
      Object.defineProperty(editor, "isContentEditable", {
        value: true,
        configurable: true,
      });
      const passthrough = makeEntry({
        id: OVERLAY_IDS.LAYER_RENAME,
        panels: () => [own],
        escPassthroughOnEditable: true,
      });
      registry.register(passthrough.entry);
      const seen: { handled: boolean; entryId: string | null }[] = [];
      registry.onEscapeHandled(payload => {
        if (payload.entryId) {
          seen.push({ handled: payload.handled, entryId: payload.entryId });
        }
      });

      escape(editor);
      expect(passthrough.closeCalls).toHaveLength(0);
      expect(seen).toEqual([{ handled: true, entryId: OVERLAY_IDS.LAYER_RENAME }]);

      // A plain element is not an editor: the passthrough does not swallow a
      // close of the same surface.
      seen.length = 0;
      escape(child(own));
      expect(passthrough.closeCalls).toHaveLength(1);
      expect(seen).toEqual([{ handled: true, entryId: OVERLAY_IDS.LAYER_RENAME }]);
    });

    it("stops notifying an unsubscribed callback", () => {
      const seen: unknown[] = [];
      const off = registry.onEscapeHandled(payload => seen.push(payload));
      off();
      escape(document.body);
      expect(seen).toHaveLength(0);
    });
  });

  // ─────────────────────── open / topmost / exclusivity ───────────────────────

  describe("open and topmost", () => {
    it("open leaves an already-closed sibling alone", () => {
      const closed = makeEntry({
        id: OVERLAY_IDS.LAYER_ATTRS,
        exclusiveGroup: "layer-control",
        open: false,
      });
      const opening = makeEntry({
        id: OVERLAY_IDS.LAYER_STYLE,
        exclusiveGroup: "layer-control",
      });
      registry.register(closed.entry);
      registry.register(opening.entry);
      registry.open(opening.entry);
      expect(closed.closeCalls).toHaveLength(0);
      expect(opening.isOpen()).toBe(true);
    });

    it("open leaves a non-closable sibling open", () => {
      const stubborn = makeEntry({
        id: OVERLAY_IDS.LAYER_ATTRS,
        exclusiveGroup: "layer-control",
        closable: () => false,
      });
      const opening = makeEntry({
        id: OVERLAY_IDS.LAYER_STYLE,
        exclusiveGroup: "layer-control",
      });
      registry.register(stubborn.entry);
      registry.register(opening.entry);
      registry.open(opening.entry);
      expect(stubborn.isOpen()).toBe(true);
      expect(stubborn.closeCalls).toHaveLength(0);
      expect(opening.isOpen()).toBe(true);
    });

    it("open without an exclusive group leaves every entry alone", () => {
      const plain = makeEntry({ id: OVERLAY_IDS.LAYER_STYLE });
      const menu = makeEntry({ id: OVERLAY_IDS.LAYER_MENU });
      registry.register(plain.entry);
      registry.register(menu.entry);
      registry.open(plain.entry);
      expect(plain.isOpen()).toBe(true);
      expect(menu.isOpen()).toBe(true);
      expect(plain.closeCalls).toHaveLength(0);
    });

    it("open closes the other entries of the exclusive group", () => {
      const first = makeEntry({
        id: OVERLAY_IDS.LAYER_ATTRS,
        exclusiveGroup: "layer-control",
      });
      const second = makeEntry({
        id: OVERLAY_IDS.LAYER_STYLE,
        exclusiveGroup: "layer-control",
      });
      const other = makeEntry({
        id: OVERLAY_IDS.PICKER_DROPDOWN,
        exclusiveGroup: "picker",
      });
      registry.register(first.entry);
      registry.register(second.entry);
      registry.register(other.entry);

      registry.open(second.entry);

      expect(first.isOpen()).toBe(false);
      expect(second.isOpen()).toBe(true);
      expect(other.isOpen()).toBe(true);
      expect(first.closeCalls).toEqual([false]);
    });

    it("topmost is the highest-ranked open entry, or null", () => {
      expect(registry.topmost()).toBeNull();
      const style = makeEntry({ id: OVERLAY_IDS.LAYER_STYLE });
      const menu = makeEntry({ id: OVERLAY_IDS.LAYER_MENU });
      registry.register(style.entry);
      registry.register(menu.entry);
      expect(registry.topmost()).toBe(menu.entry);
      escape(child(panel("x")));
      expect(menu.closeCalls).toHaveLength(1);
      expect(registry.topmost()).toBe(style.entry);
    });
  });
});
