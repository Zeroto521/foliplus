// Renames the solid-colour basemap row through its ⋮ menu and reports the
// committed label text plus its resident title. Pair with a page where the
// colour basemap row exists (it is always rendered by LayerControl).
() => {
  const ID = "foliplus_color_map";
  const row = () =>
    document.querySelector(`.foliplus-layer-item[data-layer-id="${ID}"]`);
  const input = () => row()?.querySelector(".foliplus-layer-rename-input");
  if (!input()) {
    row()?.querySelector(".foliplus-layer-more-btn")?.click();
    const rename = document.querySelector(
      '.foliplus-layer-more-menu.open li[data-action="rename-layer"]',
    );
    if (!rename) return null;
    rename.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }
  const field = input();
  if (!field) return null;
  field.value = "My Color";
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new FocusEvent("blur", { bubbles: false }));
  return new Promise(resolve => {
    let tries = 0;
    const tick = () => {
      const labelEl = row()?.querySelector(".foliplus-layer-label");
      if (labelEl?.textContent === "My Color" || ++tries > 40) {
        resolve({
          label: labelEl?.textContent ?? "",
          labelTitle: labelEl?.getAttribute("title") ?? null,
        });
      } else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
};
