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
  portals?: () => Element[];
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
    portals: options.portals,
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
    it("accepts the panel, its descendants and its portals; rejects outsiders", () => {
      const own = panel("own");
      const inner = child(own);
      const portal = panel("portal");
      const portalRow = child(portal);
      const outside = panel("outside");
      const entry = makeEntry({
        id: OVERLAY_IDS.LAYER_STYLE,
        panels: () => [own],
        portals: () => [portal],
      }).entry;

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

    it("lets the higher pressPriority entry handle a press, and only it", () => {
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
      });
      registry.register(low.entry);
      registry.register(high.entry);

      press(outside, "mousedown");
      expect(high.closeCalls).toHaveLength(1);
      expect(low.closeCalls).toHaveLength(0);
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

    it("ignores a non-Node target", () => {
      const fake = makeEntry({ id: OVERLAY_IDS.LAYER_ATTRS });
      registry.register(fake.entry);
      window.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
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
      const fake = makeEntry({
        id: OVERLAY_IDS.LAYER_STYLE,
        panels: () => [panel("host")],
        portals: () => [portal],
      });
      registry.register(fake.entry);
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
    it("leaves Escape alone and reports handled: false when no surface owns the target", () => {
      // One open entry installs the dispatcher; the target (body) is outside
      // every surface, so nothing owns the key.
      registry.register(
        makeEntry({ id: OVERLAY_IDS.LAYER_ATTRS, panels: () => [panel()] }).entry,
      );
      const seen: EscapeHandled[] = [];
      registry.onEscapeHandled(payload => seen.push(payload));
      const event = escape(document.body);

      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({
        handled: false,
        entryId: null,
        target: document.body,
        origin: "capture",
      });
      expect(event.defaultPrevented).toBe(false);
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

    it("closes the owning surface, not the highest-ranked open one (style + picker)", () => {
      const stylePanel = panel("style");
      const pickerPortal = panel("picker-portal");
      const style = makeEntry({
        id: OVERLAY_IDS.LAYER_STYLE,
        panels: () => [stylePanel],
        portals: () => [pickerPortal],
      });
      const picker = makeEntry({
        id: OVERLAY_IDS.PICKER_DROPDOWN,
        panels: () => [],
        portals: () => [pickerPortal],
      });
      registry.register(style.entry);
      registry.register(picker.entry);

      // A press inside the style panel is owned by style, even though the
      // picker ranks higher and is not contained by it.
      escape(child(stylePanel));
      expect(style.closeCalls).toHaveLength(1);
      expect(picker.closeCalls).toHaveLength(0);
    });

    it("lets the higher-ranked entry own a target both contain (picker portal)", () => {
      const stylePanel = panel("style");
      const pickerPortal = panel("picker-portal");
      const style = makeEntry({
        id: OVERLAY_IDS.LAYER_STYLE,
        panels: () => [stylePanel],
        portals: () => [pickerPortal],
      });
      const picker = makeEntry({
        id: OVERLAY_IDS.PICKER_DROPDOWN,
        panels: () => [],
        portals: () => [pickerPortal],
      });
      registry.register(style.entry);
      registry.register(picker.entry);

      escape(child(pickerPortal));
      expect(picker.closeCalls).toHaveLength(1);
      expect(style.closeCalls).toHaveLength(0);
    });

    it("closes a nested panel when the menu above it does not own the target", () => {
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
      expect(style.closeCalls).toHaveLength(1);
      expect(menu.closeCalls).toHaveLength(0);
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
      expect(registry.topmost()).toBe(menu.entry);
    });
  });
});
