// Geometry of the value-fill row in the style drawer (#793).
//
// Two regressions live here, both only visible in a real browser because jsdom
// does not compute flex layout or text metrics:
//
// 1. The shared dropdown replaces a native select inside a fixed 160px form
//    cell. A flex item's automatic minimum size is its min-content width, so
//    without `min-width: 0` on the wrapper the nowrap label refuses to shrink
//    and the inline group (Method + Classes) pushes past the control column in
//    English ("Natural Breaks" is the long one; Chinese fits).
// 2. The closed trigger ellipsizes on purpose — the row is fixed width — so the
//    open popup has to spell the value out. It follows the trigger but grows to
//    its content, clamped to the cell's right edge: a data-driven label such as
//    a field name must not push the popup past the panel content box.
() => {
  const drawer = document.querySelector(".foliplus-layer-style-panel");
  if (!drawer) return { error: "no-drawer" };
  const rows = [...drawer.querySelectorAll(".foliplus-form-row")];
  const classesRow = rows.find(
    r => r.querySelectorAll(".foliplus-dropdown").length >= 2,
  );
  if (!classesRow) return { error: "no-classes-row" };
  const control = classesRow.querySelector(".foliplus-form-control");
  const inline = classesRow.querySelector(".foliplus-form-inline");
  const [method, classes] = [...inline.querySelectorAll(".foliplus-dropdown")];
  const trigger = method.querySelector(".foliplus-dropdown-trigger");
  const label = method.querySelector(".foliplus-dropdown-label");
  const box = el => {
    const r = el.getBoundingClientRect();
    return {
      w: Math.round(r.width * 10) / 10,
      left: Math.round(r.left * 10) / 10,
      right: Math.round(r.right * 10) / 10,
    };
  };
  const openListOf = triggerEl => {
    triggerEl.click();
    const list = [...document.querySelectorAll(".foliplus-dropdown-list")].find(
      l => !l.hidden,
    );
    if (!list) return null;
    const lr = list.getBoundingClientRect();
    const labels = [...list.querySelectorAll(".foliplus-dropdown-option-label")];
    const out = {
      w: Math.round(lr.width * 10) / 10,
      left: Math.round(lr.left * 10) / 10,
      right: Math.round(lr.right * 10) / 10,
      labels: labels.map(el => ({
        text: (el.textContent || "").trim(),
        clientW: el.clientWidth,
        scrollW: el.scrollWidth,
        truncated: el.scrollWidth > el.clientWidth,
      })),
    };
    triggerEl.click();
    return out;
  };

  const fieldRow = rows.find(r => r.querySelector(".foliplus-style-fill-field-select"));

  return {
    methodLabel: (label ? label.textContent : "").trim(),
    ariaLabel: trigger ? trigger.getAttribute("aria-label") : null,
    // The full label stays reachable while the row ellipsizes it.
    title: trigger ? trigger.getAttribute("title") : null,
    labelClient: label ? label.clientWidth : -1,
    labelScroll: label ? label.scrollWidth : -1,
    ellipsized: label ? label.scrollWidth > label.clientWidth : null,
    control: box(control),
    inline: box(inline),
    method: box(method),
    classes: box(classes),
    panel: box(drawer),
    panelScrollX: drawer.scrollWidth - drawer.clientWidth,
    methodList: openListOf(trigger),
    fieldList: fieldRow
      ? {
          controlRight: box(fieldRow.querySelector(".foliplus-form-control")).right,
          ...openListOf(fieldRow.querySelector(".foliplus-dropdown-trigger")),
        }
      : null,
  };
};
