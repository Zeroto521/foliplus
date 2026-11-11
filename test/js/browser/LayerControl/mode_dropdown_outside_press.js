// Open a style mode dropdown (border or fill), then dismiss it and report
// whether the popup closed. Pins the mode dropdown's overlay-registry
// registration: without it the dropdown never dismisses on an outside press
// or an Escape (the single Escape/press dispatcher from #1011 owns all
// dismissal paths). The press must land INSIDE the panel but OUTSIDE the
// dropdown — an outside press on the map would also close the row panel
// itself, which is a different dismissal and would make the two cases
// indistinguishable. `how` selects the dismissal: "outside" dispatches a
// mousedown on the panel header, "escape" dispatches an Escape keydown on
// the document.
arg => {
  const { which, how = "outside" } = arg ?? {};
  const select = document.querySelector(
    which === "fill"
      ? ".foliplus-style-fill-mode-select"
      : ".foliplus-style-border-mode-select",
  );
  if (!select) return { ok: false, reason: "no-select", which, how };
  const wrapper = select.closest(".foliplus-dropdown");
  if (!wrapper) return { ok: false, reason: "no-wrapper", which, how };
  const trigger = wrapper.querySelector(".foliplus-dropdown-trigger");
  if (!trigger) return { ok: false, reason: "no-trigger", which, how };
  if (!trigger.classList.contains("foliplus-dropdown-open")) {
    trigger.click();
  }
  const openAfterClick = trigger.classList.contains("foliplus-dropdown-open");
  if (how === "escape") {
    // The registry owns Escape on document capture; the popup must be the
    // first surface to answer it (rank above its host panel).
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  } else {
    // Press on the panel header — inside the panel, outside the dropdown list.
    const panel = document.querySelector(".foliplus-layer-style-panel");
    const header = panel && panel.querySelector(".foliplus-panel-header");
    if (!header) return { ok: false, reason: "no-panel-header", which, how };
    header.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
  }
  const openAfterDismiss = trigger.classList.contains("foliplus-dropdown-open");
  return {
    ok: true,
    which,
    how,
    openAfterClick,
    openAfterDismiss,
    dismissed: openAfterClick && !openAfterDismiss,
  };
};
