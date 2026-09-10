() => {
  const panel = document.querySelector(".foliplus-panel-content");
  if (!panel) return null;
  const base = panel.querySelector('.foliplus-layer-item[data-layer-type="base"]');
  const overlay = panel.querySelector(
    '.foliplus-layer-item:not([data-layer-type="base"]):not(.foliplus-color-layer-item)',
  );
  if (!base || !overlay) return null;

  const pick = el => {
    const cs = getComputedStyle(el);
    return {
      glow: cs.boxShadow !== "none",
      bg: cs.backgroundColor,
      cursor: cs.cursor,
    };
  };

  const baseBox = base.querySelector('input[type="checkbox"]');
  if (baseBox) baseBox.click();
  base.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
  const baseAfter = pick(base);

  const overlayBox = overlay.querySelector('input[type="checkbox"]');
  if (overlayBox) overlayBox.click();
  const overlayAfter = pick(overlay);

  const probe = document.createElement("div");
  probe.style.background = "var(--neutral-0)";
  document.body.appendChild(probe);
  const white = getComputedStyle(probe).backgroundColor;
  probe.remove();

  return { white, baseAfter, overlayAfter };
};
