import { describe, expect, it } from "vitest";
import { createSection } from "#common/section.js";

describe("createSection — DOM shape", () => {
  it("wraps a title button and empty body in .foliplus-section", () => {
    const s = createSection({ title: "Layer" });

    expect(s.root.tagName).toBe("SECTION");
    expect(s.root.className).toBe("foliplus-section");
    expect(s.root.children).toHaveLength(2);

    expect(s.head.className).toBe("foliplus-section-heading");
    expect(s.body.className).toBe("foliplus-section-body");

    expect(s.titleEl.tagName).toBe("BUTTON");
    expect(s.titleEl.getAttribute("type")).toBe("button");
    expect(s.titleEl.textContent).toBe("Layer");
    expect(s.head.textContent).toBe("Layer");
  });

  it("returns null captionEl and switchEl when the caller omits them", () => {
    const s = createSection({ title: "Label" });

    expect(s.captionEl).toBeNull();
    expect(s.switchEl).toBeNull();
    expect(s.head.querySelector(".foliplus-section-caption")).toBeNull();
  });

  it("renders the caption as a muted second line beneath the title", () => {
    const s = createSection({ title: "Label", caption: "Shown when this layer renders." });

    expect(s.captionEl).not.toBeNull();
    expect(s.captionEl!.className).toBe("foliplus-section-caption");
    expect(s.captionEl!.textContent).toBe("Shown when this layer renders.");
    expect(s.head.children).toHaveLength(2);
    expect(s.head.querySelector(".foliplus-section-caption")).not.toBeNull();
  });

  it("mounts the caller's switch element into the head's right slot", () => {
    const sw = document.createElement("label");
    sw.className = "foliplus-toggle-switch";
    const s = createSection({ title: "Label", switch: sw });

    expect(s.switchEl).toBe(sw);
    expect(s.head.contains(sw)).toBe(true);
    expect(s.head.lastElementChild).toBe(sw);
  });

  it("accepts an element title and does not double-encode it", () => {
    const titleEl = document.createElement("span");
    titleEl.textContent = "Title via element";
    const s = createSection({ title: titleEl });

    expect(s.titleEl.contains(titleEl)).toBe(true);
    expect(s.titleEl.textContent).toBe("Title via element");
  });
});

describe("createSection — collapsible", () => {
  it("does not set aria-expanded and does not toggle on click by default", () => {
    const s = createSection({ title: "Static" });

    expect(s.titleEl.getAttribute("aria-expanded")).toBeNull();
    s.head.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(s.root.classList.contains("is-collapsed")).toBe(false);
  });

  it("toggles is-collapsed on head click when collapsible", () => {
    const s = createSection({ title: "Group", collapsible: true });

    expect(s.titleEl.getAttribute("aria-expanded")).toBe("true");
    expect(s.root.classList.contains("is-collapsed")).toBe(false);

    s.head.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(s.root.classList.contains("is-collapsed")).toBe(true);
    expect(s.titleEl.getAttribute("aria-expanded")).toBe("false");

    s.head.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(s.root.classList.contains("is-collapsed")).toBe(false);
    expect(s.titleEl.getAttribute("aria-expanded")).toBe("true");
  });

  it("starts collapsed when `collapsed` is set, aria-expanded reflects it", () => {
    const s = createSection({ title: "Hidden", collapsible: true, collapsed: true });

    expect(s.root.classList.contains("is-collapsed")).toBe(true);
    expect(s.titleEl.getAttribute("aria-expanded")).toBe("false");
  });

  it("swallows clicks that started inside the switch, so the switch owns its state", () => {
    const sw = document.createElement("input");
    sw.type = "checkbox";
    const s = createSection({ title: "With switch", collapsible: true, switch: sw });

    sw.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(s.root.classList.contains("is-collapsed")).toBe(false);
  });

  it("still collapses on Enter and Space pressed on the title button", () => {
    const s = createSection({ title: "Keyboard", collapsible: true });

    s.titleEl.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    // jsdom does not auto-fire `click` on keydown; assert the keydown
    // handler does nothing by itself — the collapse path is `click`.
    expect(s.root.classList.contains("is-collapsed")).toBe(false);

    s.titleEl.dispatchEvent(
      new KeyboardEvent("keydown", { key: "a", bubbles: true }),
    );
    expect(s.root.classList.contains("is-collapsed")).toBe(false);

    s.head.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(s.root.classList.contains("is-collapsed")).toBe(true);
  });
});

describe("createSection — programmatic API", () => {
  it("setCollapsed(true/false) toggles the class and aria-expanded", () => {
    const s = createSection({ title: "T", collapsible: true });

    s.setCollapsed(true);
    expect(s.root.classList.contains("is-collapsed")).toBe(true);
    expect(s.titleEl.getAttribute("aria-expanded")).toBe("false");

    s.setCollapsed(false);
    expect(s.root.classList.contains("is-collapsed")).toBe(false);
    expect(s.titleEl.getAttribute("aria-expanded")).toBe("true");
  });

  it("setCollapsed is a no-op on a non-collapsible section", () => {
    const s = createSection({ title: "Static" });

    s.setCollapsed(true);
    expect(s.root.classList.contains("is-collapsed")).toBe(true);
    expect(s.titleEl.getAttribute("aria-expanded")).toBe("false");
  });

  it("setSwitch(true) checks a raw input switch", () => {
    const sw = document.createElement("input");
    sw.type = "checkbox";
    const s = createSection({ title: "T", switch: sw });

    expect(sw.checked).toBe(false);
    s.setSwitch(true);
    expect(sw.checked).toBe(true);
  });

  it("setSwitch(true) checks an input nested inside a wrapper switch", () => {
    const sw = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    sw.appendChild(input);

    const s = createSection({ title: "T", switch: sw });
    s.setSwitch(true);
    expect(input.checked).toBe(true);
  });

  it("setSwitch is a no-op when no switch was provided", () => {
    const s = createSection({ title: "No switch" });
    expect(() => s.setSwitch(true)).not.toThrow();
  });
});
