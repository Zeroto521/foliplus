// Read the control-column text-start parity for ONE fill mode. The fill
// mode select rebuilds the detail slot in place, so the same "Method" row
// slot is a dropdown trigger in value mode and a readonly box in original
// mode. The Python entry drives both modes (two evaluates) and asserts
// |value.trigger.textStart - original.box.textStart| <= 1px.
//
// text-start = getBoundingClientRect().left + computed padding-left. The
// contract covers LEFT-ALIGNED controls only: the compact number field
// (centered), the colors bar and SearchControl input are out of scope.
//
// arg = { mode: "value" | "original" } — set the mode first (like a user
// picking the select), then read that mode's method control.
arg => {
  const { mode } = arg ?? {};
  const panel = document.querySelector(".foliplus-layer-style-panel");
  const modeSelect = panel?.querySelector(".foliplus-style-fill-mode-select");
  if (!panel || !modeSelect) {
    return { ok: false, reason: "no-panel-or-mode-select" };
  }
  if (!["value", "original"].includes(mode)) {
    return { ok: false, reason: "bad-mode", mode };
  }
  // Switch like a user: set + dispatch change (the panel rebinds the detail).
  if (modeSelect.value !== mode) {
    modeSelect.value = mode;
    modeSelect.dispatchEvent(new Event("change", { bubbles: true }));
  }

  const textStart = el => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    const pad = parseFloat(s.paddingLeft) || 0;
    return r.left + pad;
  };
  const detail = panel.querySelector(".foliplus-style-fill-detail");

  // The method control for this mode:
  //  value -> the bridged method select's visible trigger button.
  //  original -> the method readout box.
  let el = null;
  let kind = null;
  if (mode === "value") {
    const native = detail?.querySelector(".foliplus-style-fill-method-select");
    const trigger = native
      ? native
          .closest(".foliplus-dropdown")
          ?.querySelector(".foliplus-dropdown-trigger")
      : null;
    el = trigger;
    kind = "trigger";
  } else {
    el = panel.querySelector(".foliplus-style-fill-original-method");
    kind = "box";
  }

  const tokenInset = (() => {
    const cs = getComputedStyle(panel);
    const v = cs.getPropertyValue("--foliplus-ctrl-inset-x").trim();
    if (!v) return null;
    const probeEl = document.createElement("div");
    probeEl.style.paddingLeft = "var(--foliplus-ctrl-inset-x)";
    document.body.appendChild(probeEl);
    const resolved = getComputedStyle(probeEl).paddingLeft;
    probeEl.remove();
    return parseFloat(resolved) || 0;
  })();

  return {
    ok: true,
    mode,
    kind,
    present: !!el,
    textStart: textStart(el),
    left: el ? Math.round(el.getBoundingClientRect().left) : null,
    padLeft: el ? parseFloat(getComputedStyle(el).paddingLeft) : null,
    tokenInset,
    modeValue: modeSelect.value,
  };
};
