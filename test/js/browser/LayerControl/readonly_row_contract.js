// Read the interaction contract of the read-only style rows. The boxes must:
// (1) NOT show a pointer affordance — computed cursor: default (not pointer),
//     and no click handler that opens/edits anything;
// (2) NOT be focusable — no [tabindex]>=0 on the box or any descendant, and
//     no focusable form control (input/select/button) inside;
// (3) KEEP their value text copyable — computed user-select: text on the value
//     span (the panel is user-select: none, so this must be an explicit opt-in).
() => {
  const panel = document.querySelector(".foliplus-layer-style-panel");
  if (!panel) return { ok: false, reason: "no-panel" };
  const readouts = [...panel.querySelectorAll(".foliplus-readonly")];
  const boxes = readouts.map(el => ({
    cls: el.className,
    tag: el.tagName,
    cursor: getComputedStyle(el).cursor,
    userSelect: getComputedStyle(el).userSelect,
    tabindex: el.getAttribute("tabindex"),
    tabIndex: el.tabIndex,
    onClick: typeof el.onclick === "function",
    ariaDisabled: el.getAttribute("aria-disabled"),
    focusableDesc: [...el.querySelectorAll("input,select,button,[tabindex]")]
      .filter(d => d.tabIndex >= 0 || d.tagName === "INPUT" || d.tagName === "SELECT")
      .map(d => ({ tag: d.tagName, tabindex: d.getAttribute("tabindex") })),
  }));
  const values = [...panel.querySelectorAll(".foliplus-style-fill-original-value")]
    .map(el => ({ userSelect: getComputedStyle(el).userSelect, text: el.textContent }));
  return { ok: true, boxCount: readouts.length, boxes, values };
};
