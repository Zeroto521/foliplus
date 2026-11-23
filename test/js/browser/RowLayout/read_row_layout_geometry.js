// Computed geometry parity of a migrated dropdown option row vs the shared
// row primitive (row-primitive PR1).
//
// jsdom cannot compute flex layout, so the real parity (height / padding-left /
// gap / font-size / border-left-width) and the leading-cell x are only visible
// in a browser. The probe is driven by test/python/.../test_row_layout.py.
// The body is an arrow function (the browser-probe parser reads a function
// body), so no import/export — the DOM is already on the page.
() => {
  const box = el => {
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.x * 10) / 10,
      width: Math.round(r.width * 10) / 10,
      height: Math.round(r.height * 10) / 10,
    };
  };
  const style = (el, prop) => getComputedStyle(el).getPropertyValue(prop).trim();

  const option = document.querySelector(".foliplus-dropdown-option.foliplus-row");
  const ref = document.querySelector(".row-layout-ref .foliplus-row");

  if (!option || !ref) {
    return { present: false, option: !!option, ref: !!ref };
  }

  const rowProps = ["padding-left", "gap", "font-size", "border-left-width"];
  const heightProps = ["height"];
  const optionVals = {};
  const refVals = {};
  for (const p of rowProps) {
    optionVals[p] = style(option, p);
    refVals[p] = style(ref, p);
  }

  const optionContent = option.querySelector(".foliplus-row-content");
  const refContent = ref.querySelector(".foliplus-row-content");

  return {
    present: true,
    optionHeight: box(option).height,
    refHeight: box(ref).height,
    optionVals,
    refVals,
    optionContentX: optionContent ? box(optionContent).x - box(option).x : null,
    refContentX: refContent ? box(refContent).x - box(ref).x : null,
    optionBox: box(option),
  };
};
