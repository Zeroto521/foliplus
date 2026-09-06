() => {
  // Replaces the first data layer's name, commits it via blur, then reports
  // the committed label plus the checkbox's title and aria-label. Returns
  // null until the row settles. Pair with rename_first_layer.js.
  const row = () =>
    document.querySelector(".foliplus-layer-item:not(.foliplus-color-layer-item)");
  const input = row()?.querySelector(".foliplus-layer-rename-input");
  if (!input) return null;
  input.value = "RenamedLayer";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new FocusEvent("blur", { bubbles: false }));
  return new Promise(resolve => {
    let tries = 0;
    const tick = () => {
      const r = row();
      const label = r?.querySelector(".foliplus-layer-label")?.textContent ?? "";
      if (label === "RenamedLayer" || ++tries > 40) {
        const cb = r?.querySelector('input[type="checkbox"]');
        resolve({
          label,
          title: cb?.title ?? null,
          ariaLabel: cb?.getAttribute("aria-label") ?? null,
        });
      } else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
};
