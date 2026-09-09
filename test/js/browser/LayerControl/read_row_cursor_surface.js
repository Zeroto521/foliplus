() => {
  const panel = document.querySelector(".foliplus-panel-content");
  if (!panel) return null;
  const items = Array.from(
    panel.querySelectorAll(".foliplus-layer-item:not(.foliplus-color-layer-item)"),
  );
  if (items.length < 2) return null;

  // Sample the design-token white the recipe is supposed to paint — never
  // hardcode a hex/rgb value (folium versions differ in resting row state).
  const probe = document.createElement("div");
  probe.style.background = "var(--neutral-0)";
  document.body.appendChild(probe);
  const white = getComputedStyle(probe).backgroundColor;
  probe.remove();

  const pick = el => {
    const cs = getComputedStyle(el);
    return {
      bg: cs.backgroundColor,
      shadow: cs.boxShadow,
      active: el.classList.contains("active"),
    };
  };

  // Row 0: force UNCHECKED → rest surface is clear; cursor must paint white.
  const unchecked = items[0];
  const box = unchecked.querySelector('input[type="checkbox"]');
  if (box && box.checked) {
    box.checked = false;
    box.dispatchEvent(new Event("change", { bubbles: true }));
  }
  const rest = pick(unchecked);
  unchecked.classList.add("foliplus-layer-focused");
  const cursor = pick(unchecked);
  unchecked.classList.remove("foliplus-layer-focused");

  // Row 1: force CHECKED → rest wash must survive the cursor (no white flash).
  const checkedRow = items[1];
  const cbox = checkedRow.querySelector('input[type="checkbox"]');
  if (cbox && !cbox.checked) {
    cbox.checked = true;
    cbox.dispatchEvent(new Event("change", { bubbles: true }));
  }
  const checkedRest = pick(checkedRow);
  checkedRow.classList.add("foliplus-layer-focused");
  const checkedCursor = pick(checkedRow);
  checkedRow.classList.remove("foliplus-layer-focused");

  return { white, rest, cursor, checkedRest, checkedCursor };
};
