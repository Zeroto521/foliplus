// Read the interaction contract of the read-only style rows. The boxes must:
// (1) NOT show a pointer affordance — computed cursor: default (never pointer),
//     and no click handler that opens/edits anything;
// (2) NOT be focusable — calling focus() must NOT move focus into the box
//     (document.activeElement must not be the box or a descendant), there is no
//     [tabindex]>=0 on the box, and no focusable form control
//     (button/input/select/[tabindex]:not([tabindex="-1"])) inside it;
// (3) KEEP their value text copyable — computed user-select: text on the value
//     span (the panel is user-select: none, so this must be an explicit opt-in).
//
// The focusable probe uses the exact DOM form `querySelector('button,input,select,[tabindex]:not([tabindex="-1"])')`
// so it is a true kill test: it returns a node iff a focusable element exists
// inside the box. The box itself is a div (no tabindex), so it is only
// focusable if it is given one — the probe asserts it is not.
() => {
  const panel = document.querySelector(".foliplus-layer-style-panel");
  if (!panel) return { ok: false, reason: "no-panel" };
  const readouts = [...panel.querySelectorAll(".foliplus-readonly")];
  const boxes = readouts.map(el => {
    // focus() must not land inside the box.
    el.focus();
    const active = document.activeElement;
    const focusLanded = active === el || (active && el.contains(active));
    // The lethal focusable probe: non-null iff a focusable control exists inside.
    const focusable = el.querySelector(
      'button, input, select, [tabindex]:not([tabindex="-1"])',
    );
    return {
      cls: el.className,
      tag: el.tagName,
      cursor: getComputedStyle(el).cursor,
      userSelect: getComputedStyle(el).userSelect,
      tabindex: el.getAttribute("tabindex"),
      tabIndex: el.tabIndex,
      focusLanded,
      focusable: focusable
        ? { tag: focusable.tagName, cls: focusable.className }
        : null,
      onClick: typeof el.onclick === "function",
      ariaDisabled: el.getAttribute("aria-disabled"),
    };
  });
  const values = [...panel.querySelectorAll(".foliplus-style-fill-original-value")].map(
    el => ({ userSelect: getComputedStyle(el).userSelect, text: el.textContent }),
  );
  return { ok: true, boxCount: readouts.length, boxes, values };
};
