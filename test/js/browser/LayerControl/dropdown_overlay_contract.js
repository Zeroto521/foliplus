// Shared dropdown overlay contract probe. Covers the four behaviours the
// lead's review asked to pin for every dropdown surface:
//   1. open-register — opening the dropdown lets the overlay registry own it
//      (the observable: an Escape closes the dropdown and NOT the host panel,
//      proving the dropdown registered at a higher rank than the panel);
//   2. escape-close-order — Escape closes the dropdown before the panel;
//   3. outside-close-order — an outside mousedown closes the dropdown before
//      the panel;
//   4. focus-return — the trigger regains focus after the dismissal.
// `how` selects the dismissal channel ("escape" | "outside"). The press must
// land INSIDE the panel but OUTSIDE the dropdown — an outside press on the map
// would close the row panel itself, making the two cases indistinguishable.
arg => {
  const { which, how = "escape" } = arg ?? {};
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
  const panel = document.querySelector(".foliplus-layer-style-panel");
  if (!panel) return { ok: false, reason: "no-panel", which, how };
  const panelOpenBefore = panel.isConnected;
  // Focus the trigger so the focus-return assertion has a real starting point.
  trigger.focus();
  const focusedTriggerBefore = document.activeElement === trigger;
  if (how === "escape") {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  } else {
    const header = panel.querySelector(".foliplus-panel-header");
    if (!header) return { ok: false, reason: "no-panel-header", which, how };
    header.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
  }
  const openAfterDismiss = trigger.classList.contains("foliplus-dropdown-open");
  const panelOpenAfter = panel.isConnected;
  const focusedTriggerAfter = document.activeElement === trigger;
  return {
    ok: true,
    which,
    how,
    openAfterClick,
    panelOpenBefore,
    focusedTriggerBefore,
    dismissed: openAfterClick && !openAfterDismiss,
    panelStayedOpen: panelOpenBefore && panelOpenAfter,
    focusReturned: focusedTriggerBefore && focusedTriggerAfter,
  };
};
