() => {
  const panel = document.querySelector(".foliplus-panel-content");
  if (!panel) return null;
  const base = panel.querySelector('.foliplus-layer-item[data-layer-type="base"]');
  const overlay = panel.querySelector(
    '.foliplus-layer-item:not([data-layer-type="base"]):not(.foliplus-color-layer-item)',
  );
  if (!base || !overlay) return null;

  const token = name => {
    const probe = document.createElement("div");
    probe.style.background = `var(${name})`;
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return c;
  };
  const white = token("--neutral-0");
  const wash = token("--accent-light");

  const pick = el => {
    const cs = getComputedStyle(el);
    return {
      glow: cs.boxShadow !== "none",
      bg: cs.backgroundColor,
      cursor: cs.cursor,
      active: el.classList.contains("active"),
    };
  };

  // Force base checked → rest wash; hover must keep wash (no white/glow)
  // and show the not-allowed cursor.
  const baseBox = base.querySelector('input[type="checkbox"]');
  if (baseBox && !baseBox.checked) {
    baseBox.checked = true;
    baseBox.dispatchEvent(new Event("change", { bubbles: true }));
  }
  base.classList.add("foliplus-layer-focused");
  const baseCheckedHover = pick(base);
  base.classList.remove("foliplus-layer-focused");

  // Overlay data row still gets the full cursor recipe — lit by keyboard
  // focus, not by a checkbox press (a press is a visibility toggle and no
  // longer paints the recipe; the recipe is sticky and nothing on the
  // toggle path would ever clear it). The overlay is the same node the probe
  // was built from, so no classList juggling is needed.
  overlay.focus();
  const overlayAfter = pick(overlay);

  // Color picker row is quiet too.
  const color = panel.querySelector(".foliplus-color-layer-item");
  const colorAfter = color ? pick(color) : null;

  return { white, wash, baseCheckedHover, overlayAfter, colorAfter };
};
