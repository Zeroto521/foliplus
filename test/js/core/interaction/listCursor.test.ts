import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ListCursor } from "#core/interaction/index.js";

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

    // paintOptionContract:false + role=option (SearchControl surface): the
    // cursor still flips aria-selected — the selected state is the cursor's to
    // own even when the row builder owns the rest of the contract.
    it("flips aria-selected with paintOptionContract:false on option rows", () => {
      const c = new ListCursor({
        root,
        itemSelector: ".opt",
        activeClass: "on",
        paintOptionContract: false,
      });
      // Rows pre-built with the option contract (role/tabindex/aria-selected=false).
      const opts = [...root.querySelectorAll<HTMLElement>(".opt")];
      opts.forEach(o => {
        o.setAttribute("role", "option");
        o.setAttribute("aria-selected", "false");
      });
      c.set(1);
      expect(opts.map(o => o.getAttribute("aria-selected"))).toEqual([
        "false",
        "true",
        "false",
      ]);
      c.set(2);
      expect(opts.map(o => o.getAttribute("aria-selected"))).toEqual([
        "false",
        "false",
        "true",
      ]);
      c.destroy();
    });

    // gridcell rows (icon grid) are excluded: they carry aria-current, not
    // aria-selected, so the cursor must not paint aria-selected on them.
    it("does not paint aria-selected on gridcell rows", () => {
      const c = new ListCursor({
        root,
        itemSelector: ".opt",
        activeClass: "on",
        roles: { item: "gridcell" },
      });
      const opts = [...root.querySelectorAll<HTMLElement>(".opt")];
      c.set(1);
      expect(opts.map(o => o.getAttribute("aria-selected"))).toEqual([
        null,
        null,
        null,
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
      const e = ev("ArrowDown");
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

    it("lets range sliders consume arrow keys when focus is inside a bound input", () => {
      const c = new ListCursor({ root, itemSelector: ".opt", activeClass: "on" });
      const slider = document.createElement("input");
      slider.type = "range";
      root.appendChild(slider);
      const unbind = c.bindKeys(root);
      c.set(1);
      slider.focus();
      const event = new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      });
      slider.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(c.index).toBe(1);
      unbind();
      c.destroy();
    });

    it.each([
      [
        "textarea",
        ["ArrowDown", "ArrowUp", "Home", "End"],
        () => {
          const el = document.createElement("textarea");
          root.appendChild(el);
          return el;
        },
      ],
      [
        "select",
        ["ArrowDown", "ArrowUp"],
        () => {
          const el = document.createElement("select");
          root.appendChild(el);
          return el;
        },
      ],
    ])("handleKey lets %s consume %s", (_, keys, mk) => {
      const c = new ListCursor({ root, itemSelector: ".opt", activeClass: "on" });
      const active = mk();
      const unbind = c.bindKeys(root);
      c.set(1);
      active.focus();
      for (const key of keys) {
        const event = new KeyboardEvent("keydown", {
          key,
          bubbles: true,
          cancelable: true,
        });
        active.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
      }
      expect(c.index).toBe(1);
      unbind();
      c.destroy();
    });

    it("handleKey claims Home / End from a select: it does not own them", () => {
      // The ownership table gives a select only the arrows and Space. A
      // select does not jump to its first / last option on Home / End, so
      // the cursor keeps those two keys.
      const c = new ListCursor({ root, itemSelector: ".opt", activeClass: "on" });
      const select = document.createElement("select");
      root.appendChild(select);
      const unbind = c.bindKeys(root);
      c.set(1);
      select.focus();
      const event = new KeyboardEvent("keydown", {
        key: "Home",
        bubbles: true,
        cancelable: true,
      });
      select.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(c.index).toBe(0);
      unbind();
      c.destroy();
    });

    it("handleKey does not skip Enter / Space on a form control", () => {
      const c = new ListCursor({ root, itemSelector: ".opt", activeClass: "on" });
      const slider = document.createElement("input");
      slider.type = "range";
      root.appendChild(slider);
      const unbind = c.bindKeys(root);
      c.set(1);
      slider.focus();
      const event = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      slider.dispatchEvent(event);
      // Enter is not in the arrow guard — handleKey proceeds to activate().
      expect(c.handleKey(event)).toBe(true);
      unbind();
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

  describe("2D grid walk (cols > 1)", () => {
    const makeGrid = (rows: number, cols: number) => {
      const g = document.createElement("div");
      g.id = "grid";
      for (let i = 0; i < rows * cols; i++) {
        const cell = document.createElement("button");
        cell.className = "cell";
        cell.type = "button";
        cell.textContent = `c${i}`;
        g.appendChild(cell);
      }
      document.body.appendChild(g);
      return g;
    };
    const key = (target: HTMLElement, k: string) => {
      const ev = new KeyboardEvent("keydown", {
        key: k,
        bubbles: true,
        cancelable: true,
      });
      target.dispatchEvent(ev);
      return ev;
    };

    it("rows/cols: ArrowRight/Left move one column, clamped at the row edge", () => {
      const g = makeGrid(2, 3);
      const c = new ListCursor({
        root: g,
        itemSelector: ".cell",
        activeClass: "on",
        mode: "roving",
        cols: 3,
      });
      c.bindKeys(g);
      c.set(0);
      // Right from col 0 → col 1
      key(g, "ArrowRight");
      expect(c.index).toBe(1);
      // Right at row edge → next row's first cell (linear walk)
      key(g, "ArrowRight");
      expect(c.index).toBe(2);
      key(g, "ArrowRight");
      expect(c.index).toBe(3);
      // Left from row 1 col 0 → row 0 col 2 (linear walk backwards)
      key(g, "ArrowLeft");
      expect(c.index).toBe(2);
      // Left at the first cell → clamped at 0
      c.set(0);
      key(g, "ArrowLeft");
      expect(c.index).toBe(0);
      // Last cell right → clamped at n-1
      c.set(5);
      key(g, "ArrowRight");
      expect(c.index).toBe(5);
      c.destroy();
      g.remove();
    });

    it("ArrowUp/Down move one row, clamped at the first/last row", () => {
      const g = makeGrid(2, 3);
      const c = new ListCursor({
        root: g,
        itemSelector: ".cell",
        activeClass: "on",
        mode: "roving",
        cols: 3,
      });
      c.bindKeys(g);
      c.set(0);
      key(g, "ArrowDown");
      expect(c.index).toBe(3);
      // Down from last row → clamped at n-1
      key(g, "ArrowDown");
      expect(c.index).toBe(5);
      key(g, "ArrowUp");
      expect(c.index).toBe(2);
      // Up from row 0 → stays (row > 0 guard: index 2 is row 0)
      key(g, "ArrowUp");
      expect(c.index).toBe(2);
      c.destroy();
      g.remove();
    });

    it("Home/End go to the first/last cell", () => {
      const g = makeGrid(2, 3);
      const c = new ListCursor({
        root: g,
        itemSelector: ".cell",
        activeClass: "on",
        mode: "roving",
        cols: 3,
      });
      c.bindKeys(g);
      c.set(1);
      key(g, "Home");
      expect(c.index).toBe(0);
      key(g, "End");
      expect(c.index).toBe(5);
      c.destroy();
      g.remove();
    });

    it("Enter/Space activate the focused cell", () => {
      const g = makeGrid(1, 2);
      const activated: number[] = [];
      const c = new ListCursor({
        root: g,
        itemSelector: ".cell",
        activeClass: "on",
        mode: "roving",
        cols: 2,
        onActivate: i => activated.push(i),
      });
      c.bindKeys(g);
      c.set(0);
      key(g, "Enter");
      expect(activated).toEqual([0]);
      key(g, " ");
      expect(activated).toEqual([0, 0]);
      c.destroy();
      g.remove();
    });

    it("a native control inside the grid keeps its keys (input gets arrows)", () => {
      const g = makeGrid(1, 2);
      const input = document.createElement("input");
      input.type = "text";
      g.appendChild(input);
      const c = new ListCursor({
        root: g,
        itemSelector: ".cell",
        activeClass: "on",
        mode: "roving",
        cols: 2,
      });
      c.bindKeys(g);
      c.set(0);
      input.focus();
      const ev = key(g, "ArrowRight");
      expect(ev.defaultPrevented).toBe(false);
      expect(c.index).toBe(0);
      c.destroy();
      g.remove();
    });

    it("an empty grid does not move", () => {
      const g = document.createElement("div");
      g.id = "empty";
      document.body.appendChild(g);
      const c = new ListCursor({
        root: g,
        itemSelector: ".cell",
        activeClass: "on",
        mode: "roving",
        cols: 3,
      });
      c.bindKeys(g);
      const ev = key(g, "ArrowRight");
      expect(ev.defaultPrevented).toBe(false);
      expect(c.index).toBe(-1);
      c.destroy();
      g.remove();
    });

    it("a first move with no DOM focus and no cursor index starts at 0", () => {
      const g = makeGrid(2, 3);
      const c = new ListCursor({
        root: g,
        itemSelector: ".cell",
        activeClass: "on",
        mode: "roving",
        cols: 3,
      });
      c.bindKeys(g);
      // No set(), no DOM focus: _index stays -1. ArrowRight falls back to 0,
      // then moves one cell right (index = 0 + 1).
      key(g, "ArrowRight");
      expect(c.index).toBe(1);
      c.destroy();
      g.remove();
    });

    it("Enter with no current cell does not activate", () => {
      const g = makeGrid(1, 2);
      const activated: number[] = [];
      const c = new ListCursor({
        root: g,
        itemSelector: ".cell",
        activeClass: "on",
        mode: "roving",
        cols: 2,
        onActivate: i => activated.push(i),
      });
      c.bindKeys(g);
      // No set() and no focus: current is null. Enter must not activate.
      const ev = key(g, "Enter");
      expect(activated).toEqual([]);
      expect(ev.defaultPrevented).toBe(false);
      c.destroy();
      g.remove();
    });

    it("syncs with DOM focus: a Tab'd cell wins over the cursor index", () => {
      const g = makeGrid(2, 3);
      const c = new ListCursor({
        root: g,
        itemSelector: ".cell",
        activeClass: "on",
        mode: "roving",
        cols: 3,
      });
      c.bindKeys(g);
      c.set(0);
      const cells = [...g.querySelectorAll<HTMLElement>(".cell")];
      cells[4].focus();
      key(g, "ArrowRight");
      expect(c.index).toBe(5);
      c.destroy();
      g.remove();
    });
  });
});

describe("active row stays visible (ensureActiveVisible contract)", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = makeList(6);
  });

  afterEach(() => {
    root.remove();
  });

  it("calls scrollIntoView with nearest semantics when the cursor lands", () => {
    const opts = [...root.querySelectorAll<HTMLElement>(".opt")];
    const spy = vi.fn();
    (opts[2] as unknown as { scrollIntoView: (o?: unknown) => void }).scrollIntoView =
      spy;
    const c = new ListCursor({ root, itemSelector: ".opt", activeClass: "on" });
    c.set(2);
    expect(spy).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
    c.destroy();
  });

  it("does not scroll when the cursor clears", () => {
    const opts = [...root.querySelectorAll<HTMLElement>(".opt")];
    const spy = vi.fn();
    (opts[0] as unknown as { scrollIntoView: (o?: unknown) => void }).scrollIntoView =
      spy;
    const c = new ListCursor({ root, itemSelector: ".opt", activeClass: "on" });
    c.set(0);
    // set(0) scrolls the active row into view once.
    expect(spy).toHaveBeenCalledTimes(1);
    c.clear();
    // clear() has no active row: it must NOT scroll anything again.
    expect(spy).toHaveBeenCalledTimes(1);
    c.destroy();
  });

  it("scrolling follows the cursor across moves", () => {
    const opts = [...root.querySelectorAll<HTMLElement>(".opt")];
    const spies = opts.map(o => {
      const fn = vi.fn();
      (o as unknown as { scrollIntoView: (o?: unknown) => void }).scrollIntoView = fn;
      return fn;
    });
    const c = new ListCursor({ root, itemSelector: ".opt", activeClass: "on" });
    c.set(0);
    expect(spies[0]).toHaveBeenCalledTimes(1);
    c.move(1);
    expect(spies[1]).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
    expect(spies[0]).toHaveBeenCalledTimes(1);
    c.destroy();
  });
});
