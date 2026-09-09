() => {
  const panel = document.querySelector(".foliplus-panel-content");
  if (!panel) return null;
  const items = Array.from(
    panel.querySelectorAll(".foliplus-layer-item:not(.foliplus-color-layer-item)"),
  );
  if (items.length === 0) return null;
  const row = items[0];
  const checkbox = row.querySelector('input[type="checkbox"]');
  if (!checkbox) return null;

  const states = [];
  for (let i = 0; i < 3; i++) {
    checkbox.click();
    const cs = getComputedStyle(row);
    states.push({
      focusedClass: row.classList.contains("foliplus-layer-focused"),
      white: cs.backgroundColor,
      glow: cs.boxShadow !== "none",
    });
  }

  // Token white, sampled live.
  const probe = document.createElement("div");
  probe.style.background = "var(--neutral-0)";
  document.body.appendChild(probe);
  const white = getComputedStyle(probe).backgroundColor;
  probe.remove();

  return {
    white,
    states,
    anyCursorClass: states.some(s => s.focusedClass),
    anyGlow: states.some(s => s.glow),
  };
};
