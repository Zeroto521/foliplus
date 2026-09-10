import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ListCursor } from "#core/listCursor.js";

const makeList = (n = 3) => {
  const root = document.createElement("div");
  root.id = "list";
  for (let i = 0; i < n; i++) {
    const item = document.createElement("div");
    item.className = "opt";
    item.textContent = `item-${i}`;
    root.appendChild(item);
  }
  document.body.appendChild(root);
  return root;
};

describe("ListCursor", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = makeList(3);
  });

  afterEach(() => {
    root.remove();
  });

  describe("ARIA + roving tabindex", () => {
    it("tags root and options with listbox roles", () => {
      const c = new ListCursor({ root, itemSelector: ".opt", activeClass: "on" });
      expect(root.getAttribute("role")).toBe("listbox");
      const opts = root.querySelectorAll(".opt");
      opts.forEach(o => {
        expect(o.getAttribute("role")).toBe("option");
        expect(o.id).toBeTruthy();
      });
      c.destroy();
    });

    it("roving mode: first item is the only tab stop until the cursor moves", () => {
      const c = new ListCursor({ root, itemSelector: ".opt", activeClass: "on" });
      const opts = [...root.querySelectorAll<HTMLElement>(".opt")];
      expect(opts.map(o => o.tabIndex)).toEqual([0, -1, -1]);
      // First ArrowDown from "nothing" lands on index 0 — still the same tab stop.
      c.move(1);
      expect(c.index).toBe(0);
      expect(opts.map(o => o.tabIndex)).toEqual([0, -1, -1]);
      c.move(1);
      expect(c.index).toBe(1);
      expect(opts.map(o => o.tabIndex)).toEqual([-1, 0, -1]);
      c.destroy();
    });

    it("paints activeClass and aria-selected on exactly one option", () => {
      const c = new ListCursor({ root, itemSelector: ".opt", activeClass: "on" });
      c.set(1);
      const opts = [...root.querySelectorAll<HTMLElement>(".opt")];
      expect(opts.map(o => o.classList.contains("on"))).toEqual([false, true, false]);
      expect(opts.map(o => o.getAttribute("aria-selected"))).toEqual([
        "false",
        "true",
        "false",
      ]);
      c.destroy();
    });
  });

  describe("move / set / clear", () => {
    it("move from empty cursor lands on the edge the arrow points to", () => {
      const c = new ListCursor({ root, itemSelector: ".opt", activeClass: "on" });
      expect(c.index).toBe(-1);
      expect(c.move(1)).toBe(0);
      expect(c.move(1)).toBe(1);
      c.clear();
      expect(c.move(-1)).toBe(2);
      c.destroy();
    });

    it("clamps at both ends when loop is false", () => {
      const c = new ListCursor({ root, itemSelector: ".opt", activeClass: "on" });
      c.set(0);
      expect(c.move(-1)).toBe(0);
      c.set(2);
      expect(c.move(1)).toBe(2);
      c.destroy();
    });

    it("wraps when loop is true", () => {
      const c = new ListCursor({
        root,
        itemSelector: ".opt",
        activeClass: "on",
        loop: true,
      });
      c.set(2);
      expect(c.move(1)).toBe(0);
      c.set(0);
      expect(c.move(-1)).toBe(2);
      c.destroy();
    });

    it("clear drops the class and index", () => {
      const c = new ListCursor({ root, itemSelector: ".opt", activeClass: "on" });
      c.set(1);
      c.clear();
      expect(c.index).toBe(-1);
      expect(c.current).toBeNull();
      expect(root.querySelectorAll(".on")).toHaveLength(0);
      c.destroy();
    });

    it("set / move on an empty list stay at -1", () => {
      const onMove = vi.fn();
      const empty = document.createElement("div");
      document.body.appendChild(empty);
      const c = new ListCursor({
        root: empty,
        itemSelector: ".opt",
        activeClass: "on",
        onMove,
      });
      c.set(0);
      expect(c.index).toBe(-1);
      expect(onMove).toHaveBeenCalledWith(-1, null);
      expect(c.move(1)).toBe(-1);
      c.destroy();
      empty.remove();
    });

    it("setIndex moves the tab stop without touching the active class", () => {
      const c = new ListCursor({ root, itemSelector: ".opt", activeClass: "on" });
      c.set(1);
      const opts = [...root.querySelectorAll<HTMLElement>(".opt")];
      c.setIndex(2);
      expect(c.index).toBe(2);
      expect(opts.map(o => o.tabIndex)).toEqual([-1, -1, 0]);
      // set() painted index 1; setIndex must not strip that class.
      expect(opts[1].classList.contains("on")).toBe(true);
      c.destroy();
    });

    it("set() updates roving tabindex as well as the active class", () => {
      const c = new ListCursor({ root, itemSelector: ".opt", activeClass: "on" });
      const opts = [...root.querySelectorAll<HTMLElement>(".opt")];
      expect(opts.map(o => o.tabIndex)).toEqual([0, -1, -1]);
      c.set(2);
      expect(opts.map(o => o.tabIndex)).toEqual([-1, -1, 0]);
      expect(opts[2].classList.contains("on")).toBe(true);
      c.destroy();
    });

    it("refresh keeps a still-valid index after rebuild", () => {
      const c = new ListCursor({ root, itemSelector: ".opt", activeClass: "on" });
      c.set(1);
      // Simulate rebuild: replace children.
      root.innerHTML = "";
      for (let i = 0; i < 2; i++) {
        const item = document.createElement("div");
        item.className = "opt";
        root.appendChild(item);
      }
      c.refresh();
      expect(c.index).toBe(1);
      expect(root.querySelectorAll(".on")).toHaveLength(1);
      c.destroy();
    });
  });

  describe("handleKey", () => {
    it("ArrowDown / ArrowUp / Home / End move the cursor and preventDefault", () => {
      const c = new ListCursor({ root, itemSelector: ".opt", activeClass: "on" });
      const ev = (key: string) =>
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      let e = ev("ArrowDown");
      expect(c.handleKey(e)).toBe(true);
      expect(e.defaultPrevented).toBe(true);
      expect(c.index).toBe(0);
      c.handleKey(ev("End"));
      expect(c.index).toBe(2);
      c.handleKey(ev("Home"));
      expect(c.index).toBe(0);
      c.handleKey(ev("ArrowUp"));
      expect(c.index).toBe(0);
      c.destroy();
    });

    it("Enter / Space activate the current option", () => {
      const onActivate = vi.fn();
      const c = new ListCursor({
        root,
        itemSelector: ".opt",
        activeClass: "on",
        onActivate,
      });
      c.set(1);
      const e = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
      expect(c.handleKey(e)).toBe(true);
      expect(onActivate).toHaveBeenCalledWith(1, root.querySelectorAll(".opt")[1]);
      c.destroy();
    });

    it("ignores unrelated keys", () => {
      const c = new ListCursor({ root, itemSelector: ".opt", activeClass: "on" });
      expect(c.handleKey(new KeyboardEvent("keydown", { key: "a" }))).toBe(false);
      c.destroy();
    });
  });

  describe("active-descendant mode (SearchControl combobox)", () => {
    it("keeps DOM focus off options and mirrors the id on the input", () => {
      const input = document.createElement("input");
      document.body.appendChild(input);
      const c = new ListCursor({
        root,
        itemSelector: ".opt",
        activeClass: "on",
        mode: "active-descendant",
        input,
      });
      const opts = [...root.querySelectorAll<HTMLElement>(".opt")];
      expect(opts.map(o => o.tabIndex)).toEqual([-1, -1, -1]);
      c.move(1);
      expect(c.index).toBe(0);
      expect(document.activeElement).not.toBe(opts[0]);
      expect(input.getAttribute("aria-activedescendant")).toBe(opts[0].id);
      c.clear();
      expect(input.hasAttribute("aria-activedescendant")).toBe(false);
      c.destroy();
      input.remove();
    });
  });

  describe("roving mode focuses the option", () => {
    it("move() calls focus on the landed option", () => {
      const c = new ListCursor({ root, itemSelector: ".opt", activeClass: "on" });
      const opts = [...root.querySelectorAll<HTMLElement>(".opt")];
      const spy = vi.spyOn(opts[1], "focus");
      c.set(1);
      expect(spy).toHaveBeenCalled();
      c.destroy();
    });
  });

  describe("bindKeys", () => {
    it("routes keydown on the bound target", () => {
      const c = new ListCursor({ root, itemSelector: ".opt", activeClass: "on" });
      const unbind = c.bindKeys(root);
      root.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
          cancelable: true,
        }),
      );
      expect(c.index).toBe(0);
      unbind();
      root.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
          cancelable: true,
        }),
      );
      expect(c.index).toBe(0);
      c.destroy();
    });
  });

  describe("custom roles", () => {
    it("honors roles.list / roles.item", () => {
      const c = new ListCursor({
        root,
        itemSelector: ".opt",
        activeClass: "on",
        roles: { list: "tree", item: "treeitem" },
      });
      expect(root.getAttribute("role")).toBe("tree");
      expect(root.querySelector(".opt")!.getAttribute("role")).toBe("treeitem");
      c.destroy();
    });
  });
});
