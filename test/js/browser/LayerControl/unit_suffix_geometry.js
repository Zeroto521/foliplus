// Reads every unit-suffixed number field in the style panel and reports the
// suffix geometry + focus behaviour, so the browser test can pin:
//   1. the suffix is drawn INSIDE the input's own rect (right padding),
//   2. the suffix never overlaps the value text (value right edge < suffix left),
//   3. the input value is always the bare number (no unit text in the value),
//   4. focusing the field hides the suffix (is-editing), blur restores it,
//   5. both unit families are present on the page (px AND %).
//
// The panel is opened synchronously by the caller's click, so no wait is needed.
async ([layerName] = []) => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  const byName =
    api && Array.isArray(api.layers)
      ? api.layers.find(l => l.name === layerName)
      : undefined;
  let row = document.querySelector(
    `[data-layer-id="${CSS.escape(layerName)}"][data-layer-type]`,
  );
  if (!row && byName && byName.id) {
    row = document.querySelector(
      `[data-layer-id="${CSS.escape(byName.id)}"][data-layer-type]`,
    );
  }
  if (!row) return { row: false };

  row.querySelector(".foliplus-layer-more-btn").click();
  const styleItem = row.querySelector(
    '.foliplus-layer-more-menu button[data-action="style-layer"]',
  );
  if (!styleItem) return { row: true, styleItem: false };
  styleItem.click();

  const panel = row.querySelector(".foliplus-layer-style-panel");
  if (!panel) return { row: true, styleItem: true, panel: false };

  const fields = [...panel.querySelectorAll(".foliplus-form-number-group")]
    .map(group => {
      const input = group.querySelector("input");
      const suffix = group.querySelector(".foliplus-form-number-suffix");
      if (!input || !suffix) return null;
      const inputRect = input.getBoundingClientRect();
      const suffixRect = suffix.getBoundingClientRect();
      // The value is right-aligned in the suffixed field, so the last digit's
      // right edge is the input content-box right edge. The digit-to-suffix gap
      // is then suffix.left - content.right; the CSS pins it to a constant
      // (space-xs) instead of letting it drift with the field width.
      const style = getComputedStyle(input);
      const borderRight = parseFloat(style.borderRightWidth) || 0;
      const paddingRight = parseFloat(style.paddingRight) || 0;
      const contentRight = inputRect.right - borderRight - paddingRight;
      const value = input.value;
      return {
        text: suffix.textContent,
        value,
        bareNumber: /^-?\d+(\.\d+)?$/.test(value.trim()),
        inputRect: {
          left: inputRect.left,
          right: inputRect.right,
          top: inputRect.top,
          bottom: inputRect.bottom,
        },
        textAlign: style.textAlign,
        digitGap: suffixRect.left - contentRight,
        suffixRect: {
          left: suffixRect.left,
          right: suffixRect.right,
          top: suffixRect.top,
          bottom: suffixRect.bottom,
        },
        suffixInsideInput:
          suffixRect.right <= inputRect.right + 0.5 &&
          suffixRect.left >= inputRect.left - 0.5,
        suffixTopInside:
          suffixRect.top >= inputRect.top - 0.5 &&
          suffixRect.bottom <= inputRect.bottom + 0.5,
      };
    })
    .filter(Boolean);

  // Gap stability across digit counts: a suffixed field right-aligns its
  // value, so the digit-right edge is always the content-box right edge no
  // matter how many digits are typed — the gap must not move with "5" vs
  // "55.5" vs "100". This is the regression the centered text caused.
  let drift = null;
  const probeGroup = panel.querySelector(
    ".foliplus-form-number-group .foliplus-form-number-input",
  );
  if (probeGroup) {
    const group = probeGroup.closest(".foliplus-form-number-group");
    const input = group.querySelector("input");
    const suffix = group.querySelector(".foliplus-form-number-suffix");
    const gaps = [];
    for (const v of ["5", "55.5", "100"]) {
      input.value = v;
      const ir = input.getBoundingClientRect();
      const sr = suffix.getBoundingClientRect();
      const st = getComputedStyle(input);
      const br = parseFloat(st.borderRightWidth) || 0;
      const pr = parseFloat(st.paddingRight) || 0;
      gaps.push(sr.left - (ir.right - br - pr));
    }
    drift = { gaps, spread: Math.max(...gaps) - Math.min(...gaps) };
    input.value = probeGroup.value; // restore
  }

  // Focus behaviour on the first field with a suffix.
  let focus = null;
  const first = panel.querySelector(
    ".foliplus-form-number-group .foliplus-form-number-suffix",
  );
  if (first) {
    const group = first.closest(".foliplus-form-number-group");
    const input = group.querySelector("input");
    const suffixRectBefore = first.getBoundingClientRect();
    input.focus();
    const editingOn = group.classList.contains("is-editing");
    const suffixOpacityOn = getComputedStyle(first).opacity;
    input.blur();
    const editingOff = group.classList.contains("is-editing");
    const suffixOpacityOff = getComputedStyle(first).opacity;
    focus = {
      editingOn,
      editingOff,
      suffixOpacityOn: Number(suffixOpacityOn),
      suffixOpacityOff: Number(suffixOpacityOff),
    };
  }

  const units = new Set(fields.map(f => f.text));
  return {
    row: true,
    panel: true,
    fields,
    focus,
    hasPx: units.has("px"),
    hasPct: units.has("%"),
    fieldCount: fields.length,
    drift,
  };
};
