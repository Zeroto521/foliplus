// test/js/ui/searchField.test.ts — small DOM primitive for a search box inside a popup.
import { describe, expect, it, vi } from "vitest";
import { createSearchField } from "#ui/searchField.js";

describe("searchField", () => {
  const mk = (opts = {}) => createSearchField({ onInput: vi.fn(), ...opts });

  it("builds an input with autocomplete off", () => {
    const sf = mk();
    expect(sf.element.tagName).toBe("INPUT");
    expect(sf.element.getAttribute("autocomplete")).toBe("off");
    expect(sf.element.getAttribute("spellcheck")).toBe("false");
  });

  it("sets placeholder and aria-label when given", () => {
    const sf = mk({ placeholder: "Search…", ariaLabel: "Search values" });
    expect(sf.element.getAttribute("placeholder")).toBe("Search…");
    expect(sf.element.getAttribute("aria-label")).toBe("Search values");
  });

  it("fires onInput with the raw query on input", () => {
    const onInput = vi.fn();
    const sf = mk({ onInput });
    sf.element.value = "alpha";
    sf.element.dispatchEvent(new Event("input"));
    expect(onInput).toHaveBeenCalledWith("alpha");
  });

  it("clear empties the input and fires onInput('')", () => {
    const onInput = vi.fn();
    const sf = mk({ onInput });
    sf.element.value = "alpha";
    sf.clear();
    expect(sf.element.value).toBe("");
    expect(onInput).toHaveBeenCalledWith("");
  });

  it("clear is a no-op when already empty", () => {
    const onInput = vi.fn();
    const sf = mk({ onInput });
    sf.clear();
    expect(onInput).not.toHaveBeenCalled();
  });

  it("fires onKeyDown for a key event", () => {
    const onKeyDown = vi.fn();
    const sf = mk({ onKeyDown });
    sf.element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it("setAriaActive sets and clears aria-activedescendant", () => {
    const sf = mk();
    sf.setAriaActive("row-1");
    expect(sf.element.getAttribute("aria-activedescendant")).toBe("row-1");
    sf.setAriaActive(null);
    expect(sf.element.hasAttribute("aria-activedescendant")).toBe(false);
  });

  it("focus focuses the input", () => {
    const sf = mk();
    sf.element.focus = vi.fn();
    sf.focus();
    expect(sf.element.focus).toHaveBeenCalled();
  });
});
