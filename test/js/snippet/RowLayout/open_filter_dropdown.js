async () => {
  const more = document.querySelector(".foliplus-layer-more-btn");
  if (!more) return false;
  more.click();
  await new Promise(r => setTimeout(r, 30));
  const menuItem = document.querySelector(
    '.foliplus-layer-more-menu [data-action="filter-layer"]',
  );
  if (!menuItem) return false;
  menuItem.click();
  await new Promise(r => setTimeout(r, 30));
  const panel = document.querySelector(".foliplus-layer-filter-panel");
  if (!panel) return false;
  const ref = document.createElement("div");
  ref.className = "row-layout-ref";
  const row = document.createElement("div");
  row.className = "foliplus-row";
  const c = document.createElement("div");
  c.className = "foliplus-row-content";
  c.textContent = "Reference";
  row.appendChild(c);
  ref.appendChild(row);
  document.body.appendChild(ref);
  const trigger = panel.querySelector(".foliplus-dropdown-trigger");
  if (!trigger) return false;
  trigger.click();
  await new Promise(r => setTimeout(r, 40));
  const option = document.querySelector(".foliplus-dropdown-option.foliplus-row");
  return !!(option && document.querySelector(".row-layout-ref .foliplus-row"));
};
