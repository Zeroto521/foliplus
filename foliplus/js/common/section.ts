// common/section — declarative section builder for panel content.
//
// Panels that group content (attributes, per-layer style, delegated drawer)
// share one shape: a heading row with a title on the left and an optional
// master switch on the right, an optional muted second line beneath the
// title, and a body below. Today each panel hand-builds this — `sectionHeading()`
// in the style panel, a bare `<div class="foliplus-section-heading">` in the
// heatmap template, a hand-rolled block in between — so new sections drift.
//
// This module owns the DOM shape. Collapsing is pure view state (`is-collapsed`
// on the root) and is never persisted here; the switch's `checked` state is
// the caller's semantic on/off, and the caller already wires its own storage.
//
// Click routing on a collapsible section:
//   - With a switch: the switch owns its state; any click on `head` outside
//     the switch toggles the collapse. `event.target` bubbles, so a press
//     that started inside the switch is caught by the `switchEl.contains`
//     guard and does not collapse.
//   - Without a switch: the whole head row is the collapse trigger.
//
// The title is a native `<button type="button">`, so Enter and Space fire
// `click` (which bubbles to `head`) — one click listener handles both mouse
// and keyboard, no `keydown` shim needed.
//
// The head keeps the `.foliplus-section-heading` class so existing tests
// and CSS targeting that selector continue to work. When `caption` is
// omitted, `head.textContent` equals exactly the title text.
import { dom } from "./dom.js";

interface SectionOpts {
  /** Title text, or a caller-built element (the common case is a string). */
  title: string | HTMLElement;
  /** Muted second line beneath the title. Omit for a title-only heading. */
  caption?: string | HTMLElement | null;
  /** Master on/off control on the right of the head — a checkbox row, a pin,
   *  or any self-managed control. Callers own its behaviour; this is a slot. */
  switch?: HTMLElement | null;
  /** When true, the head row toggles the body. Default false. */
  collapsible?: boolean;
  /** Initial collapsed state. Default false. */
  collapsed?: boolean;
}

interface SectionResult {
  root: HTMLElement;
  head: HTMLElement;
  body: HTMLElement;
  titleEl: HTMLElement;
  captionEl: HTMLElement | null;
  switchEl: HTMLElement | null;
  setCollapsed: (collapsed: boolean) => void;
  setSwitch: (checked: boolean) => void;
}

const createSection = (opts: SectionOpts): SectionResult => {
  const {
    title,
    caption,
    switch: switchEl = null,
    collapsible = false,
    collapsed = false,
  } = opts;

  const root = dom.el("section", { class: "foliplus-section" });
  const head = dom.el("div", { class: "foliplus-section-heading" });

  const titleEl = dom.el("button", {
    type: "button",
    class: "foliplus-section-title",
  }) as HTMLButtonElement;
  if (typeof title === "string") titleEl.textContent = title;
  else titleEl.appendChild(title);

  let captionEl: HTMLElement | null = null;
  if (caption != null) {
    captionEl = dom.el(
      "div",
      { class: "foliplus-section-caption" },
      typeof caption === "string" ? caption : caption,
    );
  }

  const body = dom.el("div", { class: "foliplus-section-body" });

  head.appendChild(titleEl);
  if (captionEl) head.appendChild(captionEl);
  if (switchEl) head.appendChild(switchEl);

  root.appendChild(head);
  root.appendChild(body);

  if (collapsible) {
    titleEl.setAttribute("aria-expanded", collapsed ? "false" : "true");

    head.addEventListener("click", (event: MouseEvent): void => {
      if (switchEl && event.target instanceof Node && switchEl.contains(event.target)) {
        return;
      }
      const next = !root.classList.contains("is-collapsed");
      root.classList.toggle("is-collapsed", next);
      titleEl.setAttribute("aria-expanded", next ? "false" : "true");
    });
  }

  if (collapsed) root.classList.add("is-collapsed");

  return {
    root,
    head,
    body,
    titleEl,
    captionEl,
    switchEl,
    setCollapsed: (collapsed: boolean): void => {
      root.classList.toggle("is-collapsed", collapsed);
      titleEl.setAttribute("aria-expanded", collapsed ? "false" : "true");
    },
    setSwitch: (checked: boolean): void => {
      if (!switchEl) return;
      if (switchEl instanceof HTMLInputElement) {
        switchEl.checked = checked;
        return;
      }
      const box = switchEl.querySelector(
        "input[type='checkbox'], input[type='radio']",
      ) as HTMLInputElement | null;
      if (box) box.checked = checked;
    },
  };
};

export { createSection, type SectionOpts, type SectionResult };
