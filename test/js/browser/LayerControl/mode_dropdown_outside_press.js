// Open a style mode dropdown (border or fill), then press on the panel's own
// header (inside the panel, outside both dropdowns) and report whether the
// popup closed. Pins the mode dropdown's overlay-registry registration:
// without it the dropdown never dismisses on an outside press (the single
// Escape/press dispatcher from #1011 owns all dismissal paths). The press
// must land INSIDE the panel but OUTSIDE the dropdown — an outside press on
// the map would also close the row panel itself, which is a different
// dismissal and would make the two cases indistinguishable.
arg => {
  const { which } = arg ?? {};
  const select = document.querySelector(
    which === "fill"
      ? ".foliplus-style-fill-mode-select"
      : ".foliplus-style-border-mode-select",
  );
  if (!select) return { ok: false, reason: "no-select", which };
  const wrapper = select.closest(".foliplus-dropdown");
  if (!wrapper) return { ok: false, reason: "no-wrapper", which };
  const trigger = wrapper.querySelector(".foliplus-dropdown-trigger");
  if (!trigger) return { ok: false, reason: "no-trigger", which };
  if (!trigger.classList.contains("foliplus-dropdown-open")) {
    trigger.click();
  }
  const openAfterClick = trigger.classList.contains("foliplus-dropdown-open");
  // Press on the panel header — inside the panel, outside the dropdown list.
  const panel = document.querySelector(".foliplus-layer-style-panel");
  const header = panel && panel.querySelector(".foliplus-panel-header");
  if (!header) return { ok: false, reason: "no-panel-header", which };
  header.dispatchEvent(
    new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
  );
  const openAfterOutside = trigger.classList.contains("foliplus-dropdown-open");
  return {
    ok: true,
    which,
    openAfterClick,
    openAfterOutside,
    closedByOutside: openAfterClick && !openAfterOutside,
  };
};
