() => {
  // Set up a solid-color basemap the same way the user would: expand the
  // LayerControl panel, click the colour-row item, then drive the colour
  // input. This mirrors the real user path so the export test exercises the
  // same DOM state (`.active` on the container + `--color-layer-bg` var +
  // tilePane hidden) that `showColorLayer` produces.
  //
  // Returns the container's computed backgroundColor so the caller can assert
  // the colour took effect before triggering the export.
  const ctrl = document.querySelector(".foliplus-layer-ctrl");
  if (ctrl && !ctrl.classList.contains("is-expanded")) {
    ctrl.querySelector(".foliplus-toggle-btn").click();
  }
  const item = document.querySelector(".foliplus-color-layer-item");
  if (!item) return { ok: false, reason: "no colour item" };
  item.click();
  const input = document.querySelector(
    ".foliplus-color-layer-item input[type='color']",
  );
  if (input) {
    input.value = "#dc1e1e"; // rgb(220, 30, 30)
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  const container = document.querySelector(".leaflet-container");
  const cs = getComputedStyle(container);
  return {
    ok: true,
    containerActive: container.classList.contains("active"),
    cssVar: container.style.getPropertyValue("--color-layer-bg"),
    bg: cs.backgroundColor,
  };
};
