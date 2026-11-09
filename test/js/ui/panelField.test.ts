import { describe, expect, it } from "vitest";
import { dom } from "#platform/dom.js";
import { readOnlyValue } from "#ui/index.js";

// ui/panelField read-only primitive: the shared read-only value box for panel
// readouts. The class-name contract with the Python render-string tests is
// that the shared semantic class and the caller's frame class land on the
// same box in the same order, and aria-disabled is always true — so a
// readout can never be mistaken for something editable.
describe("ui/panelField read-only value", () => {
  it("pins the class combination the style panel's read-only box relies on", () => {
    // readOnlyBox (style/fill.ts) passes PANEL_CLASS.READONLY + STYLE_FILL_READONLY
    // + a caller hook class as one className string. If the primitive dropped the
    // caller's frame class, the style panel's read-only boxes would lose their
    // frame styling with no jsdom assertion failing — only the browser probe
    // (fill_author_read.js) would catch it. This is that assertion.
    const box = readOnlyValue(
      {
        className: "foliplus-style-fill-readonly foliplus-style-fill-original-column",
      },
      dom.el("span", {}, "score"),
    );
    expect(box.classList.contains("foliplus-readonly")).toBe(true);
    expect(box.classList.contains("foliplus-style-fill-readonly")).toBe(true);
    expect(box.classList.contains("foliplus-style-fill-original-column")).toBe(true);
    expect(box.getAttribute("aria-disabled")).toBe("true");
  });

  it("emits the shared READONLY class and the caller frame class", () => {
    const box = readOnlyValue(
      { className: "foliplus-style-fill-readonly" },
      dom.el("span", {}, "score"),
    );
    expect(box.tagName).toBe("DIV");
    expect(box.classList.contains("foliplus-readonly")).toBe(true);
    expect(box.classList.contains("foliplus-style-fill-readonly")).toBe(true);
    // The two classes are joined in order (semantic first, frame second).
    expect(box.outerHTML).toBe(
      '<div class="foliplus-input-skin foliplus-readonly foliplus-style-fill-readonly" aria-disabled="true"><span>score</span></div>',
    );
  });

  it("always marks the box aria-disabled (it cannot be edited)", () => {
    const box = readOnlyValue({}, "3");
    expect(box.getAttribute("aria-disabled")).toBe("true");
  });

  it("accepts ariaDisabled false for a genuinely inert container", () => {
    const box = readOnlyValue({ ariaDisabled: false }, "x");
    expect(box.getAttribute("aria-disabled")).toBe("false");
  });

  it("accepts a plain string value and renders it as text", () => {
    const box = readOnlyValue({}, "—");
    expect(box.textContent).toBe("—");
    expect(box.querySelector("span")).toBeNull();
  });

  it("applies a caller-supplied role for a stable accessible name", () => {
    const box = readOnlyValue(
      { className: "foliplus-style-fill-readonly", role: "group" },
      dom.el("span", {}, "3"),
    );
    expect(box.getAttribute("role")).toBe("group");
  });

  it("emits only the READONLY class when no caller class is given", () => {
    const box = readOnlyValue({}, "3");
    expect(box.classList.length).toBe(2);
    expect(box.classList.contains("foliplus-input-skin")).toBe(true);
    expect(box.classList.contains("foliplus-readonly")).toBe(true);
  });

  it("keeps READONLY alone when className is empty", () => {
    const box = readOnlyValue({ className: "" }, "3");
    expect(box.classList.contains("foliplus-readonly")).toBe(true);
    expect(box.classList.contains("")).toBe(false);
    // The filter(Boolean) keeps a trailing space from joining into a class.
    expect(box.className).toBe("foliplus-input-skin foliplus-readonly");
  });

  it("renders multiple children in order", () => {
    const box = readOnlyValue(
      { className: "frame" },
      dom.el("span", {}, "a"),
      dom.el("span", {}, "b"),
      "c",
    );
    // Two element children plus one text node: a bare string is appended as
    // a text node, not an element, so children counts only the elements.
    expect(box.children.length).toBe(2);
    expect(box.children[0].textContent).toBe("a");
    expect(box.children[1].textContent).toBe("b");
    expect(box.childNodes.length).toBe(3);
    expect(box.childNodes[2].nodeType).toBe(Node.TEXT_NODE);
    expect(box.childNodes[2].textContent).toBe("c");
  });
});
